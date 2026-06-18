import { ipInSubnet, ipToNumber, isIpv4 } from "./ip";
import { endpoint } from "./topology";
import type { NetworkDevice, NetworkPort, NetworkProject, SimulationEvent } from "../types/network";

export function fallbackPing(project: NetworkProject, sourceId: string, targetId: string): { project: NetworkProject; success: boolean; message: string } {
  const source = project.devices.find((device) => device.id === sourceId && device.powerOn);
  const target = project.devices.find((device) => device.id === targetId && device.powerOn);
  const now = Date.now();
  if (!source || !target) return append(project, false, "출발지 또는 목적지 장비가 없거나 전원이 꺼져 있습니다.", sourceId, targetId, now);
  const sourcePort = source.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  const targetPort = target.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  if (!sourcePort || !targetPort) return append(project, false, "두 장비 모두 활성 IPv4 인터페이스가 필요합니다.", source.id, target.id, now);

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
    message: route.reachable ? `${targetPort.ipAddress} 응답: bytes=32 time<1ms TTL=${route.routed ? 64 : 128}` : route.message
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
  if (!client || !clientPort || !server || !pool) return { project, message: "도달 가능한 DHCP 서버 또는 활성 풀이 없습니다." };
  if (!isIpv4(pool.network) || !isIpv4(pool.mask) || !isIpv4(pool.startIp)) return { project, message: "DHCP 풀의 네트워크, 마스크 또는 시작 IP가 올바르지 않습니다." };
  if (pool.defaultGateway && !ipInSubnet(pool.defaultGateway, pool.network, pool.mask)) return { project, message: "DHCP 풀 기본 게이트웨이가 풀 네트워크 밖에 있습니다." };
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
  if (!leasedIp) return { project, message: "DHCP 풀에서 할당할 수 있는 주소가 없습니다." };
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
      event(client.id, server.id, "DHCP", "클라이언트가 DHCPDISCOVER 브로드캐스트를 보냈습니다.", "forwarded", now, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(server.id, client.id, "DHCP", `${pool.name} 풀에서 DHCPOFFER ${leasedIp}을(를) 준비했습니다.`, "forwarded", now + 1, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(client.id, server.id, "DHCP", `${server.label}에 DHCPREQUEST ${leasedIp}을(를) 보냈습니다.`, "forwarded", now + 2, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(server.id, client.id, "DHCP", `DHCPACK으로 ${leasedIp}을(를) 할당했습니다.`, "delivered", now + 3, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId })
    ]
  };
  return { project: nextProject, message: `DHCP가 ${leasedIp}을(를) 할당했습니다.` };
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
      ? { reachable: true, message: "같은 서브넷 경로를 확인했습니다.", hops: l2.hops, routed: false }
      : { reachable: false, message: `VLAN ${portVlan(sourcePort)}에서 Layer 2 경로가 없습니다.`, hops: l2.hops, routed: false };
  }

  if (isRoutingDevice(source)) {
    return routeFromDevice(project, source, target, targetPort, new Set([source.id]), [source.id]);
  }

  if (!sourcePort.gateway) {
    return { reachable: false, message: "출발지에 기본 게이트웨이가 없습니다.", hops: [source.id], routed: false };
  }

  const gateway = findInterfaceByIp(project, sourcePort.gateway);
  if (!gateway) {
    return { reachable: false, message: `기본 게이트웨이 ${sourcePort.gateway}을(를) 찾을 수 없습니다.`, hops: [source.id], routed: false };
  }

  const gatewayPath = hasLayer2Path(project, source.id, gateway.device.id, portVlan(sourcePort));
  if (!gatewayPath.reachable) {
    return { reachable: false, message: `기본 게이트웨이 ${sourcePort.gateway}에 도달할 수 없습니다.`, hops: gatewayPath.hops, routed: false };
  }

  const routed = routeFromDevice(project, gateway.device, target, targetPort, new Set([gateway.device.id]), gatewayPath.hops);
  return { ...routed, routed: true };
}

