import { analyzeAddressPlan } from "./addressPlan";
import { analyzeConfigDrift } from "./configDrift";
import { analyzeFailureImpact } from "./failureImpact";
import { analyzeSecurityMatrix } from "./securityMatrix";
import { analyzeServiceReachability } from "./serviceReachability";
import { isIpv4 } from "./ip";
import { staticRouteState } from "./routeState";
import type { NetworkDevice, NetworkProject } from "../types/network";

export type VerificationTaskKind = "cli" | "pdu" | "desktop" | "config" | "physical" | "report";
export type VerificationTaskPriority = "required" | "recommended" | "optional";

export interface VerificationTask {
  id: string;
  kind: VerificationTaskKind;
  priority: VerificationTaskPriority;
  title: string;
  deviceId?: string;
  deviceLabel?: string;
  commands: string[];
  expected: string[];
  rationale: string;
}

export interface VerificationPlan {
  title: string;
  summary: string[];
  tasks: VerificationTask[];
  totals: {
    required: number;
    recommended: number;
    optional: number;
    cli: number;
    pdu: number;
    desktop: number;
    config: number;
    physical: number;
    report: number;
  };
}

export function buildVerificationPlan(project: NetworkProject): VerificationPlan {
  const tasks = [
    ...baselineTasks(project),
    ...addressingTasks(project),
    ...routingTasks(project),
    ...switchingTasks(project),
    ...securityTasks(project),
    ...serviceTasks(project),
    ...wirelessTasks(project),
    ...resilienceTasks(project),
    ...configurationTasks(project),
    ...reportTasks(project)
  ];
  return {
    title: `${project.name} Verification Plan`,
    summary: verificationSummary(project, tasks),
    tasks,
    totals: {
      required: tasks.filter((task) => task.priority === "required").length,
      recommended: tasks.filter((task) => task.priority === "recommended").length,
      optional: tasks.filter((task) => task.priority === "optional").length,
      cli: tasks.filter((task) => task.kind === "cli").length,
      pdu: tasks.filter((task) => task.kind === "pdu").length,
      desktop: tasks.filter((task) => task.kind === "desktop").length,
      config: tasks.filter((task) => task.kind === "config").length,
      physical: tasks.filter((task) => task.kind === "physical").length,
      report: tasks.filter((task) => task.kind === "report").length
    }
  };
}

export function buildVerificationPlanText(project: NetworkProject): string {
  return buildVerificationPlanLines(project).join("\n");
}

export function buildVerificationPlanLines(project: NetworkProject): string[] {
  const plan = buildVerificationPlan(project);
  const grouped = groupBy(plan.tasks, (task) => task.kind);
  return [
    "Network Editor Web Verification Plan",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    ...plan.summary.map((line) => `- ${line}`),
    "",
    "Totals",
    `- Required: ${plan.totals.required}`,
    `- Recommended: ${plan.totals.recommended}`,
    `- Optional: ${plan.totals.optional}`,
    `- CLI: ${plan.totals.cli}`,
    `- PDU: ${plan.totals.pdu}`,
    `- Desktop: ${plan.totals.desktop}`,
    `- Config: ${plan.totals.config}`,
    `- Physical: ${plan.totals.physical}`,
    `- Reports: ${plan.totals.report}`,
    "",
    ...Array.from(grouped.entries()).flatMap(([kind, tasks]) => [
      `## ${kind.toUpperCase()} Tasks`,
      "",
      ...tasks.flatMap(renderTask),
      ""
    ])
  ];
}

function baselineTasks(project: NetworkProject): VerificationTask[] {
  return [
    task("report", "required", "Run full project report", {
      rationale: "The project report combines inventory, addressing, service, security, audit, and drift evidence.",
      commands: ["Tools > 프로젝트 리포트 내보내기"],
      expected: ["Report includes Project Summary, Address Plan, Design Audit, Configuration Drift, Failure Impact."]
    }),
    task("physical", "recommended", "Inspect physical connectivity", {
      rationale: "Physical link state is the first dependency for all logical verification.",
      commands: ["Physical workspace", "show interfaces status", "show cable-diagnostics tdr"],
      expected: [`${project.links.length} links are accounted for`, "Copper TDR results are normal where expected."]
    })
  ];
}

