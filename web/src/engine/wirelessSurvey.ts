import { analyzeAddressPlan } from "./addressPlan";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import type { NetworkDevice, NetworkLink, NetworkPort, NetworkProject } from "../types/network";

export type WirelessInfrastructureRole = "controller" | "access-point" | "bridge" | "infrastructure";
export type WirelessSignalLevel = "excellent" | "good" | "fair" | "weak" | "none";
export type WirelessCoverageStatus = "associated" | "covered" | "weak" | "uncovered" | "mismatch" | "disabled";
export type WirelessReuseStatus = "clear" | "adjacent-risk" | "co-channel-risk" | "profile-gap";
export type WirelessBackhaulStatus = "ok" | "warning" | "critical";
export type WirelessDhcpStatus = "covered" | "static" | "missing" | "invalid" | "no-ip";
export type WirelessFindingSeverity = "info" | "warning" | "critical";

export interface WirelessInfrastructureNode {
  deviceId: string;
  deviceLabel: string;
  role: WirelessInfrastructureRole;
  model: string;
  ssid: string;
  auth: "open" | "wpa2-psk";
  keySet: boolean;
  channel: number;
  band: string;
  rangeMeters: number;
  powerOn: boolean;
  x: number;
  y: number;
  wirelessPorts: string[];
  wiredPorts: string[];
  managementIps: string[];
  vlanIds: number[];
  uplinkCount: number;
}

export interface WirelessClientNode {
  deviceId: string;
  deviceLabel: string;
  portId: string;
  portName: string;
  ssid: string;
  auth: "open" | "wpa2-psk";
  keySet: boolean;
  vlan: number;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  dnsServer: string;
  powerOn: boolean;
  x: number;
  y: number;
  linkedAp?: string;
  linkStatus?: NetworkLink["status"];
}

export interface WirelessSsidProfile {
  ssid: string;
  infrastructure: number;
  clients: number;
  authModes: string[];
  channels: number[];
  vlans: number[];
  bands: string[];
  keyStates: string[];
  controllerLabels: string[];
  accessPointLabels: string[];
  risks: string[];
}

export interface WirelessCoverageCheck {
  clientLabel: string;
  portName: string;
  ssid: string;
  status: WirelessCoverageStatus;
  signal: WirelessSignalLevel;
  associatedAp: string;
  bestCandidate: string;
  distanceMeters: number;
  candidateCount: number;
  reason: string;
  recommendation: string;
}

export interface WirelessChannelReuseCheck {
  leftAp: string;
  rightAp: string;
  ssid: string;
  channel: string;
  band: string;
  distanceMeters: number;
  overlapMeters: number;
  status: WirelessReuseStatus;
  recommendation: string;
}

export interface WirelessRoamingCandidate {
  leftAp: string;
  rightAp: string;
  ssid: string;
  auth: string;
  distanceMeters: number;
  overlapMeters: number;
  status: "ready" | "coverage-gap" | "co-channel-risk" | "profile-mismatch";
  recommendation: string;
}

export interface WirelessBackhaulCheck {
  deviceLabel: string;
  role: WirelessInfrastructureRole;
  status: WirelessBackhaulStatus;
  uplinks: number;
  managementIp: string;
  managementNetwork: string;
  detail: string;
  recommendation: string;
}

export interface WirelessDhcpCoverage {
  clientLabel: string;
  portName: string;
  network: string;
  pool: string;
  server: string;
  status: WirelessDhcpStatus;
  reason: string;
}

export interface WirelessSecurityFinding {
  severity: WirelessFindingSeverity;
  scope: string;
  subject: string;
  detail: string;
  recommendation: string;
}

export interface WirelessCoverageCell {
  id: string;
  x: number;
  y: number;
  bestAp: string;
  ssids: string[];
  signal: WirelessSignalLevel;
  overlappingAps: number;
  channelCount: number;
  recommendation: string;
}

export interface WirelessActionItem {
  priority: "P1" | "P2" | "P3";
  category: string;
  target: string;
  action: string;
  evidence: string;
}

export interface WirelessSurveyReport {
  infrastructure: WirelessInfrastructureNode[];
  clients: WirelessClientNode[];
  ssids: WirelessSsidProfile[];
  coverage: WirelessCoverageCheck[];
  channelReuse: WirelessChannelReuseCheck[];
  roaming: WirelessRoamingCandidate[];
  backhaul: WirelessBackhaulCheck[];
  dhcp: WirelessDhcpCoverage[];
  security: WirelessSecurityFinding[];
  grid: WirelessCoverageCell[];
  actions: WirelessActionItem[];
  warnings: string[];
  totals: {
    infrastructure: number;
    controllers: number;
    accessPoints: number;
    clients: number;
    ssids: number;
    associatedClients: number;
    uncoveredClients: number;
    channelRisks: number;
    securityFindings: number;
    backhaulRisks: number;
    dhcpRisks: number;
    warnings: number;
  };
}

