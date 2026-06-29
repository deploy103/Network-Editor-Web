import { analyzeAddressPlan } from "./addressPlan";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import { activeDefaultRoutes, activeStaticRoutes, compareStaticRoutes, staticRouteActive, staticRouteDistance } from "./routeState";
import type { NetworkDevice, NetworkProject, StaticRoute } from "../types/network";

export type RouteCoverage = "connected" | "static" | "dynamic" | "default" | "missing";

export interface RoutedSubnet {
  key: string;
  network: string;
  prefix: number;
  mask: string;
  gateways: string[];
  connectedDevices: string[];
  hostCount: number;
}

export interface DeviceRouteCoverage {
  deviceId: string;
  deviceLabel: string;
  subnetKey: string;
  coverage: RouteCoverage;
  via: string;
  detail: string;
}

export interface SubnetPathCheck {
  sourceSubnet: string;
  targetSubnet: string;
  status: "reachable" | "partial" | "missing";
  coverage: RouteCoverage[];
  devices: string[];
  recommendation: string;
}

export interface RoutingMatrixReport {
  subnets: RoutedSubnet[];
  coverage: DeviceRouteCoverage[];
  pathChecks: SubnetPathCheck[];
  warnings: string[];
  totals: {
    subnets: number;
    l3Devices: number;
    connected: number;
    static: number;
    dynamic: number;
    defaults: number;
    missing: number;
    warnings: number;
  };
}

export interface DeviceRoutingCoverageSummary {
  deviceId: string;
  deviceLabel: string;
  total: number;
  connected: number;
  static: number;
  dynamic: number;
  defaults: number;
  missing: number;
}

export function analyzeRoutingMatrix(project: NetworkProject): RoutingMatrixReport {
  const subnets = routedSubnets(project);
  const l3Devices = project.devices.filter(isL3Device);
  const coverage = l3Devices.flatMap((device) => subnets.map((subnet) => coverageForDevice(project, device, subnet)));
  const pathChecks = pairwiseSubnetChecks(subnets, coverage);
  const warnings = routingWarnings(project, subnets, coverage, pathChecks);
  return {
    subnets,
    coverage,
    pathChecks,
    warnings,
    totals: {
      subnets: subnets.length,
      l3Devices: l3Devices.length,
      connected: coverage.filter((item) => item.coverage === "connected").length,
      static: coverage.filter((item) => item.coverage === "static").length,
      dynamic: coverage.filter((item) => item.coverage === "dynamic").length,
      defaults: coverage.filter((item) => item.coverage === "default").length,
      missing: coverage.filter((item) => item.coverage === "missing").length,
      warnings: warnings.length
    }
  };
}

export function buildRoutingMatrixReportText(project: NetworkProject): string {
  return buildRoutingMatrixReportLines(project).join("\n");
}