function addressingTasks(project: NetworkProject): VerificationTask[] {
  const plan = analyzeAddressPlan(project);
  const subnetTasks = plan.subnets.slice(0, 16).map((subnet) => task("cli", "required", `Verify subnet ${subnet.network}/${subnet.prefix}`, {
    rationale: "Each routed subnet should have assigned hosts, a gateway candidate, and no duplicate addressing.",
    commands: ["show ip interface brief", "show ip route connected", `ping ${subnet.gateways[0]?.ipAddress ?? subnet.nextAvailable[0] ?? subnet.network}`],
    expected: [
      `${subnet.assignedHosts.length} assigned host entries`,
      subnet.gateways.length ? `Gateway candidate ${subnet.gateways.map((gateway) => gateway.ipAddress).join(", ")}` : "Gateway candidate is documented or intentionally absent",
      subnet.warnings.length ? `Review warnings: ${subnet.warnings.join("; ")}` : "No subnet warnings"
    ]
  }));
  const issueTasks = plan.totals.duplicateIps || plan.totals.overlaps || plan.totals.invalidEntries
    ? [task("config", "required", "Resolve address plan issues", {
        rationale: "Duplicate, overlapping, or malformed addressing breaks routing and service verification.",
        commands: ["Tools > 주소 계획 내보내기"],
        expected: [`Duplicate IPs ${plan.totals.duplicateIps}`, `Overlaps ${plan.totals.overlaps}`, `Invalid entries ${plan.totals.invalidEntries}`]
      })]
    : [];
  const desktopTasks = project.devices
    .filter((device) => device.kind === "pc" || device.kind === "server")
    .map((device) => task("desktop", "recommended", `Verify desktop identity on ${device.label}`, {
      device,
      rationale: "Desktop identity, adapter MACs, and local routes help correlate host-side evidence with ARP, DHCP, and service tests.",
      commands: ["Desktop > Command Prompt > hostname", "Desktop > Command Prompt > getmac", "Desktop > Command Prompt > getmac /v", "Desktop > Command Prompt > ipconfig /all", "Desktop > Command Prompt > netsh interface ip show config", "Desktop > Command Prompt > Get-NetAdapter", "Desktop > Command Prompt > Get-NetIPConfiguration -All", "Desktop > Command Prompt > Get-DnsClientServerAddress", "Desktop > Command Prompt > route print", "Desktop > Command Prompt > route print -4"],
      expected: [
        `${device.config.hostname || device.label} hostname visible`,
        `${device.ports.filter((port) => port.kind !== "console").length} network adapters listed`,
        "Netsh interface config shows adapter IP, gateway, and DNS evidence",
        "PowerShell adapter commands show interface status, IPv4 address, gateway, and DNS server evidence",
        "Gateway and DNS settings match the address plan"
      ]
    }));
  return [...subnetTasks, ...desktopTasks, ...issueTasks];
}

function routingTasks(project: NetworkProject): VerificationTask[] {
  return project.devices
    .filter((device) => isNetworkDevice(device))
    .flatMap((device) => {
      const hasRoutes = device.config.staticRoutes.length || (device.config.routingProtocols?.length ?? 0);
      const trackedRoutes = device.config.staticRoutes.filter((route) => route.trackId !== undefined);
      const inactiveTrackedRoutes = trackedRoutes.filter((route) => staticRouteState(project, device, route) === "inactive");
      const hasTracking = trackedRoutes.length > 0 ||
        (device.config.trackObjects ?? []).length > 0 ||
        device.ports.some((port) =>
          (port.hsrpGroups ?? []).some((group) => group.trackInterface || group.trackObject !== undefined) ||
          (port.vrrpGroups ?? []).some((group) => group.trackObject !== undefined)
        );
      const commands = [
        "show ip interface brief",
        "show ip route",
        ...device.config.staticRoutes.slice(0, 6).map((route) => `show ip route ${route.network} ${route.mask}`),
        ...(device.config.routingProtocols?.length ? ["show ip protocols"] : []),
        ...routingProtocolCommands(device),
        ...(device.config.ipSlaOperations?.length ? ["show ip sla summary"] : []),
        ...(hasTracking ? ["show track"] : []),
        ...(device.ports.some((port) => (port.hsrpGroups?.length ?? 0) > 0) ? ["show standby brief"] : []),
        ...(device.ports.some((port) => (port.vrrpGroups?.length ?? 0) > 0) ? ["show vrrp brief"] : [])
      ];
      return hasRoutes || commands.length > 2 ? [task("cli", "required", `Verify routing on ${device.label}`, {
        device,
        rationale: "Routing devices need connected, static, dynamic, and failover state checked before PDU testing.",
        commands,
        expected: [
          device.config.staticRoutes.length ? `${device.config.staticRoutes.length} static routes visible` : "Connected routes visible",
          device.config.routingProtocols?.length ? `${device.config.routingProtocols.length} dynamic process entries visible` : "No dynamic routing expected",
          hasTracking
            ? inactiveTrackedRoutes.length
              ? `${inactiveTrackedRoutes.length} tracked static routes currently inactive; verify floating backup/default route`
              : "Track objects and tracked routes report expected state"
            : "No tracked reachability expected"
        ]
      })] : [];
    });
}