export function analyzeWirelessSurvey(project: NetworkProject): WirelessSurveyReport {
  const infrastructure = collectInfrastructure(project);
  const clients = collectWirelessClients(project, infrastructure);
  const ssids = buildSsidProfiles(infrastructure, clients);
  const coverage = analyzeClientCoverage(infrastructure, clients);
  const channelReuse = analyzeChannelReuse(infrastructure);
  const roaming = analyzeRoaming(infrastructure);
  const backhaul = analyzeBackhaul(project, infrastructure);
  const dhcp = analyzeWirelessDhcp(project, clients);
  const security = analyzeWirelessSecurity(infrastructure, clients, ssids);
  const grid = buildCoverageGrid(project, infrastructure);
  const actions = buildActionItems(coverage, channelReuse, backhaul, dhcp, security, ssids);
  const warnings = buildWarnings(coverage, channelReuse, backhaul, dhcp, security, ssids);
  return {
    infrastructure,
    clients,
    ssids,
    coverage,
    channelReuse,
    roaming,
    backhaul,
    dhcp,
    security,
    grid,
    actions,
    warnings,
    totals: {
      infrastructure: infrastructure.length,
      controllers: infrastructure.filter((node) => node.role === "controller").length,
      accessPoints: infrastructure.filter((node) => isRadioNode(node)).length,
      clients: clients.length,
      ssids: ssids.length,
      associatedClients: coverage.filter((item) => item.status === "associated").length,
      uncoveredClients: coverage.filter((item) => item.status === "uncovered" || item.status === "weak").length,
      channelRisks: channelReuse.filter((item) => item.status !== "clear").length,
      securityFindings: security.filter((item) => item.severity !== "info").length,
      backhaulRisks: backhaul.filter((item) => item.status !== "ok").length,
      dhcpRisks: dhcp.filter((item) => item.status === "missing" || item.status === "invalid" || item.status === "no-ip").length,
      warnings: warnings.length
    }
  };
}

export function buildWirelessSurveyReportText(project: NetworkProject): string {
  return buildWirelessSurveyReportLines(project).join("\n");
}

