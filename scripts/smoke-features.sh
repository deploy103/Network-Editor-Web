#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d /tmp/network-feature-smoke-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

"$ROOT/node_modules/.bin/tsc" \
  --target ES2022 \
  --module commonjs \
  --moduleResolution node \
  --skipLibCheck \
  --esModuleInterop \
  --outDir "$TMPDIR" \
	  "$ROOT/web/src/data/sampleProject.ts" \
	  "$ROOT/web/src/data/deviceCatalog.ts" \
	  "$ROOT/web/src/engine/addressPlan.ts" \
	  "$ROOT/web/src/engine/capacityPlan.ts" \
	  "$ROOT/web/src/engine/configDrift.ts" \
	  "$ROOT/web/src/engine/desktopTerminal.ts" \
	  "$ROOT/web/src/engine/diagnostics.ts" \
	  "$ROOT/web/src/engine/failureImpact.ts" \
	  "$ROOT/web/src/engine/projectAudit.ts" \
	  "$ROOT/web/src/engine/projectReport.ts" \
	  "$ROOT/web/src/engine/routingMatrix.ts" \
	  "$ROOT/web/src/engine/securityMatrix.ts" \
	  "$ROOT/web/src/engine/serviceReachability.ts" \
	  "$ROOT/web/src/engine/simulation.ts" \
	  "$ROOT/web/src/engine/topology.ts" \
	  "$ROOT/web/src/engine/verificationPlan.ts" \
	  "$ROOT/web/src/engine/wirelessSurvey.ts" \
	  "$ROOT/web/src/engine/ip.ts" \
	  "$ROOT/web/src/engine/labWorkbook.ts" \
	  "$ROOT/web/src/storage/importPreview.ts" \
  "$ROOT/web/src/storage/normalizeProject.ts" \
  "$ROOT/web/src/utils/id.ts"

