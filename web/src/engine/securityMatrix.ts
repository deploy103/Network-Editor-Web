import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import type { AccessRule, NatRule, NetworkDevice, NetworkPort, NetworkProject } from "../types/network";

export interface SecurityZone {
  id: string;
  name: string;
  type: "inside" | "outside" | "dmz" | "internal" | "unknown";
  devices: string[];
  interfaces: string[];
  networks: string[];
}

export interface SecurityPolicyRow {
  deviceId: string;
  deviceLabel: string;
  policyType: "acl" | "nat" | "pbr";
  sourceZone: string;
  destinationZone: string;
  action: string;
  protocol: string;
  source: string;
  destination: string;
  detail: string;
  hits: number;
}

export interface SecurityExposure {
  deviceId: string;
  deviceLabel: string;
  service: string;
  ipAddress: string;
  zone: string;
  exposure: "internal" | "dmz" | "outside" | "unknown";
  reason: string;
}

export interface SecurityMatrixReport {
  zones: SecurityZone[];
  policies: SecurityPolicyRow[];
  exposures: SecurityExposure[];
  warnings: string[];
  totals: {
    zones: number;
    aclRules: number;
    natRules: number;
    prefixListEntries: number;
    routeMapEntries: number;
    pbrRules: number;
    exposures: number;
    warnings: number;
  };
}

export interface SecurityPolicyTypeSummary {
  policyType: SecurityPolicyRow["policyType"];
  entries: number;
  permits: number;
  denies: number;
  hits: number;
}

export function analyzeSecurityMatrix(project: NetworkProject): SecurityMatrixReport {
  const zones = inferSecurityZones(project);
  const policies = project.devices.flatMap((device) => [
    ...device.config.accessRules.map((rule) => aclPolicyRow(device, rule, zones)),
    ...device.config.natRules.map((rule) => natPolicyRow(device, rule, zones)),
    ...(device.config.routeMaps ?? []).filter((entry) => entry.setNextHop).map((entry) => ({
      deviceId: device.id,
      deviceLabel: device.label,
      policyType: "pbr" as const,
      sourceZone: "unknown",
      destinationZone: "unknown",
      action: entry.action,
      protocol: "ip",
      source: entry.matchAccessLists.join(", ") || "-",
      destination: entry.matchPrefixLists?.join(", ") || "-",
      detail: `route-map ${entry.name} seq ${entry.sequence} set next-hop ${entry.setNextHop}`,
      hits: entry.hits
    }))
  ]);
  const exposures = serviceExposures(project, zones);
  const warnings = securityWarnings(project, zones, policies, exposures);
  return {
    zones,
    policies,
    exposures,
    warnings,
    totals: {
      zones: zones.length,
      aclRules: policies.filter((policy) => policy.policyType === "acl").length,
      natRules: policies.filter((policy) => policy.policyType === "nat").length,
      prefixListEntries: project.devices.reduce((total, device) => total + (device.config.prefixLists?.length ?? 0), 0),
      routeMapEntries: project.devices.reduce((total, device) => total + (device.config.routeMaps?.length ?? 0), 0),
      pbrRules: policies.filter((policy) => policy.policyType === "pbr").length,
      exposures: exposures.length,
      warnings: warnings.length
    }
  };
}

export function buildSecurityMatrixReportText(project: NetworkProject): string {
  return buildSecurityMatrixReportLines(project).join("\n");
}

