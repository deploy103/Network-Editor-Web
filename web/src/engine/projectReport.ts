import { getDeviceModel } from "../data/deviceCatalog";
import { analyzeAddressPlan } from "./addressPlan";
import { analyzeCapacityPlan } from "./capacityPlan";
import { analyzeConfigDrift } from "./configDrift";
import { desktopNetstatListeningRows, desktopTasklistRows } from "./desktopDiagnostics";
import { analyzeFailureImpact, summarizeFailureImpactBySeverity } from "./failureImpact";
import { analyzeProjectAudit } from "./projectAudit";
import { analyzeSecurityMatrix, summarizeSecurityPoliciesByType } from "./securityMatrix";
import { analyzeServiceReachability, summarizeServiceReachabilityByService } from "./serviceReachability";
import { buildVerificationPlan } from "./verificationPlan";
import { diagnoseProject, type NetworkIssue } from "./diagnostics";
import { isIpv4, maskToPrefix, networkAddress } from "./ip";
import { buildLabWorkbook } from "./labWorkbook";
import { buildPduHeaders } from "./pduHeaders";
import { linkLabel } from "./topology";
import { analyzeRoutingMatrix, summarizeRoutingCoverageByDevice } from "./routingMatrix";
import { staticRouteState } from "./routeState";
import { analyzeWirelessSurvey } from "./wirelessSurvey";
import type { AccessRule, NatRule, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, SimulationEvent } from "../types/network";

export interface ProjectReportOptions {
  generatedAt?: Date;
  includeEmptySections?: boolean;
}

interface ReportSection {
  title: string;
  lines: string[];
}

interface LinkPeer {
  device: NetworkDevice;
  port: NetworkPort;
}

type CountMap = Record<string, number>;

export function buildProjectReportText(project: NetworkProject, options: ProjectReportOptions = {}): string {
  return buildProjectReportLines(project, options).join("\n");
}

export function buildProjectReportLines(project: NetworkProject, options: ProjectReportOptions = {}): string[] {
  const generatedAt = options.generatedAt ?? new Date();
  const diagnostics = diagnoseProject(project);
  const sections = [
    summarySection(project, diagnostics, generatedAt),
    deviceInventorySection(project),
    interfaceAddressingSection(project),
    topologySection(project),
    capacityPlanSection(project),
    switchingSection(project),
    routingSection(project),
    routingMatrixSection(project),
    securitySection(project),
    securityMatrixSection(project),
    serviceSection(project),
    serviceReachabilitySection(project),
    wirelessSection(project),
    wirelessSurveySection(project),
    simulationSection(project),
    runtimeSection(project),
    activitySection(project),
    addressPlanSection(project),
    designAuditSection(project),
    configDriftSection(project),
    failureImpactSection(project),
    verificationPlanSection(project),
    workbookSection(project),
    diagnosticsSection(diagnostics)
  ];
  return sections.flatMap((section, index) => renderSection(section, index === 0, options.includeEmptySections ?? false));
}

function summarySection(project: NetworkProject, diagnostics: NetworkIssue[], generatedAt: Date): ReportSection {
  const linkStats = countBy(project.links, (link) => link.status);
  const deviceStats = countBy(project.devices, (device) => device.kind);
  const eventStats = countBy(project.simulationEvents, (event) => event.status);
  const issueStats = countBy(diagnostics, (issue) => issue.severity);
  const configuredPorts = project.devices.reduce((total, device) => total + device.ports.filter((port) => isIpv4(port.ipAddress)).length, 0);
  const poweredOff = project.devices.filter((device) => !device.powerOn).length;
  const serviceDevices = project.devices.filter((device) => enabledServices(device).length > 0).length;
  const securityRules = project.devices.reduce((total, device) => total + device.config.accessRules.length + device.config.natRules.length, 0);

  return {
    title: "Project Summary",
    lines: [
      `Project: ${project.name}`,
      `Project ID: ${project.id}`,
      `Owner ID: ${project.ownerId}`,
      `Generated: ${generatedAt.toISOString()}`,
      `Updated: ${project.updatedAt}`,
      "",
      ...table(
        ["Metric", "Value"],
        [
          ["Devices", String(project.devices.length)],
          ["Links", `${project.links.length} (up ${linkStats.up ?? 0}, down ${linkStats.down ?? 0}, blocked ${linkStats.blocked ?? 0})`],
          ["Powered off devices", String(poweredOff)],
          ["Configured IPv4 ports", String(configuredPorts)],
          ["Service devices", String(serviceDevices)],
          ["Security rules", String(securityRules)],
          ["Simulation events", `${project.simulationEvents.length} (delivered ${eventStats.delivered ?? 0}, forwarded ${eventStats.forwarded ?? 0}, dropped ${eventStats.dropped ?? 0})`],
          ["Diagnostics", `${diagnostics.length} (errors ${issueStats.error ?? 0}, warnings ${issueStats.warning ?? 0}, info ${issueStats.info ?? 0})`],
          ["Annotations", String((project.notes ?? []).length + (project.drawings ?? []).length)]
        ]
      ),
      "",
      ...table(
        ["Device kind", "Count"],
        Object.entries(deviceStats).sort(([left], [right]) => left.localeCompare(right))
      )
    ]
  };
}

function deviceInventorySection(project: NetworkProject): ReportSection {
  const rows = project.devices.map((device) => {
    const model = getDeviceModel(device.modelId);
    const connectedPorts = device.ports.filter((port) => port.linkId && project.links.some((link) => link.id === port.linkId)).length;
    const activePorts = device.ports.filter((port) => port.linkId && project.links.some((link) => link.id === port.linkId && linkOperational(project, link))).length;
    const configuredPorts = device.ports.filter((port) => isIpv4(port.ipAddress)).length;
    const moduleSummary = device.modules.map((module) => `${module.slotId}:${module.moduleId}`).join(", ") || "-";
    const software = [model?.softwareTrain, model?.softwareVersion, model?.iosImage].filter(Boolean).join(" / ") || "-";
    return [
      device.label,
      device.config.hostname || "-",
      device.kind,
      device.model,
      device.powerOn ? "on" : "off",
      `${connectedPorts}/${device.ports.length} (${activePorts} active)`,
      String(configuredPorts),
      moduleSummary,
      software
    ];
  });

  return {
    title: "Device Inventory",
    lines: table(["Device", "Hostname", "Kind", "Model", "Power", "Links", "IPv4", "Modules", "Software"], rows)
  };
}

