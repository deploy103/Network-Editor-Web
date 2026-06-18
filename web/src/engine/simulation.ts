import { ipInSubnet, isIpv4 } from "./ip";
import { endpoint } from "./topology";
import type { NetworkDevice, NetworkPort, NetworkProject, SimulationEvent } from "../types/network";

export function fallbackPing(project: NetworkProject, sourceId: string, targetId: string): { project: NetworkProject; success: boolean; message: string } {
  const source = project.devices.find((device) => device.id === sourceId && device.powerOn);
  const target = project.devices.find((device) => device.id === targetId && device.powerOn);
  const now = Date.now();
  if (!source || !target) return append(project, false, "Source or target is missing/powered off.", sourceId, targetId, now);
  const sourcePort = source.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  const targetPort = target.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  if (!sourcePort || !targetPort) return append(project, false, "Both devices need active IPv4 interfaces.", source.id, target.id, now);

  let route = resolveRoute(project, source, sourcePort, target, targetPort);
  let evaluatedProject = project;
  if (route.reachable) {
    const firewall = applyFirewallRules(project, route.hops, sourcePort.ipAddress, targetPort.ipAddress);
    evaluatedProject = firewall.project;
    if (!firewall.allowed) {
      route = { ...route, reachable: false, message: firewall.message };
    }
  }
  const learned = route.reachable ? learnRuntime(evaluatedProject, source, sourcePort, target, targetPort, route.hops) : evaluatedProject;
  const withEvents = appendRouteEvents(learned, route, source, target, targetPort, now);
  return {
    project: withEvents,
    success: route.reachable,
    message: route.reachable ? `Reply from ${targetPort.ipAddress}: bytes=32 time<1ms TTL=${route.routed ? 64 : 128}` : route.message
  };
}

