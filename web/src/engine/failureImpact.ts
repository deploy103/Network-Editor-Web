import { linkLabel } from "./topology";
import type { NetworkDevice, NetworkLink, NetworkProject } from "../types/network";

export interface FailureImpactEndpoint {
  deviceId: string;
  label: string;
  kind: string;
  primaryIp?: string;
}

export interface FailureImpactScenario {
  id: string;
  kind: "link" | "device";
  label: string;
  severity: "none" | "low" | "medium" | "high";
  affectedEndpointCount: number;
  affectedPairCount: number;
  affectedEndpoints: FailureImpactEndpoint[];
  isolatedComponents: string[][];
  recommendation: string;
}

export interface FailureImpactReport {
  endpointCount: number;
  componentCount: number;
  resilientEndpointPairs: number;
  vulnerableEndpointPairs: number;
  bridgeLinks: FailureImpactScenario[];
  criticalDevices: FailureImpactScenario[];
  scenarios: FailureImpactScenario[];
}

interface Graph {
  nodes: Set<string>;
  adjacency: Map<string, Set<string>>;
}

export function analyzeFailureImpact(project: NetworkProject): FailureImpactReport {
  const endpoints = endpointDevices(project);
  const baseline = connectedComponents(activeGraph(project));
  const baselineReachablePairs = reachableEndpointPairKeys(project, endpoints, baseline);
  const linkScenarios = project.links
    .filter((link) => link.status === "up")
    .map((link) => analyzeLinkFailure(project, endpoints, baselineReachablePairs, link));
  const deviceScenarios = project.devices
    .filter((device) => device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless")
    .map((device) => analyzeDeviceFailure(project, endpoints, baselineReachablePairs, device));
  const scenarios = [...linkScenarios, ...deviceScenarios].sort((left, right) =>
    severityRank(right.severity) - severityRank(left.severity) ||
    right.affectedPairCount - left.affectedPairCount ||
    left.label.localeCompare(right.label)
  );
  const vulnerableEndpointPairs = scenarios.reduce((max, scenario) => Math.max(max, scenario.affectedPairCount), 0);
  return {
    endpointCount: endpoints.length,
    componentCount: baseline.length,
    resilientEndpointPairs: Math.max(0, baselineReachablePairs.size - vulnerableEndpointPairs),
    vulnerableEndpointPairs,
    bridgeLinks: linkScenarios.filter((scenario) => scenario.affectedPairCount > 0),
    criticalDevices: deviceScenarios.filter((scenario) => scenario.affectedPairCount > 0),
    scenarios
  };
}

export function buildFailureImpactReportText(project: NetworkProject): string {
  return buildFailureImpactReportLines(project).join("\n");
}

export function buildFailureImpactReportLines(project: NetworkProject): string[] {
  const report = analyzeFailureImpact(project);
  return [
    "Network Editor Web Failure Impact Report",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Endpoints: ${report.endpointCount}`,
    `- Active graph components: ${report.componentCount}`,
    `- Bridge links: ${report.bridgeLinks.length}`,
    `- Critical network devices: ${report.criticalDevices.length}`,
    `- Worst-case affected endpoint pairs: ${report.vulnerableEndpointPairs}`,
    "",
    "Top Scenarios",
    ...table(
      ["Kind", "Target", "Severity", "Endpoints", "Pairs", "Recommendation"],
      report.scenarios.slice(0, 30).map((scenario) => [
        scenario.kind,
        scenario.label,
        scenario.severity,
        String(scenario.affectedEndpointCount),
        String(scenario.affectedPairCount),
        scenario.recommendation
      ])
    ),
    "",
    "Affected Endpoint Detail",
    ...report.scenarios
      .filter((scenario) => scenario.affectedEndpointCount > 0)
      .slice(0, 20)
      .flatMap((scenario) => [
        `## ${scenario.kind.toUpperCase()} ${scenario.label}`,
        `Severity: ${scenario.severity}`,
        `Affected pairs: ${scenario.affectedPairCount}`,
        `Affected endpoints: ${scenario.affectedEndpoints.map((endpoint) => endpoint.label).join(", ") || "-"}`,
        `Components: ${scenario.isolatedComponents.map((component) => `[${component.join(", ")}]`).join(" ") || "-"}`,
        `Recommendation: ${scenario.recommendation}`,
        ""
      ])
  ];
}

function analyzeLinkFailure(project: NetworkProject, endpoints: NetworkDevice[], baselineReachablePairs: Set<string>, link: NetworkLink): FailureImpactScenario {
  const graph = activeGraph(project, { excludedLinkId: link.id });
  const components = connectedComponents(graph);
  return scenarioFromComponents(project, endpoints, baselineReachablePairs, components, {
    id: link.id,
    kind: "link",
    label: linkLabel(project, link),
    recommendation: "Add redundant uplinks, alternate Layer 3 paths, or EtherChannel where this link is not intended to be a single point of failure."
  });
}