function interfaceAddressingSection(project: NetworkProject): ReportSection {
  const rows = project.devices.flatMap((device) => device.ports.flatMap((port) => {
    const primary = isIpv4(port.ipAddress)
      ? [[
          device.label,
          port.name,
          port.kind,
          port.mode,
          port.ipAddress,
          port.subnetMask ? `/${maskToPrefix(port.subnetMask)}` : "-",
          port.subnetMask && isIpv4(port.ipAddress) ? networkAddress(port.ipAddress, port.subnetMask) : "-",
          port.gateway || "-",
          port.dnsServer || "-",
          peerLabel(project, device, port)
        ]]
      : [];
    const secondary = (port.secondaryIpAddresses ?? []).map((address) => [
      device.label,
      `${port.name} secondary`,
      port.kind,
      port.mode,
      address.ipAddress,
      address.subnetMask ? `/${maskToPrefix(address.subnetMask)}` : "-",
      address.subnetMask && isIpv4(address.ipAddress) ? networkAddress(address.ipAddress, address.subnetMask) : "-",
      port.gateway || "-",
      port.dnsServer || "-",
      peerLabel(project, device, port)
    ]);
    return [...primary, ...secondary];
  }));

  return {
    title: "Interface Addressing",
    lines: table(["Device", "Interface", "Kind", "Mode", "IPv4", "Prefix", "Network", "Gateway", "DNS", "Peer"], rows)
  };
}

function topologySection(project: NetworkProject): ReportSection {
  const rows = project.links.map((link) => {
    const a = linkEndpoint(project, link, "A");
    const b = linkEndpoint(project, link, "B");
    return [
      link.type,
      reportLinkState(project, link),
      link.dceEndpoint ?? "-",
      a ? `${a.device.label} ${a.port.name}` : link.endpointA.deviceId,
      b ? `${b.device.label} ${b.port.name}` : link.endpointB.deviceId,
      linkLabel(project, link)
    ];
  });

  return {
    title: "Topology Links",
    lines: table(["Type", "Status", "DCE", "Endpoint A", "Endpoint B", "Label"], rows)
  };
}

function switchingSection(project: NetworkProject): ReportSection {
  const vlanRows = project.devices.flatMap((device) => device.config.vlans
    .filter((vlan) => vlan.id !== 1 || vlan.name.toLowerCase() !== "default")
    .map((vlan) => [device.label, String(vlan.id), vlan.name]));

  const portRows = project.devices.flatMap((device) => device.ports
    .filter((port) => port.mode === "access" || port.mode === "trunk" || port.channelGroup || port.stpPortfast || port.bpduGuard || port.voiceVlan || port.dhcpSnoopingTrusted)
    .map((port) => [
      device.label,
      port.name,
      port.mode,
      String(port.vlan),
      port.allowedVlans.length ? compactNumberList(port.allowedVlans) : "-",
      port.nativeVlan ? String(port.nativeVlan) : "-",
      port.voiceVlan ? String(port.voiceVlan) : "-",
      port.channelGroup ? `Po${port.channelGroup.id} ${port.channelGroup.mode}` : "-",
      [
        port.stpPortfast ? "portfast" : "",
        port.bpduGuard ? "bpduguard" : "",
        port.dhcpSnoopingTrusted ? "dhcp-trust" : "",
        port.switchportNonegotiate ? "nonegotiate" : ""
      ].filter(Boolean).join(", ") || "-"
    ]));

  const globalRows = project.devices
    .filter((device) => device.kind === "switch" || device.kind === "wireless")
    .map((device) => [
      device.label,
      device.config.stpMode ?? "pvst",
      device.config.stpRootPrimaryVlans.length ? compactNumberList(device.config.stpRootPrimaryVlans) : "-",
      device.config.stpRootSecondaryVlans.length ? compactNumberList(device.config.stpRootSecondaryVlans) : "-",
      device.config.vtp ? `${device.config.vtp.mode} ${device.config.vtp.domain || "-"}` : "-",
      device.config.dhcpSnooping?.enabled ? compactNumberList(device.config.dhcpSnooping.vlans) || "enabled" : "off"
    ]);

  return {
    title: "Switching",
    lines: [
      "VLANs",
      ...table(["Device", "VLAN", "Name"], vlanRows),
      "",
      "Switchport and STP",
      ...table(["Device", "Port", "Mode", "Access VLAN", "Allowed", "Native", "Voice", "Channel", "Features"], portRows),
      "",
      "Switching Globals",
      ...table(["Device", "STP Mode", "Root Primary", "Root Secondary", "VTP", "DHCP Snooping"], globalRows)
    ]
  };
}

function capacityPlanSection(project: NetworkProject): ReportSection {
  const capacity = analyzeCapacityPlan(project);
  const deviceRows = capacity.devices.map((device) => [
    device.label,
    device.kind,
    `${device.portsConnected}/${device.portsTotal} (${device.portUtilization}%)`,
    String(device.portsActive),
    `${device.modulesInstalled}/${device.moduleSlots}`,
    String(device.routeCount),
    String(device.policyCount),
    device.warnings.join("; ") || "-"
  ]);
  const dhcpRows = capacity.dhcpPools.map((pool) => [
    pool.deviceLabel,
    pool.poolName,
    `${pool.network}/${pool.prefix}`,
    `${pool.activeLeases}/${pool.maxLeases} (${pool.utilization}%)`,
    pool.warning || "-"
  ]);
  return {
    title: "Capacity Plan",
    lines: [
      `Ports ${capacity.totals.portsConnected}/${capacity.totals.portsTotal} connected, ${capacity.totals.portsActive} active, modules ${capacity.totals.modulesInstalled}/${capacity.totals.moduleSlots}, warnings ${capacity.totals.warnings}`,
      "",
      "Device Capacity",
      ...table(["Device", "Kind", "Ports", "Active", "Modules", "Routes", "Policy", "Warnings"], deviceRows),
      "",
      "DHCP Capacity",
      ...table(["Device", "Pool", "Network", "Leases", "Warning"], dhcpRows)
    ]
  };
}