export function buildRoutingMatrixReportLines(project: NetworkProject): string[] {
  const matrix = analyzeRoutingMatrix(project);
  const deviceSummary = summarizeRoutingCoverageByDevice(matrix);
  return [
    "Network Editor Web Routing Matrix",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Subnets: ${matrix.totals.subnets}`,
    `- Layer 3 devices: ${matrix.totals.l3Devices}`,
    `- Connected coverage: ${matrix.totals.connected}`,
    `- Static coverage: ${matrix.totals.static}`,
    `- Dynamic coverage: ${matrix.totals.dynamic}`,
    `- Default coverage: ${matrix.totals.defaults}`,
    `- Missing coverage: ${matrix.totals.missing}`,
    `- Warnings: ${matrix.totals.warnings}`,
    "",
    "Device Coverage Summary",
    ...table(["Device", "Total", "Connected", "Static", "Dynamic", "Default", "Missing"], deviceSummary.map((summary) => [
      summary.deviceLabel,
      String(summary.total),
      String(summary.connected),
      String(summary.static),
      String(summary.dynamic),
      String(summary.defaults),
      String(summary.missing)
    ])),
    "",
    "Routed Subnets",
    ...table(["Subnet", "Gateways", "Connected devices", "Hosts"], matrix.subnets.map((subnet) => [
      subnet.key,
      subnet.gateways.join(", ") || "-",
      subnet.connectedDevices.join(", ") || "-",
      String(subnet.hostCount)
    ])),
    "",
    "Device Coverage",
    ...table(["Device", "Subnet", "Coverage", "Via", "Detail"], matrix.coverage.map((coverage) => [
      coverage.deviceLabel,
      coverage.subnetKey,
      coverage.coverage,
      coverage.via,
      coverage.detail
    ])),
    "",
    "Subnet Path Checks",
    ...table(["Source", "Target", "Status", "Coverage", "Devices", "Recommendation"], matrix.pathChecks.map((check) => [
      check.sourceSubnet,
      check.targetSubnet,
      check.status,
      check.coverage.join(", "),
      check.devices.join(", ") || "-",
      check.recommendation
    ])),
    "",
    "Warnings",
    ...(matrix.warnings.length ? matrix.warnings.map((warning) => `- ${warning}`) : ["- none"])
  ];
}

export function summarizeRoutingCoverageByDevice(matrix: RoutingMatrixReport): DeviceRoutingCoverageSummary[] {
  const labelsById = new Map(matrix.coverage.map((coverage) => [coverage.deviceId, coverage.deviceLabel]));
  return Array.from(labelsById.entries())
    .map(([deviceId, deviceLabel]) => {
      const rows = matrix.coverage.filter((coverage) => coverage.deviceId === deviceId);
      return {
        deviceId,
        deviceLabel,
        total: rows.length,
        connected: rows.filter((coverage) => coverage.coverage === "connected").length,
        static: rows.filter((coverage) => coverage.coverage === "static").length,
        dynamic: rows.filter((coverage) => coverage.coverage === "dynamic").length,
        defaults: rows.filter((coverage) => coverage.coverage === "default").length,
        missing: rows.filter((coverage) => coverage.coverage === "missing").length
      };
    })
    .sort((left, right) => right.missing - left.missing || left.deviceLabel.localeCompare(right.deviceLabel));
}

function routedSubnets(project: NetworkProject): RoutedSubnet[] {
  const addressPlan = analyzeAddressPlan(project);
  return addressPlan.subnets.map((subnet) => ({
    key: `${subnet.network}/${subnet.prefix}`,
    network: subnet.network,
    prefix: subnet.prefix,
    mask: subnet.mask,
    gateways: subnet.gateways.map((gateway) => `${gateway.deviceLabel}:${gateway.ipAddress}`),
    connectedDevices: connectedDevicesForSubnet(project, subnet.network, subnet.mask),
    hostCount: subnet.assignedHosts.length
  }));
}

function connectedDevicesForSubnet(project: NetworkProject, network: string, mask: string): string[] {
  return project.devices
    .filter((device) => device.powerOn && device.ports.some((port) =>
      port.adminUp &&
      ((isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask) && networkAddress(port.ipAddress, port.subnetMask) === network && port.subnetMask === mask) ||
        (port.secondaryIpAddresses ?? []).some((address) => isIpv4(address.ipAddress) && isSubnetMask(address.subnetMask) && networkAddress(address.ipAddress, address.subnetMask) === network && address.subnetMask === mask))
    ))
    .map((device) => device.label);
}

function coverageForDevice(project: NetworkProject, device: NetworkDevice, subnet: RoutedSubnet): DeviceRouteCoverage {
  const connected = device.ports.find((port) =>
    device.powerOn &&
    port.adminUp &&
    isIpv4(port.ipAddress) &&
    isSubnetMask(port.subnetMask) &&
    networkAddress(port.ipAddress, port.subnetMask) === subnet.network &&
    port.subnetMask === subnet.mask
  );
  if (connected) {
    return {
      deviceId: device.id,
      deviceLabel: device.label,
      subnetKey: subnet.key,
      coverage: "connected",
      via: connected.name,
      detail: `${connected.ipAddress}/${maskToPrefix(connected.subnetMask)}`
    };
  }
  const staticRoute = matchingStaticRoute(activeStaticRoutes(project, device), subnet);
  if (staticRoute) {
    return {
      deviceId: device.id,
      deviceLabel: device.label,
      subnetKey: subnet.key,
      coverage: "static",
      via: staticRoute.nextHop,
      detail: `${staticRoute.network}/${maskToPrefix(staticRoute.mask)} distance ${staticRouteDistance(staticRoute)}${staticRoute.trackId ? ` track ${staticRoute.trackId}` : ""}`
    };
  }
  const dynamic = device.powerOn ? (device.config.routingProtocols ?? []).find((protocol) => protocol.networks.some((network) => routingNetworkMatches(network, subnet))) : undefined;
  if (dynamic) {
    return {
      deviceId: device.id,
      deviceLabel: device.label,
      subnetKey: subnet.key,
      coverage: "dynamic",
      via: dynamic.protocol.toUpperCase(),
      detail: `${dynamic.protocol}${dynamic.processId ? ` ${dynamic.processId}` : ""} advertises ${dynamic.networks.join(", ")}`
    };
  }
  const defaultRoute = activeDefaultRoutes(project, device)[0];
  if (defaultRoute) {
    return {
      deviceId: device.id,
      deviceLabel: device.label,
      subnetKey: subnet.key,
      coverage: "default",
      via: defaultRoute.nextHop,
      detail: `default route distance ${staticRouteDistance(defaultRoute)}${defaultRoute.trackId ? ` track ${defaultRoute.trackId}` : ""}`
    };
  }
  return {
    deviceId: device.id,
    deviceLabel: device.label,
    subnetKey: subnet.key,
    coverage: "missing",
    via: "-",
    detail: "No connected, static, dynamic, or default route coverage detected."
  };
}

function matchingStaticRoute(routes: StaticRoute[], subnet: RoutedSubnet): StaticRoute | undefined {
  return [...routes].sort(compareStaticRoutes).find((route) => {
    if (!isIpv4(route.network) || !isSubnetMask(route.mask)) return false;
    if (route.network === "0.0.0.0" && route.mask === "0.0.0.0") return false;
    const routePrefix = maskToPrefix(route.mask);
    if (route.network === subnet.network && routePrefix === subnet.prefix) return true;
    return routePrefix <= subnet.prefix && ipInSubnet(subnet.network, route.network, route.mask);
  });
}

function routingNetworkMatches(network: string, subnet: RoutedSubnet): boolean {
  const cidr = network.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (cidr) {
    const [, routeNetwork, prefixText] = cidr;
    const prefix = Number(prefixText);
    return Number.isInteger(prefix) && prefix <= subnet.prefix && ipInSubnet(subnet.network, routeNetwork, prefixToMask(prefix));
  }
  const wildcard = network.match(/^(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/);
  if (wildcard) {
    const [, routeNetwork, wildcardMask] = wildcard;
    const mask = wildcardToMask(wildcardMask);
    return ipInSubnet(subnet.network, routeNetwork, mask);
  }
  return network.includes(subnet.network);
}

function pairwiseSubnetChecks(subnets: RoutedSubnet[], coverage: DeviceRouteCoverage[]): SubnetPathCheck[] {
  const checks: SubnetPathCheck[] = [];
  for (let i = 0; i < subnets.length; i += 1) {
    for (let j = i + 1; j < subnets.length; j += 1) {
      const left = subnets[i];
      const right = subnets[j];
      const leftCoverage = coverage.filter((item) => item.subnetKey === left.key && item.coverage !== "missing");
      const rightCoverage = coverage.filter((item) => item.subnetKey === right.key && item.coverage !== "missing");
      const sharedDevices = leftCoverage
        .filter((leftItem) => rightCoverage.some((rightItem) => rightItem.deviceId === leftItem.deviceId))
        .map((item) => item.deviceLabel);
      const coverageKinds = Array.from(new Set([...leftCoverage, ...rightCoverage].map((item) => item.coverage)));
      const status: SubnetPathCheck["status"] = sharedDevices.length ? "reachable" : leftCoverage.length && rightCoverage.length ? "partial" : "missing";
      checks.push({
        sourceSubnet: left.key,
        targetSubnet: right.key,
        status,
        coverage: coverageKinds.length ? coverageKinds : ["missing"],
        devices: sharedDevices,
        recommendation: status === "reachable"
          ? "At least one Layer 3 device has route coverage for both subnets."
          : status === "partial"
            ? "Route coverage exists on separate devices; verify next-hop and return routes."
            : "Add connected, static, dynamic, or default route coverage between these subnets."
      });
    }
  }
  return checks;
}

function routingWarnings(project: NetworkProject, subnets: RoutedSubnet[], coverage: DeviceRouteCoverage[], pathChecks: SubnetPathCheck[]): string[] {
  const warnings: string[] = [];
  for (const subnet of subnets) {
    if (!coverage.some((item) => item.subnetKey === subnet.key && item.coverage === "connected")) {
      warnings.push(`${subnet.key} has no connected Layer 3 owner.`);
    }
    if (!subnet.gateways.length) {
      warnings.push(`${subnet.key} has no gateway candidate in the address plan.`);
    }
  }
  const missingPairs = pathChecks.filter((check) => check.status === "missing");
  if (missingPairs.length) {
    warnings.push(`${missingPairs.length} subnet pairs have no route coverage.`);
  }
  const trackedRoutes = project.devices.flatMap((device) => device.config.staticRoutes
    .filter((route) => route.trackId)
    .map((route) => ({ device, route })));
  const ipSlaTrackedRoutes = trackedRoutes.filter(({ device, route }) =>
    (device.config.trackObjects ?? []).some((track) => track.trackId === route.trackId && track.type === "ip-sla")
  );
  if (ipSlaTrackedRoutes.length && !project.devices.some((device) => (device.config.ipSlaOperations ?? []).length > 0)) {
    warnings.push("Tracked static routes exist but no IP SLA operation is configured.");
  }
  const inactiveTrackedRoutes = trackedRoutes
    .filter(({ device, route }) => !staticRouteActive(project, device, route))
    .map(({ device, route }) => `${device.label} ${route.network}/${route.mask} track ${route.trackId}`);
  if (inactiveTrackedRoutes.length) {
    warnings.push(`Tracked static routes currently inactive: ${inactiveTrackedRoutes.slice(0, 5).join(", ")}${inactiveTrackedRoutes.length > 5 ? ", ..." : ""}`);
  }
  return warnings;
}

function isL3Device(device: NetworkDevice): boolean {
  return (device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless") &&
    device.ports.some((port) => isIpv4(port.ipAddress));
}

function prefixToMask(prefix: number): string {
  const bits = prefix <= 0 ? 0 : prefix >= 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map((shift) => String((bits >>> shift) & 255)).join(".");
}

function wildcardToMask(wildcard: string): string {
  return wildcard.split(".").map((octet) => String(255 - Number(octet))).join(".");
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