function routingProtocolCommands(device: NetworkDevice): string[] {
  const protocols = new Set((device.config.routingProtocols ?? []).map((protocol) => protocol.protocol));
  return [
    ...(protocols.has("ospf") ? ["show ip ospf", "show ip ospf interface brief", "show ip ospf neighbor"] : []),
    ...(protocols.has("eigrp") ? ["show ip eigrp neighbors", "show ip eigrp interfaces", "show ip eigrp topology"] : []),
    ...(protocols.has("rip") ? ["show ip rip database"] : [])
  ];
}

function switchingTasks(project: NetworkProject): VerificationTask[] {
  return project.devices
    .filter((device) => device.kind === "switch" || device.kind === "wireless")
    .map((device) => task("cli", "recommended", `Verify switching on ${device.label}`, {
      device,
      rationale: "Switching state confirms VLAN membership, trunks, STP state, neighbor discovery, and access-edge hardening.",
      commands: [
        "show vlan brief",
        "show interfaces trunk",
        "show spanning-tree",
        "show spanning-tree summary",
        "show interfaces status",
        ...(device.config.dhcpSnooping?.enabled ? ["show ip dhcp snooping", "show ip dhcp snooping summary"] : []),
        ...(device.ports.some((port) => port.portSecurity?.enabled) ? ["show port-security", "show port-security summary"] : []),
        ...(device.ports.some((port) => port.channelGroup) ? ["show etherchannel summary"] : [])
      ],
      expected: [
        `${device.config.vlans.length} VLAN definitions`,
        `${device.ports.filter((port) => port.mode === "trunk").length} trunk ports`,
        "STP and access-edge settings match the lab design"
      ]
    }));
}

function securityTasks(project: NetworkProject): VerificationTask[] {
  const matrix = analyzeSecurityMatrix(project);
  const deviceTasks = project.devices
    .filter((device) => device.config.accessRules.length || device.config.natRules.length || (device.config.routeMaps ?? []).length)
    .map((device) => task("cli", "required", `Verify policy on ${device.label}`, {
      device,
      rationale: "ACL, NAT, prefix-list, and route-map hit counters prove security and policy routing behavior.",
      commands: [
        ...(device.config.accessRules.length ? ["show access-list", "show access-list summary", "show ip access-lists"] : []),
        ...(device.config.natRules.length ? ["show ip nat statistics", "show ip nat translations"] : []),
        ...((device.config.prefixLists ?? []).length ? ["show ip prefix-list", "show ip prefix-list summary"] : []),
        ...((device.config.routeMaps ?? []).length ? [
          "show route-map",
          "show route-map summary",
          ...(device.config.routeMaps ?? []).slice(0, 3).map((entry) => `show route-map ${entry.name} detail`)
        ] : [])
      ],
      expected: [
        `${device.config.accessRules.length} ACL rules`,
        `${device.config.natRules.length} NAT rules`,
        `${device.config.routeMaps?.length ?? 0} route-map entries`
      ]
    }));
  const matrixTask = task("report", matrix.warnings.length ? "required" : "recommended", "Review security matrix", {
    rationale: "The matrix highlights zone inference, service exposure, NAT roles, and broad permit policy.",
    commands: ["Tools > Security Matrix 내보내기"],
    expected: matrix.warnings.length ? matrix.warnings : ["No matrix warnings"]
  });
  return [...deviceTasks, matrixTask];
}