function routingSection(project: NetworkProject): ReportSection {
  const staticRoutes = project.devices.flatMap((device) => device.config.staticRoutes.map((route) => [
    device.label,
    route.network,
    route.mask,
    route.nextHop,
    route.distance === undefined ? "1" : String(route.distance),
    route.trackId === undefined ? "-" : String(route.trackId),
    staticRouteState(project, device, route)
  ]));

  const dynamicProtocols = project.devices.flatMap((device) => (device.config.routingProtocols ?? []).map((protocol) => [
    device.label,
    protocol.protocol.toUpperCase(),
    protocol.processId ?? "-",
    protocol.routerId ?? "-",
    protocol.networks.join("; ") || "-",
    protocol.passiveInterfaceDefault ? "default" : protocol.passiveInterfaces.join(", ") || "-",
    [
      protocol.autoSummary ? "auto-summary" : "",
      protocol.redistributeStatic ? "redistribute-static" : "",
      protocol.defaultInformationOriginate ? `default-information${protocol.defaultInformationAlways ? " always" : ""}` : ""
    ].filter(Boolean).join(", ") || "-"
  ]));

  const helperRows = project.devices.flatMap((device) => device.ports
    .filter((port) => (port.helperAddresses ?? []).length > 0)
    .map((port) => [device.label, port.name, port.helperAddresses?.join(", ") ?? "-"]));

  const ipSlaRows = project.devices.flatMap((device) => [
    ...(device.config.ipSlaOperations ?? []).map((operation) => [
      device.label,
      `sla ${operation.operationId}`,
      operation.type,
      operation.targetIp,
      operation.sourceInterface ?? "-",
      `${operation.frequency}s`,
      operation.enabled ? "enabled" : "disabled"
    ]),
    ...(device.config.trackObjects ?? []).map((track) => [
      device.label,
      `track ${track.trackId}`,
      track.type,
      track.ipSlaOperationId === undefined ? track.interfaceName ?? "-" : `ip sla ${track.ipSlaOperationId}`,
      "-",
      track.mode,
      "track"
    ])
  ]);

  return {
    title: "Routing",
    lines: [
      "Static Routes",
      ...table(["Device", "Network", "Mask", "Next hop", "Distance", "Track", "State"], staticRoutes),
      "",
      "Dynamic Routing",
      ...table(["Device", "Protocol", "Process", "Router ID", "Networks", "Passive", "Options"], dynamicProtocols),
      "",
      "DHCP Relay",
      ...table(["Device", "Interface", "Helper addresses"], helperRows),
      "",
      "IP SLA and Track",
      ...table(["Device", "Object", "Type", "Target", "Source", "Timer/Mode", "State"], ipSlaRows)
    ]
  };
}

function securitySection(project: NetworkProject): ReportSection {
  const aclRows = project.devices.flatMap((device) => device.config.accessRules.map((rule) => accessRuleRow(device, rule)));
  const natRows = project.devices.flatMap((device) => device.config.natRules.map((rule) => natRuleRow(device, rule)));
  const prefixRows = project.devices.flatMap((device) => (device.config.prefixLists ?? []).map((entry) => [
    device.label,
    entry.name,
    String(entry.sequence),
    entry.action,
    entry.prefix,
    entry.ge === undefined ? "-" : String(entry.ge),
    entry.le === undefined ? "-" : String(entry.le),
    String(entry.hits)
  ]));
  const routeMapRows = project.devices.flatMap((device) => (device.config.routeMaps ?? []).map((entry) => [
    device.label,
    entry.name,
    String(entry.sequence),
    entry.action,
    entry.matchAccessLists.join(", ") || "-",
    entry.matchPrefixLists?.join(", ") || "-",
    entry.setNextHop ?? "-",
    String(entry.hits)
  ]));
  const policySummaryRows = project.devices
    .map((device) => {
      const aclCount = device.config.accessRules.length;
      const natCount = device.config.natRules.length;
      const prefixCount = device.config.prefixLists?.length ?? 0;
      const routeMapCount = device.config.routeMaps?.length ?? 0;
      const pbrPorts = device.ports.filter((port) => port.policyRouteMap).length;
      return { device, aclCount, natCount, prefixCount, routeMapCount, pbrPorts };
    })
    .filter((row) => row.aclCount || row.natCount || row.prefixCount || row.routeMapCount || row.pbrPorts)
    .map((row) => [
      row.device.label,
      String(row.aclCount),
      String(row.natCount),
      String(row.prefixCount),
      String(row.routeMapCount),
      String(row.pbrPorts)
    ]);
  const portSecurityRows = project.devices.flatMap((device) => device.ports
    .filter((port) => port.portSecurity?.enabled)
    .map((port) => [
      device.label,
      port.name,
      String(port.portSecurity?.maximum ?? 1),
      port.portSecurity?.violation ?? "-",
      port.portSecurity?.sticky ? "sticky" : "static",
      port.portSecurity?.secureMacAddresses.join(", ") || "-"
    ]));

  return {
    title: "Security and Policy",
    lines: [
      "Policy Summary",
      ...table(["Device", "ACLs", "NAT", "Prefix Lists", "Route Maps", "PBR Ports"], policySummaryRows),
      "",
      "ACLs",
      ...table(["Device", "List", "Seq", "Action", "Protocol", "Source", "Destination", "Interface", "Hits"], aclRows),
      "",
      "NAT",
      ...table(["Device", "Type", "Inside local", "Inside global", "Outside interface", "ACL", "Hits"], natRows),
      "",
      "Prefix Lists",
      ...table(["Device", "Name", "Seq", "Action", "Prefix", "GE", "LE", "Hits"], prefixRows),
      "",
      "Route Maps and PBR",
      ...table(["Device", "Name", "Seq", "Action", "ACL Match", "Prefix Match", "Set next-hop", "Hits"], routeMapRows),
      "",
      "Port Security",
      ...table(["Device", "Port", "Maximum", "Violation", "Learning", "Secure MACs"], portSecurityRows)
    ]
  };
}

function routingMatrixSection(project: NetworkProject): ReportSection {
  const matrix = analyzeRoutingMatrix(project);
  const deviceSummaryRows = summarizeRoutingCoverageByDevice(matrix).map((summary) => [
    summary.deviceLabel,
    String(summary.total),
    String(summary.connected),
    String(summary.static),
    String(summary.dynamic),
    String(summary.defaults),
    String(summary.missing)
  ]);
  const subnetRows = matrix.subnets.map((subnet) => [
    subnet.key,
    subnet.gateways.join(", ") || "-",
    subnet.connectedDevices.join(", ") || "-",
    String(subnet.hostCount)
  ]);
  const pathRows = matrix.pathChecks.slice(0, 30).map((check) => [
    check.sourceSubnet,
    check.targetSubnet,
    check.status,
    check.coverage.join(", "),
    check.devices.join(", ") || "-",
    check.recommendation
  ]);
  return {
    title: "Routing Matrix",
    lines: [
      `Subnets ${matrix.totals.subnets}, L3 devices ${matrix.totals.l3Devices}, missing coverage ${matrix.totals.missing}, warnings ${matrix.totals.warnings}`,
      "",
      "Device Coverage Summary",
      ...table(["Device", "Total", "Connected", "Static", "Dynamic", "Default", "Missing"], deviceSummaryRows),
      "",
      "Routed Subnets",
      ...table(["Subnet", "Gateways", "Connected devices", "Hosts"], subnetRows),
      "",
      "Subnet Path Checks",
      ...table(["Source", "Target", "Status", "Coverage", "Devices", "Recommendation"], pathRows),
      "",
      "Warnings",
      ...(matrix.warnings.length ? matrix.warnings.map((warning) => `- ${warning}`) : ["- none"])
    ]
  };
}

