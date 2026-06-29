import { analyzeAddressPlan } from "./addressPlan";
import { analyzeConfigDrift } from "./configDrift";
import { desktopNetstatListeningRows } from "./desktopDiagnostics";
import { analyzeFailureImpact } from "./failureImpact";
import { analyzeProjectAudit } from "./projectAudit";
import { analyzeSecurityMatrix } from "./securityMatrix";
import { analyzeServiceReachability } from "./serviceReachability";
import { endpoint, linkLabel } from "./topology";
import { buildVerificationPlan } from "./verificationPlan";
import type { NetworkDevice, NetworkLink, NetworkProject } from "../types/network";

export type WorkbookAudience = "student" | "instructor";

export interface WorkbookSection {
  title: string;
  lines: string[];
}

export interface LabWorkbook {
  title: string;
  audience: WorkbookAudience;
  sections: WorkbookSection[];
}

export function buildLabWorkbook(project: NetworkProject, audience: WorkbookAudience = "student"): LabWorkbook {
  return {
    title: `${project.name} ${audience === "instructor" ? "Instructor Workbook" : "Student Workbook"}`,
    audience,
    sections: [
      overviewSection(project, audience),
      topologySection(project),
      addressingSection(project, audience),
      serviceSection(project),
      securitySection(project, audience),
      verificationSection(project, audience),
      gradingSection(project, audience),
      troubleshootingSection(project),
      submissionSection(project, audience)
    ]
  };
}

export function buildLabWorkbookText(project: NetworkProject, audience: WorkbookAudience = "student"): string {
  return buildLabWorkbookLines(project, audience).join("\n");
}

