import type { NetworkDevice, NetworkPort, NetworkProject, RouteEntry } from "../types/network";
import { findPath } from "./topology";

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
}

export function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export function isValidIp(ip: string): boolean {
  return ipToInt(ip) !== null;
}

export function networkAddress(ip: string, mask: string): string {
  const ipValue = ipToInt(ip);
  const maskValue = ipToInt(mask);
  if (ipValue === null || maskValue === null) return "";
  return intToIp((ipValue & maskValue) >>> 0);
}

export function sameSubnet(aIp: string, aMask: string, bIp: string): boolean {
  const network = networkAddress(aIp, aMask);
  if (!network) return false;
  return networkAddress(bIp, aMask) === network;
}

export function usableAddressFromOffset(network: string, offset: number): string {
  const base = ipToInt(network);
  if (base === null) return "";
  return intToIp((base + Math.max(1, offset)) >>> 0);
}

export function firstConfiguredPort(device: NetworkDevice): NetworkPort | undefined {
  return device.ports.find((port) => port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask);
}

export function connectedRoutes(device: NetworkDevice): RouteEntry[] {
  return device.ports
    .filter((port) => port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask && port.status === "up")
    .map((port) => ({
      destination: networkAddress(port.interfaceConfig.ipAddress, port.interfaceConfig.subnetMask),
      mask: port.interfaceConfig.subnetMask,
      nextHop: "connected",
      outgoingPortId: port.id,
      learnedBy: "connected" as const,
    }));
}

function prefixLength(mask: string): number {
  const value = ipToInt(mask);
  if (value === null) return 0;
  return value.toString(2).split("").filter((bit) => bit === "1").length;
}

function routeMatches(route: RouteEntry, destinationIp: string): boolean {
  if (route.destination === "0.0.0.0" && route.mask === "0.0.0.0") return true;
  return sameSubnet(route.destination, route.mask, destinationIp);
}

type DynamicProtocol = "rip" | "ospf" | "eigrp";

function protocolNetworks(device: NetworkDevice, protocol: DynamicProtocol): string[] {
  return device.config.runningConfig
    .filter((line) => line.startsWith(`router ${protocol}\n network `))
    .map((line) => line.split("\n").at(-1)?.replace("network ", "").trim() ?? "")
    .filter(Boolean);
}

function routeAdvertisedByProtocol(device: NetworkDevice, route: RouteEntry, protocol: DynamicProtocol): boolean {
  const networks = protocolNetworks(device, protocol);
  return networks.some((network) => sameSubnet(route.destination, route.mask, network));
}

function learnedByProtocol(device: NetworkDevice, project: NetworkProject, protocol: DynamicProtocol): RouteEntry[] {
  if (!protocolNetworks(device, protocol).length) return [];
  const localConnected = connectedRoutes(device);
  return project.devices
    .filter((entry) => entry.id !== device.id && entry.powerOn && protocolNetworks(entry, protocol).length)
    .filter((entry) => findPath(project, device.id, entry.id).length > 0)
    .flatMap((entry) =>
      connectedRoutes(entry)
        .filter((route) => routeAdvertisedByProtocol(entry, route, protocol))
        .filter((route) => !localConnected.some((local) => local.destination === route.destination && local.mask === route.mask))
        .map((route) => ({
          destination: route.destination,
          mask: route.mask,
          nextHop: firstConfiguredPort(entry)?.interfaceConfig.ipAddress || protocol,
          learnedBy: protocol,
        })),
    );
}

export function dynamicLearnedRoutes(device: NetworkDevice, project?: NetworkProject): RouteEntry[] {
  if (!project) return [];
  return (["rip", "ospf", "eigrp"] as DynamicProtocol[]).flatMap((protocol) => learnedByProtocol(device, project, protocol));
}

export function bestRoute(device: NetworkDevice, destinationIp: string, project?: NetworkProject): RouteEntry | undefined {
  const candidates = [...connectedRoutes(device), ...device.config.staticRoutes, ...dynamicLearnedRoutes(device, project)];
  return candidates
    .filter((route) => routeMatches(route, destinationIp))
    .sort((a, b) => prefixLength(b.mask) - prefixLength(a.mask))[0];
}

export function deviceIpSummary(device: NetworkDevice): string {
  const configured = device.ports
    .filter((port) => port.interfaceConfig.ipAddress)
    .map((port) => `${port.name} ${port.interfaceConfig.ipAddress}/${port.interfaceConfig.subnetMask || "0.0.0.0"}`);
  return configured.length ? configured.join(", ") : "No IP configured";
}