function serviceSection(project: NetworkProject): ReportSection {
  const serviceSummaryRows = project.devices
    .filter(hasServiceSurface)
    .map((device) => {
      const serviceEntries = Object.entries(device.config.services);
      const enabledCount = serviceEntries.filter(([, enabled]) => enabled).length;
      const activePools = device.config.dhcpPools.filter((pool) => pool.enabled).length;
      return [
        device.label,
        `${enabledCount}/${serviceEntries.length}`,
        String(serviceEntries.length - enabledCount),
        `${activePools}/${device.config.dhcpPools.length}`,
        String(device.config.dhcpExcludedRanges?.length ?? 0),
        String(device.runtime.dhcpLeases.length),
        String(device.config.dnsRecords.length),
        String((device.config.nameServers ?? []).length),
        String(device.runtime.logs.length)
      ];
    });

  const serviceRows = project.devices
    .filter(hasServiceSurface)
    .map((device) => [
      device.label,
      enabledServices(device).join(", ") || "-",
      device.config.dhcpPools.filter((pool) => pool.enabled).map((pool) => `${pool.name}:${pool.network}/${maskToPrefix(pool.mask)}`).join("; ") || "-",
      device.config.dhcpExcludedRanges?.map((range) => `${range.startIp}${range.endIp ? `-${range.endIp}` : ""}`).join("; ") || "-",
      device.config.dnsRecords.map((record) => `${record.name}=${record.value}`).join("; ") || "-",
      (device.config.nameServers ?? []).join(", ") || "-"
    ]);

  const serviceLogRows = project.devices
    .filter(hasServiceSurface)
    .map((device) => [
      device.label,
      String(serviceLogCount(device, "DNS")),
      String(serviceLogCount(device, "HTTP")),
      String(serviceLogCount(device, "FTP")),
      String(serviceLogCount(device, "EMAIL")),
      String(serviceLogCount(device, "TFTP")),
      String(device.runtime.logs.length)
    ]);

  const listeningRows = project.devices
    .filter(hasServiceSurface)
    .flatMap((device) => {
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

  const leaseRows = project.devices.flatMap((device) => device.runtime.dhcpLeases.map((lease) => [
    device.label,
    lease.ipAddress,
    lease.macAddress,
    lease.deviceId || "-",
    new Date(lease.expiresAt).toISOString()
  ]));

  return {
    title: "Services",
    lines: [
      "Service Summary",
      ...table(["Device", "Enabled services", "Disabled", "DHCP pools", "Excluded", "DHCP leases", "DNS records", "Name servers", "Runtime logs"], serviceSummaryRows),
      "",
      "Service Configuration",
      ...table(["Device", "Services", "DHCP pools", "Excluded", "DNS records", "Name servers"], serviceRows),
      "",
      "Service Log Summary",
      ...table(["Device", "DNS", "HTTP", "FTP", "EMAIL", "TFTP", "SYSLOG"], serviceLogRows),
      "",
      "Listening Ports",
      ...table(["Device", "Service", "Protocol", "Local address", "State", "PID", "Process"], listeningRows),
      "",
      "Runtime DHCP Leases",
      ...table(["Device", "IP", "MAC", "Client device", "Expires"], leaseRows)
    ]
  };
}

function securityMatrixSection(project: NetworkProject): ReportSection {
  const matrix = analyzeSecurityMatrix(project);
  const policySummaryRows = summarizeSecurityPoliciesByType(matrix).map((summary) => [
    summary.policyType,
    String(summary.entries),
    String(summary.permits),
    String(summary.denies),
    String(summary.hits)
  ]);
  const policyRows = matrix.policies.slice(0, 40).map((policy) => [
    policy.deviceLabel,
    policy.policyType,
    policy.action,
    policy.protocol,
    policy.sourceZone,
    policy.destinationZone,
    policy.detail
  ]);
  const exposureRows = matrix.exposures.slice(0, 30).map((exposure) => [
    exposure.deviceLabel,
    exposure.service,
    exposure.ipAddress,
    exposure.zone,
    exposure.exposure,
    exposure.reason
  ]);
  return {
    title: "Security Matrix",
    lines: [
      `Zones ${matrix.totals.zones}, ACL ${matrix.totals.aclRules}, NAT ${matrix.totals.natRules}, prefix-list ${matrix.totals.prefixListEntries}, route-map ${matrix.totals.routeMapEntries}, PBR ${matrix.totals.pbrRules}, exposures ${matrix.totals.exposures}, warnings ${matrix.totals.warnings}`,
      "",
      "Policy Type Summary",
      ...table(["Type", "Entries", "Permit", "Deny", "Hits"], policySummaryRows),
      "",
      "Policy Matrix",
      ...table(["Device", "Type", "Action", "Protocol", "Source zone", "Destination zone", "Detail"], policyRows),
      "",
      "Service Exposure",
      ...table(["Device", "Service", "IP", "Zone", "Exposure", "Reason"], exposureRows),
      "",
      "Warnings",
      ...(matrix.warnings.length ? matrix.warnings.map((warning) => `- ${warning}`) : ["- none"])
    ]
  };
}

function wirelessSection(project: NetworkProject): ReportSection {
  const wirelessRows = project.devices
    .filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless"))
    .map((device) => [
      device.label,
      device.kind,
      device.config.wireless.ssid || "-",
      device.config.wireless.auth,
      device.config.wireless.auth === "wpa2-psk" ? maskedSecret(device.config.wireless.key) : "-",
      String(device.config.wireless.channel),
      `${device.config.wireless.range}m`,
      device.ports.filter((port) => port.kind === "wireless").map((port) => `${port.name}${isIpv4(port.ipAddress) ? ` ${port.ipAddress}` : ""}`).join(", ") || "-"
    ]);

  const wirelessLinks = project.links.filter((link) => link.type === "wireless").map((link) => {
    const a = linkEndpoint(project, link, "A");
    const b = linkEndpoint(project, link, "B");
    return [
      link.status,
      a ? `${a.device.label} ${a.port.name}` : link.endpointA.deviceId,
      b ? `${b.device.label} ${b.port.name}` : link.endpointB.deviceId,
      linkLabel(project, link)
    ];
  });

  return {
    title: "Wireless",
    lines: [
      "Wireless Devices",
      ...table(["Device", "Kind", "SSID", "Auth", "Key", "Channel", "Range", "Wireless ports"], wirelessRows),
      "",
      "Wireless Links",
      ...table(["Status", "Endpoint A", "Endpoint B", "Label"], wirelessLinks)
    ]
  };
}

function wirelessSurveySection(project: NetworkProject): ReportSection {
  const survey = analyzeWirelessSurvey(project);
  const ssidRows = survey.ssids.map((ssid) => [
    ssid.ssid,
    String(ssid.infrastructure),
    String(ssid.clients),
    ssid.authModes.join(", "),
    ssid.channels.join(", ") || "-",
    ssid.bands.join(", ") || "-",
    ssid.risks.join("; ") || "-"
  ]);
  const coverageRows = survey.coverage.map((check) => [
    check.clientLabel,
    check.portName,
    check.ssid,
    check.status,
    check.signal,
    check.associatedAp,
    check.bestCandidate,
    check.reason
  ]);
  const channelRows = survey.channelReuse
    .filter((check) => check.status !== "clear")
    .slice(0, 20)
    .map((check) => [
      check.leftAp,
      check.rightAp,
      check.channel,
      check.band,
      `${check.overlapMeters}m`,
      check.status,
      check.recommendation
    ]);
  const actionRows = survey.actions.slice(0, 20).map((item) => [
    item.priority,
    item.category,
    item.target,
    item.action,
    item.evidence
  ]);
  return {
    title: "Wireless Survey",
    lines: [
      `Infrastructure ${survey.totals.infrastructure}, AP/bridge ${survey.totals.accessPoints}, clients ${survey.totals.clients}, SSIDs ${survey.totals.ssids}`,
      `Associated ${survey.totals.associatedClients}, weak/uncovered ${survey.totals.uncoveredClients}, channel risks ${survey.totals.channelRisks}, security findings ${survey.totals.securityFindings}`,
      "",
      "SSID Profiles",
      ...table(["SSID", "Infra", "Clients", "Auth", "Channels", "Bands", "Risks"], ssidRows),
      "",
      "Client Coverage",
      ...table(["Client", "Port", "SSID", "Status", "Signal", "Associated AP", "Best AP", "Reason"], coverageRows),
      "",
      "Channel Risks",
      ...table(["Left AP", "Right AP", "Channel", "Band", "Overlap", "Status", "Recommendation"], channelRows),
      "",
      "Action Checklist",
      ...table(["Priority", "Category", "Target", "Action", "Evidence"], actionRows),
      "",
      "Warnings",
      ...(survey.warnings.length ? survey.warnings.map((warning) => `- ${warning}`) : ["- none"])
    ]
  };
}

function serviceReachabilitySection(project: NetworkProject): ReportSection {
  const reachability = analyzeServiceReachability(project);
  const serviceSummaryRows = summarizeServiceReachabilityByService(reachability).map((summary) => [
    summary.service.toUpperCase(),
    String(summary.total),
    String(summary.reachable),
    String(summary.localOnly),
    String(summary.blocked),
    String(summary.unconfigured),
    String(summary.unknown)
  ]);
  const checkRows = reachability.checks
    .filter((check) => check.status !== "unconfigured")
    .slice(0, 40)
    .map((check) => [
      check.client.label,
      check.service.toUpperCase(),
      check.status,
      check.server ? `${check.server.label} ${check.server.ipAddress}` : "-",
      check.pathScope,
      check.reason
    ]);
  return {
    title: "Service Reachability",
    lines: [
      `Clients ${reachability.totals.clients}, service endpoints ${reachability.totals.servers}`,
      `Reachable ${reachability.totals.reachable}, local-only ${reachability.totals.localOnly}, blocked ${reachability.totals.blocked}, unconfigured ${reachability.totals.unconfigured}`,
      "",
      "Service Status Summary",
      ...table(["Service", "Total", "Reachable", "Local-only", "Blocked", "Unconfigured", "Unknown"], serviceSummaryRows),
      "",
      "Service Checks",
      ...table(["Client", "Service", "Status", "Server", "Scope", "Reason"], checkRows)
    ]
  };
}

function simulationSection(project: NetworkProject): ReportSection {
  const latestEvents = [...project.simulationEvents]
    .sort((left, right) => right.time - left.time)
    .slice(0, 20)
    .map((event) => simulationEventRow(project, event));
  const latestHeaders = [...project.simulationEvents]
    .filter((event) => simulationEventHeaders(event).length > 0)
    .sort((left, right) => right.time - left.time)
    .slice(0, 12)
    .map((event) => simulationHeaderRow(project, event));
  const packetStats = Object.entries(countBy(project.simulationEvents, (event) => event.type.toUpperCase())).sort(([left], [right]) => left.localeCompare(right));

  return {
    title: "Simulation",
    lines: [
      "Event Type Counts",
      ...table(["Type", "Count"], packetStats),
      "",
      "Latest Events",
      ...table(["Time", "Type", "Status", "Source", "Target", "At", "Info"], latestEvents),
      "",
      "Latest PDU Headers",
      ...table(["Time", "Type", "Packet", "Headers"], latestHeaders)
    ]
  };
}

function runtimeSection(project: NetworkProject): ReportSection {
  const runtimeSummaryRows = project.devices
    .filter((device) => runtimeEntryCount(device) > 0 || Boolean(device.runtime.clock))
    .map((device) => [
      device.label,
      String(device.runtime.arpTable.length),
      String(device.runtime.macTable.length),
      String(device.runtime.dhcpLeases.length),
      String((device.runtime.natTranslations ?? []).length),
      String(device.runtime.logs.length),
      device.runtime.clock ?? "-"
    ]);
  const arpRows = project.devices.flatMap((device) => device.runtime.arpTable.map((entry) => [device.label, entry.ipAddress, entry.macAddress, entry.portName]));
  const macRows = project.devices.flatMap((device) => device.runtime.macTable.map((entry) => [device.label, String(entry.vlan), entry.macAddress, entry.portName, entry.type]));
  const natRows = project.devices.flatMap((device) => (device.runtime.natTranslations ?? []).map((entry) => [
    device.label,
    entry.protocol,
    entry.insideLocal,
    entry.insideGlobal,
    entry.outsideLocal,
    entry.outsideGlobal,
    entry.interfaceName,
    String(entry.hits)
  ]));
  const logRows = project.devices.flatMap((device) => device.runtime.logs.slice(-10).map((entry) => [
    device.label,
    new Date(entry.createdAt).toISOString(),
    entry.level,
    entry.message
  ]));

  return {
    title: "Runtime Tables",
    lines: [
      "Runtime Summary",
      ...table(["Device", "ARP", "MAC", "DHCP leases", "NAT translations", "Logs", "Clock"], runtimeSummaryRows),
      "",
      "ARP",
      ...table(["Device", "IP", "MAC", "Interface"], arpRows),
      "",
      "MAC",
      ...table(["Device", "VLAN", "MAC", "Port", "Type"], macRows),
      "",
      "NAT Translations",
      ...table(["Device", "Protocol", "Inside local", "Inside global", "Outside local", "Outside global", "Interface", "Hits"], natRows),
      "",
      "Recent Logs",
      ...table(["Device", "Time", "Level", "Message"], logRows)
    ]
  };
}

function activitySection(project: NetworkProject): ReportSection {
  const activity = project.activity;
  if (!activity) return { title: "Activity", lines: [] };
  const commandRuleRows = (activity.commandRules ?? []).map((rule) => [
    rule.label,
    rule.deviceId ? eventDeviceLabel(project, rule.deviceId) : "Any",
    rule.command,
    String(rule.points)
  ]);
  const commandSequenceRows = (activity.commandSequences ?? []).map((sequence) => [
    sequence.label,
    sequence.deviceId ? eventDeviceLabel(project, sequence.deviceId) : "Any",
    sequence.commands.join(" && "),
    String(sequence.points)
  ]);
  const commandOutputRows = (activity.commandOutputAssertions ?? []).map((assertion) => [
    assertion.label,
    assertion.deviceId ? eventDeviceLabel(project, assertion.deviceId) : "Any",
    assertion.commands.join(" && "),
    assertion.expectedText,
    String(assertion.points)
  ]);
  const interfaceExpectationRows = (activity.interfaceExpectations ?? []).map((expectation) => [
    expectation.label,
    eventDeviceLabel(project, expectation.deviceId),
    activityPortLabel(project, expectation.deviceId, expectation.portId),
    expectation.ipAddress || "-",
    expectation.subnetMask || "-",
    expectation.mode || "-",
    expectation.vlan ?? "-",
    String(expectation.points)
  ]);
  const headerAssertionRows = (activity.headerAssertions ?? []).map((assertion) => [
    assertion.label,
    assertion.protocol || "Any",
    assertion.field,
    assertion.value,
    String(assertion.points)
  ]);
  const answerSnapshotRows = activity.answerSnapshot ? [[
    activity.answerSnapshot.capturedAt,
    String(activity.answerSnapshot.devices.length),
    String(activity.answerSnapshot.links.length),
    String(activity.answerSnapshot.annotationCount),
    String(activity.answerSnapshot.serviceDeviceIds.length),
    String(activity.answerSnapshot.startupConfigDeviceIds.length)
  ]] : [];
  return {
    title: "Activity",
    lines: [
      `Title: ${activity.title || "-"}`,
      "",
      "Objectives",
      ...(activity.objectives.length ? activity.objectives.map((objective, index) => `${index + 1}. ${objective}`) : ["- none"]),
      "",
      "Requirements",
      ...table(["Kind", "Label", "Target", "Points"], activity.requirements.map((requirement) => [
        requirement.kind,
        requirement.label,
        String(requirement.target),
        String(requirement.points)
      ])),
      "",
      "Rule Counts",
      ...table(
        ["Rule type", "Count"],
        [
          ["Command rules", String(activity.commandRules?.length ?? 0)],
          ["Command sequences", String(activity.commandSequences?.length ?? 0)],
          ["Command output assertions", String(activity.commandOutputAssertions?.length ?? 0)],
          ["Interface expectations", String(activity.interfaceExpectations?.length ?? 0)],
          ["Header assertions", String(activity.headerAssertions?.length ?? 0)],
          ["Answer snapshot", activity.answerSnapshot ? "yes" : "no"]
        ]
      ),
      "",
      "Answer Snapshot",
      ...table(["Captured", "Devices", "Links", "Annotations", "Service devices", "Startup configs"], answerSnapshotRows),
      "",
      "Command Rules",
      ...table(["Label", "Device", "Command", "Points"], commandRuleRows),
      "",
      "Command Sequences",
      ...table(["Label", "Device", "Commands", "Points"], commandSequenceRows),
      "",
      "Command Output Assertions",
      ...table(["Label", "Device", "Commands", "Expected text", "Points"], commandOutputRows),
      "",
      "Interface Expectations",
      ...table(["Label", "Device", "Port", "IPv4", "Mask", "Mode", "VLAN", "Points"], interfaceExpectationRows),
      "",
      "Packet Header Assertions",
      ...table(["Label", "Protocol", "Field", "Value", "Points"], headerAssertionRows)
    ]
  };
}

function diagnosticsSection(diagnostics: NetworkIssue[]): ReportSection {
  const rows = diagnostics.map((issue) => [issue.severity.toUpperCase(), issue.title, issue.detail]);
  return {
    title: "Diagnostics",
    lines: table(["Severity", "Title", "Detail"], rows)
  };
}

function designAuditSection(project: NetworkProject): ReportSection {
  const audit = analyzeProjectAudit(project);
  const categoryRows = audit.categories.map((category) => [
    category.name,
    String(category.total),
    String(category.pass),
    String(category.info),
    String(category.warning),
    String(category.critical)
  ]);
  const checkRows = audit.checks
    .filter((check) => check.severity !== "pass")
    .map((check) => [
      check.category,
      check.severity.toUpperCase(),
      check.label,
      check.summary,
      check.recommendation
    ]);
  return {
    title: "Design Audit",
    lines: [
      `Score: ${audit.score}%`,
      `Pass ${audit.totals.pass}, info ${audit.totals.info}, warnings ${audit.totals.warning}, critical ${audit.totals.critical}`,
      "",
      "Category Summary",
      ...table(["Category", "Total", "Pass", "Info", "Warning", "Critical"], categoryRows),
      "",
      "Open Recommendations",
      ...table(["Category", "Severity", "Check", "Summary", "Recommendation"], checkRows)
    ]
  };
}

function addressPlanSection(project: NetworkProject): ReportSection {
  const plan = analyzeAddressPlan(project);
  const subnetRows = plan.subnets.map((subnet) => [
    subnet.network,
    `/${subnet.prefix}`,
    String(subnet.assignedHosts.length),
    subnet.gateways.map((host) => `${host.deviceLabel}:${host.ipAddress}`).join(", ") || "-",
    subnet.dhcpPools.map((pool) => `${pool.deviceLabel}:${pool.name}`).join(", ") || "-",
    subnet.nextAvailable.join(", ") || "-",
    subnet.warnings.join("; ") || "-"
  ]);
  const issueRows = [
    ...plan.invalidEntries.map((entry) => ["invalid", entry]),
    ...plan.duplicateIps.map((ip) => ["duplicate", ip]),
    ...plan.overlappingSubnets.map((pair) => ["overlap", `${pair.left} overlaps ${pair.right}`])
  ];
  return {
    title: "Address Plan",
    lines: [
      `Subnets ${plan.totals.subnets}, hosts ${plan.totals.hosts}, gateways ${plan.totals.gateways}, DHCP pools ${plan.totals.dhcpPools}`,
      `Duplicate IPs ${plan.totals.duplicateIps}, overlaps ${plan.totals.overlaps}, invalid entries ${plan.totals.invalidEntries}`,
      "",
      "Subnet Summary",
      ...table(["Network", "Prefix", "Hosts", "Gateways", "DHCP", "Next available", "Warnings"], subnetRows),
      "",
      "Address Issues",
      ...table(["Type", "Detail"], issueRows)
    ]
  };
}

function configDriftSection(project: NetworkProject): ReportSection {
  const drift = analyzeConfigDrift(project);
  const deviceRows = drift.devices.map((device) => [
    device.label,
    device.hostname || "-",
    device.kind,
    device.status,
    String(device.runningLineCount),
    String(device.startupLineCount),
    `+${device.addedLineCount}/-${device.removedLineCount}`
  ]);
  const openRows = drift.devices
    .filter((device) => device.status === "unsaved" || device.status === "drifted")
    .flatMap((device) => [
      ...device.runningOnlyCommands.slice(0, 8).map((line) => [device.label, "running-only", line]),
      ...device.startupOnlyCommands.slice(0, 8).map((line) => [device.label, "startup-only", line])
    ]);
  return {
    title: "Configuration Drift",
    lines: [
      `In sync ${drift.totals.inSync}, unsaved ${drift.totals.unsaved}, drifted ${drift.totals.drifted}, not applicable ${drift.totals.notApplicable}`,
      `Running-only lines ${drift.totals.addedLines}, startup-only lines ${drift.totals.removedLines}`,
      "",
      "Device Status",
      ...table(["Device", "Hostname", "Kind", "Status", "Running", "Startup", "Delta"], deviceRows),
      "",
      "Important Unsaved Commands",
      ...table(["Device", "Direction", "Command"], openRows)
    ]
  };
}

function failureImpactSection(project: NetworkProject): ReportSection {
  const impact = analyzeFailureImpact(project);
  const severityRows = summarizeFailureImpactBySeverity(impact).map((summary) => [
    summary.severity,
    String(summary.scenarios),
    String(summary.links),
    String(summary.devices),
    String(summary.worstAffectedPairs)
  ]);
  const scenarioRows = impact.scenarios.slice(0, 20).map((scenario) => [
    scenario.kind,
    scenario.label,
    scenario.severity,
    String(scenario.affectedEndpointCount),
    String(scenario.affectedPairCount),
    scenario.recommendation
  ]);
  const bridgeRows = impact.bridgeLinks.slice(0, 20).map((scenario) => [
    scenario.label,
    scenario.severity,
    String(scenario.affectedEndpointCount),
    scenario.affectedEndpoints.map((endpoint) => endpoint.label).join(", ") || "-"
  ]);
  const deviceRows = impact.criticalDevices.slice(0, 20).map((scenario) => [
    scenario.label,
    scenario.severity,
    String(scenario.affectedEndpointCount),
    scenario.affectedEndpoints.map((endpoint) => endpoint.label).join(", ") || "-"
  ]);
  return {
    title: "Failure Impact",
    lines: [
      `Endpoints ${impact.endpointCount}, active components ${impact.componentCount}`,
      `Bridge links ${impact.bridgeLinks.length}, critical devices ${impact.criticalDevices.length}`,
      `Worst-case affected endpoint pairs ${impact.vulnerableEndpointPairs}`,
      "",
      "Severity Summary",
      ...table(["Severity", "Scenarios", "Links", "Devices", "Worst pairs"], severityRows),
      "",
      "Top Failure Scenarios",
      ...table(["Kind", "Target", "Severity", "Endpoints", "Pairs", "Recommendation"], scenarioRows),
      "",
      "Bridge Links",
      ...table(["Link", "Severity", "Endpoints", "Affected"], bridgeRows),
      "",
      "Critical Devices",
      ...table(["Device", "Severity", "Endpoints", "Affected"], deviceRows)
    ]
  };
}

function verificationPlanSection(project: NetworkProject): ReportSection {
  const plan = buildVerificationPlan(project);
  const taskRows = plan.tasks.slice(0, 40).map((task) => [
    task.kind,
    task.priority,
    task.title,
    task.deviceLabel ?? "-",
    task.commands.slice(0, 3).join("; "),
    task.expected.slice(0, 2).join("; ")
  ]);
  return {
    title: "Verification Plan",
    lines: [
      `Required ${plan.totals.required}, recommended ${plan.totals.recommended}, optional ${plan.totals.optional}`,
      `CLI ${plan.totals.cli}, PDU ${plan.totals.pdu}, Desktop ${plan.totals.desktop}, Config ${plan.totals.config}, Report ${plan.totals.report}`,
      "",
      "Generated Tasks",
      ...table(["Kind", "Priority", "Task", "Device", "Commands", "Expected"], taskRows)
    ]
  };
}

function workbookSection(project: NetworkProject): ReportSection {
  const student = buildLabWorkbook(project, "student");
  const instructor = buildLabWorkbook(project, "instructor");
  return {
    title: "Lab Workbook",
    lines: [
      `Student workbook sections ${student.sections.length}`,
      `Instructor workbook sections ${instructor.sections.length}`,
      "",
      "Student Sections",
      ...table(["Section", "Lines"], student.sections.map((section) => [section.title, String(section.lines.length)])),
      "",
      "Instructor Sections",
      ...table(["Section", "Lines"], instructor.sections.map((section) => [section.title, String(section.lines.length)]))
    ]
  };
}

function accessRuleRow(device: NetworkDevice, rule: AccessRule): string[] {
  return [
    device.label,
    rule.listName ?? rule.interfaceName,
    rule.sequence === undefined ? "-" : String(rule.sequence),
    rule.action,
    rule.protocol,
    rule.source,
    rule.destination,
    rule.interfaceName,
    String(rule.hits)
  ];
}

function natRuleRow(device: NetworkDevice, rule: NatRule): string[] {
  return [
    device.label,
    rule.type ?? "static",
    rule.insideLocal,
    rule.insideGlobal,
    rule.outsideInterface,
    rule.aclName ?? "-",
    String(rule.hits)
  ];
}

function simulationEventRow(project: NetworkProject, event: SimulationEvent): string[] {
  return [
    new Date(event.time).toISOString(),
    event.type,
    event.status,
    eventDeviceLabel(project, event.sourceDeviceId ?? event.lastDeviceId),
    eventDeviceLabel(project, event.targetDeviceId ?? event.atDeviceId),
    eventDeviceLabel(project, event.atDeviceId),
    event.info
  ];
}

function simulationHeaderRow(project: NetworkProject, event: SimulationEvent): string[] {
  return [
    new Date(event.time).toISOString(),
    event.type,
    event.packetId ?? event.id,
    simulationEventHeaders(event)
      .map((header) => `${header.layer} ${header.field}=${headerValue(project, header.value)}`)
      .join("; ")
  ];
}

function simulationEventHeaders(event: SimulationEvent): NonNullable<SimulationEvent["headers"]> {
  if (event.headers?.length) return event.headers;
  const source = event.sourceDeviceId ?? event.lastDeviceId;
  const target = event.targetDeviceId ?? event.atDeviceId;
  return buildPduHeaders(event.type, event.status, source, target);
}

function linkEndpoint(project: NetworkProject, link: NetworkLink, side: "A" | "B"): LinkPeer | null {
  const endpoint = side === "A" ? link.endpointA : link.endpointB;
  const device = project.devices.find((item) => item.id === endpoint.deviceId);
  const port = device?.ports.find((item) => item.id === endpoint.portId);
  return device && port ? { device, port } : null;
}

function reportLinkState(project: NetworkProject, link: NetworkLink): string {
  if (link.status !== "up") return link.status;
  return linkOperational(project, link) ? "active" : "inactive (stored up)";
}

function linkOperational(project: NetworkProject, link: NetworkLink): boolean {
  if (link.status !== "up") return false;
  const a = linkEndpoint(project, link, "A");
  const b = linkEndpoint(project, link, "B");
  return Boolean(a?.device.powerOn && b?.device.powerOn && a.port.adminUp && b.port.adminUp);
}

function peerLabel(project: NetworkProject, device: NetworkDevice, port: NetworkPort): string {
  if (!port.linkId) return "-";
  const link = project.links.find((item) => item.id === port.linkId);
  if (!link) return "-";
  const peerEndpoint = link.endpointA.deviceId === device.id && link.endpointA.portId === port.id ? link.endpointB : link.endpointA;
  const peerDevice = project.devices.find((item) => item.id === peerEndpoint.deviceId);
  const peerPort = peerDevice?.ports.find((item) => item.id === peerEndpoint.portId);
  return peerDevice && peerPort ? `${peerDevice.label} ${peerPort.name}` : "-";
}

function eventDeviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
}

function activityPortLabel(project: NetworkProject, deviceId: string, portId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.ports.find((port) => port.id === portId)?.name ?? portId;
}

function headerValue(project: NetworkProject, value: string): string {
  return project.devices.find((device) => device.id === value)?.label ?? value;
}

function enabledServices(device: NetworkDevice): string[] {
  return Object.entries(device.config.services)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name.toUpperCase());
}

