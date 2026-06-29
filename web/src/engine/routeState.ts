import { endpoint } from "./topology";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix } from "./ip";
import type { NetworkDevice, NetworkPort, NetworkProject, StaticRoute } from "../types/network";

export type StaticRouteState = "untracked" | "active" | "inactive";

export function staticRouteState(project: NetworkProject, device: NetworkDevice, route: StaticRoute): StaticRouteState {
  if (!device.powerOn) return "inactive";
  if (!route.trackId) return "untracked";
  return staticRouteActive(project, device, route) ? "active" : "inactive";
}

export function staticRouteActive(project: NetworkProject, device: NetworkDevice, route: StaticRoute): boolean {
  if (!device.powerOn) return false;
  if (!route.trackId) return true;
  return trackObjectUp(project, device, route.trackId);
}

export function activeStaticRoutes(project: NetworkProject, device: NetworkDevice): StaticRoute[] {
  return device.config.staticRoutes.filter((route) => staticRouteActive(project, device, route));
}

export function activeDefaultRoutes(project: NetworkProject, device: NetworkDevice): StaticRoute[] {
  return activeStaticRoutes(project, device)
    .filter((route) => route.network === "0.0.0.0" && route.mask === "0.0.0.0")
    .sort(compareStaticRoutes);
}

export function staticRouteDistance(route: StaticRoute): number {
  return Number.isInteger(route.distance) && route.distance! >= 1 && route.distance! <= 255 ? route.distance! : 1;
}

export function compareStaticRoutes(left: StaticRoute, right: StaticRoute): number {
  const prefixDelta = staticRoutePrefixLength(right) - staticRoutePrefixLength(left);
  return prefixDelta || staticRouteDistance(left) - staticRouteDistance(right);
}

export function trackObjectUp(project: NetworkProject, device: NetworkDevice, trackId: number): boolean {
  const track = (device.config.trackObjects ?? []).find((item) => item.trackId === trackId);
  if (!track) return false;
  if (track.type === "interface") {
    const port = track.interfaceName ? device.ports.find((item) => portNameMatches(item.name, track.interfaceName!)) : undefined;
    return Boolean(port && interfaceLineProtocolUp(project, device, port));
  }
  const operation = (device.config.ipSlaOperations ?? []).find((item) => item.operationId === track.ipSlaOperationId);
  return Boolean(operation && ipSlaReachable(project, device, operation));
}

export function interfaceLineProtocolUp(project: NetworkProject, device: NetworkDevice, port: NetworkPort): boolean {
  if (!device.powerOn || !port.adminUp || !port.linkId) return false;
  const link = project.links.find((item) => item.id === port.linkId);
  if (!link || link.status !== "up") return false;
  const localIsA = link.endpointA.deviceId === device.id && link.endpointA.portId === port.id;
  const localIsB = link.endpointB.deviceId === device.id && link.endpointB.portId === port.id;
  if (!localIsA && !localIsB) return false;
  const otherRef = localIsA ? link.endpointB : link.endpointA;
  const other = endpoint(project, otherRef);
  return Boolean(other?.device.powerOn && other.port.adminUp);
}

function staticRoutePrefixLength(route: StaticRoute): number {
  return isSubnetMask(route.mask) ? maskToPrefix(route.mask) : 0;
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
    if (layer2Reachable(project, device.id, target.device.id, portVlan(entry.port))) return true;
  }
  return false;
}

function findInterfaceByIp(project: NetworkProject, ipAddress: string): { device: NetworkDevice; port: NetworkPort } | null {
  for (const device of project.devices) {
    const port = device.ports.find((item) => item.adminUp && (item.ipAddress === ipAddress || (item.secondaryIpAddresses ?? []).some((address) => address.ipAddress === ipAddress)));
    if (port && device.powerOn) return { device, port };
  }
  return null;
}

function interfaceIpEntries(device: NetworkDevice): Array<{ port: NetworkPort; ipAddress: string; subnetMask: string }> {
  return device.ports
    .filter((port) => port.adminUp && (!isSubinterfacePort(port) || Boolean(port.subinterfaceVlan)))
    .flatMap((port) => [
      ...(port.ipAddress && port.subnetMask ? [{ port, ipAddress: port.ipAddress, subnetMask: port.subnetMask }] : []),
      ...(port.secondaryIpAddresses ?? []).map((address) => ({ port, ipAddress: address.ipAddress, subnetMask: address.subnetMask }))
    ])
    .filter((entry) => isIpv4(entry.ipAddress) && isSubnetMask(entry.subnetMask));
}

function layer2Reachable(project: NetworkProject, sourceId: string, targetId: string, vlan: number): boolean {
  const seen = new Set([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    const currentDevice = project.devices.find((device) => device.id === current);
    if (!currentDevice?.powerOn) continue;
    if (current !== sourceId && current !== targetId && !canForwardLayer2(currentDevice)) continue;
    for (const link of project.links.filter((item) => item.status === "up" && (item.endpointA.deviceId === current || item.endpointB.deviceId === current))) {
      const other = link.endpointA.deviceId === current ? link.endpointB.deviceId : link.endpointA.deviceId;
      const currentPort = endpoint(project, link.endpointA.deviceId === current ? link.endpointA : link.endpointB)?.port;
      const otherEndpoint = endpoint(project, link.endpointA.deviceId === current ? link.endpointB : link.endpointA);
      if (!currentPort || !otherEndpoint || !currentPort.adminUp || !otherEndpoint.port.adminUp || !otherEndpoint.device.powerOn || !linkCarriesVlan(currentPort, otherEndpoint.port, vlan)) continue;
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return false;
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
  if (/^fa\d/.test(compact)) return compact.replace(/^fa/, "fastethernet");
  if (/^gi\d/.test(compact) || /^g\d/.test(compact)) return compact.replace(/^gi?/, "gigabitethernet");
  if (/^te\d/.test(compact)) return compact.replace(/^te/, "tengigabitethernet");
  if (/^s\d/.test(compact)) return compact.replace(/^s/, "serial");
  return compact;
}

function compactPortAlias(name: string): string {
  return normalizePortName(name).replace("fastethernet", "f").replace("tengigabitethernet", "te").replace("gigabitethernet", "g").replace("serial", "s");
}