function serviceTasks(project: NetworkProject): VerificationTask[] {
  const reachability = analyzeServiceReachability(project);
  const serverTasks = project.devices
    .filter((device) => Object.values(device.config.services).some(Boolean))
    .map((device) => task("desktop", "required", `Verify services on ${device.label}`, {
      device,
      rationale: "Enabled services should have an IP address, application state, and client tests.",
      commands: serviceVerificationCommands(device),
      expected: serviceVerificationExpected(device)
    }));
  const clientPduTasks = reachability.checks
    .filter((check) => check.status === "reachable")
    .slice(0, 20)
    .map((check) => task("pdu", "recommended", `${check.client.label} to ${check.service.toUpperCase()}`, {
      rationale: "Complex PDU verification confirms the application path and creates packet evidence for Activity checks.",
      commands: [`Complex PDU ${check.service.toUpperCase()} from ${check.client.label} to ${check.server?.label ?? "service"}`],
      expected: [`Status delivered via ${check.pathScope}`]
    }));
  const blockedTask = reachability.totals.blocked || reachability.totals.localOnly
    ? [task("config", "required", "Resolve service reachability gaps", {
        rationale: "Blocked or local-only service checks indicate missing gateways, server addresses, or topology paths.",
        commands: ["Tools > Service Reachability 내보내기"],
        expected: [`Blocked ${reachability.totals.blocked}`, `Local-only ${reachability.totals.localOnly}`]
      })]
    : [];
  return [...serverTasks, ...clientPduTasks, ...blockedTask];
}

function serviceVerificationCommands(device: NetworkDevice): string[] {
  const commands = ["Desktop > Services", "Desktop > Command Prompt > Test-NetConnection <server> -Port <port>", "Desktop > Command Prompt > netstat -an", "Desktop > Command Prompt > netstat -ano", "Desktop > Command Prompt > netstat -abno", "Desktop > Command Prompt > tasklist /svc", "Desktop > Command Prompt > Get-NetTCPConnection -State Listen", "Desktop > Command Prompt > Get-Process -Id <pid>", "Desktop > Command Prompt > sc queryex <service>", "show services", "show services summary", "show service logs", "show service logs summary"];
  const services = enabledServiceNames(device);
  if (services.includes("dhcp")) commands.push("show ip dhcp pool", "show ip dhcp pool summary", "show ip dhcp binding", "show ip dhcp binding summary");
  if (services.includes("dns")) commands.push("show hosts", "show hosts summary", "Desktop > Command Prompt > nslookup <record> [dns-server]", "Desktop > Command Prompt > Resolve-DnsName <record> -Server <dns-server> -Type A", "show service logs dns");
  if (services.includes("http")) commands.push("Desktop > Web Browser", "show service logs http");
  if (services.includes("ftp")) commands.push("Desktop > FTP", "show service logs ftp");
  if (services.includes("email")) commands.push("Desktop > Email", "show service logs email");
  if (services.includes("tftp")) commands.push("Desktop > TFTP", "show service logs tftp");
  if (services.includes("syslog")) commands.push("Desktop > Syslog", "show logging", "show service logs syslog");
  return Array.from(new Set(commands));
}

function serviceVerificationExpected(device: NetworkDevice): string[] {
  const expected = enabledServiceNames(device).map((name) => `${name.toUpperCase()} enabled`);
  if (expected.length) expected.push("Desktop Test-NetConnection reports expected TcpTestSucceeded state", "Desktop netstat shows expected listening service ports", "Desktop netstat -ano shows listener PID evidence", "Desktop netstat -abno shows listener process names", "Desktop tasklist /svc maps listener PIDs to service process names", "Desktop Get-NetTCPConnection shows TCP listener owning-process evidence", "Desktop Get-Process -Id confirms listener process identity", "Desktop sc queryex shows service state and PID evidence");
  if (device.config.services.dhcp) expected.push(`${device.config.dhcpPools.filter((pool) => pool.enabled).length}/${device.config.dhcpPools.length} DHCP pools enabled`);
  if (device.config.services.dns) expected.push(`${device.config.dnsRecords.length} DNS records available`, "Desktop Resolve-DnsName returns A/PTR answer records when DNS is reachable", "DNS lookups create DNS service log entries");
  if (device.config.services.http) expected.push("HTTP client request creates a service log entry");
  if (device.config.services.ftp) expected.push("FTP client request creates a service log entry");
  if (device.config.services.email) expected.push("EMAIL client request creates a service log entry");
  if (device.config.services.tftp) expected.push("TFTP client request creates a service log entry");
  if (device.config.services.syslog) expected.push("SYSLOG messages are visible in buffered logs");
  return expected;
}