node - "$TMPDIR" <<'NODE'
const path = require("path");
const tmpdir = process.argv[2];
const { createRoutedSampleProject, createSampleProjectFromTemplate, sampleProjectTemplates } = require(path.join(tmpdir, "data/sampleProject.js"));
const { createDevice, deviceCatalog, installModule } = require(path.join(tmpdir, "data/deviceCatalog.js"));
const { analyzeAddressPlan, buildAddressPlanReportText } = require(path.join(tmpdir, "engine/addressPlan.js"));
const { analyzeCapacityPlan, buildCapacityPlanReportText } = require(path.join(tmpdir, "engine/capacityPlan.js"));
const { analyzeConfigDrift, buildConfigDriftReportText } = require(path.join(tmpdir, "engine/configDrift.js"));
const { desktopConsoleTargets } = require(path.join(tmpdir, "engine/desktopTerminal.js"));
const { diagnoseProject } = require(path.join(tmpdir, "engine/diagnostics.js"));
const { analyzeFailureImpact, buildFailureImpactReportText } = require(path.join(tmpdir, "engine/failureImpact.js"));
const { analyzeProjectAudit } = require(path.join(tmpdir, "engine/projectAudit.js"));
const { buildProjectReportLines, buildProjectReportText } = require(path.join(tmpdir, "engine/projectReport.js"));
const { analyzeRoutingMatrix, buildRoutingMatrixReportText } = require(path.join(tmpdir, "engine/routingMatrix.js"));
const { analyzeSecurityMatrix, buildSecurityMatrixReportText } = require(path.join(tmpdir, "engine/securityMatrix.js"));
const { analyzeServiceReachability, buildServiceReachabilityReportText } = require(path.join(tmpdir, "engine/serviceReachability.js"));
const { fallbackPing, requestDhcp } = require(path.join(tmpdir, "engine/simulation.js"));
const { buildVerificationPlan, buildVerificationPlanText } = require(path.join(tmpdir, "engine/verificationPlan.js"));
const { analyzeWirelessSurvey, buildWirelessSurveyReportText } = require(path.join(tmpdir, "engine/wirelessSurvey.js"));
const { buildLabWorkbook, buildLabWorkbookText } = require(path.join(tmpdir, "engine/labWorkbook.js"));
const { addLink, endpoint, validateConnection } = require(path.join(tmpdir, "engine/topology.js"));
const { normalizeProject } = require(path.join(tmpdir, "storage/normalizeProject.js"));
const { readImportPreview } = require(path.join(tmpdir, "storage/importPreview.js"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const project = createRoutedSampleProject("user_feature_smoke");
const pc = project.devices.find((device) => device.kind === "pc");
const server = project.devices.find((device) => device.kind === "server");
const router = project.devices.find((device) => device.kind === "router");

assert(pc && server && router, "sample must include PC, server, and router");
assert(server.config.services.dhcp, "sample server DHCP must be enabled");
assert(server.config.services.dns, "sample server DNS must be enabled");
assert(server.config.services.http, "sample server HTTP must be enabled");
assert(server.config.services.ftp, "sample server FTP must be enabled");
assert(server.config.services.email, "sample server EMAIL must be enabled");
assert(server.config.services.tftp, "sample server TFTP must be enabled");
assert(server.config.services.syslog, "sample server SYSLOG must be enabled");
const projectReportText = buildProjectReportText(project, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const projectReportLines = buildProjectReportLines(project, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const addressPlan = analyzeAddressPlan(project);
const addressPlanText = buildAddressPlanReportText(project);
const capacityPlan = analyzeCapacityPlan(project);
const capacityPlanText = buildCapacityPlanReportText(project);
const projectAudit = analyzeProjectAudit(project);
const configDrift = analyzeConfigDrift(project);
const configDriftText = buildConfigDriftReportText(project);
const failureImpact = analyzeFailureImpact(project);
const failureImpactText = buildFailureImpactReportText(project);
const serviceReachability = analyzeServiceReachability(project);
const serviceReachabilityText = buildServiceReachabilityReportText(project);
const securityMatrix = analyzeSecurityMatrix(createSampleProjectFromTemplate("user_feature_smoke", "firewall-dmz"));
const securityMatrixText = buildSecurityMatrixReportText(createSampleProjectFromTemplate("user_feature_smoke", "firewall-dmz"));
const routingMatrix = analyzeRoutingMatrix(project);
const routingMatrixText = buildRoutingMatrixReportText(project);
const verificationPlan = buildVerificationPlan(project);
const verificationPlanText = buildVerificationPlanText(project);
const studentWorkbook = buildLabWorkbook(project, "student");
const instructorWorkbookText = buildLabWorkbookText(project, "instructor");
assert(addressPlan.totals.subnets >= 2 && addressPlan.totals.hosts >= 4, "address plan must discover routed sample subnets and hosts");
assert(addressPlanText.includes("Address Plan") && addressPlanText.includes("Subnets") && addressPlanText.includes("Assignments"), "address plan text must include subnet and assignment sections");
assert(capacityPlan.totals.devices >= 4 && capacityPlan.totals.portsTotal > 0, "capacity plan must summarize devices and ports");
assert(capacityPlanText.includes("Capacity Plan") && capacityPlanText.includes("Device Capacity"), "capacity plan text must include device capacity section");
assert(projectAudit.checks.length >= 10 && projectAudit.categories.some((category) => category.name === "addressing"), "project audit must inspect multiple design categories");
assert(projectAudit.score >= 0 && projectAudit.score <= 100, "project audit score must be bounded");
assert(configDrift.devices.some((device) => device.status === "unsaved"), "config drift must identify unsaved network devices");
assert(configDriftText.includes("Configuration Drift Report") && configDriftText.includes("startup-config is not saved"), "config drift text must include unsaved startup-config details");
assert(failureImpact.endpointCount >= 2 && failureImpact.scenarios.length >= project.links.length, "failure impact must inspect link and device scenarios");
assert(failureImpactText.includes("Failure Impact Report") && failureImpactText.includes("Top Scenarios"), "failure impact text must include scenario output");
assert(serviceReachability.totals.clients >= 2 && serviceReachability.totals.servers >= 1, "service reachability must discover clients and service endpoints");
assert(serviceReachabilityText.includes("Service Reachability Report") && serviceReachabilityText.includes("Checks"), "service reachability text must include check output");
assert(securityMatrix.totals.aclRules >= 2 && securityMatrix.totals.natRules >= 2, "security matrix must discover firewall ACL and NAT policy");
assert(securityMatrixText.includes("Security Matrix") && securityMatrixText.includes("Policies") && securityMatrixText.includes("Service Exposure"), "security matrix text must include policy and exposure sections");
assert(routingMatrix.totals.subnets >= 2 && routingMatrix.coverage.length > 0, "routing matrix must discover subnets and route coverage");
assert(routingMatrixText.includes("Routing Matrix") && routingMatrixText.includes("Device Coverage"), "routing matrix text must include coverage output");
assert(verificationPlan.tasks.length >= 8 && verificationPlan.totals.required >= 1, "verification plan must generate required verification tasks");
assert(verificationPlanText.includes("Verification Plan") && verificationPlanText.includes("CLI Tasks") && verificationPlanText.includes("PDU Tasks"), "verification plan text must include grouped task sections");
assert(studentWorkbook.sections.length >= 8, "lab workbook must generate multiple student sections");
assert(instructorWorkbookText.includes("Instructor Workbook") && instructorWorkbookText.includes("Grading Checklist"), "instructor workbook must include grading checklist");
assert(projectReportText.includes("## Project Summary"), "project report must include a summary section");
assert(projectReportText.includes("## Device Inventory"), "project report must include device inventory");
assert(projectReportText.includes("## Interface Addressing"), "project report must include interface addressing");
assert(projectReportText.includes("## Address Plan") && projectReportText.includes("Subnet Summary"), "project report must include address plan output");
assert(projectReportText.includes("## Capacity Plan") && projectReportText.includes("Device Capacity"), "project report must include capacity plan output");
assert(projectReportText.includes("## Routing Matrix") && projectReportText.includes("Subnet Path Checks"), "project report must include routing matrix output");
assert(projectReportText.includes("## Services"), "project report must include services");
assert(projectReportText.includes("## Service Reachability") && projectReportText.includes("Service Checks"), "project report must include service reachability output");
assert(projectReportText.includes("## Security Matrix") && projectReportText.includes("Policy Matrix"), "project report must include security matrix output");
assert(projectReportText.includes("## Wireless Survey") && projectReportText.includes("Client Coverage"), "project report must include wireless survey output");
assert(projectReportText.includes("## Design Audit") && projectReportText.includes("Category Summary"), "project report must include design audit output");
assert(projectReportText.includes("## Configuration Drift") && projectReportText.includes("Device Status"), "project report must include configuration drift output");
assert(projectReportText.includes("## Failure Impact") && projectReportText.includes("Top Failure Scenarios"), "project report must include failure impact output");
assert(projectReportText.includes("## Verification Plan") && projectReportText.includes("Generated Tasks"), "project report must include verification plan output");
assert(projectReportText.includes("## Lab Workbook") && projectReportText.includes("Student Sections"), "project report must include lab workbook output");
assert(projectReportText.includes("HTTP") && projectReportText.includes("DNS") && projectReportText.includes("DHCP"), "project report must include enabled services");
assert(projectReportLines.some((line) => line.includes("Topology Links")), "project report lines must include topology links");
assert(sampleProjectTemplates.length >= 5, "sample template picker must expose multiple lab templates");
const sampleProjectsByTemplate = Object.fromEntries(sampleProjectTemplates.map((template) => {
  const lab = createSampleProjectFromTemplate("user_feature_smoke", template.id);
  assert(lab.devices.length >= 4, `${template.id} sample must create a realistic device set`);
  assert(lab.links.length >= Math.max(1, lab.devices.length - 2), `${template.id} sample must create useful links`);
  assert(lab.activity && lab.activity.requirements.length >= 3, `${template.id} sample must include Activity Wizard requirements`);
  assert(lab.notes.length >= 1, `${template.id} sample must include workspace documentation`);
  return [template.id, lab];
}));
const ospfCampus = sampleProjectsByTemplate["ospf-campus"];
const ospfKinds = new Set(ospfCampus.activity.requirements.map((requirement) => requirement.kind));
const ospfEdge = ospfCampus.devices.find((device) => device.config.hostname === "EDGE-C1111");
const ospfDistribution = ospfCampus.devices.filter((device) => device.config.hostname.startsWith("DIST-"));
assert(ospfKinds.has("dynamic-routing-count") && ospfKinds.has("vlan-count") && ospfKinds.has("dhcp-snooping-device-count"), "OSPF campus sample must use advanced Activity requirements");
assert(ospfEdge && ospfEdge.config.routingProtocols.some((protocol) => protocol.protocol === "ospf" && protocol.defaultInformationOriginate), "OSPF campus sample must include default-information originate on the edge");
assert(ospfDistribution.length === 2 && ospfDistribution.every((device) => device.config.routingProtocols.some((protocol) => protocol.protocol === "ospf")), "OSPF campus sample must include dual OSPF distribution switches");
assert(ospfCampus.devices.some((device) => device.config.hostname === "ACCESS-9200L" && device.config.dhcpSnooping?.enabled), "OSPF campus sample must include DHCP snooping on access switching");
const dualWanPbr = sampleProjectsByTemplate["dual-wan-pbr"];
const dualWanKinds = new Set(dualWanPbr.activity.requirements.map((requirement) => requirement.kind));
const pbrBranch = dualWanPbr.devices.find((device) => device.config.hostname === "BRANCH-PBR");
assert(dualWanKinds.has("pbr-route-map-count") && dualWanKinds.has("ip-sla-track-count") && dualWanKinds.has("prefix-list-count"), "Dual-WAN sample must use PBR and IP SLA Activity requirements");
assert(pbrBranch && pbrBranch.config.prefixLists.some((entry) => entry.name === "APP-NET"), "Dual-WAN sample must include an application prefix-list");
assert(pbrBranch.config.routeMaps.some((entry) => entry.name === "PBR-APP" && entry.setNextHop === "198.51.100.1"), "Dual-WAN sample must include a policy route-map with backup next-hop");
assert(pbrBranch.config.ipSlaOperations.some((operation) => operation.operationId === 10) && pbrBranch.config.trackObjects.some((track) => track.trackId === 10), "Dual-WAN sample must include IP SLA and track objects");
assert(pbrBranch.config.staticRoutes.some((route) => route.trackId === 10) && pbrBranch.config.staticRoutes.some((route) => route.distance === 200), "Dual-WAN sample must include tracked primary and floating backup defaults");
const firewallDmz = sampleProjectsByTemplate["firewall-dmz"];
const firewallKinds = new Set(firewallDmz.activity.requirements.map((requirement) => requirement.kind));
const dmzFirewall = firewallDmz.devices.find((device) => device.config.hostname === "FPR-DMZ");
assert(firewallKinds.has("acl-rule-count") && firewallKinds.has("nat-rule-count") && firewallKinds.has("routed-port-count"), "DMZ sample must use security Activity requirements");
assert(dmzFirewall && dmzFirewall.kind === "firewall", "DMZ sample must include a firewall device");
assert(dmzFirewall.config.accessRules.some((rule) => rule.listName === "OUTSIDE-IN" && rule.protocol === "http"), "DMZ sample must include outside HTTP ACL policy");
assert(dmzFirewall.config.natRules.some((rule) => rule.type === "static" && rule.insideGlobal === "203.0.113.10"), "DMZ sample must publish the DMZ server with static NAT");
assert(dmzFirewall.ports.some((port) => port.natRole === "inside") && dmzFirewall.ports.some((port) => port.natRole === "outside"), "DMZ sample must mark inside and outside NAT roles");
const wirelessCampus = sampleProjectsByTemplate["wireless-campus"];
const wirelessKinds = new Set(wirelessCampus.activity.requirements.map((requirement) => requirement.kind));
const wirelessSurvey = analyzeWirelessSurvey(wirelessCampus);
const wirelessSurveyText = buildWirelessSurveyReportText(wirelessCampus);
assert(wirelessKinds.has("wireless-infrastructure-count") && wirelessKinds.has("wireless-client-count") && wirelessKinds.has("dhcp-pool-count"), "wireless campus sample must use wireless Activity requirements");
assert(wirelessCampus.devices.some((device) => device.modelId === "wlc-9800-l"), "wireless campus sample must include a Catalyst 9800 controller");
assert(wirelessCampus.devices.some((device) => device.modelId === "ap-catalyst-9120axi"), "wireless campus sample must include a Catalyst AP");
assert(wirelessCampus.devices.some((device) => device.ports.some((port) => port.kind === "wireless" && port.ipAddress === "10.60.60.50")), "wireless campus sample must include an addressed wireless client");
assert(wirelessCampus.devices.some((device) => device.config.dhcpPools.some((pool) => pool.name === "WLAN-USERS")), "wireless campus sample must include WLAN DHCP service");
assert(wirelessSurvey.totals.controllers >= 1 && wirelessSurvey.totals.accessPoints >= 1, "wireless survey must discover controllers and APs");
assert(wirelessSurvey.totals.clients >= 1 && wirelessSurvey.ssids.some((ssid) => ssid.ssid === "Lab-Wireless"), "wireless survey must discover WLAN clients and SSIDs");
assert(wirelessSurvey.coverage.length >= 1 && wirelessSurvey.dhcp.some((entry) => entry.status === "covered"), "wireless survey must evaluate coverage and DHCP");
assert(wirelessSurveyText.includes("Wireless Survey") && wirelessSurveyText.includes("SSID Profiles") && wirelessSurveyText.includes("Action Checklist"), "wireless survey text must include operational sections");
assert(deviceCatalog.some((model) => model.id === "router-4321"), "device catalog must include Cisco ISR 4321");
assert(deviceCatalog.some((model) => model.id === "router-4451"), "device catalog must include Cisco ISR 4451-X");
assert(deviceCatalog.some((model) => model.id === "switch-2960x-24ps"), "device catalog must include Catalyst 2960X-24PS");
assert(deviceCatalog.some((model) => model.id === "switch-3650-24ps"), "device catalog must include Catalyst 3650-24PS");
assert(deviceCatalog.some((model) => model.id === "switch-3850-48p"), "device catalog must include Catalyst 3850-48P");
assert(deviceCatalog.some((model) => model.id === "switch-9200l-48p-4x"), "device catalog must include fixed-uplink Catalyst 9200L models");
assert(deviceCatalog.some((model) => model.id === "switch-9300-48p"), "device catalog must include Catalyst 9300 modular models");
assert(deviceCatalog.some((model) => model.id === "switch-9500-32c"), "device catalog must include Catalyst 9500 distribution models");
assert(deviceCatalog.some((model) => model.id === "firewall-fpr1010"), "device catalog must include Firepower firewall models");
assert(deviceCatalog.some((model) => model.id === "ap-catalyst-9120axi"), "device catalog must include Catalyst wireless AP models");
assert(deviceCatalog.some((model) => model.id === "wlc-9800-l"), "device catalog must include Catalyst 9800 WLC models");

const isr4321 = createDevice("router-4321", { x: 10, y: 20 }, []);
assert(isr4321.ports.some((port) => port.name === "GigabitEthernet0/0/0"), "ISR 4321 must expose IOS XE style onboard GE names");
assert(isr4321.ports.some((port) => port.name === "GigabitEthernet0/0/1"), "ISR 4321 must include the second onboard GE port");
let cold4321 = { ...isr4321, powerOn: false };
const nimSerialInstall = installModule(cold4321, "slot0", "NIM-2T");
assert(nimSerialInstall.ok && nimSerialInstall.device.ports.some((port) => port.name === "Serial0/0/0"), "ISR 4321 must accept NIM-2T and create serial ports");
const compactReject = installModule(cold4321, "slot1", "NIM-8MFT-T1/E1");
assert(!compactReject.ok, "compact ISR 4321 must reject high-density NIM-8MFT-T1/E1 modules");
const isr4451 = createDevice("router-4451", { x: 12, y: 24 }, []);
let cold4451 = { ...isr4451, powerOn: false };
const highDensityNim = installModule(cold4451, "slot0", "NIM-8MFT-T1/E1");
assert(highDensityNim.ok && highDensityNim.device.ports.some((port) => port.name === "Serial0/0/7:0"), "ISR 4451-X must accept high-density NIM-8MFT-T1/E1 and create channelized serial ports");
cold4451 = highDensityNim.device;
const dualGeNim = installModule(cold4451, "slot1", "NIM-2GE-CU-SFP");
assert(dualGeNim.ok && dualGeNim.device.ports.some((port) => port.name === "GigabitEthernet0/1/1" && port.kind === "fiber"), "ISR 4451-X must accept NIM-2GE-CU-SFP and create routed SFP-capable GE ports");

const cat2960x = createDevice("switch-2960x-24ps", { x: 20, y: 20 }, []);
assert(cat2960x.ports.filter((port) => port.kind === "gigabit-ethernet").length >= 24, "2960X-24PS must expose 24 Gigabit access ports");
assert(cat2960x.ports.filter((port) => port.kind === "fiber").length === 4, "2960X-24PS must expose 4 SFP uplinks");

const cat3750x = createDevice("switch-3750x-24t", { x: 30, y: 20 }, []);
const c3kxInstall = installModule({ ...cat3750x, powerOn: false }, "slot1", "C3KX-NM-10GT");
assert(c3kxInstall.ok && c3kxInstall.device.ports.some((port) => port.name.startsWith("TenGigabitEthernet1/1/")), "3750X must accept C3KX 10G network modules");

const cat3850 = createDevice("switch-3850-48p", { x: 35, y: 20 }, []);
const c3850Install = installModule({ ...cat3850, powerOn: false }, "slot1", "C3850-NM-4-10G");
assert(c3850Install.ok && c3850Install.device.ports.some((port) => port.name === "TenGigabitEthernet1/1/4"), "3850 must accept C3850 10G network modules and expose TenGigabit uplinks");

const cat3650 = createDevice("switch-3650-24ps", { x: 40, y: 20 }, []);
assert(cat3650.ports.some((port) => port.name === "Vlan1" && port.ipCapable), "3650 must expose a routed SVI for multilayer labs");
assert(cat3650.ports.some((port) => port.name === "GigabitEthernet1/1/1"), "3650 must expose modular-style SFP uplink names");

const cat9200l = createDevice("switch-9200l-48p-4x", { x: 45, y: 20 }, []);
assert(cat9200l.modules.length === 0, "Catalyst 9200L fixed-uplink models must not expose removable network modules");
assert(cat9200l.ports.filter((port) => port.name.startsWith("TenGigabitEthernet1/1/")).length === 4, "Catalyst 9200L-48P-4X must expose four fixed 10G SFP+ uplinks");

const cat9200 = createDevice("switch-9200-24p", { x: 50, y: 20 }, []);
const c9200Install = installModule({ ...cat9200, powerOn: false }, "slot1", "C9200-NM-4X");
assert(c9200Install.ok && c9200Install.device.ports.some((port) => port.name === "TenGigabitEthernet1/1/4"), "Catalyst 9200 must accept C9200 10G network modules");
const c9200Reject = installModule({ ...cat9200, powerOn: false }, "slot1", "C9300-NM-8X");
assert(!c9200Reject.ok, "Catalyst 9200 must reject Catalyst 9300-only network modules");

const cat9300 = createDevice("switch-9300-48p", { x: 55, y: 20 }, []);
const c9300Install = installModule({ ...cat9300, powerOn: false }, "slot1", "C9300-NM-8X");
assert(c9300Install.ok && c9300Install.device.ports.filter((port) => port.name.startsWith("TenGigabitEthernet1/1/")).length === 8, "Catalyst 9300 must accept C9300 8x10G network modules");

const cat9500 = createDevice("switch-9500-32c", { x: 60, y: 20 }, []);
assert(cat9500.modules.length === 0, "Catalyst 9500 fixed distribution models must not expose removable network modules");
assert(cat9500.ports.filter((port) => port.name.startsWith("HundredGigabitEthernet1/0/") && port.ipCapable).length === 32, "Catalyst 9500-32C must expose routed 100G fiber ports");

const firepower = createDevice("firewall-fpr1010", { x: 65, y: 20 }, []);
assert(firepower.kind === "firewall" && firepower.ports.some((port) => port.name === "Ethernet1/1"), "Firepower 1010 must expose routed Ethernet firewall ports");

const catalystAp = createDevice("ap-catalyst-9120axi", { x: 70, y: 20 }, []);
assert(catalystAp.ports.some((port) => port.kind === "wireless") && catalystAp.ports.some((port) => port.name === "GigabitEthernet0"), "Catalyst AP must expose wired and wireless ports");

const wlc9800 = createDevice("wlc-9800-l", { x: 75, y: 20 }, []);
assert(wlc9800.ports.some((port) => port.name === "TenGigabitEthernet0/0/0" && port.ipCapable), "Catalyst 9800-L WLC must expose routed 10G management uplinks");
assert(project.activity && project.activity.requirements.some((requirement) => requirement.kind === "device-count" && requirement.target === 4), "sample project must include Activity Wizard requirements");
assert(project.activity.requirements.some((requirement) => requirement.kind === "tdr-normal-count" && requirement.target === 3), "sample project must include Activity Wizard TDR requirements");
assert(router.ports.some((port) => (port.helperAddresses || []).includes("10.10.10.10")), "router must include DHCP helper-address");
assert((server.config.dhcpExcludedRanges || []).some((range) => range.startIp === "192.168.10.1" && range.endIp === "192.168.10.20"), "sample server must include DHCP excluded range");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP helper")), "routed sample must not report DHCP helper diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP 제외")), "routed sample must not report DHCP excluded range diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("서비스에 접근 가능한 IP")), "routed sample services must have reachable server IPs");

const natOutsidePort = router.ports.find((port) => port.ipAddress === "10.10.10.1");
assert(natOutsidePort, "routed sample router must expose the server-facing outside NAT port");
let patProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.ipAddress === "192.168.10.1"
          ? { ...port, natRole: "inside" }
          : port.ipAddress === "10.10.10.1"
            ? { ...port, natRole: "outside" }
            : port),
        config: {
          ...device.config,
          accessRules: [
            ...device.config.accessRules,
            { id: "acl_pat_smoke", listName: "10", listType: "standard", interfaceName: "10", action: "permit", protocol: "ip", source: "192.168.10.0 0.0.0.255", destination: "any", sequence: 10, hits: 0 }
          ],
          natRules: [
            ...device.config.natRules,
            { id: "nat_pat_smoke", insideLocal: "list 10", insideGlobal: `interface ${natOutsidePort.name}`, outsideInterface: natOutsidePort.name, type: "overload", aclName: "10", interfaceName: natOutsidePort.name, overload: true, hits: 0 }
          ]
        }
      }
    : device)
};
const patPing = fallbackPing(patProject, pc.id, server.id);
const patRouter = patPing.project.devices.find((device) => device.id === router.id);
assert(patPing.success, "PAT sample ping must still be routed successfully");
assert(patRouter.runtime.natTranslations.some((entry) => entry.insideLocal === "192.168.10.10" && entry.insideGlobal === "10.10.10.1"), "PAT simulation must create an overload translation on the outside interface IP");
assert(patRouter.config.natRules.some((rule) => rule.id === "nat_pat_smoke" && rule.hits === 1), "PAT simulation must increment overload NAT rule hits");