function routeFromDevice(project: NetworkProject, router: NetworkDevice, target: NetworkDevice, targetPort: NetworkPort, seenRouters: Set<string>, hops: string[]): RouteResult {
  for (const port of router.ports.filter((item) => item.adminUp && item.ipAddress && item.subnetMask)) {
    if (ipInSubnet(targetPort.ipAddress, port.ipAddress, port.subnetMask)) {
      const path = hasLayer2Path(project, router.id, target.id, portVlan(port));
      if (path.reachable) return { reachable: true, message: "연결된 네트워크를 통해 라우팅되었습니다.", hops: mergeHops(hops, path.hops), routed: true };
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

  for (const neighbor of dynamicRoutingNeighbors(project, router)) {
    if (seenRouters.has(neighbor.device.id)) continue;
    const nextHopPath = hasLayer2Path(project, router.id, neighbor.device.id, portVlan(neighbor.localPort));
    if (!nextHopPath.reachable) continue;
    seenRouters.add(neighbor.device.id);
    return routeFromDevice(project, neighbor.device, target, targetPort, seenRouters, mergeHops(hops, nextHopPath.hops));
  }

  return { reachable: false, message: `${router.label}에서 ${targetPort.ipAddress}(으)로 가는 라우트가 없습니다.`, hops, routed: true };
}

function dynamicRoutingNeighbors(project: NetworkProject, router: NetworkDevice): Array<{ device: NetworkDevice; localPort: NetworkPort }> {
  if (!routingProtocols(router).length) return [];
  const neighbors: Array<{ device: NetworkDevice; localPort: NetworkPort }> = [];
  for (const candidate of project.devices.filter((device) => device.id !== router.id && device.powerOn && isRoutingDevice(device) && shareRoutingProtocol(router, device))) {
    for (const localPort of routedIpPorts(router)) {
      const peerPort = routedIpPorts(candidate).find((port) => ipInSubnet(port.ipAddress, localPort.ipAddress, localPort.subnetMask));
      if (peerPort && hasLayer2Path(project, router.id, candidate.id, portVlan(localPort)).reachable) {
        neighbors.push({ device: candidate, localPort });
        break;
      }
    }
  }
  return neighbors;
}

function routedIpPorts(device: NetworkDevice): NetworkPort[] {
  return device.ports.filter((port) => port.adminUp && port.ipAddress && port.subnetMask);
}

function routingProtocols(device: NetworkDevice): NonNullable<NetworkDevice["config"]["routingProtocols"]> {
  return device.config.routingProtocols ?? [];
}

function shareRoutingProtocol(a: NetworkDevice, b: NetworkDevice): boolean {
  return routingProtocols(a).some((left) => routingProtocols(b).some((right) =>
    left.protocol === right.protocol &&
    (left.protocol !== "eigrp" || (left.processId ?? "") === (right.processId ?? ""))
  ));
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
    event(source.id, target.id, "ARP", `${targetPort.ipAddress}을(를) ${targetPort.macAddress}(으)로 확인했습니다.`, "delivered", now, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId })
  ];
  for (let index = 1; index < route.hops.length - 1; index += 1) {
    const hop = project.devices.find((device) => device.id === route.hops[index]);
    if (hop?.kind === "hub") {
      events.push(event(route.hops[index - 1], route.hops[index], "HUB", `${hop.label}이(가) 활성 포트로 프레임을 플러딩했습니다.`, "forwarded", now + index, ["Layer 1", "Layer 2"], { sourceId: source.id, targetId: target.id, packetId }));
    } else if (hop?.kind === "switch" || hop?.kind === "wireless") {
      events.push(event(route.hops[index - 1], route.hops[index], "SWITCH", `${hop.label}이(가) VLAN/MAC 상태로 프레임을 전달했습니다.`, "forwarded", now + index, ["Layer 2"], { sourceId: source.id, targetId: target.id, packetId }));
    } else {
      events.push(event(route.hops[index - 1], route.hops[index], "ICMP", `${deviceLabel(project, route.hops[index])}을(를) 통해 echo 요청을 전달했습니다.`, "forwarded", now + index, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId }));
    }
  }
  events.push(event(route.hops.at(-2) ?? source.id, target.id, "ICMP", `${target.label}에서 echo 응답을 받았습니다.`, "delivered", now + route.hops.length, ["Layer 2", "Layer 3"], { sourceId: source.id, targetId: target.id, packetId }));
  return { ...project, simulationEvents: [...project.simulationEvents, ...events] };
}