export function buildSecurityMatrixReportLines(project: NetworkProject): string[] {
  const matrix = analyzeSecurityMatrix(project);
  const policySummary = summarizeSecurityPoliciesByType(matrix);
  return [
    "Network Editor Web Security Matrix",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Zones: ${matrix.totals.zones}`,
    `- ACL rules: ${matrix.totals.aclRules}`,
    `- NAT rules: ${matrix.totals.natRules}`,
    `- Prefix-list entries: ${matrix.totals.prefixListEntries}`,
    `- Route-map entries: ${matrix.totals.routeMapEntries}`,
    `- PBR rules: ${matrix.totals.pbrRules}`,
    `- Service exposures: ${matrix.totals.exposures}`,
    `- Warnings: ${matrix.totals.warnings}`,
    "",
    "Policy Type Summary",
    ...table(["Type", "Entries", "Permit", "Deny", "Hits"], policySummary.map((summary) => [
      summary.policyType,
      String(summary.entries),
      String(summary.permits),
      String(summary.denies),
      String(summary.hits)
    ])),
    "",
    "Zones",
    ...table(["Zone", "Type", "Networks", "Interfaces", "Devices"], matrix.zones.map((zone) => [
      zone.name,
      zone.type,
      zone.networks.join(", ") || "-",
      zone.interfaces.join(", ") || "-",
      zone.devices.join(", ") || "-"
    ])),
    "",
    "Policies",
    ...table(["Device", "Type", "Action", "Protocol", "Source zone", "Destination zone", "Source", "Destination", "Detail", "Hits"], matrix.policies.map((policy) => [
      policy.deviceLabel,
      policy.policyType,
      policy.action,
      policy.protocol,
      policy.sourceZone,
      policy.destinationZone,
      policy.source,
      policy.destination,
      policy.detail,
      String(policy.hits)
    ])),
    "",
    "Service Exposure",
    ...table(["Device", "Service", "IP", "Zone", "Exposure", "Reason"], matrix.exposures.map((exposure) => [
      exposure.deviceLabel,
      exposure.service,
      exposure.ipAddress,
      exposure.zone,
      exposure.exposure,
      exposure.reason
    ])),
    "",
    "Warnings",
    ...(matrix.warnings.length ? matrix.warnings.map((warning) => `- ${warning}`) : ["- none"])
  ];
}

export function summarizeSecurityPoliciesByType(matrix: SecurityMatrixReport): SecurityPolicyTypeSummary[] {
  return (["acl", "nat", "pbr"] as Array<SecurityPolicyRow["policyType"]>).map((policyType) => {
    const entries = matrix.policies.filter((policy) => policy.policyType === policyType);
    return {
      policyType,
      entries: entries.length,
      permits: entries.filter((policy) => policy.action === "permit").length,
      denies: entries.filter((policy) => policy.action === "deny").length,
      hits: entries.reduce((total, policy) => total + policy.hits, 0)
    };
  });
}

function inferSecurityZones(project: NetworkProject): SecurityZone[] {
  const zoneByName = new Map<string, SecurityZone>();
  for (const device of project.devices) {
    for (const port of device.ports.filter((item) => item.kind !== "console")) {
      const zoneName = zoneNameForPort(device, port);
      const zone = zoneByName.get(zoneName) ?? {
        id: zoneName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: zoneName,
        type: zoneType(zoneName),
        devices: [],
        interfaces: [],
        networks: []
      };
      if (!zone.devices.includes(device.label)) zone.devices.push(device.label);
      zone.interfaces.push(`${device.label} ${port.name}`);
      if (isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask)) {
        const network = `${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)}`;
        if (!zone.networks.includes(network)) zone.networks.push(network);
      }
      zoneByName.set(zoneName, zone);
    }
  }
  return Array.from(zoneByName.values()).sort((left, right) => zoneRank(left.type) - zoneRank(right.type) || left.name.localeCompare(right.name));
}

function zoneNameForPort(device: NetworkDevice, port: NetworkPort): string {
  if (port.natRole === "inside") return "inside";
  if (port.natRole === "outside") return "outside";
  const lowered = `${device.label} ${device.config.hostname} ${port.name} ${port.description}`.toLowerCase();
  if (lowered.includes("dmz")) return "dmz";
  if (lowered.includes("outside") || lowered.includes("wan") || lowered.includes("internet")) return "outside";
  if (lowered.includes("inside") || lowered.includes("lan") || lowered.includes("user")) return "inside";
  if (port.vlan && port.vlan !== 1) return `vlan-${port.vlan}`;
  if (isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask)) return `${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)}`;
  return "unknown";
}

function zoneType(name: string): SecurityZone["type"] {
  const lower = name.toLowerCase();
  if (lower.includes("inside") || lower.includes("user") || lower.includes("lan")) return "inside";
  if (lower.includes("outside") || lower.includes("wan") || lower.includes("internet")) return "outside";
  if (lower.includes("dmz")) return "dmz";
  if (lower.startsWith("vlan-") || lower.includes("/")) return "internal";
  return "unknown";
}

function zoneRank(type: SecurityZone["type"]): number {
  return ({ inside: 0, internal: 1, dmz: 2, outside: 3, unknown: 4 })[type];
}

function aclPolicyRow(device: NetworkDevice, rule: AccessRule, zones: SecurityZone[]): SecurityPolicyRow {
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    policyType: "acl",
    sourceZone: zoneForAddress(rule.source, zones),
    destinationZone: zoneForAddress(rule.destination, zones),
    action: rule.action,
    protocol: rule.protocol,
    source: rule.source,
    destination: rule.destination,
    detail: `${rule.listName ?? rule.interfaceName} seq ${rule.sequence ?? "-"} ${rule.interfaceName}`,
    hits: rule.hits
  };
}

function natPolicyRow(device: NetworkDevice, rule: NatRule, zones: SecurityZone[]): SecurityPolicyRow {
  const insideLocal = natAddress(rule.insideLocal) || rule.insideLocal;
  const insideGlobal = natAddress(rule.insideGlobal) || rule.insideGlobal;
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    policyType: "nat",
    sourceZone: zoneForAddress(insideLocal, zones),
    destinationZone: zoneForAddress(insideGlobal, zones),
    action: rule.type ?? "static",
    protocol: "ip",
    source: rule.insideLocal,
    destination: rule.insideGlobal,
    detail: `${rule.outsideInterface}${rule.overload ? " overload" : ""}${rule.aclName ? ` acl ${rule.aclName}` : ""}`,
    hits: rule.hits
  };
}

function zoneForAddress(value: string, zones: SecurityZone[]): string {
  const hostMatch = value.match(/host\s+(\d+\.\d+\.\d+\.\d+)/i);
  const ip = hostMatch?.[1] ?? (isIpv4(value) ? value : "");
  if (!ip) {
    if (value.toLowerCase().includes("any")) return "any";
    return "unknown";
  }
  return zones.find((zone) => zone.networks.some((network) => ipInCidr(ip, network)))?.name ?? "unknown";
}

function serviceExposures(project: NetworkProject, zones: SecurityZone[]): SecurityExposure[] {
  const direct = project.devices.flatMap((device) => {
    const enabled = Object.entries(device.config.services).filter(([, enabled]) => enabled).map(([name]) => name.toUpperCase());
    if (!device.powerOn || !enabled.length) return [];
    return device.ports.filter((port) => port.adminUp && isIpv4(port.ipAddress)).flatMap((port) => enabled.map((service) => {
      const zone = zones.find((candidate) => candidate.interfaces.includes(`${device.label} ${port.name}`));
      const exposure: SecurityExposure["exposure"] = zone?.type === "outside" ? "outside" : zone?.type === "dmz" ? "dmz" : zone?.type === "inside" || zone?.type === "internal" ? "internal" : "unknown";
      return {
        deviceId: device.id,
        deviceLabel: device.label,
        service,
        ipAddress: port.ipAddress,
        zone: zone?.name ?? "unknown",
        exposure,
        reason: exposure === "outside" ? "Service IP is directly in an outside zone." : exposure === "dmz" ? "Service is placed in a DMZ zone." : "Service is not directly outside-facing."
      };
    }));
  });
  const staticNat = project.devices.flatMap((serviceDevice) => {
    const enabled = Object.entries(serviceDevice.config.services).filter(([, enabled]) => enabled).map(([name]) => name.toUpperCase());
    if (!serviceDevice.powerOn || !enabled.length) return [];
    return serviceDevice.ports.filter((port) => port.adminUp && isIpv4(port.ipAddress)).flatMap((port) =>
      project.devices.flatMap((policyDevice) =>
        !policyDevice.powerOn ? [] : policyDevice.config.natRules
          .filter((rule) => (rule.type ?? "static") === "static" && natAddress(rule.insideLocal) === port.ipAddress && isIpv4(natAddress(rule.insideGlobal)) && natOutsideOperational(policyDevice, rule))
          .flatMap((rule) => {
            const globalAddress = natAddress(rule.insideGlobal);
            const globalZone = zoneForAddress(globalAddress, zones);
            return enabled.map((service) => ({
              deviceId: serviceDevice.id,
              deviceLabel: serviceDevice.label,
              service,
              ipAddress: globalAddress,
              zone: globalZone === "unknown" ? "outside NAT" : globalZone,
              exposure: "outside" as const,
              reason: `Static NAT on ${policyDevice.label} publishes ${port.ipAddress} as ${globalAddress}.`
            }));
          })
      )
    );
  });
  return dedupeExposures([...direct, ...staticNat]);
}

function natAddress(value: string): string {
  const hostMatch = value.match(/host\s+(\d+\.\d+\.\d+\.\d+)/i);
  return hostMatch?.[1] ?? (isIpv4(value) ? value : "");
}

function natOutsideOperational(device: NetworkDevice, rule: NatRule): boolean {
  const names = [rule.outsideInterface, rule.interfaceName].filter((name): name is string => Boolean(name));
  if (!names.length) return true;
  return names.some((name) => {
    const port = device.ports.find((candidate) => portNameMatches(candidate.name, name));
    return Boolean(port?.adminUp);
  });
}

function portNameMatches(portName: string, query: string): boolean {
  const compactPort = portName.toLowerCase().replace(/\s+/g, "");
  const compactQuery = query.toLowerCase().replace(/\s+/g, "");
  return compactPort === compactQuery;
}

function dedupeExposures(exposures: SecurityExposure[]): SecurityExposure[] {
  const seen = new Set<string>();
  return exposures.filter((exposure) => {
    const key = `${exposure.deviceId}:${exposure.service}:${exposure.ipAddress}:${exposure.exposure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function securityWarnings(project: NetworkProject, zones: SecurityZone[], policies: SecurityPolicyRow[], exposures: SecurityExposure[]): string[] {
  const warnings: string[] = [];
  const outsideServices = exposures.filter((exposure) => exposure.exposure === "outside");
  if (outsideServices.length) {
    warnings.push(`Outside-facing services detected: ${outsideServices.map((exposure) => `${exposure.deviceLabel} ${exposure.service}`).join(", ")}`);
  }
  const firewalls = project.devices.filter((device) => device.kind === "firewall");
  if (firewalls.length && !policies.some((policy) => policy.policyType === "acl")) {
    warnings.push("Firewall devices exist but no ACL policy is configured.");
  }
  if (policies.some((policy) => policy.policyType === "nat") && !zones.some((zone) => zone.type === "inside") || policies.some((policy) => policy.policyType === "nat") && !zones.some((zone) => zone.type === "outside")) {
    warnings.push("NAT policy exists but inside/outside zones are incomplete.");
  }
  const permitAny = policies.filter((policy) => policy.policyType === "acl" && policy.action === "permit" && policy.source.toLowerCase() === "any" && policy.destination.toLowerCase() === "any");
  if (permitAny.length) {
    warnings.push(`${permitAny.length} ACL rules permit any to any.`);
  }
  const pbrWithoutPolicyHits = policies.filter((policy) => policy.policyType === "pbr" && policy.hits === 0);
  if (pbrWithoutPolicyHits.length) {
    warnings.push(`${pbrWithoutPolicyHits.length} PBR policies have no simulation hits yet.`);
  }
  return warnings;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!isIpv4(network) || !Number.isInteger(prefix)) return false;
  const mask = prefixToMask(prefix);
  return ipInSubnet(ip, network, mask);
}

function prefixToMask(prefix: number): string {
  const bits = prefix <= 0 ? 0 : prefix >= 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((shift) => String((bits >>> shift) & 255)).join(".");
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