export function requestDhcp(project: NetworkProject, clientId: string): { project: NetworkProject; message: string } {
  const client = project.devices.find((device) => device.id === clientId);
  const clientPort = client?.ports.find((port) => port.adminUp && port.kind !== "console");
  const server = client && clientPort ? project.devices.find((device) =>
    device.powerOn &&
    device.config.services.dhcp &&
    device.config.dhcpPools.some((pool) => pool.enabled) &&
    hasLayer2Path(project, client.id, device.id, portVlan(clientPort)).reachable
  ) : undefined;
  const pool = server?.config.dhcpPools.find((item) => item.enabled);
  if (!client || !clientPort || !server || !pool) return { project, message: "No reachable DHCP server or active pool." };
  if (!isIpv4(pool.network) || !isIpv4(pool.mask) || !isIpv4(pool.startIp)) return { project, message: "DHCP pool has invalid network, mask, or start IP." };
  if (pool.defaultGateway && !ipInSubnet(pool.defaultGateway, pool.network, pool.mask)) return { project, message: "DHCP pool default gateway is outside the pool network." };
  const now = Date.now();
  const existingLease = server.runtime.dhcpLeases.find((lease) => lease.deviceId === client.id && lease.expiresAt > now);
  const active = new Set(server.runtime.dhcpLeases.filter((lease) => lease.deviceId !== client.id && lease.expiresAt > now).map((lease) => lease.ipAddress));
  let leasedIp = existingLease?.ipAddress ?? "";
  for (let index = 0; index < pool.maxLeases; index += 1) {
    if (leasedIp) break;
    const candidate = increment(pool.startIp, index);
    if (!active.has(candidate)) {
      leasedIp = candidate;
      break;
    }
  }
  if (!leasedIp) return { project, message: "DHCP pool is exhausted." };
  const expiresAt = now + 86_400_000;
  const packetId = `dhcp_${now}_${client.id}_${server.id}`;
  const nextProject = {
    ...project,
    devices: project.devices.map((device) => {
      if (device.id === client.id) {
        return { ...device, ports: device.ports.map((port) => (port.id === clientPort.id ? { ...port, ipAddress: leasedIp, subnetMask: pool.mask, gateway: pool.defaultGateway, dnsServer: pool.dnsServer } : port)) };
      }
      if (device.id === server.id) {
        return { ...device, runtime: { ...device.runtime, dhcpLeases: [...device.runtime.dhcpLeases.filter((lease) => lease.deviceId !== client.id), { ipAddress: leasedIp, macAddress: clientPort.macAddress, deviceId: client.id, expiresAt }] } };
      }
      return device;
    }),
    simulationEvents: [
      ...project.simulationEvents,
      event(client.id, server.id, "DHCP", "DHCPDISCOVER broadcast sent by client.", "forwarded", now, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(server.id, client.id, "DHCP", `DHCPOFFER ${leasedIp} prepared from pool ${pool.name}.`, "forwarded", now + 1, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(client.id, server.id, "DHCP", `DHCPREQUEST ${leasedIp} sent to ${server.label}.`, "forwarded", now + 2, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(server.id, client.id, "DHCP", `DHCPACK assigned ${leasedIp}.`, "delivered", now + 3, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId })
    ]
  };
  return { project: nextProject, message: `DHCP assigned ${leasedIp}.` };
}

interface RouteResult {
  reachable: boolean;
  message: string;
  hops: string[];
  routed: boolean;
}

function resolveRoute(project: NetworkProject, source: NetworkDevice, sourcePort: NetworkPort, target: NetworkDevice, targetPort: NetworkPort): RouteResult {
  if (ipInSubnet(sourcePort.ipAddress, targetPort.ipAddress, sourcePort.subnetMask)) {
    const l2 = hasLayer2Path(project, source.id, target.id, portVlan(sourcePort));
    return l2.reachable
      ? { reachable: true, message: "Direct subnet path resolved.", hops: l2.hops, routed: false }
      : { reachable: false, message: `No layer-2 path on VLAN ${portVlan(sourcePort)}.`, hops: l2.hops, routed: false };
  }

  if (isRoutingDevice(source)) {
    return routeFromDevice(project, source, target, targetPort, new Set([source.id]), [source.id]);
  }

  if (!sourcePort.gateway) {
    return { reachable: false, message: "Source has no default gateway.", hops: [source.id], routed: false };
  }

  const gateway = findInterfaceByIp(project, sourcePort.gateway);
  if (!gateway) {
    return { reachable: false, message: `Default gateway ${sourcePort.gateway} was not found.`, hops: [source.id], routed: false };
  }

  const gatewayPath = hasLayer2Path(project, source.id, gateway.device.id, portVlan(sourcePort));
  if (!gatewayPath.reachable) {
    return { reachable: false, message: `Cannot reach default gateway ${sourcePort.gateway}.`, hops: gatewayPath.hops, routed: false };
  }

  const routed = routeFromDevice(project, gateway.device, target, targetPort, new Set([gateway.device.id]), gatewayPath.hops);
  return { ...routed, routed: true };
}

function routeFromDevice(project: NetworkProject, router: NetworkDevice, target: NetworkDevice, targetPort: NetworkPort, seenRouters: Set<string>, hops: string[]): RouteResult {
  for (const port of router.ports.filter((item) => item.adminUp && item.ipAddress && item.subnetMask)) {
    if (ipInSubnet(targetPort.ipAddress, port.ipAddress, port.subnetMask)) {
      const path = hasLayer2Path(project, router.id, target.id, portVlan(port));
      if (path.reachable) return { reachable: true, message: "Route delivered through connected network.", hops: mergeHops(hops, path.hops), routed: true };
    }
  }

  for (const route of router.config.staticRoutes) {
    if (!ipInSubnet(targetPort.ipAddress, route.network, route.mask)) continue;
    const nextHop = findInterfaceByIp(project, route.nextHop);
    if (!nextHop || seenRouters.has(nextHop.device.id)) continue;
    const exitPort = router.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask && ipInSubnet(route.nextHop, port.ipAddress, port.subnetMask));
    if (!exitPort) continue;
    const nextHopPath = hasLayer2Path(project, router.id, nextHop.device.id, portVlan(exitPort));
    if (!nextHopPath.reachable) continue;
    seenRouters.add(nextHop.device.id);
    return routeFromDevice(project, nextHop.device, target, targetPort, seenRouters, mergeHops(hops, nextHopPath.hops));
  }

  return { reachable: false, message: `No route from ${router.label} to ${targetPort.ipAddress}.`, hops, routed: true };
}

function hasLayer2Path(project: NetworkProject, sourceId: string, targetId: string, vlan: number): { reachable: boolean; hops: string[] } {
  const seen = new Set([sourceId]);
  const queue = [sourceId];
  const previous = new Map<string, string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === targetId) return { reachable: true, hops: buildPath(previous, sourceId, targetId) };
    const currentDevice = project.devices.find((device) => device.id === current);
    if (!currentDevice?.powerOn) continue;
    if (current !== sourceId && current !== targetId && !canForwardLayer2(currentDevice)) continue;
    for (const link of project.links.filter((item) => item.status === "up" && (item.endpointA.deviceId === current || item.endpointB.deviceId === current))) {
      const other = link.endpointA.deviceId === current ? link.endpointB.deviceId : link.endpointA.deviceId;
      const currentPort = endpoint(project, link.endpointA.deviceId === current ? link.endpointA : link.endpointB)?.port;
      const otherEndpoint = endpoint(project, link.endpointA.deviceId === current ? link.endpointB : link.endpointA);
      if (!currentPort || !otherEndpoint || !linkCarriesVlan(currentPort, otherEndpoint.port, vlan) || !otherEndpoint.device.powerOn) continue;
      if (!seen.has(other)) {
        seen.add(other);
        previous.set(other, current);
        queue.push(other);
      }
    }
  }
  return { reachable: false, hops: [sourceId] };
}