function wirelessTasks(project: NetworkProject): VerificationTask[] {
  return project.devices
    .filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless"))
    .map((device) => task("cli", "recommended", `Verify wireless settings on ${device.label}`, {
      device,
      rationale: "Wireless links depend on matching SSID, authentication, channel, key, and range.",
      commands: ["Config > 무선", "show interfaces status", "show cdp neighbors"],
      expected: [
        `SSID ${device.config.wireless.ssid || "(blank)"}`,
        `Auth ${device.config.wireless.auth}`,
        `Channel ${device.config.wireless.channel}`
      ]
    }));
}

function resilienceTasks(project: NetworkProject): VerificationTask[] {
  const impact = analyzeFailureImpact(project);
  const critical = [...impact.bridgeLinks, ...impact.criticalDevices].slice(0, 10);
  return [
    task("report", critical.length ? "required" : "optional", "Review failure impact", {
      rationale: "Single points of failure should be intentional and documented in resilient campus, WAN, or service labs.",
      commands: ["Tools > Failure Impact 내보내기"],
      expected: critical.length ? critical.map((scenario) => `${scenario.kind} ${scenario.label}: ${scenario.affectedPairCount} affected pairs`) : ["No endpoint-impacting single failure scenarios detected"]
    })
  ];
}

function configurationTasks(project: NetworkProject): VerificationTask[] {
  const drift = analyzeConfigDrift(project);
  return project.devices
    .filter((device) => isNetworkDevice(device))
    .map((device) => {
      const deviceDrift = drift.devices.find((item) => item.deviceId === device.id);
      return task("config", deviceDrift?.status === "in-sync" ? "recommended" : "required", `Save and compare config on ${device.label}`, {
        device,
        rationale: "Startup-config must match running-config before a lab is submitted or distributed.",
        commands: ["show running-config", "show startup-config", "write memory", "Tools > Configuration Drift 내보내기"],
        expected: [`Drift status ${deviceDrift?.status ?? "unknown"}`]
      });
    });
}

function reportTasks(project: NetworkProject): VerificationTask[] {
  const activity = project.activity;
  return [
    task("report", activity?.requirements.length ? "recommended" : "optional", "Review Activity Wizard score", {
      rationale: "Activity checks turn the verification plan into repeatable scoring criteria.",
      commands: ["Activity Wizard", "Activity Check 내보내기"],
      expected: activity?.requirements.length ? [`${activity.requirements.length} requirements available`] : ["Add requirements for scored labs"]
    })
  ];
}

function verificationSummary(project: NetworkProject, tasks: VerificationTask[]): string[] {
  return [
    `${project.devices.length} devices and ${project.links.length} links are included in the verification scope.`,
    `${tasks.filter((task) => task.priority === "required").length} required tasks should pass before handoff.`,
    `${tasks.filter((task) => task.kind === "cli").length} CLI tasks and ${tasks.filter((task) => task.kind === "pdu").length} PDU tasks were generated.`,
    "Run generated report tasks first, then CLI/config tasks, then PDU and desktop service checks."
  ];
}

function task(kind: VerificationTaskKind, priority: VerificationTaskPriority, title: string, options: { device?: NetworkDevice; commands: string[]; expected: string[]; rationale: string }): VerificationTask {
  return {
    id: `${kind}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    kind,
    priority,
    title,
    deviceId: options.device?.id,
    deviceLabel: options.device?.label,
    commands: options.commands,
    expected: options.expected,
    rationale: options.rationale
  };
}

function renderTask(task: VerificationTask): string[] {
  return [
    `### ${task.title}`,
    `Priority: ${task.priority}${task.deviceLabel ? ` / Device: ${task.deviceLabel}` : ""}`,
    `Rationale: ${task.rationale}`,
    "Commands:",
    ...task.commands.map((command) => `- ${command}`),
    "Expected:",
    ...task.expected.map((item) => `- ${item}`),
    ""
  ];
}

function enabledServiceNames(device: NetworkDevice): Array<keyof NetworkDevice["config"]["services"]> {
  return (Object.entries(device.config.services) as Array<[keyof NetworkDevice["config"]["services"], boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

function isNetworkDevice(device: NetworkDevice): boolean {
  return device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless";
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}