function applyFirewallRules(project: NetworkProject, hops: string[], sourceIp: string, targetIp: string): { project: NetworkProject; allowed: boolean; message: string } {
  let blocked = "";
  const accessHits = new Map<string, Set<string>>();
  const natHits = new Map<string, Set<string>>();
  for (let hopIndex = 0; hopIndex < hops.length; hopIndex += 1) {
    const deviceId = hops[hopIndex];
    const filterDevice = project.devices.find((device) => device.id === deviceId && device.config.accessRules.length);
    const firewall = project.devices.find((device) => device.id === deviceId && device.kind === "firewall");
    if (!filterDevice && !firewall) continue;
    const policyDevice = filterDevice ?? firewall;
    if (!policyDevice) continue;
    const ingressPortName = connectedPortName(project, hops[hopIndex - 1] ?? "", policyDevice.id);
    const egressPortName = connectedPortName(project, hops[hopIndex + 1] ?? "", policyDevice.id);
    const ingressPort = policyDevice.ports.find((port) => port.name === ingressPortName);
    const egressPort = policyDevice.ports.find((port) => port.name === egressPortName);
    const adjacentPorts = new Set([
      ingressPortName,
      egressPortName
    ].filter(Boolean));

    for (const binding of [
      { port: ingressPort, listName: ingressPort?.accessGroupIn, direction: "in" },
      { port: egressPort, listName: egressPort?.accessGroupOut, direction: "out" }
    ]) {
      if (!binding.listName) continue;
      const decision = evaluateAcl(policyDevice, binding.listName, sourceIp, targetIp);
      if (!decision) continue;
      if (decision.ruleId) addHit(accessHits, policyDevice.id, decision.ruleId);
      if (!decision.allowed) {
        blocked = `${policyDevice.label} ${binding.port?.name ?? ""} ${binding.direction} ACL ${binding.listName}이(가) ${sourceIp}에서 ${targetIp}(으)로 가는 ICMP를 차단했습니다.`;
        break;
      }
    }
    if (blocked) break;

    const matchingNatRules = firewall?.config.natRules.filter((rule) => addressMatches(rule.insideLocal, sourceIp)) ?? [];
    if (matchingNatRules.length > 0) {
      natHits.set(policyDevice.id, new Set(matchingNatRules.map((rule) => rule.id)));
    }
    const legacyRule = policyDevice.config.accessRules.find((item) =>
      !item.listName &&
      (item.protocol === "ip" || item.protocol === "icmp") &&
      addressMatches(item.source, sourceIp) &&
      addressMatches(item.destination, targetIp) &&
      (!item.interfaceName || adjacentPorts.has(item.interfaceName))
    );
    if (!legacyRule) continue;
    addHit(accessHits, policyDevice.id, legacyRule.id);
    if (legacyRule.action === "deny") {
      blocked = `${policyDevice.label}이(가) ${sourceIp}에서 ${targetIp}(으)로 가는 ICMP를 차단했습니다.`;
      break;
    }
  }
  if (accessHits.size === 0 && natHits.size === 0) return { project, allowed: !blocked, message: blocked };
  const nextProject = {
    ...project,
    devices: project.devices.map((device) => {
      const accessRuleIds = accessHits.get(device.id);
      const natRuleIds = natHits.get(device.id);
      if (!accessRuleIds && !natRuleIds) return device;
      return {
        ...device,
        config: {
          ...device.config,
          accessRules: device.config.accessRules.map((rule) => accessRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule),
          natRules: device.config.natRules.map((rule) => natRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule)
        }
      };
    })
  };
  return { project: nextProject, allowed: !blocked, message: blocked };
}

function evaluateAcl(device: NetworkDevice, listName: string, sourceIp: string, targetIp: string): { allowed: boolean; ruleId?: string } | null {
  const rules = device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() === listName.toLowerCase());
  if (!rules.length) return null;
  const rule = rules.find((item) =>
    (item.protocol === "ip" || item.protocol === "icmp") &&
    addressMatches(item.source, sourceIp) &&
    addressMatches(item.destination, targetIp)
  );
  if (!rule) return { allowed: false };
  return { allowed: rule.action === "permit", ruleId: rule.id };
}

function aclListName(rule: NetworkDevice["config"]["accessRules"][number]): string {
  return rule.listName || rule.interfaceName || "ACL";
}

function addHit(map: Map<string, Set<string>>, deviceId: string, ruleId: string): void {
  map.set(deviceId, new Set([...(map.get(deviceId) ?? []), ruleId]));
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
  const value = stripAclOptions(pattern.trim().toLowerCase());
  if (!value || value === "any") return true;
  if (value.startsWith("host ")) return value.split(/\s+/)[1] === ipAddress;
  if (value.includes("/")) {
    const [network, prefix] = value.split("/");
    const prefixNumber = Number(prefix);
    if (!Number.isInteger(prefixNumber) || prefixNumber < 0 || prefixNumber > 32) return false;
    return ipInSubnet(ipAddress, network, prefixToMask(prefixNumber));
  }
  const [network, mask] = value.split(/\s+/);
  if (mask) return ipInSubnet(ipAddress, network, mask) || ipMatchesWildcard(ipAddress, network, mask);
  return value === ipAddress;
}

function stripAclOptions(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const optionIndex = tokens.findIndex((token) => token === "eq" || token === "neq" || token === "gt" || token === "lt" || token === "range" || token === "log" || token === "established");
  return (optionIndex >= 0 ? tokens.slice(0, optionIndex) : tokens).join(" ");
}

function ipMatchesWildcard(ipAddress: string, network: string, wildcard: string): boolean {
  if (!isIpv4(ipAddress) || !isIpv4(network) || !isIpv4(wildcard)) return false;
  const inverseWildcard = (~ipToNumber(wildcard)) >>> 0;
  return ((ipToNumber(ipAddress) ^ ipToNumber(network)) & inverseWildcard) === 0;
}

function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join(".");
}