function analyzeDeviceFailure(project: NetworkProject, endpoints: NetworkDevice[], baselineReachablePairs: Set<string>, device: NetworkDevice): FailureImpactScenario {
  const graph = activeGraph(project, { excludedDeviceId: device.id });
  const components = connectedComponents(graph);
  return scenarioFromComponents(project, endpoints, baselineReachablePairs, components, {
    id: device.id,
    kind: "device",
    label: `${device.label} (${device.model})`,
    recommendation: device.kind === "switch"
      ? "Use redundant access/distribution uplinks, dual-homed services, or a second switch for high availability."
      : device.kind === "router" || device.kind === "firewall"
        ? "Use first-hop redundancy, floating routes, dynamic routing, or paired edge/security devices."
        : "Use controller/AP redundancy or overlapping wireless coverage when the lab requires availability."
  });
}

function scenarioFromComponents(
  project: NetworkProject,
  endpoints: NetworkDevice[],
  baselineReachablePairs: Set<string>,
  components: string[][],
  source: { id: string; kind: "link" | "device"; label: string; recommendation: string }
): FailureImpactScenario {
  const reachablePairs = reachableEndpointPairKeys(project, endpoints, components);
  const lostPairs = Array.from(baselineReachablePairs).filter((pair) => !reachablePairs.has(pair));
  const affectedIds = new Set(lostPairs.flatMap((pair) => pair.split("<->")));
  const affectedEndpoints = endpoints.filter((endpoint) => affectedIds.has(endpoint.id)).map(endpointSummary);
  const isolatedComponents = components
    .map((component) => component.filter((deviceId) => affectedIds.has(deviceId)).map((deviceId) => project.devices.find((device) => device.id === deviceId)?.label ?? deviceId))
    .filter((component) => component.length > 0);
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    severity: impactSeverity(affectedEndpoints.length, lostPairs.length, endpoints.length),
    affectedEndpointCount: affectedEndpoints.length,
    affectedPairCount: lostPairs.length,
    affectedEndpoints,
    isolatedComponents,
    recommendation: affectedEndpoints.length ? source.recommendation : "No endpoint reachability loss was detected for this failure."
  };
}

function activeGraph(project: NetworkProject, options: { excludedLinkId?: string; excludedDeviceId?: string } = {}): Graph {
  const nodes = new Set(project.devices.filter((device) => device.id !== options.excludedDeviceId).map((device) => device.id));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node, new Set());
  for (const link of project.links) {
    if (link.status !== "up") continue;
    if (link.id === options.excludedLinkId) continue;
    if (link.endpointA.deviceId === options.excludedDeviceId || link.endpointB.deviceId === options.excludedDeviceId) continue;
    if (!nodes.has(link.endpointA.deviceId) || !nodes.has(link.endpointB.deviceId)) continue;
    adjacency.get(link.endpointA.deviceId)?.add(link.endpointB.deviceId);
    adjacency.get(link.endpointB.deviceId)?.add(link.endpointA.deviceId);
  }
  return { nodes, adjacency };
}

function connectedComponents(graph: Graph): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const node of graph.nodes) {
    if (visited.has(node)) continue;
    const stack = [node];
    const component: string[] = [];
    visited.add(node);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const neighbor of graph.adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    components.push(component.sort());
  }
  return components.sort((left, right) => right.length - left.length);
}

function reachableEndpointPairKeys(project: NetworkProject, endpoints: NetworkDevice[], components: string[][]): Set<string> {
  const componentByDevice = new Map<string, number>();
  components.forEach((component, index) => component.forEach((deviceId) => componentByDevice.set(deviceId, index)));
  const pairs = new Set<string>();
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const left = endpoints[i];
      const right = endpoints[j];
      if (componentByDevice.get(left.id) === componentByDevice.get(right.id)) {
        pairs.add(endpointPairKey(left.id, right.id));
      }
    }
  }
  return pairs;
}

function endpointPairKey(left: string, right: string): string {
  return [left, right].sort().join("<->");
}

function endpointDevices(project: NetworkProject): NetworkDevice[] {
  return project.devices.filter((device) => device.kind === "pc" || device.kind === "server" || (device.kind !== "hub" && device.ports.some((port) => port.kind === "wireless" && port.ipAddress)));
}

function endpointSummary(device: NetworkDevice): FailureImpactEndpoint {
  const dataPort = device.ports.find((port) => port.kind !== "console" && port.ipAddress) ?? device.ports.find((port) => port.kind !== "console");
  return {
    deviceId: device.id,
    label: device.label,
    kind: device.kind,
    primaryIp: dataPort?.ipAddress || undefined
  };
}

function impactSeverity(affectedEndpoints: number, affectedPairs: number, endpointCount: number): FailureImpactScenario["severity"] {
  if (affectedEndpoints === 0 || affectedPairs === 0) return "none";
  const endpointRatio = endpointCount ? affectedEndpoints / endpointCount : 0;
  if (endpointRatio >= 0.5 || affectedPairs >= 6) return "high";
  if (endpointRatio >= 0.25 || affectedPairs >= 2) return "medium";
  return "low";
}

function severityRank(severity: FailureImpactScenario["severity"]): number {
  return ({ none: 0, low: 1, medium: 2, high: 3 })[severity];
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