function hasServiceSurface(device: NetworkDevice): boolean {
  return enabledServices(device).length > 0 ||
    device.config.dhcpPools.length > 0 ||
    (device.config.dhcpExcludedRanges?.length ?? 0) > 0 ||
    device.config.dnsRecords.length > 0 ||
    (device.config.nameServers ?? []).length > 0 ||
    device.runtime.dhcpLeases.length > 0 ||
    device.runtime.logs.length > 0;
}

function serviceLogCount(device: NetworkDevice, prefix: string): number {
  return device.runtime.logs.filter((log) => log.message.startsWith(prefix)).length;
}

function runtimeEntryCount(device: NetworkDevice): number {
  return device.runtime.arpTable.length +
    device.runtime.macTable.length +
    device.runtime.dhcpLeases.length +
    (device.runtime.natTranslations ?? []).length +
    device.runtime.logs.length;
}

function compactNumberList(values: number[]): string {
  const sorted = Array.from(new Set(values)).sort((left, right) => left - right);
  if (!sorted.length) return "";
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges.join(",");
}

function maskedSecret(value: string): string {
  if (!value) return "-";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

function renderSection(section: ReportSection, first: boolean, includeEmpty: boolean): string[] {
  const lines = section.lines.filter((line, index, list) => includeEmpty || line.trim() || list.some((item) => item.trim()));
  if (!lines.length && !includeEmpty) return [];
  return [
    ...(first ? [] : [""]),
    `## ${section.title}`,
    "",
    ...(lines.length ? lines : ["- none"])
  ];
}

function table(headers: string[], rows: Array<Array<string | number>>): string[] {
  if (!rows.length) return ["- none"];
  const normalizedRows = rows.map((row) => headers.map((_, index) => sanitizeCell(row[index] ?? "")));
  const normalizedHeaders = headers.map(sanitizeCell);
  const widths = normalizedHeaders.map((header, index) => Math.max(header.length, ...normalizedRows.map((row) => row[index].length)));
  const headerLine = `| ${normalizedHeaders.map((header, index) => header.padEnd(widths[index])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  const body = normalizedRows.map((row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`);
  return [headerLine, separator, ...body];
}

function sanitizeCell(value: string | number): string {
  return String(value).replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "-";
}

function countBy<T>(items: T[], key: (item: T) => string): CountMap {
  return items.reduce<CountMap>((counts, item) => {
    const name = key(item) || "-";
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}
