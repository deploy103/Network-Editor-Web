import { getDeviceModel } from "../data/deviceCatalog";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix } from "./ip";
import { interfaceLineProtocolUp } from "./routeState";
import type { NetworkDevice, NetworkProject } from "../types/network";

export interface DeviceCapacityRow {
  deviceId: string;
  label: string;
  kind: string;
  model: string;
  portsTotal: number;
  portsConnected: number;
  portsActive: number;
  portsConfigured: number;
  portUtilization: number;
  modulesInstalled: number;
  moduleSlots: number;
  vlanCount: number;
  routeCount: number;
  policyCount: number;
  serviceCount: number;
  warnings: string[];
}

export interface DhcpCapacityRow {
  deviceId: string;
  deviceLabel: string;
  poolName: string;
  network: string;
  prefix: number;
  maxLeases: number;
  activeLeases: number;
  configuredStartIp: string;
  utilization: number;
  warning: string;
}

export interface CapacityPlanReport {
  devices: DeviceCapacityRow[];
  dhcpPools: DhcpCapacityRow[];
  warnings: string[];
  totals: {
    devices: number;
    portsTotal: number;
    portsConnected: number;
    portsActive: number;
    portsConfigured: number;
    modulesInstalled: number;
    moduleSlots: number;
    dhcpPools: number;
    warnings: number;
  };
}

export function analyzeCapacityPlan(project: NetworkProject): CapacityPlanReport {
  const devices = project.devices.map((device) => deviceCapacity(project, device));
  const dhcpPools = project.devices.flatMap(dhcpCapacityRows);
  const warnings = [
    ...devices.flatMap((device) => device.warnings.map((warning) => `${device.label}: ${warning}`)),
    ...dhcpPools.filter((pool) => pool.warning).map((pool) => `${pool.deviceLabel} ${pool.poolName}: ${pool.warning}`)
  ];
  return {
    devices,
    dhcpPools,
    warnings,
    totals: {
      devices: devices.length,
      portsTotal: devices.reduce((sum, device) => sum + device.portsTotal, 0),
      portsConnected: devices.reduce((sum, device) => sum + device.portsConnected, 0),
      portsActive: devices.reduce((sum, device) => sum + device.portsActive, 0),
      portsConfigured: devices.reduce((sum, device) => sum + device.portsConfigured, 0),
      modulesInstalled: devices.reduce((sum, device) => sum + device.modulesInstalled, 0),
      moduleSlots: devices.reduce((sum, device) => sum + device.moduleSlots, 0),
      dhcpPools: dhcpPools.length,
      warnings: warnings.length
    }
  };
}

export function buildCapacityPlanReportText(project: NetworkProject): string {
  return buildCapacityPlanReportLines(project).join("\n");
}