function learnRuntime(project: NetworkProject, source: NetworkDevice, sourcePort: NetworkPort, target: NetworkDevice, targetPort: NetworkPort, hops: string[]): NetworkProject {
  return {
    ...project,
    devices: project.devices.map((device) => {
      if (device.id === source.id) {
        return {
          ...device,
          runtime: {
            ...device.runtime,
            arpTable: [...device.runtime.arpTable.filter((entry) => entry.ipAddress !== targetPort.ipAddress), { ipAddress: targetPort.ipAddress, macAddress: targetPort.macAddress, portName: sourcePort.name }]
          }
        };
      }
      const hopIndex = hops.indexOf(device.id);
      if (hopIndex > 0 && hopIndex < hops.length - 1 && canForwardLayer2(device)) {
        const ingressPortName = connectedPortName(project, hops[hopIndex - 1], device.id);
        const egressPortName = connectedPortName(project, hops[hopIndex + 1], device.id);
        const learnedEntries = [
          ...(ingressPortName ? [{ vlan: portVlan(sourcePort), macAddress: sourcePort.macAddress, portName: ingressPortName, type: "dynamic" as const }] : []),
          ...(egressPortName ? [{ vlan: portVlan(targetPort), macAddress: targetPort.macAddress, portName: egressPortName, type: "dynamic" as const }] : [])
        ];
        return {
          ...device,
          runtime: {
            ...device.runtime,
            macTable: [...device.runtime.macTable.filter((entry) => entry.macAddress !== sourcePort.macAddress && entry.macAddress !== targetPort.macAddress), ...learnedEntries]
          }
        };
      }
      return device;
    })
  };
}

