import { desktopNetstatListeningRows, desktopTasklistRows } from "./desktopDiagnostics";
import { ipInSubnet, isIpv4, isSubnetMask } from "./ip";
import { fallbackPing } from "./simulation";
import { endpoint } from "./topology";
import type { NetworkDevice, NetworkPort, NetworkProject } from "../types/network";

export type ServiceName = "dhcp" | "dns" | "http" | "ftp" | "email" | "tftp" | "syslog";
export type ServiceReachabilityStatus = "reachable" | "local-only" | "blocked" | "unconfigured" | "unknown";

export interface ServiceEndpoint {
  deviceId: string;
  label: string;
  portName: string;
  ipAddress: string;
  services: ServiceName[];
}

export interface ClientEndpoint {
  deviceId: string;
  label: string;
  portName: string;
  ipAddress: string;
  gateway: string;
  dnsServer: string;
}

export interface ServiceReachabilityCheck {
  id: string;
  client: ClientEndpoint;
  service: ServiceName;
  server?: ServiceEndpoint;
  status: ServiceReachabilityStatus;
  reason: string;
  pathScope: "same-subnet" | "routed" | "missing-address" | "missing-server";
}

export interface ServiceReachabilityReport {
  clients: ClientEndpoint[];
  servers: ServiceEndpoint[];
  checks: ServiceReachabilityCheck[];
  totals: {
    clients: number;
    servers: number;
    reachable: number;
    localOnly: number;
    blocked: number;
    unconfigured: number;
    unknown: number;
  };
}

export interface ServiceReachabilityServiceSummary {
  service: ServiceName;
  total: number;
  reachable: number;
  localOnly: number;
  blocked: number;
  unconfigured: number;
  unknown: number;
}

const serviceOrder: ServiceName[] = ["dhcp", "dns", "http", "ftp", "email", "tftp", "syslog"];

export function analyzeServiceReachability(project: NetworkProject): ServiceReachabilityReport {
  const clients = collectClients(project);
  const servers = collectServers(project);
  const components = activeComponents(project);
  const checks = clients.flatMap((client) => serviceOrder.map((service) => checkService(project, components, client, service, servers)));
  return {
    clients,
    servers,
    checks,
    totals: {
      clients: clients.length,
      servers: servers.length,
      reachable: checks.filter((check) => check.status === "reachable").length,
      localOnly: checks.filter((check) => check.status === "local-only").length,
      blocked: checks.filter((check) => check.status === "blocked").length,
      unconfigured: checks.filter((check) => check.status === "unconfigured").length,
      unknown: checks.filter((check) => check.status === "unknown").length
    }
  };
}

export function buildServiceReachabilityReportText(project: NetworkProject): string {
  return buildServiceReachabilityReportLines(project).join("\n");
}

