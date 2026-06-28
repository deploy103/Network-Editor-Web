import { ipInSubnet, ipToNumber, isIpv4, isSubnetMask } from "./ip";
import { endpoint } from "./topology";
import type { DhcpPool, NetworkDevice, NetworkPort, NetworkProject, SimulationEvent } from "../types/network";

export function fallbackPing(project: NetworkProject, sourceId: string, targetId: string): { project: NetworkProject; success: boolean; message: string } {
  const source = project.devices.find((device) => device.id === sourceId && device.powerOn);
  const target = project.devices.find((device) => device.id === targetId && device.powerOn);
  const now = Date.now();
  if (!source || !target) return append(project, false, "출발지 또는 목적지 장비가 없거나 전원이 꺼져 있습니다.", sourceId, targetId, now);
  const sourcePort = source.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  const targetPort = target.ports.find((port) => port.adminUp && port.ipAddress && port.subnetMask);
  if (!sourcePort || !targetPort) return append(project, false, "두 장비 모두 활성 IPv4 인터페이스가 필요합니다.", source.id, target.id, now);

  let route = resolveRoute(project, source, sourcePort, target, targetPort);
  let evaluatedProject = applyPolicyHits(project, route.policyHits ?? []);
  if (route.reachable) {
    const firewall = applyFirewallRules(evaluatedProject, route.hops, sourcePort.ipAddress, targetPort.ipAddress);
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

function applyPolicyHits(project: NetworkProject, hits: RoutePolicyHit[]): NetworkProject {
  if (!hits.length) return project;
  const routeMapHits = new Map<string, Set<string>>();
  const accessRuleHits = new Map<string, Set<string>>();
  const prefixListHits = new Map<string, Set<string>>();
  for (const hit of hits) {
    routeMapHits.set(hit.deviceId, new Set([...(routeMapHits.get(hit.deviceId) ?? []), hit.routeMapId]));
    if (hit.accessRuleId) accessRuleHits.set(hit.deviceId, new Set([...(accessRuleHits.get(hit.deviceId) ?? []), hit.accessRuleId]));
    if (hit.prefixListId) prefixListHits.set(hit.deviceId, new Set([...(prefixListHits.get(hit.deviceId) ?? []), hit.prefixListId]));
  }
  return {
    ...project,
    devices: project.devices.map((device) => {
      const routeMapIds = routeMapHits.get(device.id);
      const accessRuleIds = accessRuleHits.get(device.id);
      const prefixListIds = prefixListHits.get(device.id);
      if (!routeMapIds?.size && !accessRuleIds?.size && !prefixListIds?.size) return device;
      return {
        ...device,
        config: {
          ...device.config,
          routeMaps: (device.config.routeMaps ?? []).map((entry) => routeMapIds?.has(entry.id) ? { ...entry, hits: entry.hits + 1 } : entry),
          prefixLists: (device.config.prefixLists ?? []).map((entry) => prefixListIds?.has(entry.id) ? { ...entry, hits: entry.hits + 1 } : entry),
          accessRules: device.config.accessRules.map((rule) => accessRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule)
        }
      };
    })
  };
}

export function requestDhcp(project: NetworkProject, clientId: string): { project: NetworkProject; message: string } {
  const client = project.devices.find((device) => device.id === clientId);
  const clientPort = client?.ports.find((port) => port.adminUp && port.kind !== "console");
  const serverMatch = client && clientPort ? findDhcpServer(project, client, clientPort) : null;
  const server = serverMatch?.server;
  const pool = server && clientPort ? selectDhcpPool(server, serverMatch, clientPort) : undefined;
  if (!client || !clientPort || !server || !pool) return { project, message: "도달 가능한 DHCP 서버 또는 활성 풀이 없습니다." };
  const snoopingBlock = !serverMatch?.relay ? dhcpSnoopingBlock(project, client, server, portVlan(clientPort)) : "";
  if (snoopingBlock) return { project, message: snoopingBlock };
  if (!isIpv4(pool.network) || !isSubnetMask(pool.mask) || ipToNumber(pool.mask) === 0 || !isIpv4(pool.startIp)) return { project, message: "DHCP 풀의 네트워크, 마스크 또는 시작 IP가 올바르지 않습니다." };
  if (!ipInSubnet(pool.startIp, pool.network, pool.mask)) return { project, message: "DHCP 풀 시작 IP가 풀 네트워크 밖에 있습니다." };
  if (pool.defaultGateway && !ipInSubnet(pool.defaultGateway, pool.network, pool.mask)) return { project, message: "DHCP 풀 기본 게이트웨이가 풀 네트워크 밖에 있습니다." };
  const now = Date.now();
  const existingLease = server.runtime.dhcpLeases.find((lease) =>
    lease.deviceId === client.id &&
    lease.expiresAt > now &&
    ipInSubnet(lease.ipAddress, pool.network, pool.mask) &&
    !isDhcpExcluded(server, lease.ipAddress)
  );
  const active = new Set(server.runtime.dhcpLeases.filter((lease) => lease.deviceId !== client.id && lease.expiresAt > now).map((lease) => lease.ipAddress));
  const reserved = new Set(project.devices.flatMap((device) => device.ports.map((port) => port.ipAddress).filter(Boolean)));
  let leasedIp = existingLease?.ipAddress ?? "";
  for (let index = 0; index < pool.maxLeases; index += 1) {
    if (leasedIp) break;
    const candidate = increment(pool.startIp, index);
    if (ipInSubnet(candidate, pool.network, pool.mask) && !active.has(candidate) && !reserved.has(candidate) && !isDhcpExcluded(server, candidate)) {
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
      ...(serverMatch?.relay ? [event(serverMatch.relay.id, server.id, "DHCP", `${serverMatch.relay.label}이(가) helper-address로 DHCP 요청을 릴레이했습니다.`, "forwarded" as const, now + 0.5, ["Layer 7", "Layer 3"], { sourceId: client.id, targetId: server.id, packetId })] : []),
      event(server.id, client.id, "DHCP", `${pool.name} 풀에서 DHCPOFFER ${leasedIp}을(를) 준비했습니다.`, "forwarded", now + 1, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(client.id, server.id, "DHCP", `${server.label}에 DHCPREQUEST ${leasedIp}을(를) 보냈습니다.`, "forwarded", now + 2, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId }),
      event(server.id, client.id, "DHCP", `DHCPACK으로 ${leasedIp}을(를) 할당했습니다.`, "delivered", now + 3, ["Layer 7", "Layer 3", "Layer 2"], { sourceId: client.id, targetId: server.id, packetId })
    ]
  };
  return { project: nextProject, message: `DHCP가 ${leasedIp}을(를) 할당했습니다.` };
}

function findDhcpServer(project: NetworkProject, client: NetworkDevice, clientPort: NetworkPort): { server: NetworkDevice; relay?: NetworkDevice; relayPort?: NetworkPort } | null {
  const direct = project.devices.find((device) =>
    device.powerOn &&
    device.config.services.dhcp &&
    device.config.dhcpPools.some((pool) => pool.enabled) &&
    hasLayer2Path(project, client.id, device.id, portVlan(clientPort)).reachable
  );
  if (direct) return { server: direct };

  for (const relay of project.devices.filter((device) => device.powerOn && isRoutingDevice(device))) {
    for (const relayPort of relay.ports.filter((port) => port.adminUp && port.helperAddresses?.length)) {
      const clientToRelay = hasLayer2Path(project, client.id, relay.id, portVlan(clientPort));
      if (!clientToRelay.reachable) continue;
      for (const helperAddress of relayPort.helperAddresses ?? []) {
        const helper = findInterfaceByIp(project, helperAddress);
        if (!helper?.device.config.services.dhcp || !helper.device.config.dhcpPools.some((pool) => pool.enabled)) continue;
        const routed = routeFromDevice(project, relay, helper.device, helper.port, new Set([relay.id]), [relay.id]);
        if (routed.reachable) return { server: helper.device, relay, relayPort };
      }
    }
  }
  return null;
}

function selectDhcpPool(server: NetworkDevice, serverMatch: { relay?: NetworkDevice; relayPort?: NetworkPort } | null, clientPort: NetworkPort): DhcpPool | undefined {
  const pools = server.config.dhcpPools.filter((item) => item.enabled);
  const clientSubnetPort = serverMatch?.relayPort ?? (clientPort.ipAddress ? clientPort : undefined);
  if (clientSubnetPort?.ipAddress) {
    const matchingClientSubnet = pools.find((pool) => ipInSubnet(clientSubnetPort.ipAddress, pool.network, pool.mask));
    if (matchingClientSubnet) return matchingClientSubnet;
  }
  if (!serverMatch?.relayPort) {
    const matchingServerSubnet = pools.find((pool) =>
      server.ports.some((port) => port.adminUp && port.ipAddress && ipInSubnet(port.ipAddress, pool.network, pool.mask))
    );
    if (matchingServerSubnet) return matchingServerSubnet;
  }
  return pools[0];
}

function dhcpSnoopingBlock(project: NetworkProject, client: NetworkDevice, server: NetworkDevice, vlan: number): string {
  const path = hasLayer2Path(project, client.id, server.id, vlan);
  if (!path.reachable) return "";
  for (let index = 1; index < path.hops.length - 1; index += 1) {
    const device = project.devices.find((item) => item.id === path.hops[index]);
    if (!device || device.kind !== "switch") continue;
    const snooping = device.config.dhcpSnooping;
    if (!snooping?.enabled || !snooping.vlans.includes(vlan)) continue;
    const serverSidePortName = connectedPortName(project, path.hops[index + 1], device.id);
    const serverSidePort = device.ports.find((port) => port.name === serverSidePortName);
    if (serverSidePort?.dhcpSnoopingTrusted) continue;
    return `${device.label} DHCP Snooping이 VLAN ${vlan}의 untrusted 포트 ${serverSidePortName || "unknown"}에서 DHCP 서버 응답을 차단했습니다.`;
  }
  return "";
}

interface RouteResult {
  reachable: boolean;
  message: string;
  hops: string[];
  routed: boolean;
  policyHits?: RoutePolicyHit[];
}

interface RoutePolicyHit {
  deviceId: string;
  routeMapId: string;
  accessRuleId?: string;
  prefixListId?: string;
}

function resolveRoute(project: NetworkProject, source: NetworkDevice, sourcePort: NetworkPort, target: NetworkDevice, targetPort: NetworkPort): RouteResult {
  if (ipInSubnet(sourcePort.ipAddress, targetPort.ipAddress, sourcePort.subnetMask)) {
    const l2 = hasLayer2Path(project, source.id, target.id, portVlan(sourcePort));
    return l2.reachable
      ? { reachable: true, message: "같은 서브넷 경로를 확인했습니다.", hops: l2.hops, routed: false }
      : { reachable: false, message: `VLAN ${portVlan(sourcePort)}에서 Layer 2 경로가 없습니다.`, hops: l2.hops, routed: false };
  }

  if (isRoutingDevice(source)) {
    return routeFromDevice(project, source, target, targetPort, new Set([source.id]), [source.id], sourcePort.ipAddress);
  }

  if (!sourcePort.gateway) {
    return { reachable: false, message: "출발지에 기본 게이트웨이가 없습니다.", hops: [source.id], routed: false };
  }

  const gateway = findGatewayInterface(project, sourcePort.gateway, source.id, portVlan(sourcePort));
  if (!gateway) {
    return { reachable: false, message: `기본 게이트웨이 ${sourcePort.gateway}을(를) 찾을 수 없습니다.`, hops: [source.id], routed: false };
  }

  const gatewayPath = hasLayer2Path(project, source.id, gateway.device.id, portVlan(sourcePort));
  if (!gatewayPath.reachable) {
    return { reachable: false, message: `기본 게이트웨이 ${sourcePort.gateway}에 도달할 수 없습니다.`, hops: gatewayPath.hops, routed: false };
  }

  const routed = routeFromDevice(project, gateway.device, target, targetPort, new Set([gateway.device.id]), gatewayPath.hops, sourcePort.ipAddress, gateway.port);
  return { ...routed, routed: true };
}

function routeFromDevice(project: NetworkProject, router: NetworkDevice, target: NetworkDevice, targetPort: NetworkPort, seenRouters: Set<string>, hops: string[], sourceIp = "", ingressPort?: NetworkPort): RouteResult {
  const policy = ingressPort?.policyRouteMap ? evaluatePolicyRouteMap(router, ingressPort.policyRouteMap, sourceIp, targetPort.ipAddress) : null;
  const policyHits = policy ? [{ deviceId: router.id, routeMapId: policy.routeMap.id, accessRuleId: policy.accessRuleId, prefixListId: policy.prefixListId }] : [];
  if (policy?.routeMap.action === "permit" && policy.routeMap.setNextHop) {
    const policyRoute = routeViaNextHop(project, router, target, targetPort, seenRouters, hops, sourceIp, policy.routeMap.setNextHop);
    return policyRoute
      ? appendPolicyHits(policyRoute, policyHits)
      : {
          reachable: false,
          message: `${router.label} PBR next-hop ${policy.routeMap.setNextHop}에 도달할 수 없습니다.`,
          hops,
          routed: true,
          policyHits
        };
  }

  for (const entry of interfaceIpEntries(router)) {
    if (ipInSubnet(targetPort.ipAddress, entry.ipAddress, entry.subnetMask)) {
      const path = hasLayer2Path(project, router.id, target.id, portVlan(entry.port));
      if (path.reachable) return appendPolicyHits({ reachable: true, message: "연결된 네트워크를 통해 라우팅되었습니다.", hops: mergeHops(hops, path.hops), routed: true }, policyHits);
    }
  }

  for (const route of [...router.config.staticRoutes].sort((left, right) => staticRouteDistance(left) - staticRouteDistance(right))) {
    if (route.trackId && !trackObjectUp(project, router, route.trackId)) continue;
    if (!ipInSubnet(targetPort.ipAddress, route.network, route.mask)) continue;
    const exitEntry = interfaceIpEntries(router).find((entry) => ipInSubnet(route.nextHop, entry.ipAddress, entry.subnetMask));
    if (!exitEntry) continue;
    const nextHop = findGatewayInterface(project, route.nextHop, router.id, portVlan(exitEntry.port));
    if (!nextHop || seenRouters.has(nextHop.device.id)) continue;
    const nextHopPath = hasLayer2Path(project, router.id, nextHop.device.id, portVlan(exitEntry.port));
    if (!nextHopPath.reachable) continue;
    seenRouters.add(nextHop.device.id);
    return appendPolicyHits(routeFromDevice(project, nextHop.device, target, targetPort, seenRouters, mergeHops(hops, nextHopPath.hops), sourceIp, nextHop.port), policyHits);
  }

  for (const neighbor of dynamicRoutingNeighbors(project, router)) {
    if (seenRouters.has(neighbor.device.id)) continue;
    const nextHopPath = hasLayer2Path(project, router.id, neighbor.device.id, portVlan(neighbor.localPort));
    if (!nextHopPath.reachable) continue;
    seenRouters.add(neighbor.device.id);
    const ingress = routedIpPorts(neighbor.device).find((port) => ipInSubnet(port.ipAddress, neighbor.localPort.ipAddress, neighbor.localPort.subnetMask));
    return appendPolicyHits(routeFromDevice(project, neighbor.device, target, targetPort, seenRouters, mergeHops(hops, nextHopPath.hops), sourceIp, ingress), policyHits);
  }

  return appendPolicyHits({ reachable: false, message: `${router.label}에서 ${targetPort.ipAddress}(으)로 가는 라우트가 없습니다.`, hops, routed: true }, policyHits);
}

function routeViaNextHop(project: NetworkProject, router: NetworkDevice, target: NetworkDevice, targetPort: NetworkPort, seenRouters: Set<string>, hops: string[], sourceIp: string, nextHopIp: string): RouteResult | null {
  const exitEntry = interfaceIpEntries(router).find((entry) => ipInSubnet(nextHopIp, entry.ipAddress, entry.subnetMask));
  if (!exitEntry) return null;
  const nextHop = findGatewayInterface(project, nextHopIp, router.id, portVlan(exitEntry.port));
  if (!nextHop || seenRouters.has(nextHop.device.id)) return null;
  const nextHopPath = hasLayer2Path(project, router.id, nextHop.device.id, portVlan(exitEntry.port));
  if (!nextHopPath.reachable) return null;
  const nextSeen = new Set(seenRouters);
  nextSeen.add(nextHop.device.id);
  return routeFromDevice(project, nextHop.device, target, targetPort, nextSeen, mergeHops(hops, nextHopPath.hops), sourceIp, nextHop.port);
}

function evaluatePolicyRouteMap(router: NetworkDevice, routeMapName: string, sourceIp: string, targetIp: string): { routeMap: NonNullable<NetworkDevice["config"]["routeMaps"]>[number]; accessRuleId?: string; prefixListId?: string } | null {
  if (!sourceIp || !targetIp) return null;
  const entries = (router.config.routeMaps ?? [])
    .filter((entry) => entry.name.toLowerCase() === routeMapName.toLowerCase())
    .sort((left, right) => left.sequence - right.sequence);
  for (const entry of entries) {
    const aclMatch = evaluatePolicyAclMatch(router, entry.matchAccessLists, sourceIp, targetIp);
    const prefixMatch = evaluatePolicyPrefixMatch(router, entry.matchPrefixLists ?? [], targetIp);
    if (!aclMatch.matched || !prefixMatch.matched) continue;
    return { routeMap: entry, accessRuleId: aclMatch.accessRuleId, prefixListId: prefixMatch.prefixListId };
  }
  return null;
}

function evaluatePolicyAclMatch(router: NetworkDevice, listNames: string[], sourceIp: string, targetIp: string): { matched: boolean; accessRuleId?: string } {
  if (!listNames.length) return { matched: true };
  for (const listName of listNames) {
    const decision = evaluateAcl(router, listName, sourceIp, targetIp);
    if (decision?.allowed) return { matched: true, accessRuleId: decision.ruleId };
  }
  return { matched: false };
}

function evaluatePolicyPrefixMatch(router: NetworkDevice, listNames: string[], targetIp: string): { matched: boolean; prefixListId?: string } {
  if (!listNames.length) return { matched: true };
  for (const listName of listNames) {
    const decision = evaluatePrefixList(router, listName, targetIp);
    if (decision.allowed) return { matched: true, prefixListId: decision.prefixListId };
  }
  return { matched: false };
}

function appendPolicyHits(route: RouteResult, hits: RoutePolicyHit[]): RouteResult {
  if (!hits.length) return route;
  return { ...route, policyHits: [...hits, ...(route.policyHits ?? [])] };
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
  return device.ports.filter((port) => port.adminUp && port.ipAddress && port.subnetMask && (!isSubinterfacePort(port) || Boolean(port.subinterfaceVlan)));
}

function routingProtocols(device: NetworkDevice): NonNullable<NetworkDevice["config"]["routingProtocols"]> {
  return device.config.routingProtocols ?? [];
}

function staticRouteDistance(route: NetworkDevice["config"]["staticRoutes"][number]): number {
  return Number.isInteger(route.distance) && route.distance! >= 1 && route.distance! <= 255 ? route.distance! : 1;
}

function trackObjectUp(project: NetworkProject, device: NetworkDevice, trackId: number): boolean {
  const track = (device.config.trackObjects ?? []).find((item) => item.trackId === trackId);
  if (!track) return false;
  if (track.type === "interface") {
    const port = track.interfaceName ? device.ports.find((item) => portNameMatches(item.name, track.interfaceName!)) : undefined;
    return Boolean(port && device.powerOn && port.adminUp && port.linkId);
  }
  const operation = (device.config.ipSlaOperations ?? []).find((item) => item.operationId === track.ipSlaOperationId);
  return Boolean(operation && ipSlaReachable(project, device, operation));
}

function ipSlaReachable(project: NetworkProject, device: NetworkDevice, operation: NonNullable<NetworkDevice["config"]["ipSlaOperations"]>[number]): boolean {
  if (!device.powerOn || !operation.enabled || !operation.targetIp || !isIpv4(operation.targetIp)) return false;
  const target = findInterfaceByIp(project, operation.targetIp);
  if (!target) return false;
  if (target.device.id === device.id) return target.port.adminUp;
  const sourcePorts = operation.sourceInterface
    ? device.ports.filter((port) => portNameMatches(port.name, operation.sourceInterface!))
    : device.ports;
  for (const entry of interfaceIpEntries({ ...device, ports: sourcePorts })) {
    if (!ipInSubnet(operation.targetIp, entry.ipAddress, entry.subnetMask)) continue;
    if (hasLayer2Path(project, device.id, target.device.id, portVlan(entry.port)).reachable) return true;
  }
  return false;
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
  const natTranslationAdds = new Map<string, NonNullable<NetworkDevice["runtime"]["natTranslations"]>>();
  for (let hopIndex = 0; hopIndex < hops.length; hopIndex += 1) {
    const deviceId = hops[hopIndex];
    const filterDevice = project.devices.find((device) => device.id === deviceId && (device.config.accessRules.length || device.config.natRules.length));
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

    const natMatches = matchingNatRules(policyDevice, sourceIp, targetIp);
    if (natMatches.length > 0) {
      natHits.set(policyDevice.id, new Set(natMatches.map((match) => match.rule.id)));
      const translations = natMatches.map((match) => match.translation).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (translations.length) {
        natTranslationAdds.set(policyDevice.id, [...(natTranslationAdds.get(policyDevice.id) ?? []), ...translations]);
      }
    }
    const legacyRule = policyDevice.config.accessRules.find((item) =>
      !item.remark &&
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
  if (accessHits.size === 0 && natHits.size === 0 && natTranslationAdds.size === 0) return { project, allowed: !blocked, message: blocked };
  const nextProject = {
    ...project,
    devices: project.devices.map((device) => {
      const accessRuleIds = accessHits.get(device.id);
      const natRuleIds = natHits.get(device.id);
      const natTranslations = natTranslationAdds.get(device.id);
      if (!accessRuleIds && !natRuleIds && !natTranslations) return device;
      return {
        ...device,
        config: {
          ...device.config,
          accessRules: device.config.accessRules.map((rule) => accessRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule),
          natRules: device.config.natRules.map((rule) => natRuleIds?.has(rule.id) ? { ...rule, hits: rule.hits + 1 } : rule)
        },
        runtime: {
          ...device.runtime,
          natTranslations: natTranslations ? mergeNatTranslations([...(device.runtime.natTranslations ?? []), ...natTranslations]) : device.runtime.natTranslations
        }
      };
    })
  };
  return { project: nextProject, allowed: !blocked, message: blocked };
}

function evaluateAcl(device: NetworkDevice, listName: string, sourceIp: string, targetIp: string): { allowed: boolean; ruleId?: string } | null {
  const rules = orderedAccessRules(device.config.accessRules.filter((rule) => !rule.remark && aclListName(rule).toLowerCase() === listName.toLowerCase()));
  if (!rules.length) return null;
  const rule = rules.find((item) =>
    (item.protocol === "ip" || item.protocol === "icmp") &&
    addressMatches(item.source, sourceIp) &&
    addressMatches(item.destination, targetIp)
  );
  if (!rule) return { allowed: false };
  return { allowed: rule.action === "permit", ruleId: rule.id };
}

function matchingNatRules(device: NetworkDevice, sourceIp: string, targetIp: string): Array<{ rule: NetworkDevice["config"]["natRules"][number]; translation?: NonNullable<NetworkDevice["runtime"]["natTranslations"]>[number] }> {
  return device.config.natRules.flatMap((rule) => {
    if (rule.type === "overload") {
      if (!rule.aclName) return [];
      const decision = evaluateAcl(device, rule.aclName, sourceIp, targetIp);
      if (!decision?.allowed) return [];
      const outside = findPortByName(device, rule.interfaceName ?? rule.outsideInterface);
      const insideGlobal = outside?.ipAddress || rule.interfaceName || rule.outsideInterface || "interface";
      return [{
        rule,
        translation: {
          protocol: "icmp",
          insideLocal: sourceIp,
          insideGlobal,
          outsideLocal: targetIp,
          outsideGlobal: targetIp,
          interfaceName: outside?.name || rule.interfaceName || rule.outsideInterface,
          hits: 1,
          createdAt: Date.now()
        }
      }];
    }
    return addressMatches(rule.insideLocal, sourceIp) ? [{ rule }] : [];
  });
}

function findPortByName(device: NetworkDevice, name: string | undefined): NetworkDevice["ports"][number] | undefined {
  const wanted = (name ?? "").toLowerCase().replace(/\s+/g, "");
  return device.ports.find((port) => port.name.toLowerCase().replace(/\s+/g, "") === wanted);
}

function mergeNatTranslations(entries: NonNullable<NetworkDevice["runtime"]["natTranslations"]>): NonNullable<NetworkDevice["runtime"]["natTranslations"]> {
  const byKey = new Map<string, NonNullable<NetworkDevice["runtime"]["natTranslations"]>[number]>();
  for (const entry of entries) {
    const key = [entry.protocol, entry.insideLocal, entry.insideGlobal, entry.outsideGlobal, entry.interfaceName].join("|");
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, hits: existing.hits + Math.max(1, entry.hits) } : entry);
  }
  return [...byKey.values()];
}

function aclListName(rule: NetworkDevice["config"]["accessRules"][number]): string {
  return rule.listName || rule.interfaceName || "ACL";
}

function orderedAccessRules(rules: NetworkDevice["config"]["accessRules"]): NetworkDevice["config"]["accessRules"] {
  return [...rules].sort((a, b) => {
    const aSequence = a.sequence ?? Number.MAX_SAFE_INTEGER;
    const bSequence = b.sequence ?? Number.MAX_SAFE_INTEGER;
    if (aSequence !== bSequence) return aSequence - bSequence;
    return rules.indexOf(a) - rules.indexOf(b);
  });
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
  return { id: `evt_${time}_${Math.random().toString(36).slice(2)}`, time, lastDeviceId, atDeviceId, sourceDeviceId: packet?.sourceId, targetDeviceId: packet?.targetId, packetId: packet?.packetId, type, info, status, osiLayers, headers: pduHeaders(type, status, packet) };
}

function pduHeaders(type: string, status: SimulationEvent["status"], packet?: { sourceId: string; targetId: string; packetId?: string }): SimulationEvent["headers"] {
  const protocol = type.toUpperCase();
  const source = packet?.sourceId ?? "unknown";
  const target = packet?.targetId ?? "unknown";
  const base = [
    { layer: "Layer 3", field: "Source", value: source },
    { layer: "Layer 3", field: "Destination", value: target },
    { layer: "Layer 3", field: "Disposition", value: status }
  ];
  if (protocol === "ARP" || protocol === "SWITCH" || protocol === "HUB") {
    return [
      { layer: "Layer 2", field: "Frame type", value: protocol },
      { layer: "Layer 2", field: "Source", value: source },
      { layer: "Layer 2", field: "Destination", value: target },
      { layer: "Layer 2", field: "Action", value: status }
    ];
  }
  if (protocol === "DHCP") {
    return [
      { layer: "Layer 2", field: "EtherType", value: "IPv4 / broadcast-capable" },
      ...base,
      { layer: "Layer 4", field: "Protocol", value: "UDP" },
      { layer: "Layer 4", field: "Ports", value: "67/68" },
      { layer: "Layer 7", field: "Application", value: "DHCP" }
    ];
  }
  return [
    { layer: "Layer 2", field: "EtherType", value: "IPv4" },
    ...base,
    { layer: "Layer 3", field: "Protocol", value: protocol === "ICMP" ? "ICMP" : "IP" },
    { layer: "Layer 7", field: "Application", value: protocol }
  ];
}

function increment(ip: string, offset: number): string {
  const parts = ip.split(".").map(Number);
  let value = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) + offset;
  value >>>= 0;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function isDhcpExcluded(server: NetworkDevice, ipAddress: string): boolean {
  return (server.config.dhcpExcludedRanges ?? []).some((range) => {
    if (!range.endIp) return range.startIp === ipAddress;
    if (!isIpv4(range.startIp) || !isIpv4(range.endIp) || !isIpv4(ipAddress)) return false;
    const value = ipToNumber(ipAddress);
    return value >= ipToNumber(range.startIp) && value <= ipToNumber(range.endIp);
  });
}

function findInterfaceByIp(project: NetworkProject, ipAddress: string): { device: NetworkDevice; port: NetworkPort } | null {
  for (const device of project.devices) {
    const port = device.ports.find((item) => item.adminUp && (item.ipAddress === ipAddress || (item.secondaryIpAddresses ?? []).some((address) => address.ipAddress === ipAddress)));
    if (port && device.powerOn) return { device, port };
  }
  return null;
}

function interfaceIpEntries(device: NetworkDevice): Array<{ port: NetworkPort; ipAddress: string; subnetMask: string; secondary: boolean }> {
  return device.ports
    .filter((port) => port.adminUp && (!isSubinterfacePort(port) || Boolean(port.subinterfaceVlan)))
    .flatMap((port) => [
      ...(port.ipAddress && port.subnetMask ? [{ port, ipAddress: port.ipAddress, subnetMask: port.subnetMask, secondary: false }] : []),
      ...(port.secondaryIpAddresses ?? []).map((address) => ({ port, ipAddress: address.ipAddress, subnetMask: address.subnetMask, secondary: true }))
    ])
    .filter((entry) => isIpv4(entry.ipAddress) && isSubnetMask(entry.subnetMask));
}

function findGatewayInterface(project: NetworkProject, ipAddress: string, sourceId: string, vlan: number): { device: NetworkDevice; port: NetworkPort } | null {
  const physical = findInterfaceByIp(project, ipAddress);
  if (physical) return physical;
  const candidates: Array<{ device: NetworkDevice; port: NetworkPort; priority: number; preempt: boolean; addressValue: number }> = [];
  for (const device of project.devices.filter((item) => item.powerOn && isRoutingDevice(item))) {
    for (const port of device.ports.filter((item) => item.adminUp && item.ipAddress && item.subnetMask && portAllowsVlan(item, vlan))) {
      if (!ipInSubnet(ipAddress, port.ipAddress, port.subnetMask)) continue;
      if (!hasLayer2Path(project, sourceId, device.id, vlan).reachable) continue;
      const hsrpGroup = (port.hsrpGroups ?? []).find((item) => item.virtualIp === ipAddress);
      if (hsrpGroup) {
        candidates.push({
          device,
          port,
          priority: hsrpEffectivePriority(project, device, hsrpGroup),
          preempt: hsrpGroup.preempt,
          addressValue: ipToNumber(port.ipAddress)
        });
      }
      const vrrpGroup = (port.vrrpGroups ?? []).find((item) => item.virtualIp === ipAddress);
      if (vrrpGroup) {
        candidates.push({
          device,
          port,
          priority: vrrpEffectivePriority(project, device, vrrpGroup),
          preempt: vrrpGroup.preempt,
          addressValue: ipToNumber(port.ipAddress)
        });
      }
    }
  }
  candidates.sort((left, right) =>
    right.priority - left.priority ||
    Number(right.preempt) - Number(left.preempt) ||
    right.addressValue - left.addressValue ||
    left.device.id.localeCompare(right.device.id)
  );
  const selected = candidates[0];
  return selected ? { device: selected.device, port: selected.port } : null;
}

function hsrpEffectivePriority(project: NetworkProject, device: NetworkDevice, group: NonNullable<NetworkPort["hsrpGroups"]>[number]): number {
  const trackedPort = group.trackInterface ? device.ports.find((port) => portNameMatches(port.name, group.trackInterface!)) : undefined;
  const trackedDown = Boolean(group.trackInterface && (!trackedPort || !device.powerOn || !trackedPort.adminUp || !trackedPort.linkId));
  const trackObjectDown = Boolean(group.trackObject && !trackObjectUp(project, device, group.trackObject));
  return Math.max(0, group.priority - (trackedDown || trackObjectDown ? group.trackDecrement ?? 10 : 0));
}

function vrrpEffectivePriority(project: NetworkProject, device: NetworkDevice, group: NonNullable<NetworkPort["vrrpGroups"]>[number]): number {
  const trackObjectDown = Boolean(group.trackObject && !trackObjectUp(project, device, group.trackObject));
  return Math.max(0, group.priority - (trackObjectDown ? group.trackDecrement ?? 10 : 0));
}

function portNameMatches(portName: string, query: string): boolean {
  const wanted = normalizePortName(query);
  const normalized = normalizePortName(portName);
  return normalized === wanted || compactPortAlias(portName) === wanted;
}

function normalizePortName(name: string): string {
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.startsWith("fastethernet")) return compact;
  if (compact.startsWith("gigabitethernet")) return compact;
  if (compact.startsWith("tengigabitethernet")) return compact;
  if (compact.startsWith("serial")) return compact;
  if (compact.startsWith("vlan")) return compact;
  if (compact.startsWith("fa")) return compact.replace(/^fa/, "fastethernet");
  if (compact.startsWith("f")) return compact.replace(/^f/, "fastethernet");
  if (compact.startsWith("gi")) return compact.replace(/^gi/, "gigabitethernet");
  if (compact.startsWith("g")) return compact.replace(/^g/, "gigabitethernet");
  if (compact.startsWith("te")) return compact.replace(/^te/, "tengigabitethernet");
  if (compact.startsWith("ten")) return compact.replace(/^ten/, "tengigabitethernet");
  if (compact.startsWith("se")) return compact.replace(/^se/, "serial");
  if (compact.startsWith("s")) return compact.replace(/^s/, "serial");
  return compact;
}

function compactPortAlias(name: string): string {
  return normalizePortName(name).replace("fastethernet", "f").replace("tengigabitethernet", "te").replace("gigabitethernet", "g").replace("serial", "s");
}

function isRoutingDevice(device: NetworkDevice): boolean {
  if (device.kind === "router" || device.kind === "firewall") return true;
  if (device.kind !== "switch") return false;
  return device.modelId === "switch-3560" || device.modelId.startsWith("switch-3560") || device.ports.some((port) => port.name.toLowerCase().startsWith("vlan") && port.adminUp && port.ipAddress && port.subnetMask);
}

function canForwardLayer2(device: NetworkDevice): boolean {
  return device.kind === "switch" || device.kind === "hub" || device.kind === "wireless";
}

function linkCarriesVlan(a: NetworkPort, b: NetworkPort, vlan: number): boolean {
  return portAllowsVlan(a, vlan) && portAllowsVlan(b, vlan);
}

function portAllowsVlan(port: NetworkPort, vlan: number): boolean {
  if (port.mode === "trunk") return port.allowedVlans.includes(vlan) || port.nativeVlan === vlan;
  if (port.subinterfaceVlan) return port.subinterfaceVlan === vlan;
  if (port.mode === "routed" && port.allowedVlans.length) return port.allowedVlans.includes(vlan);
  return port.vlan === vlan;
}

function portVlan(port: NetworkPort): number {
  if (port.subinterfaceVlan) return port.subinterfaceVlan;
  return port.mode === "trunk" ? port.allowedVlans[0] ?? 1 : port.vlan;
}

function isSubinterfacePort(port: NetworkPort): boolean {
  return Boolean(port.parentPortId || /\.\d+$/.test(port.name));
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

function evaluatePrefixList(device: NetworkDevice, listName: string, targetIp: string): { allowed: boolean; prefixListId?: string } {
  const entries = (device.config.prefixLists ?? [])
    .filter((entry) => entry.name.toLowerCase() === listName.toLowerCase())
    .sort((left, right) => left.sequence - right.sequence);
  if (!entries.length) return { allowed: false };
  const entry = entries.find((item) => prefixListEntryMatches(item, targetIp));
  if (!entry) return { allowed: false };
  return { allowed: entry.action === "permit", prefixListId: entry.id };
}

function prefixListEntryMatches(entry: NonNullable<NetworkDevice["config"]["prefixLists"]>[number], ipAddress: string): boolean {
  const [network, prefixText] = entry.prefix.split("/");
  const prefix = Number(prefixText);
  if (!isIpv4(network) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (!ipInSubnet(ipAddress, network, prefixToMask(prefix))) return false;
  const hostPrefix = 32;
  if (entry.ge !== undefined && hostPrefix < entry.ge) return false;
  if (entry.le !== undefined && hostPrefix > entry.le) return false;
  return true;
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