function appendRouteEvents(project: NetworkProject, route: RouteResult, source: NetworkDevice, target: NetworkDevice, targetPort: NetworkPort, now: number): NetworkProject {
  const packetId = `pdu_${now}_${source.id}_${target.id}`;
  if (!route.reachable) {
    return {
      ...project,
      simulationEvents: [...project.simulationEvents, event(route.hops.at(-1) ?? source.id, target.id, "ICMP", route.message, "dropped", now, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId })]
    };
  }
  const events: SimulationEvent[] = [
    event(source.id, target.id, "ARP", `Resolved ${targetPort.ipAddress} to ${targetPort.macAddress}.`, "delivered", now, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId })
  ];
  for (let index = 1; index < route.hops.length - 1; index += 1) {
    const hop = project.devices.find((device) => device.id === route.hops[index]);
    if (hop?.kind === "hub") {
      events.push(event(route.hops[index - 1], route.hops[index], "HUB", `${hop.label} flooded the frame out active ports.`, "forwarded", now + index, ["Layer 1", "Layer 2"], { sourceId: source.id, targetId: target.id, packetId }));
    } else if (hop?.kind === "switch" || hop?.kind === "wireless") {
      events.push(event(route.hops[index - 1], route.hops[index], "SWITCH", `${hop.label} forwarded the frame using VLAN/MAC state.`, "forwarded", now + index, ["Layer 2"], { sourceId: source.id, targetId: target.id, packetId }));
    } else {
      events.push(event(route.hops[index - 1], route.hops[index], "ICMP", `Forwarded echo request through ${deviceLabel(project, route.hops[index])}.`, "forwarded", now + index, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId }));
    }
  }
  events.push(event(route.hops.at(-2) ?? source.id, target.id, "ICMP", `Echo reply received from ${target.label}.`, "delivered", now + route.hops.length, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId }));
  return { ...project, simulationEvents: [...project.simulationEvents, ...events] };
}

function applyFirewallRules(project: NetworkProject, hops: string[], sourceIp: string, targetIp: string): { project: NetworkProject; allowed: boolean; message: string } {
  let blocked = "";
  let matchedDeviceId = "";
  let matchedRuleId = "";
  const natHits = new Map<string, Set<string>>();
  for (let hopIndex = 0; hopIndex < hops.length; hopIndex += 1) {
    const deviceId = hops[hopIndex];
    const firewall = project.devices.find((device) => device.id === deviceId && device.kind === "firewall");
    if (!firewall) continue;
    const adjacentPorts = new Set([
      connectedPortName(project, hops[hopIndex - 1] ?? "", firewall.id),
      connectedPortName(project, hops[hopIndex + 1] ?? "", firewall.id)
    ].filter(Boolean));
    const matchingNatRules = firewall.config.natRules.filter((rule) => addressMatches(rule.insideLocal, sourceIp));
    if (matchingNatRules.length > 0) {
      natHits.set(firewall.id, new Set(matchingNatRules.map((rule) => rule.id)));
    }
    const rule = firewall.config.accessRules.find((item) =>
      (item.protocol === "ip" || item.protocol === "icmp") &&
      addressMatches(item.source, sourceIp) &&
      addressMatches(item.destination, targetIp) &&
      (!item.interfaceName || adjacentPorts.has(item.interfaceName))
    );
    if (!rule) continue;
    matchedDeviceId = firewall.id;
    matchedRuleId = rule.id;
    if (rule.action === "deny") blocked = `${firewall.label} denied ICMP from ${sourceIp} to ${targetIp}.`;
    break;
  }
  if (!matchedRuleId && natHits.size === 0) return { project, allowed: true, message: "" };
  const nextProject = {
    ...project,
    devices: project.devices.map((device) => {
      const natRuleIds = natHits.get(device.id);
      if (device.id !== matchedDeviceId && !natRuleIds) return device;
      return {
        ...device,
        config: {
          ...device.config,
          accessRules: device.config.accessRules.map((rule) => rule.id === matchedRuleId ? { ...rule, hits: rule.hits + 1 } : rule),
          natRules: device.config.natRules.map((rule) => natRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule)
        }
      };
    })
  };
  return { project: nextProject, allowed: !blocked, message: blocked };
}

function append(project: NetworkProject, success: boolean, message: string, sourceId: string, targetId: string, now: number) {
  const packetId = `pdu_${now}_${sourceId}_${targetId}`;
  return {
    project: {
      ...project,
      simulationEvents: [...project.simulationEvents, event(sourceId, targetId, "ICMP", message, success ? "delivered" : "dropped", now, ["Layer 2", "Layer 3"], { sourceId, targetId, packetId })]
    },
    success,
    message
  };
}