const hsrpPcPort = pc.ports.find((port) => port.kind !== "console");
const routerLanPort = router.ports.find((port) => port.ipAddress === "192.168.10.1");
assert(hsrpPcPort && routerLanPort, "HSRP smoke must find PC data port and router LAN interface");
const hsrpProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.id === hsrpPcPort.id ? { ...port, gateway: "192.168.10.254" } : port) }
    : device.id === router.id
      ? { ...device, ports: device.ports.map((port) => port.id === routerLanPort.id ? { ...port, hsrpGroups: [{ group: 1, virtualIp: "192.168.10.254", priority: 110, preempt: true, version: "2", trackInterface: "GigabitEthernet0/1", trackDecrement: 20 }] } : port) }
      : device)
};
const hsrpPing = fallbackPing(hsrpProject, pc.id, server.id);
assert(hsrpPing.success, "HSRP virtual gateway must route host traffic when no physical gateway owns the virtual IP");
assert(!diagnoseProject(hsrpProject).some((issue) => issue.severity === "error" && issue.title.includes("HSRP")), "valid HSRP virtual gateway must not produce HSRP error diagnostics");

const vrrpProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.id === hsrpPcPort.id ? { ...port, gateway: "192.168.10.253" } : port) }
    : device.id === router.id
      ? { ...device, ports: device.ports.map((port) => port.id === routerLanPort.id ? { ...port, vrrpGroups: [{ group: 1, virtualIp: "192.168.10.253", priority: 120, preempt: true, version: "3", advertiseInterval: 2 }] } : port) }
      : device)
};
const vrrpPing = fallbackPing(vrrpProject, pc.id, server.id);
assert(vrrpPing.success, "VRRP virtual gateway must route host traffic when no physical gateway owns the virtual IP");
assert(!diagnoseProject(vrrpProject).some((issue) => issue.severity === "error" && issue.title.includes("VRRP")), "valid VRRP virtual gateway must not produce VRRP error diagnostics");

const secondaryGatewayProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.id === hsrpPcPort.id ? { ...port, ipAddress: "192.168.20.10", subnetMask: "255.255.255.0", gateway: "192.168.20.1" } : port) }
    : device.id === router.id
      ? { ...device, ports: device.ports.map((port) => port.id === routerLanPort.id ? { ...port, secondaryIpAddresses: [{ ipAddress: "192.168.20.1", subnetMask: "255.255.255.0" }] } : port) }
      : device)
};
const secondaryGatewayPing = fallbackPing(secondaryGatewayProject, pc.id, server.id);
assert(secondaryGatewayPing.success, "secondary interface IP must work as a host default gateway in simulation");

const rosPc = createDevice("pc-pt", { x: 20, y: 420 }, []);
const rosSwitch = createDevice("switch-2960-24tt", { x: 190, y: 420 }, [rosPc]);
const rosRouter = createDevice("router-1941", { x: 360, y: 420 }, [rosPc, rosSwitch]);
const rosServerBase = createDevice("server-pt", { x: 530, y: 420 }, [rosPc, rosSwitch, rosRouter]);
const rosPcPort = rosPc.ports.find((port) => port.kind !== "console");
const rosSwitchPorts = rosSwitch.ports.filter((port) => port.kind !== "console");
const rosRouterEthPorts = rosRouter.ports.filter((port) => port.kind !== "console" && port.kind !== "serial");
const rosServerPort = rosServerBase.ports.find((port) => port.kind !== "console");
assert(rosPcPort && rosSwitchPorts.length >= 2 && rosRouterEthPorts.length >= 2 && rosServerPort, "router-on-a-stick smoke must have enough Ethernet ports");
const rosRouterLanParent = rosRouterEthPorts[0];
const rosRouterServerPort = rosRouterEthPorts[1];
const rosSubinterface = {
  ...rosRouterLanParent,
  id: "ros_subif_40",
  name: `${rosRouterLanParent.name}.40`,
  mode: "routed",
  vlan: 40,
  allowedVlans: [40],
  nativeVlan: 40,
  ipAddress: "172.16.40.1",
  subnetMask: "255.255.255.0",
  parentPortId: rosRouterLanParent.id,
  subinterfaceVlan: 40,
  encapsulationDot1qNative: false,
  linkId: undefined,
  ipCapable: true
};
let routerOnStickProject = {
  id: "project_router_on_stick",
  ownerId: "user_feature_smoke",
  name: "Router-on-a-stick smoke",
  devices: [
    { ...rosPc, ports: rosPc.ports.map((port) => port.id === rosPcPort.id ? { ...port, vlan: 40, ipAddress: "172.16.40.10", subnetMask: "255.255.255.0", gateway: "172.16.40.1" } : port) },
    { ...rosSwitch, config: { ...rosSwitch.config, vlans: [{ id: 1, name: "default" }, { id: 40, name: "USERS40" }] }, ports: rosSwitch.ports.map((port) => port.id === rosSwitchPorts[0].id ? { ...port, mode: "access", vlan: 40 } : port.id === rosSwitchPorts[1].id ? { ...port, mode: "trunk", allowedVlans: [40], nativeVlan: 1 } : port) },
    {
      ...rosRouter,
      ports: [
        ...rosRouter.ports.map((port) => port.id === rosRouterLanParent.id
          ? { ...port, mode: "routed", vlan: 40, allowedVlans: [40], ipCapable: true }
          : port.id === rosRouterServerPort.id
            ? { ...port, mode: "routed", vlan: 1, allowedVlans: [1], ipAddress: "10.40.0.1", subnetMask: "255.255.255.0", ipCapable: true }
            : port),
        rosSubinterface
      ]
    },
    { ...rosServerBase, ports: rosServerBase.ports.map((port) => port.id === rosServerPort.id ? { ...port, ipAddress: "10.40.0.10", subnetMask: "255.255.255.0", gateway: "10.40.0.1" } : port) }
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
let rosLink = validateConnection(routerOnStickProject, rosPc.id, rosSwitch.id, "auto", rosPcPort.id, rosSwitchPorts[0].id);
assert(rosLink.link, "router-on-a-stick PC access link must validate");
routerOnStickProject = addLink(routerOnStickProject, rosLink.link);
rosLink = validateConnection(routerOnStickProject, rosSwitch.id, rosRouter.id, "auto", rosSwitchPorts[1].id, rosRouterLanParent.id);
assert(rosLink.link, "router-on-a-stick trunk parent link must validate");
routerOnStickProject = addLink(routerOnStickProject, rosLink.link);
rosLink = validateConnection(routerOnStickProject, rosRouter.id, rosServerBase.id, "auto", rosRouterServerPort.id, rosServerPort.id);
assert(rosLink.link, "router-on-a-stick routed server link must validate");
routerOnStickProject = addLink(routerOnStickProject, rosLink.link);
const routerOnStickPing = fallbackPing(routerOnStickProject, rosPc.id, rosServerBase.id);
assert(routerOnStickPing.success, "router-on-a-stick subinterface must route VLAN-tagged host traffic through the switch trunk");
assert(!diagnoseProject(routerOnStickProject).some((issue) => issue.severity === "error" && issue.title.includes("parent 인터페이스")), "valid router-on-a-stick subinterface must not report parent interface errors");

const pbrClient = createDevice("pc-pt", { x: 20, y: 560 }, []);
const pbrR1 = createDevice("router-2911", { x: 190, y: 560 }, [pbrClient]);
const pbrR2 = createDevice("router-1941", { x: 360, y: 500 }, [pbrClient, pbrR1]);
const pbrR3 = createDevice("router-1941", { x: 360, y: 620 }, [pbrClient, pbrR1, pbrR2]);
const pbrTarget = createDevice("server-pt", { x: 530, y: 620 }, [pbrClient, pbrR1, pbrR2, pbrR3]);
const pbrClientPort = pbrClient.ports.find((port) => port.kind !== "console");
const pbrR1Ports = pbrR1.ports.filter((port) => port.kind !== "console" && port.kind !== "serial");
const pbrR2Port = pbrR2.ports.find((port) => port.kind !== "console" && port.kind !== "serial");
const pbrR3Ports = pbrR3.ports.filter((port) => port.kind !== "console" && port.kind !== "serial");
const pbrTargetPort = pbrTarget.ports.find((port) => port.kind !== "console");
assert(pbrClientPort && pbrR1Ports.length >= 3 && pbrR2Port && pbrR3Ports.length >= 2 && pbrTargetPort, "PBR smoke must have enough Ethernet ports");
const pbrR1Lan = pbrR1Ports[0];
const pbrR1BadNextHop = pbrR1Ports[1];
const pbrR1PolicyNextHop = pbrR1Ports[2];
const pbrR3ToR1 = pbrR3Ports[0];
const pbrR3ToTarget = pbrR3Ports[1];
let pbrProject = {
  id: "project_pbr_smoke",
  ownerId: "user_feature_smoke",
  name: "PBR smoke",
  devices: [
    { ...pbrClient, ports: pbrClient.ports.map((port) => port.id === pbrClientPort.id ? { ...port, ipAddress: "192.168.1.10", subnetMask: "255.255.255.0", gateway: "192.168.1.1" } : port) },
    {
      ...pbrR1,
      ports: pbrR1.ports.map((port) => port.id === pbrR1Lan.id
        ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "192.168.1.1", subnetMask: "255.255.255.0", policyRouteMap: "PBR" }
        : port.id === pbrR1BadNextHop.id
          ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.12.0.1", subnetMask: "255.255.255.0" }
          : port.id === pbrR1PolicyNextHop.id
            ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.13.0.1", subnetMask: "255.255.255.0" }
            : port),
      config: {
        ...pbrR1.config,
        accessRules: [{ id: "acl_pbr_smoke", listName: "101", listType: "extended", interfaceName: "101", action: "permit", protocol: "ip", source: "192.168.1.0 0.0.0.255", destination: "10.30.0.0 0.0.0.255", sequence: 10, hits: 0 }],
        prefixLists: [{ id: "plist_pbr_smoke", name: "DST30", sequence: 5, action: "permit", prefix: "10.30.0.0/24", hits: 0 }],
        routeMaps: [{ id: "rmap_pbr_smoke", name: "PBR", sequence: 10, action: "permit", matchAccessLists: ["101"], matchPrefixLists: ["DST30"], setNextHop: "10.13.0.3", hits: 0 }],
        staticRoutes: [{ id: "route_pbr_bad_static", network: "10.30.0.0", mask: "255.255.255.0", nextHop: "10.12.0.2" }]
      }
    },
    { ...pbrR2, ports: pbrR2.ports.map((port) => port.id === pbrR2Port.id ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.12.0.2", subnetMask: "255.255.255.0" } : port) },
    { ...pbrR3, ports: pbrR3.ports.map((port) => port.id === pbrR3ToR1.id ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.13.0.3", subnetMask: "255.255.255.0" } : port.id === pbrR3ToTarget.id ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.30.0.1", subnetMask: "255.255.255.0" } : port) },
    { ...pbrTarget, ports: pbrTarget.ports.map((port) => port.id === pbrTargetPort.id ? { ...port, ipAddress: "10.30.0.10", subnetMask: "255.255.255.0", gateway: "10.30.0.1" } : port) }
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
for (const [leftDevice, rightDevice, leftPort, rightPort, label] of [
  [pbrClient, pbrR1, pbrClientPort, pbrR1Lan, "client to PBR ingress"],
  [pbrR1, pbrR2, pbrR1BadNextHop, pbrR2Port, "R1 to static next-hop"],
  [pbrR1, pbrR3, pbrR1PolicyNextHop, pbrR3ToR1, "R1 to PBR next-hop"],
  [pbrR3, pbrTarget, pbrR3ToTarget, pbrTargetPort, "PBR next-hop to target"]
]) {
  const connection = validateConnection(pbrProject, leftDevice.id, rightDevice.id, "auto", leftPort.id, rightPort.id);
  assert(connection.link, `PBR ${label} link must validate`);
  pbrProject = addLink(pbrProject, connection.link);
}
const pbrPing = fallbackPing(pbrProject, pbrClient.id, pbrTarget.id);
const pbrR1AfterPing = pbrPing.project.devices.find((device) => device.id === pbrR1.id);
assert(pbrPing.success, "PBR must override the normal static route and deliver traffic through the policy next-hop");
assert(pbrR1AfterPing, "PBR smoke must preserve R1 after ping");
assert(pbrR1AfterPing.config.routeMaps.some((entry) => entry.id === "rmap_pbr_smoke" && entry.hits === 1), "PBR simulation must increment matching route-map hits");
assert(pbrR1AfterPing.config.accessRules.some((rule) => rule.id === "acl_pbr_smoke" && rule.hits === 1), "PBR simulation must increment the ACL rule used by match ip address");
assert(pbrR1AfterPing.config.prefixLists.some((entry) => entry.id === "plist_pbr_smoke" && entry.hits === 1), "PBR simulation must increment the prefix-list entry used by match ip address prefix-list");
assert(!diagnoseProject(pbrProject).some((issue) => issue.title.includes("route-map") && issue.severity === "error"), "valid PBR topology must not produce route-map error diagnostics");

const trackClient = createDevice("pc-pt", { x: 20, y: 720 }, []);
const trackR1 = createDevice("router-2911", { x: 190, y: 720 }, [trackClient]);
const trackR2 = createDevice("router-1941", { x: 360, y: 660 }, [trackClient, trackR1]);
const trackR3 = createDevice("router-1941", { x: 360, y: 780 }, [trackClient, trackR1, trackR2]);
const trackTarget = createDevice("server-pt", { x: 530, y: 780 }, [trackClient, trackR1, trackR2, trackR3]);
const trackClientPort = trackClient.ports.find((port) => port.kind !== "console");
const trackR1Ports = trackR1.ports.filter((port) => port.kind !== "console" && port.kind !== "serial");
const trackR2Port = trackR2.ports.find((port) => port.kind !== "console" && port.kind !== "serial");
const trackR3Ports = trackR3.ports.filter((port) => port.kind !== "console" && port.kind !== "serial");
const trackTargetPort = trackTarget.ports.find((port) => port.kind !== "console");
assert(trackClientPort && trackR1Ports.length >= 3 && trackR2Port && trackR3Ports.length >= 2 && trackTargetPort, "tracked static route smoke must have enough Ethernet ports");
const trackR1Lan = trackR1Ports[0];
const trackR1Primary = trackR1Ports[1];
const trackR1Backup = trackR1Ports[2];
const trackR3ToR1 = trackR3Ports[0];
const trackR3ToTarget = trackR3Ports[1];
let trackedRouteProject = {
  id: "project_tracked_route_smoke",
  ownerId: "user_feature_smoke",
  name: "Tracked static route failover smoke",
  devices: [
    { ...trackClient, ports: trackClient.ports.map((port) => port.id === trackClientPort.id ? { ...port, ipAddress: "192.168.50.10", subnetMask: "255.255.255.0", gateway: "192.168.50.1" } : port) },
    {
      ...trackR1,
      ports: trackR1.ports.map((port) => port.id === trackR1Lan.id
        ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "192.168.50.1", subnetMask: "255.255.255.0" }
        : port.id === trackR1Primary.id
          ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.12.0.1", subnetMask: "255.255.255.0" }
          : port.id === trackR1Backup.id
            ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.13.0.1", subnetMask: "255.255.255.0" }
            : port),
      config: {
        ...trackR1.config,
        staticRoutes: [
          { id: "route_track_primary_smoke", network: "10.50.0.0", mask: "255.255.255.0", nextHop: "10.12.0.2", distance: 1, trackId: 1 },
          { id: "route_track_backup_smoke", network: "10.50.0.0", mask: "255.255.255.0", nextHop: "10.13.0.3", distance: 200 }
        ],
        ipSlaOperations: [{ id: "sla_track_smoke", operationId: 1, type: "icmp-echo", targetIp: "10.12.0.99", sourceInterface: trackR1Primary.name, frequency: 5, timeout: 1000, threshold: 1000, enabled: true }],
        trackObjects: [{ id: "track_ip_sla_smoke", trackId: 1, type: "ip-sla", ipSlaOperationId: 1, mode: "reachability" }]
      }
    },
    { ...trackR2, ports: trackR2.ports.map((port) => port.id === trackR2Port.id ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.12.0.2", subnetMask: "255.255.255.0" } : port) },
    {
      ...trackR3,
      ports: trackR3.ports.map((port) => port.id === trackR3ToR1.id
        ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.13.0.3", subnetMask: "255.255.255.0" }
        : port.id === trackR3ToTarget.id
          ? { ...port, mode: "routed", allowedVlans: [1], ipAddress: "10.50.0.1", subnetMask: "255.255.255.0" }
          : port),
      config: { ...trackR3.config, staticRoutes: [{ id: "route_track_return_smoke", network: "192.168.50.0", mask: "255.255.255.0", nextHop: "10.13.0.1" }] }
    },
    { ...trackTarget, ports: trackTarget.ports.map((port) => port.id === trackTargetPort.id ? { ...port, ipAddress: "10.50.0.10", subnetMask: "255.255.255.0", gateway: "10.50.0.1" } : port) }
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
for (const [leftDevice, rightDevice, leftPort, rightPort, label] of [
  [trackClient, trackR1, trackClientPort, trackR1Lan, "client to R1"],
  [trackR1, trackR2, trackR1Primary, trackR2Port, "R1 to primary next-hop"],
  [trackR1, trackR3, trackR1Backup, trackR3ToR1, "R1 to backup next-hop"],
  [trackR3, trackTarget, trackR3ToTarget, trackTargetPort, "backup next-hop to target"]
]) {
  const connection = validateConnection(trackedRouteProject, leftDevice.id, rightDevice.id, "auto", leftPort.id, rightPort.id);
  assert(connection.link, `tracked static route ${label} link must validate`);
  trackedRouteProject = addLink(trackedRouteProject, connection.link);
}
const trackedRoutePing = fallbackPing(trackedRouteProject, trackClient.id, trackTarget.id);
assert(trackedRoutePing.success, "tracked static route must ignore the down primary track and deliver traffic over the floating backup route");
assert(!diagnoseProject(trackedRouteProject).some((issue) => issue.title.includes("track object가 없습니다") || issue.title.includes("IP SLA operation이 없습니다")), "valid tracked static route topology must not report missing track diagnostics");

const normalized = normalizeProject({
  ...project,
  notes: [{ id: "note_smoke", text: "Smoke note", position: { x: 42, y: 84 }, color: "green" }],
  drawings: [
    { id: "draw_smoke", kind: "ellipse", label: "Smoke zone", position: { x: 140, y: 180 }, width: 260, height: 120, color: "blue", strokeStyle: "dashed", fill: true },
    { id: "draw_freehand_smoke", kind: "freehand", label: "Smoke freehand", position: { x: 220, y: 240 }, width: 180, height: 90, points: [{ x: 0, y: 20 }, { x: 70, y: 8 }, { x: 180, y: 82 }], color: "rose", strokeStyle: "solid", fill: false }
  ],
  simulationEvents: [{ id: "evt_header_smoke", time: Date.now(), lastDeviceId: pc.id, atDeviceId: server.id, sourceDeviceId: pc.id, targetDeviceId: server.id, packetId: "packet_header_smoke", type: "HTTP", info: "HTTP header smoke", status: "delivered", osiLayers: ["Layer 7", "Layer 4", "Layer 3"], headers: [{ layer: "Layer 4", field: "Ports", value: "80" }, { layer: "Layer 7", field: "Application", value: "HTTP" }] }],
  activity: {
    ...project.activity,
    commandRules: [{ id: "act_cmd_smoke", label: "Hostname saved", deviceId: router.id, command: "hostname", points: 5 }],
    commandSequences: [{ id: "act_seq_smoke", label: "Interface sequence", deviceId: router.id, commands: ["interface", "ip address"], points: 10 }],
    commandOutputAssertions: [{ id: "act_out_smoke", label: "Show version register", deviceId: router.id, commands: ["show version"], expectedText: "Configuration register", points: 10 }],
    interfaceExpectations: [{ id: "act_int_smoke", label: "PC IP", deviceId: pc.id, portId: pc.ports.find((port) => port.kind !== "console").id, ipAddress: "192.168.10.10", subnetMask: "255.255.255.0", mode: "access", vlan: 1, points: 5 }],
    headerAssertions: [{ id: "act_hdr_smoke", label: "HTTP port", protocol: "HTTP", field: "Ports", value: "80", points: 5 }],
    answerSnapshot: {
      capturedAt: new Date().toISOString(),
      devices: project.devices.map((device) => ({ id: device.id, label: device.label, kind: device.kind, model: device.model })),
      links: project.links.map((link) => ({ id: link.id, type: link.type, endpointADeviceId: link.endpointA.deviceId, endpointBDeviceId: link.endpointB.deviceId })),
      annotationCount: 2,
      serviceDeviceIds: [server.id],
      startupConfigDeviceIds: []
    }
  },
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, runtime: { ...device.runtime, logs: [{ id: "log_normalize", level: "info", message: "normalize syslog", createdAt: Date.now() }] } }
    : device.id === router.id
      ? {
          ...device,
          ports: device.ports.map((port) => port.id === routerLanPort.id ? { ...port, secondaryIpAddresses: [{ ipAddress: "192.168.20.1", subnetMask: "255.255.255.0" }], hsrpGroups: [{ group: 1, virtualIp: "192.168.10.254", priority: 110, preempt: true, version: "2", trackObject: 1, trackDecrement: 20 }], vrrpGroups: [{ group: 2, virtualIp: "192.168.10.253", priority: 120, preempt: true, version: "3", advertiseInterval: 2, trackObject: 1, trackDecrement: 15 }], policyRouteMap: "PBR-NORMALIZE" } : port),
          config: {
            ...device.config,
            staticRoutes: [...device.config.staticRoutes, { id: "route_distance_smoke", network: "172.16.0.0", mask: "255.255.0.0", nextHop: "10.10.10.2", distance: 200 }, { id: "route_track_normalize_smoke", network: "172.31.0.0", mask: "255.255.0.0", nextHop: "10.10.10.2", distance: 210, trackId: 1 }],
            prefixLists: [{ id: "plist_normalize_smoke", name: "DST-NORMALIZE", sequence: 5, action: "permit", prefix: "172.16.0.0/16", le: 24, hits: 3 }],
            routeMaps: [{ id: "rmap_normalize_smoke", name: "PBR-NORMALIZE", sequence: 10, action: "permit", matchAccessLists: ["101"], matchPrefixLists: ["DST-NORMALIZE"], setNextHop: "10.10.10.2", hits: 7 }],
            ipSlaOperations: [{ id: "sla_normalize_smoke", operationId: 1, type: "icmp-echo", targetIp: "10.10.10.10", sourceInterface: routerLanPort.name, frequency: 10, timeout: 1000, threshold: 1000, enabled: true }],
            trackObjects: [{ id: "track_normalize_smoke", trackId: 1, type: "ip-sla", ipSlaOperationId: 1, mode: "reachability" }]
          }
        }
    : device)
});
const normalizedServer = normalized.devices.find((device) => device.id === server.id);
const normalizedRouter = normalized.devices.find((device) => device.id === router.id);
assert(normalizedServer.config.services.ftp && normalizedServer.config.services.email && normalizedServer.config.services.tftp && normalizedServer.config.services.syslog, "normalizeProject must preserve FTP, EMAIL, TFTP, and SYSLOG service flags");
assert(normalizedServer.config.dhcpExcludedRanges.some((range) => range.startIp === "192.168.10.1"), "normalizeProject must preserve DHCP excluded ranges");
assert(normalizedServer.runtime.logs.some((log) => log.message === "normalize syslog"), "normalizeProject must preserve runtime syslog logs");
assert(normalizedRouter.ports.some((port) => (port.helperAddresses || []).includes("10.10.10.10")), "normalizeProject must preserve DHCP helper-addresses");
assert(normalizedRouter.ports.some((port) => (port.secondaryIpAddresses || []).some((address) => address.ipAddress === "192.168.20.1" && address.subnetMask === "255.255.255.0")), "normalizeProject must preserve secondary interface IP addresses");
assert(normalizedRouter.ports.some((port) => (port.hsrpGroups || []).some((group) => group.virtualIp === "192.168.10.254" && group.priority === 110 && group.version === "2")), "normalizeProject must preserve HSRP groups");
assert(normalizedRouter.ports.some((port) => (port.hsrpGroups || []).some((group) => group.trackObject === 1 && group.trackDecrement === 20)), "normalizeProject must preserve HSRP track objects");
assert(normalizedRouter.ports.some((port) => (port.vrrpGroups || []).some((group) => group.virtualIp === "192.168.10.253" && group.priority === 120 && group.version === "3" && group.advertiseInterval === 2)), "normalizeProject must preserve VRRP groups");
assert(normalizedRouter.ports.some((port) => (port.vrrpGroups || []).some((group) => group.trackObject === 1 && group.trackDecrement === 15)), "normalizeProject must preserve VRRP track objects");
assert(normalizedRouter.ports.some((port) => port.policyRouteMap === "PBR-NORMALIZE"), "normalizeProject must preserve interface policy route-map bindings");
assert(normalizedRouter.config.staticRoutes.some((route) => route.network === "172.16.0.0" && route.distance === 200), "normalizeProject must preserve static route administrative distance");
assert(normalizedRouter.config.staticRoutes.some((route) => route.network === "172.31.0.0" && route.trackId === 1), "normalizeProject must preserve tracked static routes");
assert(normalizedRouter.config.prefixLists.some((entry) => entry.name === "DST-NORMALIZE" && entry.prefix === "172.16.0.0/16" && entry.le === 24 && entry.hits === 3), "normalizeProject must preserve prefix-list entries");
assert(normalizedRouter.config.routeMaps.some((entry) => entry.name === "PBR-NORMALIZE" && entry.setNextHop === "10.10.10.2" && entry.matchPrefixLists.includes("DST-NORMALIZE") && entry.hits === 7), "normalizeProject must preserve route-map entries");
assert(normalizedRouter.config.ipSlaOperations.some((operation) => operation.operationId === 1 && operation.targetIp === "10.10.10.10" && operation.enabled), "normalizeProject must preserve IP SLA operations");
assert(normalizedRouter.config.trackObjects.some((track) => track.trackId === 1 && track.type === "ip-sla" && track.ipSlaOperationId === 1), "normalizeProject must preserve track objects");
assert(normalized.notes.some((note) => note.text === "Smoke note" && note.color === "green" && note.position.x === 42), "normalizeProject must preserve workspace notes");
assert(normalized.drawings.some((drawing) => drawing.label === "Smoke zone" && drawing.kind === "ellipse" && drawing.color === "blue"), "normalizeProject must preserve workspace drawings");
assert(normalized.drawings.some((drawing) => drawing.label === "Smoke freehand" && drawing.kind === "freehand" && drawing.points.length === 3 && drawing.fill === false), "normalizeProject must preserve freehand workspace drawings");
assert(normalized.simulationEvents.some((event) => event.headers?.some((header) => header.field === "Ports" && header.value === "80")), "normalizeProject must preserve PDU header fields");
assert(normalized.activity.requirements.some((requirement) => requirement.kind === "service-count" && requirement.points === 5), "normalizeProject must preserve Activity Wizard requirements");
assert(normalized.activity.requirements.some((requirement) => requirement.kind === "tdr-normal-count" && requirement.target === 3), "normalizeProject must preserve Activity Wizard TDR requirements");
assert(normalized.activity.answerSnapshot && normalized.activity.answerSnapshot.devices.length === project.devices.length && normalized.activity.answerSnapshot.serviceDeviceIds.includes(server.id), "normalizeProject must preserve Activity Wizard answer snapshots");
assert(normalized.activity.commandRules.some((rule) => rule.deviceId === router.id && rule.command === "hostname"), "normalizeProject must preserve Activity Wizard command scoring rules");
assert(normalized.activity.commandSequences.some((sequence) => sequence.deviceId === router.id && sequence.commands.length === 2), "normalizeProject must preserve Activity Wizard command sequence rules");
assert(normalized.activity.commandOutputAssertions.some((assertion) => assertion.deviceId === router.id && assertion.expectedText === "Configuration register"), "normalizeProject must preserve Activity Wizard command output assertions");
assert(normalized.activity.interfaceExpectations.some((expectation) => expectation.deviceId === pc.id && expectation.ipAddress === "192.168.10.10"), "normalizeProject must preserve Activity Wizard interface expectations");
assert(normalized.activity.headerAssertions.some((assertion) => assertion.protocol === "HTTP" && assertion.field === "Ports"), "normalizeProject must preserve Activity Wizard header assertions");

assert(desktopConsoleTargets(project, pc).length === 0, "Desktop Terminal must ignore data links without a console cable");
const pcConsole = pc.ports.find((port) => port.kind === "console");
const routerConsole = router.ports.find((port) => port.kind === "console");
const pcDataPort = pc.ports.find((port) => port.kind !== "console");
assert(pcConsole && routerConsole && pcDataPort, "sample devices must expose console and data ports for Terminal smoke");
const consoleProject = {
  ...project,
  links: [
    ...project.links,
    {
      id: "link_console_smoke",
      type: "console",
      endpointA: { deviceId: pc.id, portId: pcConsole.id },
      endpointB: { deviceId: router.id, portId: routerConsole.id },
      status: "up",
      createdAt: Date.now()
    }
  ]
};
assert(desktopConsoleTargets(consoleProject, pc).some((target) => target.id === router.id), "Desktop Terminal must discover router console targets from a PC RS232 console cable");
assert(desktopConsoleTargets(consoleProject, router).some((target) => target.id === pc.id), "Desktop Terminal console target discovery must work in both endpoint directions");
const invalidConsoleProject = {
  ...project,
  links: [
    ...project.links,
    {
      id: "link_bad_console_smoke",
      type: "console",
      endpointA: { deviceId: pc.id, portId: pcDataPort.id },
      endpointB: { deviceId: router.id, portId: routerConsole.id },
      status: "up",
      createdAt: Date.now()
    }
  ]
};
assert(desktopConsoleTargets(invalidConsoleProject, pc).length === 0, "Desktop Terminal must require console-kind ports on both console cable endpoints");

const jsonPreview = readImportPreview(`\uFEFF  ${JSON.stringify(project)}`, "sample.json");
assert(jsonPreview.name === project.name && jsonPreview.devices === project.devices.length && jsonPreview.links === project.links.length, "JSON import preview must handle BOM and leading spaces");
const ptwebPreview = readImportPreview(`PTWEB1\n${JSON.stringify({ project })}`, "sample.ptweb");
assert(ptwebPreview.name === project.name && ptwebPreview.devices === project.devices.length, "PTWEB import preview must read project envelopes");
let importPreviewRejected = false;
try {
  readImportPreview(JSON.stringify({ devices: "bad", links: [] }), "bad.json");
} catch {
  importPreviewRejected = true;
}
assert(importPreviewRejected, "import preview must reject malformed project structures");
let binaryPreviewRejected = false;
try {
  readImportPreview("PKT\u0000binary", "bad.pkt");
} catch {
  binaryPreviewRejected = true;
}
assert(binaryPreviewRejected, "import preview must reject binary-like project files");

const invalidPortMaskProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.kind !== "console" ? { ...port, subnetMask: "255.0.255.0" } : port) }
    : device)
};
assert(diagnoseProject(invalidPortMaskProject).some((issue) => issue.severity === "error" && issue.title.includes("mask가 올바르지 않습니다")), "diagnostics must reject non-contiguous interface subnet masks");

const invalidTrackingProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.id === routerLanPort.id ? { ...port, hsrpGroups: [{ group: 1, virtualIp: "192.168.10.254", priority: 100, preempt: false, version: "2", trackObject: 77, trackDecrement: 10 }], vrrpGroups: [{ group: 1, virtualIp: "192.168.10.253", priority: 100, preempt: true, version: "3", advertiseInterval: 1, trackObject: 77, trackDecrement: 10 }] } : port),
        config: {
          ...device.config,
          staticRoutes: [...device.config.staticRoutes, { id: "route_missing_track_diag", network: "172.20.0.0", mask: "255.255.0.0", nextHop: "10.10.10.2", trackId: 77 }],
          ipSlaOperations: [{ id: "sla_bad_diag", operationId: 1, type: "icmp-echo", targetIp: "999.1.1.1", sourceInterface: "GigabitEthernet9/9", frequency: 5, timeout: 1000, threshold: 1000, enabled: true }],
          trackObjects: [{ id: "track_missing_sla_diag", trackId: 1, type: "ip-sla", ipSlaOperationId: 99, mode: "reachability" }]
        }
      }
    : device)
};
const invalidTrackingIssues = diagnoseProject(invalidTrackingProject);
assert(invalidTrackingIssues.some((issue) => issue.title.includes("static route track object가 없습니다")), "diagnostics must warn when a static route references a missing track object");
assert(invalidTrackingIssues.some((issue) => issue.title.includes("HSRP track object가 없습니다")), "diagnostics must warn when HSRP references a missing track object");
assert(invalidTrackingIssues.some((issue) => issue.title.includes("VRRP track object가 없습니다")), "diagnostics must warn when VRRP references a missing track object");
assert(invalidTrackingIssues.some((issue) => issue.title.includes("IP SLA 1 대상 IP가 올바르지 않습니다")), "diagnostics must reject invalid IP SLA target addresses");
assert(invalidTrackingIssues.some((issue) => issue.title.includes("IP SLA 1 source-interface가 없습니다")), "diagnostics must warn when an IP SLA source-interface is missing");
assert(invalidTrackingIssues.some((issue) => issue.title.includes("Track 1 IP SLA operation이 없습니다")), "diagnostics must warn when track objects reference missing IP SLA operations");

const serviceWithoutIpProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, ports: device.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "", subnetMask: "" } : port) }
    : device)
};
assert(diagnoseProject(serviceWithoutIpProject).some((issue) => issue.severity === "warning" && issue.title.includes("서비스에 접근 가능한 IP") && issue.detail.includes("FTP")), "diagnostics must warn when enabled services have no reachable IPv4 interface");

const invalidPoolMaskProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((pool) => ({ ...pool, mask: "255.0.255.0" })) } }
    : device)
};
assert(diagnoseProject(invalidPoolMaskProject).some((issue) => issue.severity === "error" && issue.title.includes("DHCP 풀") && issue.title.includes("주소 설정")), "diagnostics must reject non-contiguous DHCP pool masks");
assert(requestDhcp(invalidPoolMaskProject, pc.id).message.includes("마스크"), "DHCP request must reject non-contiguous pool masks");

const vtpSwitchA = createDevice("switch-2960-24tt", { x: 10, y: 300 }, []);
const vtpSwitchB = createDevice("switch-2960-24tt", { x: 220, y: 300 }, [vtpSwitchA]);
const vtpPortA = vtpSwitchA.ports.find((port) => port.kind !== "console");
const vtpPortB = vtpSwitchB.ports.find((port) => port.kind !== "console");
assert(vtpPortA && vtpPortB, "VTP diagnostic switches must expose copper ports");
let vtpProject = {
  id: "project_vtp",
  ownerId: "user_feature_smoke",
  name: "VTP diagnostics smoke",
  devices: [
    {
      ...vtpSwitchA,
      ports: vtpSwitchA.ports.map((port) => port.id === vtpPortA.id ? { ...port, mode: "trunk", allowedVlans: [10] } : port),
      config: { ...vtpSwitchA.config, vlans: [{ id: 1, name: "default" }, { id: 10, name: "USERS" }], vtp: { mode: "server", domain: "CAMPUS_A", version: "2", pruning: false, revision: 1 } }
    },
    {
      ...vtpSwitchB,
      ports: vtpSwitchB.ports.map((port) => port.id === vtpPortB.id ? { ...port, mode: "trunk", allowedVlans: [10] } : port),
      config: { ...vtpSwitchB.config, vlans: [{ id: 1, name: "default" }, { id: 10, name: "USERS" }], vtp: { mode: "client", domain: "CAMPUS_B", version: "2", pruning: false, revision: 0 } }
    }
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const vtpLinkResult = validateConnection(vtpProject, vtpSwitchA.id, vtpSwitchB.id, "auto", vtpPortA.id, vtpPortB.id);
assert(vtpLinkResult.link, "VTP diagnostic switches must connect over selected trunk ports");
vtpProject = addLink(vtpProject, vtpLinkResult.link);
assert(diagnoseProject(vtpProject).some((issue) => issue.title.includes("VTP 불일치") && issue.detail.includes("domain")), "diagnostics must warn on VTP domain mismatch over switch trunks");

const snoopPc = createDevice("pc-pt", { x: 10, y: 10 }, []);
const snoopSwitch = createDevice("switch-2960-24tt", { x: 180, y: 10 }, [snoopPc]);
const snoopServerBase = createDevice("server-pt", { x: 350, y: 10 }, [snoopPc, snoopSwitch]);
const snoopServer = {
  ...snoopServerBase,
  ports: snoopServerBase.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "192.168.1.10", subnetMask: "255.255.255.0" } : port),
  config: {
    ...snoopServerBase.config,
    services: { ...snoopServerBase.config.services, dhcp: true },
    dhcpPools: [{
      id: "pool_snoop",
      name: "SNOOP",
      network: "192.168.1.0",
      mask: "255.255.255.0",
      defaultGateway: "192.168.1.1",
      dnsServer: "192.168.1.10",
      startIp: "192.168.1.100",
      maxLeases: 5,
      enabled: true
    }]
  }
};
let snoopProject = {
  id: "project_snoop",
  ownerId: "user_feature_smoke",
  name: "DHCP Snooping smoke",
  devices: [
    { ...snoopPc, ports: snoopPc.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" } : port) },
    { ...snoopSwitch, config: { ...snoopSwitch.config, dhcpSnooping: { enabled: true, vlans: [1], verifyMacAddress: true } } },
    snoopServer
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
let linkResult = validateConnection(snoopProject, snoopPc.id, snoopSwitch.id, "auto");
snoopProject = addLink(snoopProject, linkResult.link);
linkResult = validateConnection(snoopProject, snoopSwitch.id, snoopServer.id, "auto");
snoopProject = addLink(snoopProject, linkResult.link);
const blockedDhcp = requestDhcp(snoopProject, snoopPc.id);
assert(blockedDhcp.message.includes("DHCP Snooping") && blockedDhcp.message.includes("untrusted"), "DHCP snooping must block offers from untrusted switch ports");
const serverLink = snoopProject.links.find((link) => link.endpointA.deviceId === snoopServer.id || link.endpointB.deviceId === snoopServer.id);
const switchEndpointRef = serverLink.endpointA.deviceId === snoopSwitch.id ? serverLink.endpointA : serverLink.endpointB;
snoopProject = {
  ...snoopProject,
  devices: snoopProject.devices.map((device) => device.id === snoopSwitch.id
    ? { ...device, ports: device.ports.map((port) => port.id === switchEndpointRef.portId ? { ...port, dhcpSnoopingTrusted: true } : port) }
    : device)
};
const allowedDhcp = requestDhcp(snoopProject, snoopPc.id);
assert(allowedDhcp.message.includes("192.168.1.100"), "DHCP snooping must allow offers from trusted server-facing ports");

const invalidGatewayProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((pool) => ({ ...pool, defaultGateway: "172.16.10.1" })) } }
    : device)
};
assert(diagnoseProject(invalidGatewayProject).some((issue) => issue.severity === "error" && issue.title.includes("gateway가 맞지 않습니다")), "diagnostics must reject DHCP gateways outside the pool subnet");

const badHelperProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? { ...device, ports: device.ports.map((port) => port.helperAddresses?.length ? { ...port, helperAddresses: ["999.1.1.1"] } : port) }
    : device)
};
assert(diagnoseProject(badHelperProject).some((issue) => issue.severity === "error" && issue.title.includes("DHCP helper가 올바르지 않습니다")), "diagnostics must reject invalid DHCP helper IP");

const missingHelperProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? { ...device, ports: device.ports.map((port) => port.helperAddresses?.length ? { ...port, helperAddresses: ["10.10.10.254"] } : port) }
    : device)
};
assert(diagnoseProject(missingHelperProject).some((issue) => issue.severity === "warning" && issue.title.includes("DHCP helper 대상이 없습니다")), "diagnostics must warn when DHCP helper target has no active server");

const helperWithoutActivePoolProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((pool) => ({ ...pool, enabled: false })) } }
    : device)
};
assert(diagnoseProject(helperWithoutActivePoolProject).some((issue) => issue.severity === "warning" && issue.title.includes("DHCP helper 대상이 없습니다")), "diagnostics must warn when DHCP helper target has no active pool");

const helperWithoutInterfaceIpProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? { ...device, ports: device.ports.map((port) => port.helperAddresses?.length ? { ...port, ipAddress: "", subnetMask: "" } : port) }
    : device)
};
assert(diagnoseProject(helperWithoutInterfaceIpProject).some((issue) => issue.severity === "warning" && issue.title.includes("DHCP helper 인터페이스 IP")), "diagnostics must warn when DHCP helper is set on an interface without an IP");

const reversedExcludeProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, config: { ...device.config, dhcpExcludedRanges: [{ id: "exclude_bad_order", startIp: "192.168.10.30", endIp: "192.168.10.20" }] } }
    : device)
};
assert(diagnoseProject(reversedExcludeProject).some((issue) => issue.severity === "error" && issue.title.includes("DHCP 제외 범위 순서")), "diagnostics must reject reversed DHCP excluded ranges");

const outsideExcludeProject = {
  ...project,
  devices: project.devices.map((device) => device.id === server.id
    ? { ...device, config: { ...device.config, dhcpExcludedRanges: [{ id: "exclude_outside", startIp: "172.16.10.1", endIp: "172.16.10.20" }] } }
    : device)
};
assert(diagnoseProject(outsideExcludeProject).some((issue) => issue.severity === "warning" && issue.title.includes("DHCP 제외 범위가 풀 밖")), "diagnostics must warn when DHCP excluded ranges do not match an active pool");

const released = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.kind !== "console"
          ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }
          : port)
      }
    : device)
};

const result = requestDhcp(released, pc.id);
const nextPc = result.project.devices.find((device) => device.id === pc.id);

assert(result.message.includes("192.168.10.100"), "DHCP relay should allocate the first pool address");
assert(nextPc.ports.some((port) => port.ipAddress === "192.168.10.100" && port.gateway === "192.168.10.1" && port.dnsServer === "10.10.10.10"), "client port must receive DHCP settings");
assert(result.project.simulationEvents.some((event) => event.info.includes("helper-address")), "DHCP relay event must be recorded");

