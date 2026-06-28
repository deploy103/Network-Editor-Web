import { analyzeAddressPlan } from "./addressPlan";
import { analyzeConfigDrift } from "./configDrift";
import { analyzeFailureImpact } from "./failureImpact";
import { analyzeProjectAudit } from "./projectAudit";
import { analyzeSecurityMatrix } from "./securityMatrix";
import { analyzeServiceReachability } from "./serviceReachability";
import { buildVerificationPlan } from "./verificationPlan";
import type { NetworkProject } from "../types/network";

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
  const links = project.links.map((link) => `- ${link.type} ${link.status}: ${link.endpointA.deviceId} <-> ${link.endpointB.deviceId}`);
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
      "- Verify each routed interface or SVI has the expected subnet gateway address.",
      "- Use the exported Address Plan if you need the full assignment table."
    ]
  };
}

function serviceSection(project: NetworkProject): WorkbookSection {
  const reachability = analyzeServiceReachability(project);
  const serviceServers = reachability.servers.map((server) => `- ${server.label} ${server.ipAddress}: ${server.services.map((service) => service.toUpperCase()).join(", ")}`);
  const blocked = reachability.checks.filter((check) => check.status === "blocked" || check.status === "local-only").slice(0, 10);
  return {
    title: "Services",
    lines: [
      "Service endpoints",
      ...(serviceServers.length ? serviceServers : ["- none"]),
      "",
      `Reachability: ${reachability.totals.reachable} reachable, ${reachability.totals.blocked} blocked, ${reachability.totals.localOnly} local-only.`,
      ...(blocked.length ? ["", "Open service gaps", ...blocked.map((check) => `- ${check.client.label} ${check.service.toUpperCase()}: ${check.reason}`)] : []),
      "",
      "Required checks",
      "- Use Desktop or Complex PDU tests for DNS and HTTP when those services are enabled.",
      "- Confirm DHCP leases are issued from the intended pool when DHCP is part of the lab.",
      "- Check service logs after test traffic is generated."
    ]
  };
}

function securitySection(project: NetworkProject, audience: WorkbookAudience): WorkbookSection {
  const matrix = analyzeSecurityMatrix(project);
  return {
    title: "Security And Policy",
    lines: [
      `Zones: ${matrix.totals.zones}`,
      `ACL rules: ${matrix.totals.aclRules}`,
      `NAT rules: ${matrix.totals.natRules}`,
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
      ...(requirements.length ? requirements.map((requirement) => `- ${requirement.label}: ${requirement.target} target, ${requirement.points} points`) : ["- Add Activity Wizard requirements for scored grading."]),
      "",
      "Always check",
      `- Startup-config saved on network devices: ${drift.totals.inSync} in sync, ${drift.totals.unsaved} unsaved, ${drift.totals.drifted} drifted.`,
      "- Required PDU events are delivered and visible in Simulation mode.",
      "- Diagnostic errors are resolved or documented as intentional exceptions.",
      audience === "instructor" ? "- Export Activity Check and Project Report as grading artifacts." : "- Submit the project after saving configurations and completing verification."
    ]
  };
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
