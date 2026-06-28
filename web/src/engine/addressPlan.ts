import { ipInSubnet, ipToNumber, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import type { DhcpPool, NetworkDevice, NetworkPort, NetworkProject } from "../types/network";

export interface AddressPlanHost {
  deviceId: string;
  deviceLabel: string;
  portId: string;
  portName: string;
  ipAddress: string;
  subnetMask: string;
  prefix: number;
  network: string;
  role: "interface" | "secondary" | "gateway" | "virtual-gateway";
}

export interface AddressPlanDhcpPool {
  deviceId: string;
  deviceLabel: string;
  name: string;
  network: string;
  mask: string;
  prefix: number;
  defaultGateway: string;
  dnsServer: string;
  startIp: string;
  maxLeases: number;
  enabled: boolean;
  coveredHosts: number;
}

export interface AddressPlanSubnet {
  key: string;
  network: string;
  mask: string;
  prefix: number;
  hostCapacity: number;
  assignedHosts: AddressPlanHost[];
  dhcpPools: AddressPlanDhcpPool[];
  gateways: AddressPlanHost[];
  duplicateIps: string[];
  overlaps: string[];
  nextAvailable: string[];
  warnings: string[];
}

export interface AddressPlanReport {
  subnets: AddressPlanSubnet[];
  orphanHosts: AddressPlanHost[];
  invalidEntries: string[];
  duplicateIps: string[];
  overlappingSubnets: Array<{ left: string; right: string }>;
  totals: {
    subnets: number;
    hosts: number;
    gateways: number;
    dhcpPools: number;
    invalidEntries: number;
    duplicateIps: number;
    overlaps: number;
  };
}

interface SubnetAccumulator {
  network: string;
  mask: string;
  prefix: number;
  assignedHosts: AddressPlanHost[];
  dhcpPools: AddressPlanDhcpPool[];
}

export function analyzeAddressPlan(project: NetworkProject): AddressPlanReport {
  const invalidEntries: string[] = [];
  const hosts = collectAddressHosts(project, invalidEntries);
  const dhcpPools = collectDhcpPools(project, hosts, invalidEntries);
  const subnetsByKey = new Map<string, SubnetAccumulator>();
  for (const host of hosts) {
    const key = subnetKey(host.network, host.subnetMask);
    const current = subnetsByKey.get(key) ?? { network: host.network, mask: host.subnetMask, prefix: host.prefix, assignedHosts: [], dhcpPools: [] };
    current.assignedHosts.push(host);
    subnetsByKey.set(key, current);
  }
  for (const pool of dhcpPools) {
    const key = subnetKey(pool.network, pool.mask);
    const current = subnetsByKey.get(key) ?? { network: pool.network, mask: pool.mask, prefix: pool.prefix, assignedHosts: [], dhcpPools: [] };
    current.dhcpPools.push(pool);
    subnetsByKey.set(key, current);
  }
  const duplicateIps = duplicateValues(hosts.map((host) => host.ipAddress));
  const overlaps = overlappingSubnetPairs(Array.from(subnetsByKey.values()));
  const subnets = Array.from(subnetsByKey.values())
    .sort((left, right) => ipToNumber(left.network) - ipToNumber(right.network) || left.prefix - right.prefix)
    .map((subnet) => finalizeSubnet(subnet, duplicateIps, overlaps));
  const subnetKeys = new Set(subnets.map((subnet) => subnet.key));
  const orphanHosts = hosts.filter((host) => !subnetKeys.has(subnetKey(host.network, host.subnetMask)));
  return {
    subnets,
    orphanHosts,
    invalidEntries,
    duplicateIps,
    overlappingSubnets: overlaps,
    totals: {
      subnets: subnets.length,
      hosts: hosts.length,
      gateways: hosts.filter((host) => host.role === "gateway" || host.role === "virtual-gateway").length,
      dhcpPools: dhcpPools.length,
      invalidEntries: invalidEntries.length,
      duplicateIps: duplicateIps.length,
      overlaps: overlaps.length
    }
  };
}

export function buildAddressPlanReportText(project: NetworkProject): string {
  return buildAddressPlanReportLines(project).join("\n");
}

export function buildAddressPlanReportLines(project: NetworkProject): string[] {
  const plan = analyzeAddressPlan(project);
  return [
    "Network Editor Web Address Plan",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Subnets: ${plan.totals.subnets}`,
    `- Assigned hosts: ${plan.totals.hosts}`,
    `- Gateways: ${plan.totals.gateways}`,
    `- DHCP pools: ${plan.totals.dhcpPools}`,
    `- Duplicate IPs: ${plan.totals.duplicateIps}`,
    `- Overlaps: ${plan.totals.overlaps}`,
    `- Invalid entries: ${plan.totals.invalidEntries}`,
    "",
    "Subnets",
    ...table(
      ["Network", "Prefix", "Hosts", "Capacity", "Gateways", "DHCP", "Next available", "Warnings"],
      plan.subnets.map((subnet) => [
        subnet.network,
        `/${subnet.prefix}`,
        String(subnet.assignedHosts.length),
        String(subnet.hostCapacity),
        subnet.gateways.map((host) => `${host.deviceLabel}:${host.ipAddress}`).join("; ") || "-",
        subnet.dhcpPools.map((pool) => `${pool.deviceLabel}:${pool.name}`).join("; ") || "-",
        subnet.nextAvailable.join(", ") || "-",
        subnet.warnings.join("; ") || "-"
      ])
    ),
    "",
    "Assignments",
    ...table(
      ["Device", "Port", "Role", "IP", "Prefix", "Network"],
      plan.subnets.flatMap((subnet) => subnet.assignedHosts.map((host) => [
        host.deviceLabel,
        host.portName,
        host.role,
        host.ipAddress,
        `/${host.prefix}`,
        subnet.network
      ]))
    ),
    "",
    "DHCP Pools",
    ...table(
      ["Device", "Pool", "Network", "Gateway", "DNS", "Start", "Leases", "Covered hosts", "State"],
      plan.subnets.flatMap((subnet) => subnet.dhcpPools.map((pool) => [
        pool.deviceLabel,
        pool.name,
        `${pool.network}/${pool.prefix}`,
        pool.defaultGateway,
        pool.dnsServer,
        pool.startIp,
        String(pool.maxLeases),
        String(pool.coveredHosts),
        pool.enabled ? "enabled" : "disabled"
      ]))
    ),
    "",
    "Global Issues",
    ...(plan.invalidEntries.length ? plan.invalidEntries.map((entry) => `- ${entry}`) : ["- none"]),
    ...(plan.duplicateIps.length ? ["", "Duplicate IPs", ...plan.duplicateIps.map((ip) => `- ${ip}`)] : []),
    ...(plan.overlappingSubnets.length ? ["", "Overlapping Subnets", ...plan.overlappingSubnets.map((pair) => `- ${pair.left} overlaps ${pair.right}`)] : [])
  ];
}

function collectAddressHosts(project: NetworkProject, invalidEntries: string[]): AddressPlanHost[] {
  return project.devices.flatMap((device) => device.ports.flatMap((port) => {
    const entries: AddressPlanHost[] = [];
    if (port.ipAddress || port.subnetMask) {
      const host = hostFromAddress(device, port, port.ipAddress, port.subnetMask, "interface", invalidEntries);
      if (host) entries.push(host);
    }
    for (const secondary of port.secondaryIpAddresses ?? []) {
      const host = hostFromAddress(device, port, secondary.ipAddress, secondary.subnetMask, "secondary", invalidEntries);
      if (host) entries.push(host);
    }
    if (isIpv4(port.gateway) && isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask) && ipInSubnet(port.gateway, port.ipAddress, port.subnetMask)) {
      entries.push({
        deviceId: device.id,
        deviceLabel: device.label,
        portId: port.id,
        portName: `${port.name} gateway`,
        ipAddress: port.gateway,
        subnetMask: port.subnetMask,
        prefix: maskToPrefix(port.subnetMask),
        network: networkAddress(port.gateway, port.subnetMask),
        role: "gateway"
      });
    }
    for (const group of port.hsrpGroups ?? []) {
      const host = hostFromAddress(device, port, group.virtualIp, port.subnetMask, "virtual-gateway", invalidEntries, `HSRP ${group.group}`);
      if (host) entries.push(host);
    }
    for (const group of port.vrrpGroups ?? []) {
      const host = hostFromAddress(device, port, group.virtualIp, port.subnetMask, "virtual-gateway", invalidEntries, `VRRP ${group.group}`);
      if (host) entries.push(host);
    }
    return entries;
  }));
}

function hostFromAddress(
  device: NetworkDevice,
  port: NetworkPort,
  ipAddress: string,
  subnetMask: string,
  role: AddressPlanHost["role"],
  invalidEntries: string[],
  suffix = ""
): AddressPlanHost | null {
  if (!ipAddress && !subnetMask) return null;
  if (!isIpv4(ipAddress)) {
    invalidEntries.push(`${device.label} ${port.name}${suffix ? ` ${suffix}` : ""}: invalid IPv4 ${ipAddress || "(blank)"}`);
    return null;
  }
  if (!isSubnetMask(subnetMask)) {
    invalidEntries.push(`${device.label} ${port.name}${suffix ? ` ${suffix}` : ""}: invalid mask ${subnetMask || "(blank)"}`);
    return null;
  }
  const prefix = maskToPrefix(subnetMask);
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    portId: port.id,
    portName: suffix ? `${port.name} ${suffix}` : port.name,
    ipAddress,
    subnetMask,
    prefix,
    network: networkAddress(ipAddress, subnetMask),
    role
  };
}

function collectDhcpPools(project: NetworkProject, hosts: AddressPlanHost[], invalidEntries: string[]): AddressPlanDhcpPool[] {
  return project.devices.flatMap((device) => device.config.dhcpPools.flatMap((pool) => {
    const normalized = normalizeDhcpPool(device, pool, hosts, invalidEntries);
    return normalized ? [normalized] : [];
  }));
}

function normalizeDhcpPool(device: NetworkDevice, pool: DhcpPool, hosts: AddressPlanHost[], invalidEntries: string[]): AddressPlanDhcpPool | null {
  const fields = [
    ["network", pool.network],
    ["mask", pool.mask],
    ["default-router", pool.defaultGateway],
    ["dns-server", pool.dnsServer],
    ["start-ip", pool.startIp]
  ];
  for (const [field, value] of fields) {
    if (field === "mask" ? !isSubnetMask(value) : !isIpv4(value)) {
      invalidEntries.push(`${device.label} DHCP pool ${pool.name}: invalid ${field} ${value || "(blank)"}`);
      return null;
    }
  }
  const prefix = maskToPrefix(pool.mask);
  const coveredHosts = hosts.filter((host) => ipInSubnet(host.ipAddress, pool.network, pool.mask)).length;
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    name: pool.name,
    network: networkAddress(pool.network, pool.mask),
    mask: pool.mask,
    prefix,
    defaultGateway: pool.defaultGateway,
    dnsServer: pool.dnsServer,
    startIp: pool.startIp,
    maxLeases: pool.maxLeases,
    enabled: pool.enabled,
    coveredHosts
  };
}

function finalizeSubnet(accumulator: SubnetAccumulator, duplicateIps: string[], overlaps: Array<{ left: string; right: string }>): AddressPlanSubnet {
  const key = subnetKey(accumulator.network, accumulator.mask);
  const assignedIps = new Set(accumulator.assignedHosts.map((host) => host.ipAddress));
  const gateways = accumulator.assignedHosts.filter((host) => host.role === "gateway" || host.role === "virtual-gateway" || isLikelyGateway(host));
  const subnetDuplicates = duplicateIps.filter((ip) => accumulator.assignedHosts.some((host) => host.ipAddress === ip));
  const subnetOverlaps = overlaps
    .filter((pair) => pair.left === key || pair.right === key)
    .map((pair) => pair.left === key ? pair.right : pair.left);
  const warnings = [
    gateways.length === 0 ? "no gateway candidate" : "",
    subnetDuplicates.length ? `duplicate IPs ${subnetDuplicates.join(", ")}` : "",
    subnetOverlaps.length ? `overlaps ${subnetOverlaps.join(", ")}` : "",
    accumulator.dhcpPools.some((pool) => !ipInSubnet(pool.defaultGateway, accumulator.network, accumulator.mask)) ? "DHCP gateway outside subnet" : "",
    accumulator.dhcpPools.some((pool) => !ipInSubnet(pool.startIp, accumulator.network, accumulator.mask)) ? "DHCP start outside subnet" : ""
  ].filter(Boolean);
  return {
    key,
    network: accumulator.network,
    mask: accumulator.mask,
    prefix: accumulator.prefix,
    hostCapacity: hostCapacity(accumulator.prefix),
    assignedHosts: accumulator.assignedHosts.sort((left, right) => ipToNumber(left.ipAddress) - ipToNumber(right.ipAddress)),
    dhcpPools: accumulator.dhcpPools.sort((left, right) => left.name.localeCompare(right.name)),
    gateways,
    duplicateIps: subnetDuplicates,
    overlaps: subnetOverlaps,
    nextAvailable: nextAvailableIps(accumulator.network, accumulator.mask, assignedIps, 5),
    warnings
  };
}

function subnetKey(network: string, mask: string): string {
  return `${network}/${maskToPrefix(mask)}`;
}

function hostCapacity(prefix: number): number {
  if (prefix >= 31) return 2 ** (32 - prefix);
  return Math.max(0, 2 ** (32 - prefix) - 2);
}

function isLikelyGateway(host: AddressPlanHost): boolean {
  const lastOctet = Number(host.ipAddress.split(".").at(-1));
  return host.role === "interface" && (lastOctet === 1 || lastOctet === 254) && !host.deviceLabel.toLowerCase().includes("pc");
}

function nextAvailableIps(network: string, mask: string, assignedIps: Set<string>, limit: number): string[] {
  const prefix = maskToPrefix(mask);
  const start = ipToNumber(network) + (prefix >= 31 ? 0 : 1);
  const end = ipToNumber(network) + 2 ** (32 - prefix) - (prefix >= 31 ? 1 : 2);
  const output: string[] = [];
  for (let value = start; value <= end && output.length < limit; value += 1) {
    const ip = numberToIp(value);
    if (!assignedIps.has(ip)) output.push(ip);
  }
  return output;
}

function overlappingSubnetPairs(subnets: SubnetAccumulator[]): Array<{ left: string; right: string }> {
  const output: Array<{ left: string; right: string }> = [];
  for (let i = 0; i < subnets.length; i += 1) {
    for (let j = i + 1; j < subnets.length; j += 1) {
      const left = subnets[i];
      const right = subnets[j];
      if (subnetContains(left, right.network) || subnetContains(right, left.network)) {
        const leftKey = subnetKey(left.network, left.mask);
        const rightKey = subnetKey(right.network, right.mask);
        if (leftKey !== rightKey) output.push({ left: leftKey, right: rightKey });
      }
    }
  }
  return output;
}

function subnetContains(subnet: SubnetAccumulator, ipAddress: string): boolean {
  return isIpv4(ipAddress) && ipInSubnet(ipAddress, subnet.network, subnet.mask);
}

function duplicateValues(values: string[]): string[] {
  const counts = values.reduce<Record<string, number>>((next, value) => {
    next[value] = (next[value] ?? 0) + 1;
    return next;
  }, {});
  return Object.entries(counts).filter(([, count]) => count > 1).map(([value]) => value).sort((left, right) => ipToNumber(left) - ipToNumber(right));
}

function numberToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join(".");
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