export function buildLabWorkbookLines(project: NetworkProject, audience: WorkbookAudience = "student"): string[] {
  const workbook = buildLabWorkbook(project, audience);
  return [
    `# ${workbook.title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...workbook.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      ...section.lines,
      ""
    ])
  ];
}

function overviewSection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const activity = project.activity;
  const audit = analyzeProjectAudit(project);
  return {
    title: "Overview",
    lines: [
      `Project: ${project.name}`,
      `Devices: ${project.devices.length}`,
      `Links: ${project.links.length}`,
      `Activity: ${activity?.title || "not configured"}`,
      `Design audit score: ${audit.score}%`,
      "",
      "Objectives",
      ...(activity?.objectives.length ? activity.objectives.map((objective, index) => `${index + 1}. ${objective}`) : defaultObjectives()),
      "",
      audience === "instructor"
        ? `Instructor note: ${audit.totals.critical} critical audit checks and ${audit.totals.warning} warnings are currently open.`
        : "Read the objectives first, build the topology, then complete verification tasks before submitting."
    ]
  };
}

function topologySection(project: NetworkProject): WorkbookSection {
  const impact = analyzeFailureImpact(project);
  const devices = project.devices.map((device) => `- ${device.label}: ${device.model} (${device.kind})`);
  const links = project.links.map((link) => `- ${link.type} ${workbookLinkState(project, link)}: ${linkLabel(project, link)}`);
  return {
    title: "Topology Inventory",
    lines: [
      "Devices",
      ...(devices.length ? devices : ["- none"]),
      "",
      "Links",
      ...(links.length ? links : ["- none"]),
      "",
      `Failure impact: ${impact.bridgeLinks.length} bridge links, ${impact.criticalDevices.length} critical devices.`,
      ...(impact.scenarios.filter((scenario) => scenario.affectedPairCount > 0).slice(0, 5).map((scenario) => `- ${scenario.kind} ${scenario.label}: ${scenario.affectedPairCount} endpoint pairs affected`) || [])
    ]
  };
}

function addressingSection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const addressPlan = analyzeAddressPlan(project);
  const subnetLines = addressPlan.subnets.map((subnet) =>
    `- ${subnet.network}/${subnet.prefix}: ${subnet.assignedHosts.length} assigned, gateways ${subnet.gateways.map((gateway) => gateway.ipAddress).join(", ") || "none"}, next ${subnet.nextAvailable.join(", ") || "none"}`
  );
  const issueLines = [
    ...addressPlan.invalidEntries.map((entry) => `- Invalid: ${entry}`),
    ...addressPlan.duplicateIps.map((ip) => `- Duplicate IP: ${ip}`),
    ...addressPlan.overlappingSubnets.map((pair) => `- Overlap: ${pair.left} / ${pair.right}`)
  ];
  return {
    title: "Addressing Plan",
    lines: [
      "Subnets",
      ...(subnetLines.length ? subnetLines : ["- none"]),
      "",
      audience === "instructor" ? "Addressing issues" : "Addressing checks",
      ...(issueLines.length ? issueLines : ["- no address plan issues detected"]),
      "",
      "Student actions",
      "- Verify each endpoint has IP address, subnet mask, gateway, and DNS where required.",
      "- Use Desktop Command Prompt ipconfig /all, netsh interface ip show config, Get-NetAdapter, Get-NetIPConfiguration -All, or Get-DnsClientServerAddress to capture host adapter evidence.",
      "- Use Desktop Command Prompt route print, Get-NetRoute, arp -a, or Get-NetNeighbor to capture host route and neighbor evidence.",
      "- Verify each routed interface or SVI has the expected subnet gateway address.",
      "- Use the exported Address Plan if you need the full assignment table."
    ]
  };
}

function serviceSection(project: NetworkProject): WorkbookSection {
  const reachability = analyzeServiceReachability(project);
  const serviceServers = reachability.servers.map((server) => `- ${server.label} ${server.ipAddress}: ${server.services.map((service) => service.toUpperCase()).join(", ")}`);
  const serviceSummary = project.devices.filter(hasServiceWorkbookSurface).map((device) => {
    const serviceEntries = Object.entries(device.config.services);
    const enabledCount = serviceEntries.filter(([, enabled]) => enabled).length;
    const activePools = device.config.dhcpPools.filter((pool) => pool.enabled).length;
    const listenerRows = desktopNetstatListeningRows(device);
    const listenerSummary = listenerRows.map((row) => `${row.service}:${row.pid}`).join(", ");
    const logSummary = [
      `DNS ${workbookServiceLogCount(device, "DNS")}`,
      `HTTP ${workbookServiceLogCount(device, "HTTP")}`,
      `FTP ${workbookServiceLogCount(device, "FTP")}`,
      `EMAIL ${workbookServiceLogCount(device, "EMAIL")}`,
      `TFTP ${workbookServiceLogCount(device, "TFTP")}`,
      `SYSLOG ${device.runtime.logs.length}`
    ].join(", ");
    return `- ${device.label}: services ${enabledCount}/${serviceEntries.length}, listeners ${listenerRows.length}${listenerSummary ? ` (${listenerSummary})` : ""}, DHCP pools ${activePools}/${device.config.dhcpPools.length}, DHCP leases ${device.runtime.dhcpLeases.length}, DNS records ${device.config.dnsRecords.length}, logs ${logSummary}`;
  });
  const blocked = reachability.checks.filter((check) => check.status === "blocked" || check.status === "local-only").slice(0, 10);
  return {
    title: "Services",
    lines: [
      "Service endpoints",
      ...(serviceServers.length ? serviceServers : ["- none"]),
      "",
      "Service summary",
      ...(serviceSummary.length ? serviceSummary : ["- none"]),
      "",
      `Reachability: ${reachability.totals.reachable} reachable, ${reachability.totals.blocked} blocked, ${reachability.totals.localOnly} local-only.`,
      ...(blocked.length ? ["", "Open service gaps", ...blocked.map((check) => `- ${check.client.label} ${check.service.toUpperCase()}: ${check.reason}`)] : []),
      "",
      "Required checks",
      "- Use Desktop or Complex PDU tests for DNS and HTTP when those services are enabled.",
      "- Use Desktop Command Prompt Test-Connection <server> -Count 4 to capture ICMP reply evidence.",
      "- Use Desktop Command Prompt Invoke-WebRequest http://<server> to capture HTTP status-code evidence.",
      "- Use Desktop Command Prompt Send-MailMessage -SmtpServer <server> -To <recipient> to capture EMAIL delivery evidence.",
      "- Use Desktop Command Prompt Test-NetConnection <server> -Port <port> to capture service port success or failure.",
      "- Use Desktop Command Prompt netstat -an, netstat -ano, or netstat -abno plus tasklist /svc, Get-NetTCPConnection -State Listen, Get-Process -Id <pid>, Get-Service <service>, and sc queryex <service> on service devices to confirm listening application ports, PID evidence, process names, owning processes, and service state.",
      "- Use show services summary on service devices to confirm enabled and disabled service counts.",
      "- Confirm DHCP leases are issued from the intended pool when DHCP is part of the lab.",
      "- Use show ip dhcp pool summary when DHCP pools are part of the lab.",
      "- Use show ip dhcp binding summary after DHCP tests to confirm lease evidence.",
      "- Use show hosts summary when DNS records or name servers are part of the lab.",
      "- Use show service logs dns after nslookup <record> <dns-server> or Resolve-DnsName <record> -Server <dns-server> -Type A tests to confirm directed DNS evidence.",
      "- Use Desktop Command Prompt Get-EventLog -LogName Application -Newest 10 after service tests to capture recent runtime events.",
      "- Check service logs after test traffic is generated.",
      "- Use show service logs summary on service devices to confirm per-service evidence counts."
    ]
  };
}

function securitySection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const matrix = analyzeSecurityMatrix(project);
  const prefixListCount = project.devices.reduce((total, device) => total + (device.config.prefixLists?.length ?? 0), 0);
  const routeMapCount = project.devices.reduce((total, device) => total + (device.config.routeMaps?.length ?? 0), 0);
  const pbrPortCount = project.devices.reduce((total, device) => total + device.ports.filter((port) => port.policyRouteMap).length, 0);
  return {
    title: "Security And Policy",
    lines: [
      `Zones: ${matrix.totals.zones}`,
      `ACL rules: ${matrix.totals.aclRules}`,
      `NAT rules: ${matrix.totals.natRules}`,
      `Prefix-list entries: ${prefixListCount}`,
      `Route-map entries: ${routeMapCount}`,
      `PBR-enabled ports: ${pbrPortCount}`,
      `PBR rules: ${matrix.totals.pbrRules}`,
      "",
      "Exposure summary",
      ...(matrix.exposures.length ? matrix.exposures.slice(0, 12).map((exposure) => `- ${exposure.deviceLabel} ${exposure.service} ${exposure.ipAddress}: ${exposure.exposure}`) : ["- no exposed services"]),
      "",
      audience === "instructor" ? "Policy warnings" : "Policy review",
      ...(matrix.warnings.length ? matrix.warnings.map((warning) => `- ${warning}`) : ["- no policy warnings"]),
      "",
      "Required checks",
      "- Verify ACL hit counters after PDU tests.",
      "- Verify NAT translations and statistics when NAT is configured.",
      "- Verify route-map and prefix-list counters when PBR is configured."
    ]
  };
}

function verificationSection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const plan = buildVerificationPlan(project);
  const required = plan.tasks.filter((task) => task.priority === "required");
  const recommended = plan.tasks.filter((task) => task.priority === "recommended");
  const selected = audience === "instructor" ? plan.tasks : [...required, ...recommended.slice(0, 12)];
  return {
    title: "Verification Tasks",
    lines: [
      `Generated tasks: ${plan.tasks.length}`,
      `Required: ${plan.totals.required}, recommended: ${plan.totals.recommended}, optional: ${plan.totals.optional}`,
      "",
      ...selected.flatMap((task, index) => [
        `${index + 1}. ${task.title} (${task.priority}, ${task.kind})`,
        `   Commands: ${task.commands.join("; ")}`,
        `   Expected: ${task.expected.join("; ")}`
      ])
    ]
  };
}

function gradingSection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const activity = project.activity;
  const drift = analyzeConfigDrift(project);
  const requirements = activity?.requirements ?? [];
  return {
    title: "Grading Checklist",
    lines: [
      "Requirements",
      ...(requirements.length ? requirements.map((requirement) => `- ${requirement.label}: ${requirement.target} target, ${requirement.points} points`) : ["- Add Activity Wizard requirements for scored grading."]),
      ...activityDetailLines(project, audience),
      "",
      "Always check",
      `- Startup-config saved on network devices: ${drift.totals.inSync} in sync, ${drift.totals.unsaved} unsaved, ${drift.totals.drifted} drifted.`,
      "- Required PDU events are delivered and visible in Simulation mode.",
      "- Diagnostic errors are resolved or documented as intentional exceptions.",
      audience === "instructor" ? "- Export Activity Check and Project Report as grading artifacts." : "- Submit the project after saving configurations and completing verification."
    ]
  };
}

function activityDetailLines(project: NetworkProject, audience: WorkbookAudience): string[] {
  const activity = project.activity;
  if (!activity) return [];
  const counts = {
    commandRules: activity.commandRules?.length ?? 0,
    commandSequences: activity.commandSequences?.length ?? 0,
    commandOutputAssertions: activity.commandOutputAssertions?.length ?? 0,
    interfaceExpectations: activity.interfaceExpectations?.length ?? 0,
    headerAssertions: activity.headerAssertions?.length ?? 0
  };
  if (audience !== "instructor") {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return total ? [
      "",
      "Activity checks",
      `- Instructor has ${total} detailed Activity checks configured. Use Check Results before submission.`
    ] : [];
  }

  const lines: string[] = ["", "Instructor Activity Checks"];
  if (activity.answerSnapshot) {
    lines.push(
      "Answer snapshot",
      `- Captured ${activity.answerSnapshot.capturedAt}: ${activity.answerSnapshot.devices.length} devices, ${activity.answerSnapshot.links.length} links, ${activity.answerSnapshot.annotationCount} annotations, ${activity.answerSnapshot.serviceDeviceIds.length} service devices, ${activity.answerSnapshot.startupConfigDeviceIds.length} startup configs.`
    );
  }
  if (counts.commandRules) {
    lines.push("Command rules", ...(activity.commandRules ?? []).map((rule) =>
      `- ${rule.label}: ${rule.deviceId ? deviceLabel(project, rule.deviceId) : "Any device"} command "${rule.command}" (${rule.points} pts)`
    ));
  }
  if (counts.commandSequences) {
    lines.push("Command sequences", ...(activity.commandSequences ?? []).map((sequence) =>
      `- ${sequence.label}: ${sequence.deviceId ? deviceLabel(project, sequence.deviceId) : "Any device"} sequence ${sequence.commands.join(" -> ")} (${sequence.points} pts)`
    ));
  }
  if (counts.commandOutputAssertions) {
    lines.push("Command output assertions", ...(activity.commandOutputAssertions ?? []).map((assertion) =>
      `- ${assertion.label}: ${assertion.deviceId ? deviceLabel(project, assertion.deviceId) : "Any device"} ${assertion.commands.join(" && ")} contains "${assertion.expectedText}" (${assertion.points} pts)`
    ));
  }
  if (counts.interfaceExpectations) {
    lines.push("Interface expectations", ...(activity.interfaceExpectations ?? []).map((expectation) => {
      const expected = [
        expectation.ipAddress ? `ip ${expectation.ipAddress}` : "",
        expectation.subnetMask ? `mask ${expectation.subnetMask}` : "",
        expectation.mode ? `mode ${expectation.mode}` : "",
        expectation.vlan !== undefined ? `vlan ${expectation.vlan}` : ""
      ].filter(Boolean).join(", ") || "configured state";
      return `- ${expectation.label}: ${deviceLabel(project, expectation.deviceId)} ${portLabel(project, expectation.deviceId, expectation.portId)} expects ${expected} (${expectation.points} pts)`;
    }));
  }
  if (counts.headerAssertions) {
    lines.push("Packet header assertions", ...(activity.headerAssertions ?? []).map((assertion) =>
      `- ${assertion.label}: ${(assertion.protocol || "Any").toUpperCase()} ${assertion.field}=${assertion.value} (${assertion.points} pts)`
    ));
  }
  return lines.length > 2 ? lines : [];
}

function troubleshootingSection(project: NetworkProject): WorkbookSection {
  const audit = analyzeProjectAudit(project);
  const open = audit.checks.filter((check) => check.severity !== "pass").slice(0, 12);
  return {
    title: "Troubleshooting Guide",
    lines: [
      "Recommended order",
      "1. Check power and physical link status.",
      "2. Check IP address, subnet mask, default gateway, and DNS.",
      "3. Check VLAN/trunk membership and STP state.",
      "4. Check routing table, default route, and first-hop redundancy.",
      "5. Check ACL, NAT, PBR, and service logs.",
      "",
      "Current hints",
      ...(open.length ? open.map((check) => `- [${check.severity}] ${check.category}/${check.label}: ${check.recommendation}`) : ["- No open audit hints."])
    ]
  };
}

function submissionSection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  return {
    title: "Submission Artifacts",
    lines: [
      "- Saved project file (.ptweb or JSON).",
      "- Project Report export.",
      "- Activity Check export when Activity Wizard is used.",
      "- Configuration Drift report showing saved startup-config state.",
      "- Simulation event CSV when packet evidence is required.",
      audience === "instructor" ? "- Instructor workbook and expected answer snapshot." : "- Screenshots only when the instructor requests them.",
      `Project updated timestamp: ${project.updatedAt}`
    ]
  };
}

function defaultObjectives(): string[] {
  return [
    "1. Build the physical and logical topology shown by the project.",
    "2. Configure addressing, routing, switching, services, and policy features.",
    "3. Save network device configurations.",
    "4. Prove reachability with CLI, Desktop tools, and PDU simulation."
  ];
}

function workbookLinkState(project: NetworkProject, link: NetworkLink): string {
  if (link.status !== "up") return link.status;
  const a = endpoint(project, link.endpointA);
  const b = endpoint(project, link.endpointB);
  return a?.device.powerOn && b?.device.powerOn && a.port.adminUp && b.port.adminUp ? "active" : "inactive (stored up)";
}

function deviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
}

function portLabel(project: NetworkProject, deviceId: string, portId: string): string {
  const device = project.devices.find((item): item is NetworkDevice => item.id === deviceId);
  return device?.ports.find((port) => port.id === portId)?.name ?? portId;
}

function hasServiceWorkbookSurface(device: NetworkDevice): boolean {
  return Object.values(device.config.services).some(Boolean) ||
    device.config.dhcpPools.length > 0 ||
    (device.config.dhcpExcludedRanges?.length ?? 0) > 0 ||
    device.config.dnsRecords.length > 0 ||
    (device.config.nameServers ?? []).length > 0 ||
    device.runtime.dhcpLeases.length > 0 ||
    device.runtime.logs.length > 0;
}

function workbookServiceLogCount(device: NetworkDevice, prefix: string): number {
  return device.runtime.logs.filter((log) => log.message.startsWith(prefix)).length;
}