const outsideStartProject = {
  ...released,
  devices: released.devices.map((device) => device.id === server.id
    ? {
        ...device,
        config: {
          ...device.config,
          dhcpPools: device.config.dhcpPools.map((pool) => ({ ...pool, startIp: "172.16.10.50" }))
        },
        runtime: { ...device.runtime, dhcpLeases: [] }
      }
    : device)
};
const outsideStartResult = requestDhcp(outsideStartProject, pc.id);
const outsideStartPc = outsideStartResult.project.devices.find((device) => device.id === pc.id);
assert(diagnoseProject(outsideStartProject).some((issue) => issue.severity === "error" && issue.title.includes("시작 IP가 네트워크 밖")), "diagnostics must reject DHCP start IPs outside the pool subnet");
assert(outsideStartResult.message.includes("시작 IP") && outsideStartResult.message.includes("밖"), "DHCP must reject a pool start IP outside the selected subnet");
assert(!outsideStartPc.ports.some((port) => port.ipAddress === "172.16.10.50"), "DHCP must not assign addresses outside the selected pool subnet");

const reservedAddressProject = {
  ...released,
  devices: released.devices.map((device) => device.id === server.id
    ? {
        ...device,
        config: {
          ...device.config,
          dhcpPools: device.config.dhcpPools.map((pool) => ({ ...pool, startIp: "192.168.10.1" })),
          dhcpExcludedRanges: []
        }
      }
    : device)
};
assert(diagnoseProject(reservedAddressProject).some((issue) => issue.severity === "warning" && issue.title.includes("시작 IP가 이미 사용 중입니다")), "diagnostics must warn when DHCP start IP is already assigned to an interface");
const reservedAddressResult = requestDhcp(reservedAddressProject, pc.id);
const reservedAddressPc = reservedAddressResult.project.devices.find((device) => device.id === pc.id);
assert(reservedAddressPc.ports.some((port) => port.ipAddress === "192.168.10.2"), "DHCP must skip addresses already assigned to device interfaces");

const multiPoolProject = {
  ...released,
  devices: released.devices.map((device) => device.id === server.id
    ? {
        ...device,
        config: {
          ...device.config,
          dhcpPools: [
            {
              id: "pool_wrong",
              name: "WRONG",
              network: "172.16.50.0",
              mask: "255.255.255.0",
              defaultGateway: "172.16.50.1",
              dnsServer: "10.10.10.10",
              startIp: "172.16.50.100",
              maxLeases: 10,
              enabled: true
            },
            ...device.config.dhcpPools
          ]
        },
        runtime: { ...device.runtime, dhcpLeases: [] }
      }
    : device)
};
const multiPoolResult = requestDhcp(multiPoolProject, pc.id);
const multiPoolPc = multiPoolResult.project.devices.find((device) => device.id === pc.id);
assert(multiPoolPc.ports.some((port) => port.ipAddress === "192.168.10.100"), "DHCP relay must prefer the pool matching the relay client subnet");
assert(!multiPoolPc.ports.some((port) => port.ipAddress === "172.16.50.100"), "DHCP relay must not allocate from the first unrelated active pool");

const wrongLeaseProject = {
  ...multiPoolProject,
  devices: multiPoolProject.devices.map((device) => device.id === server.id
    ? {
        ...device,
        runtime: {
          ...device.runtime,
          dhcpLeases: [{ ipAddress: "172.16.50.100", macAddress: pc.ports.find((port) => port.kind !== "console").macAddress, deviceId: pc.id, expiresAt: Date.now() + 60000 }]
        }
      }
    : device)
};
const wrongLeaseResult = requestDhcp(wrongLeaseProject, pc.id);
const wrongLeasePc = wrongLeaseResult.project.devices.find((device) => device.id === pc.id);
assert(wrongLeasePc.ports.some((port) => port.ipAddress === "192.168.10.100"), "DHCP relay must ignore an existing lease outside the selected pool");

console.log("Feature smoke tests passed");
NODE