function event(lastDeviceId: string, atDeviceId: string, type: string, info: string, status: SimulationEvent["status"], time = Date.now(), osiLayers = ["Layer 2", "Layer 3"], packet?: { sourceId: string; targetId: string; packetId?: string }): SimulationEvent {
  return { id: `evt_${time}_${Math.random().toString(36).slice(2)}`, time, lastDeviceId, atDeviceId, sourceDeviceId: packet?.sourceId, targetDeviceId: packet?.targetId, packetId: packet?.packetId, type, info, status, osiLayers };
}

function increment(ip: string, offset: number): string {
  const parts = ip.split(".").map(Number);
  let value = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) + offset;
  value >>>= 0;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function findInterfaceByIp(project: NetworkProject, ipAddress: string): { device: NetworkDevice; port: NetworkPort } | null {
  for (const device of project.devices) {
    const port = device.ports.find((item) => item.adminUp && item.ipAddress === ipAddress);
    if (port && device.powerOn) return { device, port };
  }
  return null;
}

function isRoutingDevice(device: NetworkDevice): boolean {
  if (device.kind === "router" || device.kind === "firewall") return true;
  if (device.kind !== "switch") return false;
  return device.modelId === "switch-3560" || device.ports.some((port) => port.name.toLowerCase().startsWith("vlan") && port.adminUp && port.ipAddress && port.subnetMask);
}

function canForwardLayer2(device: NetworkDevice): boolean {
  return device.kind === "switch" || device.kind === "hub" || device.kind === "wireless";
}

function linkCarriesVlan(a: NetworkPort, b: NetworkPort, vlan: number): boolean {
  return portAllowsVlan(a, vlan) && portAllowsVlan(b, vlan);
}

function portAllowsVlan(port: NetworkPort, vlan: number): boolean {
  if (port.mode === "trunk") return port.allowedVlans.includes(vlan);
  return port.vlan === vlan;
}

function portVlan(port: NetworkPort): number {
  return port.mode === "trunk" ? port.allowedVlans[0] ?? 1 : port.vlan;
}

function buildPath(previous: Map<string, string>, sourceId: string, targetId: string): string[] {
  const path = [targetId];
  let current = targetId;
  while (current !== sourceId) {
    const parent = previous.get(current);
    if (!parent) break;
    path.unshift(parent);
    current = parent;
  }
  return path;
}

function mergeHops(a: string[], b: string[]): string[] {
  return [...a, ...b.filter((id, index) => index !== 0 || id !== a.at(-1))];
}

function deviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
}

function connectedPortName(project: NetworkProject, neighborId: string, deviceId: string): string {
  const link = project.links.find((item) =>
    item.status === "up" &&
    ((item.endpointA.deviceId === neighborId && item.endpointB.deviceId === deviceId) || (item.endpointB.deviceId === neighborId && item.endpointA.deviceId === deviceId))
  );
  if (!link) return "";
  const ref = link.endpointA.deviceId === deviceId ? link.endpointA : link.endpointB;
  return endpoint(project, ref)?.port.name ?? "";
}

function addressMatches(pattern: string, ipAddress: string): boolean {
  const value = pattern.trim().toLowerCase();
  if (!value || value === "any") return true;
  if (value.startsWith("host ")) return value.slice(5).trim() === ipAddress;
  if (value.includes("/")) {
    const [network, prefix] = value.split("/");
    const prefixNumber = Number(prefix);
    if (!Number.isInteger(prefixNumber) || prefixNumber < 0 || prefixNumber > 32) return false;
    return ipInSubnet(ipAddress, network, prefixToMask(prefixNumber));
  }
  const [network, mask] = value.split(/\s+/);
  if (mask) return ipInSubnet(ipAddress, network, mask);
  return value === ipAddress;
}

function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join(".");
}