export function buildWirelessSurveyReportLines(project: NetworkProject): string[] {
  const survey = analyzeWirelessSurvey(project);
  return [
    "Network Editor Web Wireless Survey",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- Infrastructure devices: ${survey.totals.infrastructure}`,
    `- Controllers: ${survey.totals.controllers}`,
    `- Access points / bridges: ${survey.totals.accessPoints}`,
    `- Wireless clients: ${survey.totals.clients}`,
    `- SSIDs: ${survey.totals.ssids}`,
    `- Associated clients: ${survey.totals.associatedClients}`,
    `- Weak or uncovered clients: ${survey.totals.uncoveredClients}`,
    `- Channel risks: ${survey.totals.channelRisks}`,
    `- Security findings: ${survey.totals.securityFindings}`,
    `- Backhaul risks: ${survey.totals.backhaulRisks}`,
    `- DHCP risks: ${survey.totals.dhcpRisks}`,
    `- Warnings: ${survey.totals.warnings}`,
    "",
    "SSID Profiles",
    ...table(["SSID", "Infra", "Clients", "Auth", "Channels", "Bands", "VLANs", "Risks"], survey.ssids.map((ssid) => [
      ssid.ssid,
      String(ssid.infrastructure),
      String(ssid.clients),
      ssid.authModes.join(", "),
      ssid.channels.join(", ") || "-",
      ssid.bands.join(", ") || "-",
      ssid.vlans.join(", ") || "-",
      ssid.risks.join("; ") || "-"
    ])),
    "",
    "Infrastructure",
    ...table(["Device", "Role", "SSID", "Auth", "Channel", "Range", "Mgmt IPs", "Uplinks", "Power"], survey.infrastructure.map((node) => [
      node.deviceLabel,
      node.role,
      node.ssid,
      node.auth,
      `${node.channel} ${node.band}`,
      `${node.rangeMeters}m`,
      node.managementIps.join(", ") || "-",
      String(node.uplinkCount),
      node.powerOn ? "on" : "off"
    ])),
    "",
    "Client Coverage",
    ...table(["Client", "Port", "SSID", "Status", "Signal", "Associated AP", "Best Candidate", "Distance", "Reason"], survey.coverage.map((check) => [
      check.clientLabel,
      check.portName,
      check.ssid,
      check.status,
      check.signal,
      check.associatedAp,
      check.bestCandidate,
      check.distanceMeters ? `${check.distanceMeters}m` : "-",
      check.reason
    ])),
    "",
    "Channel Reuse",
    ...table(["Left AP", "Right AP", "SSID", "Channel", "Band", "Distance", "Overlap", "Status", "Recommendation"], survey.channelReuse.map((check) => [
      check.leftAp,
      check.rightAp,
      check.ssid,
      check.channel,
      check.band,
      `${check.distanceMeters}m`,
      `${check.overlapMeters}m`,
      check.status,
      check.recommendation
    ])),
    "",
    "Roaming Candidates",
    ...table(["Left AP", "Right AP", "SSID", "Auth", "Distance", "Overlap", "Status", "Recommendation"], survey.roaming.map((candidate) => [
      candidate.leftAp,
      candidate.rightAp,
      candidate.ssid,
      candidate.auth,
      `${candidate.distanceMeters}m`,
      `${candidate.overlapMeters}m`,
      candidate.status,
      candidate.recommendation
    ])),
    "",
    "Wired Backhaul",
    ...table(["Device", "Role", "Status", "Uplinks", "Management", "Network", "Detail", "Recommendation"], survey.backhaul.map((check) => [
      check.deviceLabel,
      check.role,
      check.status,
      String(check.uplinks),
      check.managementIp,
      check.managementNetwork,
      check.detail,
      check.recommendation
    ])),
    "",
    "DHCP Coverage",
    ...table(["Client", "Port", "Network", "Pool", "Server", "Status", "Reason"], survey.dhcp.map((check) => [
      check.clientLabel,
      check.portName,
      check.network,
      check.pool,
      check.server,
      check.status,
      check.reason
    ])),
    "",
    "Coverage Grid",
    ...table(["Cell", "Center", "Best AP", "SSIDs", "Signal", "Overlap APs", "Channels", "Recommendation"], survey.grid.map((cell) => [
      cell.id,
      `${cell.x},${cell.y}`,
      cell.bestAp,
      cell.ssids.join(", ") || "-",
      cell.signal,
      String(cell.overlappingAps),
      String(cell.channelCount),
      cell.recommendation
    ])),
    "",
    "Security Findings",
    ...table(["Severity", "Scope", "Subject", "Detail", "Recommendation"], survey.security.map((finding) => [
      finding.severity,
      finding.scope,
      finding.subject,
      finding.detail,
      finding.recommendation
    ])),
    "",
    "Action Checklist",
    ...table(["Priority", "Category", "Target", "Action", "Evidence"], survey.actions.map((item) => [
      item.priority,
      item.category,
      item.target,
      item.action,
      item.evidence
    ])),
    "",
    "Warnings",
    ...(survey.warnings.length ? survey.warnings.map((warning) => `- ${warning}`) : ["- none"])
  ];
}

function collectInfrastructure(project: NetworkProject): WirelessInfrastructureNode[] {
  return project.devices
    .filter((device) => device.kind === "wireless")
    .map((device) => {
      const wirelessPorts = device.ports.filter((port) => port.kind === "wireless");
      const wiredPorts = device.ports.filter((port) => port.kind !== "wireless" && port.kind !== "console");
      const managementPorts = device.ports.filter((port) => isIpv4(port.ipAddress));
      const uplinkCount = wiredPorts.filter((port) => port.linkId).length;
      return {
        deviceId: device.id,
        deviceLabel: device.label,
        role: inferInfrastructureRole(device),
        model: device.model,
        ssid: normalizedSsid(device.config.wireless.ssid),
        auth: device.config.wireless.auth,
        keySet: device.config.wireless.key.trim().length > 0,
        channel: normalizeChannel(device.config.wireless.channel),
        band: channelBand(device.config.wireless.channel),
        rangeMeters: normalizeRange(device.config.wireless.range),
        powerOn: device.powerOn,
        x: device.position.x,
        y: device.position.y,
        wirelessPorts: wirelessPorts.map((port) => port.name),
        wiredPorts: wiredPorts.map((port) => port.name),
        managementIps: managementPorts.map((port) => port.ipAddress),
        vlanIds: uniqueNumbers(device.ports.map((port) => port.vlan).filter((vlan) => vlan > 0)),
        uplinkCount
      };
    })
    .sort((left, right) => roleRank(left.role) - roleRank(right.role) || left.deviceLabel.localeCompare(right.deviceLabel));
}

function collectWirelessClients(project: NetworkProject, infrastructure: WirelessInfrastructureNode[]): WirelessClientNode[] {
  return project.devices
    .filter((device) => device.kind !== "wireless")
    .flatMap((device) => device.ports
      .filter((port) => port.kind === "wireless")
      .map((port) => {
        const link = wirelessLinkForPort(project, device.id, port.id);
        const peer = link ? peerInfrastructure(project, link, device.id, infrastructure) : undefined;
        return {
          deviceId: device.id,
          deviceLabel: device.label,
          portId: port.id,
          portName: port.name,
          ssid: normalizedSsid(device.config.wireless.ssid),
          auth: device.config.wireless.auth,
          keySet: device.config.wireless.key.trim().length > 0,
          vlan: port.vlan,
          ipAddress: port.ipAddress,
          subnetMask: port.subnetMask,
          gateway: port.gateway,
          dnsServer: port.dnsServer,
          powerOn: device.powerOn,
          x: device.position.x,
          y: device.position.y,
          linkedAp: peer?.deviceLabel,
          linkStatus: link?.status
        };
      }))
    .sort((left, right) => left.deviceLabel.localeCompare(right.deviceLabel) || left.portName.localeCompare(right.portName));
}

function buildSsidProfiles(infrastructure: WirelessInfrastructureNode[], clients: WirelessClientNode[]): WirelessSsidProfile[] {
  const names = uniqueStrings([
    ...infrastructure.map((node) => node.ssid),
    ...clients.map((client) => client.ssid)
  ]);
  return names.map((ssid) => {
    const nodes = infrastructure.filter((node) => node.ssid === ssid);
    const ssidClients = clients.filter((client) => client.ssid === ssid);
    const risks: string[] = [];
    const authModes = uniqueStrings([...nodes.map((node) => node.auth), ...ssidClients.map((client) => client.auth)]);
    const keyStates = uniqueStrings([...nodes.map((node) => node.keySet ? "key-set" : "no-key"), ...ssidClients.map((client) => client.keySet ? "key-set" : "no-key")]);
    if (authModes.length > 1) risks.push("mixed authentication");
    if (ssid === "(blank)") risks.push("blank SSID");
    if (ssid.toLowerCase() === "lab-wireless") risks.push("default SSID");
    if (authModes.includes("open")) risks.push("open authentication");
    if (nodes.length === 0 && ssidClients.length > 0) risks.push("clients without infrastructure");
    if (nodes.length > 0 && ssidClients.length === 0) risks.push("no associated client profile");
    return {
      ssid,
      infrastructure: nodes.length,
      clients: ssidClients.length,
      authModes,
      channels: uniqueNumbers(nodes.filter(isRadioNode).map((node) => node.channel)),
      vlans: uniqueNumbers([...nodes.flatMap((node) => node.vlanIds), ...ssidClients.map((client) => client.vlan)].filter((vlan) => vlan > 0)),
      bands: uniqueStrings(nodes.filter(isRadioNode).map((node) => node.band)),
      keyStates,
      controllerLabels: nodes.filter((node) => node.role === "controller").map((node) => node.deviceLabel),
      accessPointLabels: nodes.filter(isRadioNode).map((node) => node.deviceLabel),
      risks
    };
  }).sort((left, right) => left.ssid.localeCompare(right.ssid));
}

function analyzeClientCoverage(infrastructure: WirelessInfrastructureNode[], clients: WirelessClientNode[]): WirelessCoverageCheck[] {
  const radios = infrastructure.filter(isRadioNode);
  return clients.map((client) => {
    const associated = client.linkedAp ? radios.find((node) => node.deviceLabel === client.linkedAp) : undefined;
    const ranked = rankCandidateRadios(client, radios);
    const best = ranked[0];
    const sameProfileCandidates = ranked.filter((candidate) => profileMatches(client, candidate.node));
    if (!client.powerOn) {
      return coverageCheck(client, "disabled", "none", associated, best, sameProfileCandidates.length, "Client device is powered off.", "Power on the client before validating WLAN coverage.");
    }
    if (associated && client.linkStatus === "down") {
      return coverageCheck(client, "disabled", "none", associated, best, sameProfileCandidates.length, "Wireless link exists but is down.", "Bring the wireless link up or reassociate the client.");
    }
    if (associated && !profileMatches(client, associated)) {
      return coverageCheck(client, "mismatch", signalLevel(distanceBetweenClientAndNode(client, associated), associated.rangeMeters), associated, best, sameProfileCandidates.length, "Associated AP uses a different SSID, authentication mode, or WPA2 key state.", "Align the client WLAN profile with the AP profile.");
    }
    if (associated && client.linkStatus === "up") {
      const distance = distanceBetweenClientAndNode(client, associated);
      return coverageCheck(client, "associated", signalLevel(distance, associated.rangeMeters), associated, best, sameProfileCandidates.length, "Client has an up wireless association.", "No coverage action required.");
    }
    if (best && profileMatches(client, best.node) && best.distance <= best.node.rangeMeters) {
      return coverageCheck(client, "covered", signalLevel(best.distance, best.node.rangeMeters), undefined, best, sameProfileCandidates.length, "Client is inside at least one matching AP coverage radius.", "Create or repair a wireless link to the best AP candidate.");
    }
    if (best && profileMatches(client, best.node) && best.distance <= best.node.rangeMeters * 1.25) {
      return coverageCheck(client, "weak", signalLevel(best.distance, best.node.rangeMeters), undefined, best, sameProfileCandidates.length, "Client is near the edge of matching AP coverage.", "Move the client closer, raise AP range, or add another AP.");
    }
    if (ranked.some((candidate) => candidate.node.ssid === client.ssid)) {
      return coverageCheck(client, "mismatch", best ? signalLevel(best.distance, best.node.rangeMeters) : "none", undefined, best, sameProfileCandidates.length, "SSID exists but authentication or key state does not match.", "Make the client and AP security profile consistent.");
    }
    return coverageCheck(client, "uncovered", "none", undefined, best, sameProfileCandidates.length, "No AP with a matching SSID profile covers this client.", "Add a matching AP, move the client, or change the WLAN profile.");
  });
}

function analyzeChannelReuse(infrastructure: WirelessInfrastructureNode[]): WirelessChannelReuseCheck[] {
  const radios = infrastructure.filter(isRadioNode);
  const checks: WirelessChannelReuseCheck[] = [];
  for (let i = 0; i < radios.length; i += 1) {
    for (let j = i + 1; j < radios.length; j += 1) {
      const left = radios[i];
      const right = radios[j];
      const distance = distanceBetweenNodes(left, right);
      const overlap = Math.max(0, left.rangeMeters + right.rangeMeters - distance);
      if (left.ssid !== right.ssid && overlap === 0) continue;
      const status = reuseStatus(left, right, overlap);
      checks.push({
        leftAp: left.deviceLabel,
        rightAp: right.deviceLabel,
        ssid: left.ssid === right.ssid ? left.ssid : `${left.ssid} / ${right.ssid}`,
        channel: left.channel === right.channel ? String(left.channel) : `${left.channel}/${right.channel}`,
        band: left.band === right.band ? left.band : `${left.band}/${right.band}`,
        distanceMeters: distance,
        overlapMeters: overlap,
        status,
        recommendation: channelRecommendation(status, left, right)
      });
    }
  }
  return checks.sort((left, right) => reuseRank(right.status) - reuseRank(left.status) || right.overlapMeters - left.overlapMeters);
}

function analyzeRoaming(infrastructure: WirelessInfrastructureNode[]): WirelessRoamingCandidate[] {
  const radios = infrastructure.filter(isRadioNode);
  const candidates: WirelessRoamingCandidate[] = [];
  for (let i = 0; i < radios.length; i += 1) {
    for (let j = i + 1; j < radios.length; j += 1) {
      const left = radios[i];
      const right = radios[j];
      if (left.ssid !== right.ssid) continue;
      const distance = distanceBetweenNodes(left, right);
      const overlap = Math.max(0, left.rangeMeters + right.rangeMeters - distance);
      const sameProfile = left.auth === right.auth && (left.auth === "open" || left.keySet === right.keySet);
      const status: WirelessRoamingCandidate["status"] = !sameProfile
        ? "profile-mismatch"
        : overlap <= 0
          ? "coverage-gap"
          : left.channel === right.channel
            ? "co-channel-risk"
            : "ready";
      candidates.push({
        leftAp: left.deviceLabel,
        rightAp: right.deviceLabel,
        ssid: left.ssid,
        auth: left.auth === right.auth ? left.auth : `${left.auth}/${right.auth}`,
        distanceMeters: distance,
        overlapMeters: overlap,
        status,
        recommendation: roamingRecommendation(status)
      });
    }
  }
  return candidates.sort((left, right) => roamingRank(left.status) - roamingRank(right.status) || left.ssid.localeCompare(right.ssid));
}

function analyzeBackhaul(project: NetworkProject, infrastructure: WirelessInfrastructureNode[]): WirelessBackhaulCheck[] {
  return infrastructure.map((node) => {
    const device = project.devices.find((item) => item.id === node.deviceId);
    const uplinks = device ? wiredUplinkLinks(project, device) : [];
    const upLinks = uplinks.filter((link) => link.status === "up").length;
    const management = managementAddress(device);
    const network = management && isSubnetMask(management.subnetMask) ? `${networkAddress(management.ipAddress, management.subnetMask)}/${maskToPrefix(management.subnetMask)}` : "-";
    if (!node.powerOn) {
      return {
        deviceLabel: node.deviceLabel,
        role: node.role,
        status: "critical",
        uplinks: upLinks,
        managementIp: management?.ipAddress ?? "-",
        managementNetwork: network,
        detail: "Wireless infrastructure device is powered off.",
        recommendation: "Power on the device before validating WLAN service."
      };
    }
    if (node.role !== "controller" && upLinks === 0) {
      return {
        deviceLabel: node.deviceLabel,
        role: node.role,
        status: "critical",
        uplinks: upLinks,
        managementIp: management?.ipAddress ?? "-",
        managementNetwork: network,
        detail: "AP or bridge has no active wired backhaul link.",
        recommendation: "Connect the wired uplink to an access or trunk port and keep the link up."
      };
    }
    if (!management) {
      return {
        deviceLabel: node.deviceLabel,
        role: node.role,
        status: "warning",
        uplinks: upLinks,
        managementIp: "-",
        managementNetwork: "-",
        detail: "No management IPv4 address is configured.",
        recommendation: "Assign a management IP, default gateway, and DNS server."
      };
    }
    if (uplinks.length > upLinks) {
      return {
        deviceLabel: node.deviceLabel,
        role: node.role,
        status: "warning",
        uplinks: upLinks,
        managementIp: management.ipAddress,
        managementNetwork: network,
        detail: `${uplinks.length - upLinks} wired uplink(s) are not up.`,
        recommendation: "Repair down or blocked backhaul links."
      };
    }
    return {
      deviceLabel: node.deviceLabel,
      role: node.role,
      status: "ok",
      uplinks: upLinks,
      managementIp: management.ipAddress,
      managementNetwork: network,
      detail: "Management address and wired backhaul are present.",
      recommendation: "No backhaul action required."
    };
  });
}

function analyzeWirelessDhcp(project: NetworkProject, clients: WirelessClientNode[]): WirelessDhcpCoverage[] {
  const plan = analyzeAddressPlan(project);
  return clients.map((client) => {
    if (!client.ipAddress) {
      return {
        clientLabel: client.deviceLabel,
        portName: client.portName,
        network: "-",
        pool: "-",
        server: "-",
        status: "no-ip",
        reason: "Wireless client port has no IPv4 address."
      };
    }
    if (!isIpv4(client.ipAddress) || !isSubnetMask(client.subnetMask)) {
      return {
        clientLabel: client.deviceLabel,
        portName: client.portName,
        network: "-",
        pool: "-",
        server: "-",
        status: "invalid",
        reason: "Wireless client IPv4 address or subnet mask is invalid."
      };
    }
    const network = networkAddress(client.ipAddress, client.subnetMask);
    const prefix = maskToPrefix(client.subnetMask);
    const subnet = plan.subnets.find((item) => item.network === network && item.mask === client.subnetMask);
    const pool = subnet?.dhcpPools.find((item) => item.enabled && ipInSubnet(client.ipAddress, item.network, item.mask));
    if (pool) {
      return {
        clientLabel: client.deviceLabel,
        portName: client.portName,
        network: `${network}/${prefix}`,
        pool: pool.name,
        server: pool.deviceLabel,
        status: "covered",
        reason: "Client subnet has an enabled DHCP pool."
      };
    }
    if (client.gateway && client.dnsServer) {
      return {
        clientLabel: client.deviceLabel,
        portName: client.portName,
        network: `${network}/${prefix}`,
        pool: "-",
        server: "-",
        status: "static",
        reason: "Client appears statically addressed with gateway and DNS."
      };
    }
    return {
      clientLabel: client.deviceLabel,
      portName: client.portName,
      network: `${network}/${prefix}`,
      pool: "-",
      server: "-",
      status: "missing",
      reason: "No enabled DHCP pool covers this wireless client subnet."
    };
  });
}

function analyzeWirelessSecurity(infrastructure: WirelessInfrastructureNode[], clients: WirelessClientNode[], ssids: WirelessSsidProfile[]): WirelessSecurityFinding[] {
  const findings: WirelessSecurityFinding[] = [];
  for (const node of infrastructure) {
    if (node.ssid === "(blank)") {
      findings.push(finding("critical", "infrastructure", node.deviceLabel, "SSID is blank.", "Set a named SSID before deploying clients."));
    }
    if (node.ssid.toLowerCase() === "lab-wireless") {
      findings.push(finding("warning", "infrastructure", node.deviceLabel, "SSID still uses the default lab name.", "Rename the SSID to match the design plan."));
    }
    if (node.auth === "open") {
      findings.push(finding("warning", "infrastructure", node.deviceLabel, `SSID ${node.ssid} uses open authentication.`, "Use WPA2-PSK for non-guest WLANs."));
    }
    if (node.auth === "wpa2-psk" && !node.keySet) {
      findings.push(finding("critical", "infrastructure", node.deviceLabel, "WPA2-PSK is selected but no key is configured.", "Configure the shared key on the AP/controller profile."));
    }
    if (node.auth === "wpa2-psk" && node.keySet && node.rangeMeters > 300) {
      findings.push(finding("info", "infrastructure", node.deviceLabel, "Large coverage range with PSK authentication.", "Validate that the key scope and RF range are intentional."));
    }
  }
  for (const client of clients) {
    if (client.ssid === "(blank)") {
      findings.push(finding("critical", "client", client.deviceLabel, `${client.portName} has no SSID configured.`, "Configure the wireless client profile."));
    }
    if (client.auth === "wpa2-psk" && !client.keySet) {
      findings.push(finding("critical", "client", client.deviceLabel, `${client.portName} expects WPA2-PSK but has no key.`, "Set the client WPA2 key."));
    }
  }
  for (const ssid of ssids) {
    if (ssid.authModes.length > 1) {
      findings.push(finding("critical", "ssid", ssid.ssid, `SSID has mixed authentication modes: ${ssid.authModes.join(", ")}.`, "Use one security profile per SSID."));
    }
    if (ssid.keyStates.length > 1 && ssid.authModes.includes("wpa2-psk")) {
      findings.push(finding("warning", "ssid", ssid.ssid, "Some WPA2 participants have a key and others do not.", "Align the WPA2 key state for all clients and APs."));
    }
    if (ssid.accessPointLabels.length === 0 && ssid.clients > 0) {
      findings.push(finding("critical", "ssid", ssid.ssid, "Clients reference an SSID with no AP or bridge.", "Add an AP profile or change the client SSID."));
    }
  }
  return findings.sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.subject.localeCompare(right.subject));
}

function buildCoverageGrid(project: NetworkProject, infrastructure: WirelessInfrastructureNode[]): WirelessCoverageCell[] {
  const radios = infrastructure.filter(isRadioNode);
  if (!radios.length) return [];
  const points = [...project.devices.map((device) => device.position), ...radios.map((radio) => ({ x: radio.x, y: radio.y }))];
  const minX = Math.min(...points.map((point) => point.x)) - 120;
  const maxX = Math.max(...points.map((point) => point.x)) + 120;
  const minY = Math.min(...points.map((point) => point.y)) - 120;
  const maxY = Math.max(...points.map((point) => point.y)) + 120;
  const cells: WirelessCoverageCell[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = Math.round(minX + ((maxX - minX) * (column + 0.5)) / 3);
      const y = Math.round(minY + ((maxY - minY) * (row + 0.5)) / 3);
      const ranked = radios
        .map((radio) => ({ radio, distance: distanceBetweenPointAndNode(x, y, radio) }))
        .sort((left, right) => left.distance - right.distance);
      const best = ranked[0];
      const covering = ranked.filter((item) => item.distance <= item.radio.rangeMeters);
      const channels = uniqueNumbers(covering.map((item) => item.radio.channel));
      cells.push({
        id: `R${row + 1}C${column + 1}`,
        x,
        y,
        bestAp: best ? best.radio.deviceLabel : "-",
        ssids: uniqueStrings(covering.map((item) => item.radio.ssid)),
        signal: best ? signalLevel(best.distance, best.radio.rangeMeters) : "none",
        overlappingAps: covering.length,
        channelCount: channels.length,
        recommendation: coverageCellRecommendation(best?.distance ?? 0, best?.radio, covering.length, channels.length)
      });
    }
  }
  return cells;
}

function buildActionItems(
  coverage: WirelessCoverageCheck[],
  channelReuse: WirelessChannelReuseCheck[],
  backhaul: WirelessBackhaulCheck[],
  dhcp: WirelessDhcpCoverage[],
  security: WirelessSecurityFinding[],
  ssids: WirelessSsidProfile[]
): WirelessActionItem[] {
  const items: WirelessActionItem[] = [];
  for (const findingItem of security.filter((item) => item.severity === "critical")) {
    items.push(action("P1", "security", findingItem.subject, findingItem.recommendation, findingItem.detail));
  }
  for (const check of backhaul.filter((item) => item.status === "critical")) {
    items.push(action("P1", "backhaul", check.deviceLabel, check.recommendation, check.detail));
  }
  for (const check of coverage.filter((item) => item.status === "uncovered" || item.status === "mismatch")) {
    items.push(action("P1", "coverage", check.clientLabel, check.recommendation, check.reason));
  }
  for (const check of dhcp.filter((item) => item.status === "missing" || item.status === "invalid" || item.status === "no-ip")) {
    items.push(action("P2", "dhcp", check.clientLabel, "Provide DHCP coverage or complete the static client addressing.", check.reason));
  }
  for (const check of channelReuse.filter((item) => item.status === "co-channel-risk")) {
    items.push(action("P2", "channel", `${check.leftAp} / ${check.rightAp}`, check.recommendation, `${check.channel} overlap ${check.overlapMeters}m`));
  }
  for (const findingItem of security.filter((item) => item.severity === "warning")) {
    items.push(action("P2", "security", findingItem.subject, findingItem.recommendation, findingItem.detail));
  }
  for (const check of coverage.filter((item) => item.status === "weak")) {
    items.push(action("P3", "coverage", check.clientLabel, check.recommendation, check.reason));
  }
  for (const ssid of ssids.filter((item) => item.risks.length > 0)) {
    items.push(action("P3", "ssid", ssid.ssid, "Review the SSID profile and remove design drift.", ssid.risks.join("; ")));
  }
  return dedupeActions(items).sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.category.localeCompare(right.category));
}

function buildWarnings(
  coverage: WirelessCoverageCheck[],
  channelReuse: WirelessChannelReuseCheck[],
  backhaul: WirelessBackhaulCheck[],
  dhcp: WirelessDhcpCoverage[],
  security: WirelessSecurityFinding[],
  ssids: WirelessSsidProfile[]
): string[] {
  return uniqueStrings([
    ...coverage.filter((item) => item.status === "uncovered").map((item) => `${item.clientLabel} is outside matching WLAN coverage.`),
    ...coverage.filter((item) => item.status === "mismatch").map((item) => `${item.clientLabel} has a wireless profile mismatch.`),
    ...channelReuse.filter((item) => item.status === "co-channel-risk").map((item) => `${item.leftAp} and ${item.rightAp} have co-channel overlap on ${item.channel}.`),
    ...backhaul.filter((item) => item.status === "critical").map((item) => `${item.deviceLabel} has a critical wireless backhaul issue.`),
    ...dhcp.filter((item) => item.status === "missing" || item.status === "invalid" || item.status === "no-ip").map((item) => `${item.clientLabel} lacks complete wireless client addressing/DHCP coverage.`),
    ...security.filter((item) => item.severity === "critical").map((item) => `${item.subject}: ${item.detail}`),
    ...ssids.flatMap((ssid) => ssid.risks.map((risk) => `${ssid.ssid}: ${risk}`))
  ]);
}

function coverageCheck(
  client: WirelessClientNode,
  status: WirelessCoverageStatus,
  signal: WirelessSignalLevel,
  associated: WirelessInfrastructureNode | undefined,
  best: { node: WirelessInfrastructureNode; distance: number } | undefined,
  candidateCount: number,
  reason: string,
  recommendation: string
): WirelessCoverageCheck {
  return {
    clientLabel: client.deviceLabel,
    portName: client.portName,
    ssid: client.ssid,
    status,
    signal,
    associatedAp: associated?.deviceLabel ?? client.linkedAp ?? "-",
    bestCandidate: best?.node.deviceLabel ?? "-",
    distanceMeters: best ? best.distance : 0,
    candidateCount,
    reason,
    recommendation
  };
}

function rankCandidateRadios(client: WirelessClientNode, radios: WirelessInfrastructureNode[]): Array<{ node: WirelessInfrastructureNode; distance: number }> {
  return radios
    .filter((node) => node.powerOn)
    .map((node) => ({ node, distance: distanceBetweenClientAndNode(client, node) }))
    .sort((left, right) => {
      const leftMatch = profileMatches(client, left.node) ? 0 : 1;
      const rightMatch = profileMatches(client, right.node) ? 0 : 1;
      return leftMatch - rightMatch || left.distance - right.distance || left.node.deviceLabel.localeCompare(right.node.deviceLabel);
    });
}

function profileMatches(client: WirelessClientNode, node: WirelessInfrastructureNode): boolean {
  if (client.ssid !== node.ssid) return false;
  if (client.auth !== node.auth) return false;
  if (client.auth === "wpa2-psk" && client.keySet !== node.keySet) return false;
  return true;
}

function reuseStatus(left: WirelessInfrastructureNode, right: WirelessInfrastructureNode, overlap: number): WirelessReuseStatus {
  if (left.ssid !== right.ssid || left.auth !== right.auth) return overlap > 0 ? "profile-gap" : "clear";
  if (overlap <= 0) return "clear";
  if (left.channel === right.channel) return "co-channel-risk";
  if (left.band === "2.4GHz" && right.band === "2.4GHz" && Math.abs(left.channel - right.channel) < 5) return "adjacent-risk";
  return "clear";
}

function channelRecommendation(status: WirelessReuseStatus, left: WirelessInfrastructureNode, right: WirelessInfrastructureNode): string {
  if (status === "co-channel-risk") return "Move one AP to a non-overlapping channel or reduce cell overlap.";
  if (status === "adjacent-risk") return "Use 2.4GHz channels 1, 6, and 11 for nearby cells.";
  if (status === "profile-gap") return `Confirm whether ${left.ssid} and ${right.ssid} should overlap in the same area.`;
  return "No channel change required.";
}

function roamingRecommendation(status: WirelessRoamingCandidate["status"]): string {
  if (status === "ready") return "Roaming profile is consistent; validate with a mobile client path.";
  if (status === "coverage-gap") return "Move APs closer, increase range, or add an intermediate AP.";
  if (status === "co-channel-risk") return "Keep the same SSID but separate the APs onto different channels.";
  return "Align SSID authentication and WPA2 key state before testing roaming.";
}

function coverageCellRecommendation(distance: number, best: WirelessInfrastructureNode | undefined, overlaps: number, channelCount: number): string {
  if (!best) return "No AP is available for this area.";
  if (distance > best.rangeMeters * 1.25) return "Add AP coverage for this area.";
  if (distance > best.rangeMeters) return "Coverage is weak; adjust AP placement or range.";
  if (overlaps > 2 && channelCount <= 1) return "Multiple APs overlap on one channel; review channel reuse.";
  if (overlaps === 0) return "No AP covers this sampled cell.";
  return "Coverage is acceptable in this sampled cell.";
}

function wiredUplinkLinks(project: NetworkProject, device: NetworkDevice): NetworkLink[] {
  const portIds = new Set(device.ports.filter((port) => port.kind !== "wireless" && port.kind !== "console").map((port) => port.id));
  return project.links.filter((link) =>
    (link.endpointA.deviceId === device.id && portIds.has(link.endpointA.portId)) ||
    (link.endpointB.deviceId === device.id && portIds.has(link.endpointB.portId))
  );
}

function wirelessLinkForPort(project: NetworkProject, deviceId: string, portId: string): NetworkLink | undefined {
  return project.links.find((link) =>
    link.type === "wireless" &&
    ((link.endpointA.deviceId === deviceId && link.endpointA.portId === portId) ||
      (link.endpointB.deviceId === deviceId && link.endpointB.portId === portId))
  );
}

function peerInfrastructure(
  project: NetworkProject,
  link: NetworkLink,
  deviceId: string,
  infrastructure: WirelessInfrastructureNode[]
): WirelessInfrastructureNode | undefined {
  const peerId = link.endpointA.deviceId === deviceId ? link.endpointB.deviceId : link.endpointA.deviceId;
  const peerDevice = project.devices.find((device) => device.id === peerId);
  if (!peerDevice) return undefined;
  return infrastructure.find((node) => node.deviceId === peerDevice.id);
}

function managementAddress(device: NetworkDevice | undefined): { ipAddress: string; subnetMask: string } | undefined {
  return device?.ports.find((port) => isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask));
}

function inferInfrastructureRole(device: NetworkDevice): WirelessInfrastructureRole {
  const text = `${device.modelId} ${device.model} ${device.label}`.toLowerCase();
  const hasWirelessPort = device.ports.some((port) => port.kind === "wireless");
  const hasWiredPort = device.ports.some((port) => port.kind !== "wireless" && port.kind !== "console");
  if (text.includes("wlc") || text.includes("controller") || text.includes("9800") || text.includes("2504") || text.includes("3504")) return "controller";
  if (text.includes("ap-") || text.includes("access point") || text.includes("aironet") || text.includes("catalyst 91")) return "access-point";
  if (hasWirelessPort && hasWiredPort) return "bridge";
  return "infrastructure";
}

function isRadioNode(node: WirelessInfrastructureNode): boolean {
  return node.role === "access-point" || node.role === "bridge" || node.wirelessPorts.length > 0;
}

function normalizedSsid(value: string): string {
  return value.trim() || "(blank)";
}

function normalizeChannel(value: number): number {
  if (!Number.isFinite(value)) return 6;
  const channel = Math.round(value);
  if (channel < 1) return 1;
  if (channel > 196) return 196;
  return channel;
}

function normalizeRange(value: number): number {
  if (!Number.isFinite(value)) return 120;
  const range = Math.round(value);
  if (range < 20) return 20;
  if (range > 1200) return 1200;
  return range;
}

function channelBand(channel: number): string {
  const normalized = normalizeChannel(channel);
  if (normalized >= 1 && normalized <= 14) return "2.4GHz";
  if (normalized >= 32 && normalized <= 196) return "5GHz";
  return "unknown";
}

function signalLevel(distance: number, range: number): WirelessSignalLevel {
  if (!Number.isFinite(distance) || !Number.isFinite(range) || range <= 0) return "none";
  const ratio = distance / range;
  if (ratio <= 0.35) return "excellent";
  if (ratio <= 0.65) return "good";
  if (ratio <= 1) return "fair";
  if (ratio <= 1.25) return "weak";
  return "none";
}

function distanceBetweenClientAndNode(client: WirelessClientNode, node: WirelessInfrastructureNode): number {
  return distanceBetweenPoints(client.x, client.y, node.x, node.y);
}

function distanceBetweenNodes(left: WirelessInfrastructureNode, right: WirelessInfrastructureNode): number {
  return distanceBetweenPoints(left.x, left.y, right.x, right.y);
}

function distanceBetweenPointAndNode(x: number, y: number, node: WirelessInfrastructureNode): number {
  return distanceBetweenPoints(x, y, node.x, node.y);
}

function distanceBetweenPoints(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.round(Math.hypot(leftX - rightX, leftY - rightY));
}

function roleRank(role: WirelessInfrastructureRole): number {
  return ({ controller: 0, "access-point": 1, bridge: 2, infrastructure: 3 })[role];
}

function reuseRank(status: WirelessReuseStatus): number {
  return ({ clear: 0, "profile-gap": 1, "adjacent-risk": 2, "co-channel-risk": 3 })[status];
}

function roamingRank(status: WirelessRoamingCandidate["status"]): number {
  return ({ "profile-mismatch": 0, "coverage-gap": 1, "co-channel-risk": 2, ready: 3 })[status];
}

function severityRank(severity: WirelessFindingSeverity): number {
  return ({ critical: 0, warning: 1, info: 2 })[severity];
}

function priorityRank(priority: WirelessActionItem["priority"]): number {
  return ({ P1: 0, P2: 1, P3: 2 })[priority];
}

function finding(severity: WirelessFindingSeverity, scope: string, subject: string, detail: string, recommendation: string): WirelessSecurityFinding {
  return { severity, scope, subject, detail, recommendation };
}

function action(priority: WirelessActionItem["priority"], category: string, target: string, actionText: string, evidence: string): WirelessActionItem {
  return { priority, category, target, action: actionText, evidence };
}

function dedupeActions(items: WirelessActionItem[]): WirelessActionItem[] {
  const seen = new Set<string>();
  const deduped: WirelessActionItem[] = [];
  for (const item of items) {
    const key = `${item.priority}|${item.category}|${item.target}|${item.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort((left, right) => left.localeCompare(right));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((left, right) => left - right);
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