export function buildCapacityPlanReportLines(project: NetworkProject): string[] {
  const capacity = analyzeCapacityPlan(project);
  return [
    "Network Editor Web Capacity Plan",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Devices: ${capacity.totals.devices}`,
    `- Ports: ${capacity.totals.portsConnected}/${capacity.totals.portsTotal} connected, ${capacity.totals.portsActive} active, ${capacity.totals.portsConfigured} configured`,
    `- Modules: ${capacity.totals.modulesInstalled}/${capacity.totals.moduleSlots} slots used`,
    `- DHCP pools: ${capacity.totals.dhcpPools}`,
    `- Warnings: ${capacity.totals.warnings}`,
    "",
    "Device Capacity",
    ...table(["Device", "Kind", "Model", "Ports", "Active", "Configured", "Modules", "VLANs", "Routes", "Policy", "Services", "Warnings"], capacity.devices.map((device) => [
      device.label,
      device.kind,
      device.model,
      `${device.portsConnected}/${device.portsTotal} (${device.portUtilization}%)`,
      String(device.portsActive),
      String(device.portsConfigured),
      `${device.modulesInstalled}/${device.moduleSlots}`,
      String(device.vlanCount),
      String(device.routeCount),
      String(device.policyCount),
      String(device.serviceCount),
      device.warnings.join("; ") || "-"
    ])),
    "",
    "DHCP Capacity",
    ...table(["Device", "Pool", "Network", "Prefix", "Leases", "Active", "Utilization", "Start", "Warning"], capacity.dhcpPools.map((pool) => [
      pool.deviceLabel,
      pool.poolName,
      pool.network,
      `/${pool.prefix}`,
      String(pool.maxLeases),
      String(pool.activeLeases),
      `${pool.utilization}%`,
      pool.configuredStartIp,
      pool.warning || "-"
    ])),
    "",
    "Warnings",
    ...(capacity.warnings.length ? capacity.warnings.map((warning) => `- ${warning}`) : ["- none"])
  ];
}

function deviceCapacity(project: NetworkProject, device: NetworkDevice): DeviceCapacityRow {
  const dataPorts = device.ports.filter((port) => port.kind !== "console");
  const connected = dataPorts.filter((port) => port.linkId && project.links.some((link) => link.id === port.linkId)).length;
  const active = dataPorts.filter((port) => interfaceLineProtocolUp(project, device, port)).length;
  const staleLinkReferences = dataPorts.filter((port) => port.linkId && !project.links.some((link) => link.id === port.linkId)).length;
  const configured = dataPorts.filter((port) => isIpv4(port.ipAddress) || port.mode === "trunk" || port.vlan !== 1 || port.description || port.channelGroup || port.portSecurity?.enabled).length;
  const modules = getDeviceModel(device.modelId)?.modules.length ?? device.modules.length;
  const routeCount = device.config.staticRoutes.length + (device.config.routingProtocols?.length ?? 0);
  const policyCount = device.config.accessRules.length + device.config.natRules.length + (device.config.prefixLists?.length ?? 0) + (device.config.routeMaps?.length ?? 0);
  const serviceCount = Object.values(device.config.services).filter(Boolean).length;
  const utilization = dataPorts.length ? Math.round((connected / dataPorts.length) * 100) : 0;
  const warnings = [
    utilization >= 90 ? "port usage above 90%" : "",
    utilization >= 75 && utilization < 90 ? "port usage above 75%" : "",
    modules > 0 && device.modules.length === modules ? "all module slots occupied" : "",
    device.config.vlans.length > 100 ? "large VLAN table" : "",
    policyCount > 50 ? "large policy table" : "",
    routeCount > 30 ? "large route table" : "",
    connected > active ? `${connected - active} connected port(s) inactive` : "",
    staleLinkReferences ? `${staleLinkReferences} stale link reference(s)` : "",
    device.kind === "server" && serviceCount > 4 ? "many services on one server" : ""
  ].filter(Boolean);
  return {
    deviceId: device.id,
    label: device.label,
    kind: device.kind,
    model: device.model,
    portsTotal: dataPorts.length,
    portsConnected: connected,
    portsActive: active,
    portsConfigured: configured,
    portUtilization: utilization,
    modulesInstalled: device.modules.length,
    moduleSlots: modules,
    vlanCount: device.config.vlans.length,
    routeCount,
    policyCount,
    serviceCount,
    warnings
  };
}

function dhcpCapacityRows(device: NetworkDevice): DhcpCapacityRow[] {
  return device.config.dhcpPools.map((pool) => {
    const activeLeases = isIpv4(pool.network) && isSubnetMask(pool.mask)
      ? device.runtime.dhcpLeases.filter((lease) => isIpv4(lease.ipAddress) && ipInSubnet(lease.ipAddress, pool.network, pool.mask)).length
      : 0;
    const utilization = pool.maxLeases ? Math.round((activeLeases / pool.maxLeases) * 100) : 0;
    const prefix = maskToPrefix(pool.mask);
    const warning = [
      !pool.enabled ? "pool disabled" : "",
      pool.maxLeases <= 0 ? "no leases available" : "",
      utilization >= 90 ? "lease usage above 90%" : "",
      utilization >= 75 && utilization < 90 ? "lease usage above 75%" : "",
      !pool.startIp ? "missing start IP" : ""
    ].filter(Boolean).join("; ");
    return {
      deviceId: device.id,
      deviceLabel: device.label,
      poolName: pool.name,
      network: pool.network,
      prefix,
      maxLeases: pool.maxLeases,
      activeLeases,
      configuredStartIp: pool.startIp,
      utilization,
      warning
    };
  });
}

function table(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return ["- none"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => sanitize(row[index] ?? "").length)));
  return [
    `| ${headers.map((header, index) => header.padEnd(widths[index])).join(" | ")} |`,
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell, index) => sanitize(cell).padEnd(widths[index])).join(" | ")} |`)
  ];
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "-";
}