export function buildServiceReachabilityReportLines(project: NetworkProject): string[] {
  const report = analyzeServiceReachability(project);
  const serviceSummary = summarizeServiceReachabilityByService(report);
  const serviceLogRows = project.devices
    .filter((device) => Object.values(device.config.services).some(Boolean) || device.runtime.logs.length > 0)
    .map((device) => [
      device.label,
      String(serviceLogCount(device, "DNS")),
      String(serviceLogCount(device, "HTTP")),
      String(serviceLogCount(device, "FTP")),
      String(serviceLogCount(device, "EMAIL")),
      String(serviceLogCount(device, "TFTP")),
      String(device.runtime.logs.length)
    ]);
  const listeningRows = project.devices.flatMap((device) => {
    const tasksByPid = new Map(desktopTasklistRows(device).map((task) => [task.pid, task]));
    return desktopNetstatListeningRows(device).map((row) => [
      device.label,
      row.service,
      row.protocol,
      row.localAddress,
      row.state || "-",
      row.pid,
      tasksByPid.get(row.pid)?.imageName ?? "-"
    ]);
  });
  return [
    "Network Editor Web Service Reachability Report",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Clients: ${report.totals.clients}`,
    `- Service endpoints: ${report.totals.servers}`,
    `- Reachable checks: ${report.totals.reachable}`,
    `- Local-only checks: ${report.totals.localOnly}`,
    `- Blocked checks: ${report.totals.blocked}`,
    `- Unconfigured checks: ${report.totals.unconfigured}`,
    `- Unknown checks: ${report.totals.unknown}`,
    "",
    "Service Status Summary",
    ...table(["Service", "Total", "Reachable", "Local-only", "Blocked", "Unconfigured", "Unknown"], serviceSummary.map((summary) => [
      summary.service.toUpperCase(),
      String(summary.total),
      String(summary.reachable),
      String(summary.localOnly),
      String(summary.blocked),
      String(summary.unconfigured),
      String(summary.unknown)
    ])),
    "",
    "Clients",
    ...table(["Client", "Port", "IP", "Gateway", "DNS"], report.clients.map((client) => [
      client.label,
      client.portName,
      client.ipAddress,
      client.gateway || "-",
      client.dnsServer || "-"
    ])),
    "",
    "Servers",
    ...table(["Server", "Port", "IP", "Services"], report.servers.map((server) => [
      server.label,
      server.portName,
      server.ipAddress,
      server.services.join(", ")
    ])),
    "",
    "Service Log Summary",
    ...table(["Device", "DNS", "HTTP", "FTP", "EMAIL", "TFTP", "SYSLOG"], serviceLogRows),
    "",
    "Listening Ports",
    ...table(["Device", "Service", "Protocol", "Local address", "State", "PID", "Process"], listeningRows),
    "",
    "Checks",
    ...table(["Client", "Service", "Status", "Server", "Scope", "Reason"], report.checks.map((check) => [
      check.client.label,
      check.service.toUpperCase(),
      check.status,
      check.server ? `${check.server.label} ${check.server.ipAddress}` : "-",
      check.pathScope,
      check.reason
    ]))
  ];
}

export function summarizeServiceReachabilityByService(report: ServiceReachabilityReport): ServiceReachabilityServiceSummary[] {
  return serviceOrder.map((service) => {
    const checks = report.checks.filter((check) => check.service === service);
    return {
      service,
      total: checks.length,
      reachable: checks.filter((check) => check.status === "reachable").length,
      localOnly: checks.filter((check) => check.status === "local-only").length,
      blocked: checks.filter((check) => check.status === "blocked").length,
      unconfigured: checks.filter((check) => check.status === "unconfigured").length,
      unknown: checks.filter((check) => check.status === "unknown").length
    };
  });
}

function serviceLogCount(device: NetworkDevice, prefix: string): number {
  return device.runtime.logs.filter((log) => log.message.startsWith(prefix)).length;
}

function checkService(
  project: NetworkProject,
  components: Map<string, number>,
  client: ClientEndpoint,
  service: ServiceName,
  servers: ServiceEndpoint[]
): ServiceReachabilityCheck {
  const server = bestServerForService(client, service, servers);
  if (!isIpv4(client.ipAddress)) {
    return reachabilityCheck(client, service, server, "unconfigured", "Client has no IPv4 address.", "missing-address");
  }
  if (!server) {
    return reachabilityCheck(client, service, undefined, "unconfigured", `No ${service.toUpperCase()} service endpoint is enabled.`, "missing-server");
  }
  const clientDevice = project.devices.find((device) => device.id === client.deviceId);
  const serverDevice = project.devices.find((device) => device.id === server.deviceId);
  const clientPort = clientDevice?.ports.find((port) => port.name === client.portName);
  const serverPort = serverDevice?.ports.find((port) => port.name === server.portName);
  if (!clientDevice || !serverDevice || !clientPort || !serverPort) {
    return reachabilityCheck(client, service, server, "unknown", "Client or server port could not be found.", "missing-address");
  }
  if (!clientDevice.powerOn || !serverDevice.powerOn || !clientPort.adminUp || !serverPort.adminUp) {
    return reachabilityCheck(client, service, server, "blocked", "Client or service endpoint device/port is down.", "routed");
  }
  if (components.get(client.deviceId) !== components.get(server.deviceId)) {
    return reachabilityCheck(client, service, server, "blocked", "Client and service endpoint are not in the same active topology component.", "routed");
  }
  const sameSubnetPath = sameSubnet(clientPort, serverPort);
  if (!sameSubnetPath && !isIpv4(client.gateway)) {
    return reachabilityCheck(client, service, server, "local-only", "Client needs a default gateway to reach this remote service.", "routed");
  }
  if (!sameSubnetPath && !gatewayCandidateExists(project, clientPort, client.gateway)) {
    return reachabilityCheck(client, service, server, "blocked", `Gateway ${client.gateway} is not present in the project.`, "routed");
  }
  if (service === "dns" && client.dnsServer && client.dnsServer !== server.ipAddress && !servers.some((candidate) => candidate.ipAddress === client.dnsServer && candidate.services.includes("dns"))) {
    return reachabilityCheck(client, service, server, "blocked", `Client DNS points to ${client.dnsServer}, but no DNS server owns that address.`, "routed");
  }
  const pathScope = sameSubnetPath ? "same-subnet" : "routed";
  const simulated = fallbackPing(project, clientDevice.id, serverDevice.id, service);
  if (!simulated.success) {
    return reachabilityCheck(client, service, server, "blocked", `Simulation path failed: ${simulated.message}`, pathScope);
  }
  return reachabilityCheck(
    client,
    service,
    server,
    "reachable",
    sameSubnetPath ? "Client and service endpoint share a simulated reachable subnet." : "Client has a simulated routed path to the remote service.",
    pathScope
  );
}

function reachabilityCheck(
  client: ClientEndpoint,
  service: ServiceName,
  server: ServiceEndpoint | undefined,
  status: ServiceReachabilityStatus,
  reason: string,
  pathScope: ServiceReachabilityCheck["pathScope"]
): ServiceReachabilityCheck {
  return {
    id: `${client.deviceId}-${service}`,
    client,
    service,
    server,
    status,
    reason,
    pathScope
  };
}

function collectClients(project: NetworkProject): ClientEndpoint[] {
  return project.devices
    .filter((device) => device.kind === "pc" || device.kind === "server")
    .flatMap((device) => device.ports
      .filter((port) => port.kind !== "console" && (port.ipAddress || port.linkId || port.kind === "wireless"))
      .map((port) => ({
        deviceId: device.id,
        label: device.label,
        portName: port.name,
        ipAddress: port.ipAddress,
        gateway: port.gateway,
        dnsServer: port.dnsServer
      })));
}

function collectServers(project: NetworkProject): ServiceEndpoint[] {
  return project.devices.flatMap((device) => {
    const services = enabledServices(device);
    if (!services.length) return [];
    return device.ports
      .filter((port) => port.kind !== "console" && isIpv4(port.ipAddress))
      .map((port) => ({
        deviceId: device.id,
        label: device.label,
        portName: port.name,
        ipAddress: port.ipAddress,
        services
      }));
  });
}

function bestServerForService(client: ClientEndpoint, service: ServiceName, servers: ServiceEndpoint[]): ServiceEndpoint | undefined {
  const candidates = servers.filter((server) => server.services.includes(service));
  if (!candidates.length) return undefined;
  if (service === "dns" && client.dnsServer) {
    const dnsMatch = candidates.find((server) => server.ipAddress === client.dnsServer);
    if (dnsMatch) return dnsMatch;
  }
  return candidates.find((server) => server.deviceId !== client.deviceId) ?? candidates[0];
}

function enabledServices(device: NetworkDevice): ServiceName[] {
  return serviceOrder.filter((service) => device.config.services[service]);
}

function sameSubnet(left: NetworkPort, right: NetworkPort): boolean {
  return isIpv4(left.ipAddress) &&
    isIpv4(right.ipAddress) &&
    isSubnetMask(left.subnetMask) &&
    ipInSubnet(right.ipAddress, left.ipAddress, left.subnetMask);
}

function gatewayCandidateExists(project: NetworkProject, clientPort: NetworkPort, gateway: string): boolean {
  if (!isIpv4(gateway) || !isIpv4(clientPort.ipAddress) || !isSubnetMask(clientPort.subnetMask)) return false;
  if (!ipInSubnet(gateway, clientPort.ipAddress, clientPort.subnetMask)) return false;
  return project.devices.some((device) => device.ports.some((port) => {
    if (port.id === clientPort.id) return false;
    if (!device.powerOn || !port.adminUp) return false;
    if (port.ipAddress === gateway && sameSubnetOwner(gateway, port.ipAddress, port.subnetMask)) return true;
    if ((port.secondaryIpAddresses ?? []).some((secondary) => secondary.ipAddress === gateway && sameSubnetOwner(gateway, secondary.ipAddress, secondary.subnetMask))) return true;
    if ((port.hsrpGroups ?? []).some((group) => group.virtualIp === gateway && sameSubnetOwner(gateway, port.ipAddress, port.subnetMask))) return true;
    if ((port.vrrpGroups ?? []).some((group) => group.virtualIp === gateway && sameSubnetOwner(gateway, port.ipAddress, port.subnetMask))) return true;
    return false;
  }));
}

function sameSubnetOwner(gateway: string, ownerIp: string, ownerMask: string): boolean {
  return isIpv4(ownerIp) && isSubnetMask(ownerMask) && ipInSubnet(gateway, ownerIp, ownerMask);
}

function activeComponents(project: NetworkProject): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  for (const device of project.devices.filter((item) => item.powerOn)) adjacency.set(device.id, new Set());
  for (const link of project.links) {
    if (!linkOperational(project, link)) continue;
    adjacency.get(link.endpointA.deviceId)?.add(link.endpointB.deviceId);
    adjacency.get(link.endpointB.deviceId)?.add(link.endpointA.deviceId);
  }
  const componentByDevice = new Map<string, number>();
  let component = 0;
  for (const device of project.devices.filter((item) => item.powerOn)) {
    if (componentByDevice.has(device.id)) continue;
    const stack = [device.id];
    componentByDevice.set(device.id, component);
    while (stack.length) {
      const current = stack.pop()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (componentByDevice.has(neighbor)) continue;
        componentByDevice.set(neighbor, component);
        stack.push(neighbor);
      }
    }
    component += 1;
  }
  return componentByDevice;
}

function linkOperational(project: NetworkProject, link: NetworkProject["links"][number]): boolean {
  if (link.status !== "up") return false;
  const a = endpoint(project, link.endpointA);
  const b = endpoint(project, link.endpointB);
  return Boolean(a?.device.powerOn && b?.device.powerOn && a.port.adminUp && b.port.adminUp);
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
