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
  "$ROOT/web/src/engine/desktopDiagnostics.ts" \
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
  "$ROOT/web/src/wasm/engine.ts" \
  "$ROOT/web/src/engine/ip.ts" \
  "$ROOT/web/src/engine/labWorkbook.ts" \
  "$ROOT/web/src/storage/importPreview.ts" \
  "$ROOT/web/src/storage/localStore.ts" \
  "$ROOT/web/src/storage/normalizeProject.ts" \
  "$ROOT/web/src/utils/id.ts"

node - "$TMPDIR" "$ROOT" <<'NODE'
const fs = require("fs");
const path = require("path");
const tmpdir = process.argv[2];
const root = process.argv[3];
const { createRoutedSampleProject, createSampleProjectFromTemplate, sampleProjectTemplates } = require(path.join(tmpdir, "data/sampleProject.js"));
const { canPortUseCable, createDevice, deviceCatalog, effectivePortKind, getTransceiverSpec, installModule } = require(path.join(tmpdir, "data/deviceCatalog.js"));
const { analyzeAddressPlan, buildAddressPlanReportText } = require(path.join(tmpdir, "engine/addressPlan.js"));
const { analyzeCapacityPlan, buildCapacityPlanReportText } = require(path.join(tmpdir, "engine/capacityPlan.js"));
const { analyzeConfigDrift, buildConfigDriftReportText } = require(path.join(tmpdir, "engine/configDrift.js"));
const { clearDesktopArpEntries, desktopArpTable, desktopDnsCache, desktopGetmacTable, desktopHostname, desktopIpconfigAll, desktopNetshInterfaceConfig, desktopNetstatListening, desktopNetstatListeningRows, desktopRoutePrint, desktopScQuery, desktopTasklist, isDesktopNetshInterfaceConfigCommand, isDesktopRoutePrintCommand, parseDesktopArpCommand, parseDesktopNetstatCommand, parseDesktopNslookupCommand, parseDesktopPingCommand, parseDesktopRemoteAccessCommand, parseDesktopScCommand, parseDesktopTasklistCommand, parseDesktopTestNetConnectionCommand, parseDesktopTraceCommand } = require(path.join(tmpdir, "engine/desktopDiagnostics.js"));
const { desktopConsoleTargets } = require(path.join(tmpdir, "engine/desktopTerminal.js"));
const { diagnoseProject } = require(path.join(tmpdir, "engine/diagnostics.js"));
const { analyzeFailureImpact, buildFailureImpactReportText } = require(path.join(tmpdir, "engine/failureImpact.js"));
const { analyzeProjectAudit } = require(path.join(tmpdir, "engine/projectAudit.js"));
const { buildPduHeaders, pduTransportForProtocol } = require(path.join(tmpdir, "engine/pduHeaders.js"));
const { buildProjectReportLines, buildProjectReportText } = require(path.join(tmpdir, "engine/projectReport.js"));
const { analyzeRoutingMatrix, buildRoutingMatrixReportText } = require(path.join(tmpdir, "engine/routingMatrix.js"));
const { analyzeSecurityMatrix, buildSecurityMatrixReportText } = require(path.join(tmpdir, "engine/securityMatrix.js"));
const { analyzeServiceReachability, buildServiceReachabilityReportText } = require(path.join(tmpdir, "engine/serviceReachability.js"));
const { fallbackPing, requestDhcp } = require(path.join(tmpdir, "engine/simulation.js"));
const { requiresTypeScriptPingFallback } = require(path.join(tmpdir, "wasm/engine.js"));
const { buildVerificationPlan, buildVerificationPlanText } = require(path.join(tmpdir, "engine/verificationPlan.js"));
const { analyzeWirelessSurvey, buildWirelessSurveyReportText } = require(path.join(tmpdir, "engine/wirelessSurvey.js"));
const { buildLabWorkbook, buildLabWorkbookText } = require(path.join(tmpdir, "engine/labWorkbook.js"));
const { addLink, endpoint, recalc, validateConnection } = require(path.join(tmpdir, "engine/topology.js"));
const localStore = require(path.join(tmpdir, "storage/localStore.js"));
const { normalizeProject } = require(path.join(tmpdir, "storage/normalizeProject.js"));
const { readImportPreview } = require(path.join(tmpdir, "storage/importPreview.js"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const editorSource = fs.readFileSync(path.join(root, "web/src/components/Editor.tsx"), "utf8");
assert(
  editorSource.includes("pathping www.lab.local") &&
  editorSource.includes("desktopIpconfigAll") &&
  editorSource.includes("netsh interface ip show config") &&
  editorSource.includes("getmac /v") &&
  editorSource.includes("route print -4") &&
  editorSource.includes("netstat -rn") &&
  editorSource.includes("netstat -ano") &&
  editorSource.includes("netstat -abno") &&
  editorSource.includes("tasklist /svc") &&
  editorSource.includes("sc queryex dns") &&
  editorSource.includes("Test-NetConnection www.lab.local -Port 80") &&
  editorSource.includes("parseDesktopNetstatCommand") &&
  editorSource.includes("nslookup [-type=A|PTR] <이름|ip> [dns-server]") &&
  editorSource.includes("ping [-4] [-n 횟수] <ip|이름>") &&
  editorSource.includes("pathping [-n] <ip|이름>") &&
  editorSource.includes("Trace complete."),
  "Desktop command prompt must expose pathping, netstat PID output, and richer ipconfig diagnostics"
);

function createMemoryStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

const project = createRoutedSampleProject("user_feature_smoke");
const pc = project.devices.find((device) => device.kind === "pc");
const server = project.devices.find((device) => device.kind === "server");
const router = project.devices.find((device) => device.kind === "router");
const sshTransport = pduTransportForProtocol("SSH");
assert(sshTransport.protocol === "TCP" && sshTransport.destinationPort === "22" && sshTransport.operation === "Session open", "PDU transport helper must describe SSH TCP/22 session metadata");
const telnetHeaders = buildPduHeaders("TELNET", "delivered", "pc_smoke", "router_smoke");
assert(telnetHeaders.some((header) => header.layer === "Layer 4" && header.field === "Destination port" && header.value === "23") && telnetHeaders.some((header) => header.layer === "Packet" && header.field === "Disposition" && header.value === "delivered"), "PDU header helper must build TELNET destination-port and disposition headers");
const sshUserAtHost = parseDesktopRemoteAccessCommand("ssh admin@router.lab.local");
assert(sshUserAtHost.protocol === "ssh" && sshUserAtHost.username === "admin" && sshUserAtHost.targetText === "router.lab.local", "Desktop SSH parser must accept user@host targets");
const sshWithOptions = parseDesktopRemoteAccessCommand("ssh -l netadmin -p 22 router.lab.local");
assert(sshWithOptions.protocol === "ssh" && sshWithOptions.username === "netadmin" && sshWithOptions.port === "22" && sshWithOptions.targetText === "router.lab.local", "Desktop SSH parser must preserve -l user and -p port options");
const telnetWithPort = parseDesktopRemoteAccessCommand("telnet router.lab.local 23");
assert(telnetWithPort.protocol === "telnet" && telnetWithPort.targetText === "router.lab.local" && telnetWithPort.port === "23", "Desktop Telnet parser must accept optional TCP port arguments");

assert(pc && server && router, "sample must include PC, server, and router");
assert(desktopHostname(pc) === pc.config.hostname, "Desktop hostname command helper must use the configured hostname");
assert(desktopGetmacTable(pc).includes(pc.ports.find((port) => port.kind !== "console").macAddress), "Desktop getmac helper must list non-console adapter MAC addresses");
assert(desktopGetmacTable(pc, { verbose: true }).includes("Connection Name") && desktopGetmacTable(pc, { verbose: true }).includes("Network Adapter"), "Desktop getmac /v helper must include verbose adapter columns");
const ipconfigOutput = desktopIpconfigAll(pc);
assert(ipconfigOutput.includes("물리적 주소") && ipconfigOutput.includes("DHCP 사용") && ipconfigOutput.includes("IPv4 주소") && ipconfigOutput.includes("DNS 서버"), "Desktop ipconfig /all helper must include adapter MAC, DHCP, IPv4, and DNS fields");
const netshConfigOutput = desktopNetshInterfaceConfig(pc);
assert(netshConfigOutput.includes("Configuration for interface") && netshConfigOutput.includes("DHCP enabled") && netshConfigOutput.includes("IP Address") && netshConfigOutput.includes("Default Gateway") && netshConfigOutput.includes("DNS Servers"), "Desktop netsh interface config helper must include adapter IP, DHCP, gateway, and DNS fields");
assert(isDesktopNetshInterfaceConfigCommand("netsh interface ip show config") && isDesktopNetshInterfaceConfigCommand("netsh int ipv4 show configuration"), "Desktop netsh parser must accept interface/int and ip/ipv4 forms");
const pcWithDhcpLease = { ...pc, runtime: { ...pc.runtime, dhcpLeases: [{ ipAddress: "192.168.10.100", macAddress: pc.ports.find((port) => port.kind !== "console").macAddress, deviceId: pc.id, expiresAt: Date.now() + 60000 }] } };
assert(desktopIpconfigAll(pcWithDhcpLease).includes("DHCP 임대 만료"), "Desktop ipconfig /all helper must include DHCP lease expiration when a lease exists");
const dnsCacheOutput = desktopDnsCache(project, pc);
assert(dnsCacheOutput.includes("DNS Resolver Cache") && dnsCacheOutput.includes("Record Type . . . . . : 1") && dnsCacheOutput.includes("A (Host) Record") && dnsCacheOutput.includes("Record Type . . . . . : 12") && dnsCacheOutput.includes("PTR Record") && dnsCacheOutput.includes("in-addr.arpa"), "Desktop ipconfig /displaydns helper must include A and PTR cache details");
const pcWithoutDnsServer = { ...pc, ports: pc.ports.map((port) => ({ ...port, dnsServer: "" })) };
assert(desktopDnsCache(project, pcWithoutDnsServer).includes("표시할 서버가 없습니다"), "Desktop ipconfig /displaydns helper must report missing DNS server configuration");
const routePrintOutput = desktopRoutePrint(pc);
assert(routePrintOutput.includes("Interface List") && routePrintOutput.includes("IPv4 Route Table") && routePrintOutput.includes("Active Routes:") && routePrintOutput.includes("0.0.0.0"), "Desktop route print helper must include Windows-style interface and active-route sections");
const pcWithArp = { ...pc, runtime: { ...pc.runtime, arpTable: [{ ipAddress: "192.168.10.1", macAddress: "0200.0000.0001", portName: "FastEthernet0" }, { ipAddress: "192.168.10.2", macAddress: "0200.0000.0002", portName: "FastEthernet0" }] } };
const arpTableOutput = desktopArpTable(pcWithArp);
assert(arpTableOutput.includes("Interface:") && arpTableOutput.includes("Internet Address") && arpTableOutput.includes("Physical Address") && arpTableOutput.includes("dynamic"), "Desktop arp -a helper must include Windows-style ARP table columns");
assert(parseDesktopArpCommand("arp /a").action === "show", "Desktop ARP parser must accept slash-style show options");
const parsedArpDelete = parseDesktopArpCommand("arp /d 192.168.10.1");
assert(parsedArpDelete.action === "delete" && parsedArpDelete.target === "192.168.10.1", "Desktop ARP parser must accept slash-style delete options");
const pcAfterSingleArpDelete = clearDesktopArpEntries(pcWithArp, "192.168.10.1");
assert(pcAfterSingleArpDelete.removed === 1 && pcAfterSingleArpDelete.device.runtime.arpTable.length === 1, "Desktop arp -d <ip> helper must remove a single ARP entry");
const pcAfterAllArpDelete = clearDesktopArpEntries(pcWithArp, "*");
assert(pcAfterAllArpDelete.removed === 2 && pcAfterAllArpDelete.device.runtime.arpTable.length === 0, "Desktop arp -d * helper must clear all ARP entries");
assert(isDesktopRoutePrintCommand("route print /4") && isDesktopRoutePrintCommand("route print -4"), "Desktop route parser must accept slash and dash IPv4 filters");
const serverListeningRows = desktopNetstatListeningRows(server);
assert(serverListeningRows.some((row) => row.service === "HTTP" && row.localAddress.endsWith(":80") && row.state === "LISTENING"), "Desktop netstat helper must list HTTP TCP listeners");
assert(serverListeningRows.some((row) => row.service === "DNS" && row.protocol === "UDP" && row.localAddress.endsWith(":53") && row.pid === "4053"), "Desktop netstat helper must list DNS UDP listeners with stable PID evidence");
const netstatPidOutput = desktopNetstatListening(server, { includePid: true });
assert(netstatPidOutput.includes("PID") && netstatPidOutput.includes("4080") && netstatPidOutput.includes("4053"), "Desktop netstat -ano helper must include listener PID output");
const netstatProcessOutput = desktopNetstatListening(server, { includePid: true, includeProcess: true });
assert(netstatProcessOutput.includes("Process") && netstatProcessOutput.includes("ptweb-http.exe") && netstatProcessOutput.includes("4080"), "Desktop netstat -abno helper must include listener process names");
const tasklistSvcOutput = desktopTasklist(server, { showServices: true });
assert(tasklistSvcOutput.includes("ptweb-http.exe") && tasklistSvcOutput.includes("4080") && tasklistSvcOutput.includes("HTTP") && tasklistSvcOutput.includes("DNS"), "Desktop tasklist /svc helper must map listener PIDs to service images");
assert(desktopTasklist(server, { pidFilter: "4053" }).includes("4053") && !desktopTasklist(server, { pidFilter: "4053" }).includes("4080"), "Desktop tasklist helper must filter by PID");
const parsedTasklist = parseDesktopTasklistCommand("tasklist /svc /fi \"PID eq 4053\"");
assert(parsedTasklist.valid && parsedTasklist.showServices && parsedTasklist.pidFilter === "4053", "Desktop tasklist parser must accept /svc and PID filters");
const scDnsOutput = desktopScQuery(server, { extended: true, serviceName: "dns" });
assert(scDnsOutput.includes("SERVICE_NAME: dns") && scDnsOutput.includes("RUNNING") && scDnsOutput.includes("PID") && scDnsOutput.includes("4053"), "Desktop sc queryex helper must include service state and PID evidence");
const parsedSc = parseDesktopScCommand("sc queryex dns");
assert(parsedSc.valid && parsedSc.extended && parsedSc.serviceName === "dns", "Desktop sc parser must accept queryex service filters");
const parsedTestNetConnection = parseDesktopTestNetConnectionCommand("Test-NetConnection www.lab.local -Port 80");
assert(parsedTestNetConnection.valid && parsedTestNetConnection.targetText === "www.lab.local" && parsedTestNetConnection.port === "80", "Desktop Test-NetConnection parser must preserve target and port");
const parsedTnc = parseDesktopTestNetConnectionCommand("tnc -ComputerName www.lab.local -p 443");
assert(parsedTnc.valid && parsedTnc.targetText === "www.lab.local" && parsedTnc.port === "443", "Desktop tnc parser must accept PowerShell-style aliases");
const parsedTncCommonPort = parseDesktopTestNetConnectionCommand("tnc -ComputerName www.lab.local -CommonTCPPort HTTP -InformationLevel Detailed");
assert(parsedTncCommonPort.valid && parsedTncCommonPort.targetText === "www.lab.local" && parsedTncCommonPort.port === "80", "Desktop tnc parser must accept common TCP port and information-level options");
assert(parseDesktopNetstatCommand("netstat /ano").kind === "listening" && parseDesktopNetstatCommand("netstat /ano").includePid, "Desktop netstat parser must accept slash-style combined listener PID options");
assert(parseDesktopNetstatCommand("netstat -a -n -o").kind === "listening" && parseDesktopNetstatCommand("netstat -a -n -o").includePid, "Desktop netstat parser must accept spaced listener PID options");
assert(parseDesktopNetstatCommand("netstat /abno").kind === "listening" && parseDesktopNetstatCommand("netstat /abno").includePid && parseDesktopNetstatCommand("netstat /abno").includeProcess, "Desktop netstat parser must accept process-name listener options");
assert(parseDesktopNetstatCommand("netstat /rn").kind === "routes", "Desktop netstat parser must accept slash-style route table options");
const directedNslookup = parseDesktopNslookupCommand("nslookup www.lab.local 192.168.10.10");
assert(directedNslookup.name === "www.lab.local" && directedNslookup.serverText === "192.168.10.10", "Desktop nslookup parser must preserve directed DNS server argument");
const defaultNslookup = parseDesktopNslookupCommand("nslookup www.lab.local");
assert(defaultNslookup.name === "www.lab.local" && defaultNslookup.serverText === "", "Desktop nslookup parser must allow default DNS server lookup");
const typedNslookup = parseDesktopNslookupCommand("nslookup -type=ptr 192.168.10.10 192.168.10.2");
assert(typedNslookup.name === "192.168.10.10" && typedNslookup.serverText === "192.168.10.2" && typedNslookup.queryType === "PTR", "Desktop nslookup parser must preserve type options and directed DNS server argument");
const spacedTypeNslookup = parseDesktopNslookupCommand("nslookup -type PTR 192.168.10.10 192.168.10.2");
assert(spacedTypeNslookup.name === "192.168.10.10" && spacedTypeNslookup.serverText === "192.168.10.2" && spacedTypeNslookup.queryType === "PTR", "Desktop nslookup parser must preserve space-separated type options");
const debugNslookup = parseDesktopNslookupCommand("nslookup -debug -timeout=2 www.lab.local 192.168.10.10");
assert(debugNslookup.name === "www.lab.local" && debugNslookup.serverText === "192.168.10.10", "Desktop nslookup parser must ignore debug and timeout controls while preserving query and server");
const spacedPing = parseDesktopPingCommand("ping -n 4 www.lab.local");
assert(spacedPing.count === 4 && spacedPing.targetText === "www.lab.local", "Desktop ping parser must preserve spaced -n count and target");
const compactPing = parseDesktopPingCommand("ping -n12 www.lab.local");
assert(compactPing.count === 10 && compactPing.targetText === "www.lab.local", "Desktop ping parser must clamp compact -n counts to the command limit");
const defaultPing = parseDesktopPingCommand("ping www.lab.local");
assert(defaultPing.count === 4 && defaultPing.targetText === "www.lab.local", "Desktop ping parser must default to four requests");
const optionPing = parseDesktopPingCommand("ping -4 -n 3 -l 64 www.lab.local");
assert(optionPing.count === 3 && optionPing.targetText === "www.lab.local", "Desktop ping parser must skip common Windows ping options while preserving target");
const parsedTracert = parseDesktopTraceCommand("tracert -d www.lab.local");
assert(parsedTracert.numericOnly && parsedTracert.targetText === "www.lab.local", "Desktop tracert parser must skip -d while preserving target");
const parsedPathping = parseDesktopTraceCommand("pathping -n www.lab.local");
assert(parsedPathping.numericOnly && parsedPathping.targetText === "www.lab.local", "Desktop pathping parser must skip -n while preserving target");
const parsedTracertWithHopLimit = parseDesktopTraceCommand("tracert -d -h 5 www.lab.local");
assert(parsedTracertWithHopLimit.numericOnly && parsedTracertWithHopLimit.targetText === "www.lab.local", "Desktop tracert parser must skip value options while preserving target");
const parsedTracertWithLooseSource = parseDesktopTraceCommand("tracert -j 192.168.10.1 www.lab.local");
assert(!parsedTracertWithLooseSource.numericOnly && parsedTracertWithLooseSource.targetText === "www.lab.local", "Desktop tracert parser must skip loose-source host-list options while preserving target");
const parsedPathpingWithQueryCount = parseDesktopTraceCommand("pathping -n -q 2 www.lab.local");
assert(parsedPathpingWithQueryCount.numericOnly && parsedPathpingWithQueryCount.targetText === "www.lab.local", "Desktop pathping parser must skip value options while preserving target");
assert(server.config.services.dhcp, "sample server DHCP must be enabled");
assert(server.config.services.dns, "sample server DNS must be enabled");
assert(server.config.services.http, "sample server HTTP must be enabled");
assert(server.config.services.ftp, "sample server FTP must be enabled");
assert(server.config.services.email, "sample server EMAIL must be enabled");
assert(server.config.services.tftp, "sample server TFTP must be enabled");
assert(server.config.services.syslog, "sample server SYSLOG must be enabled");
const sampleOutputAssertions = project.activity?.commandOutputAssertions ?? [];
assert(sampleOutputAssertions.some((assertion) => assertion.label === "Router show version output" && assertion.expectedText === "Configuration register" && assertion.commands.includes("show version")), "routed sample must include a browser-checkable CLI output assertion");
const sampleHeaderAssertions = project.activity?.headerAssertions ?? [];
assert(sampleHeaderAssertions.some((assertion) => assertion.label === "HTTP destination port header" && assertion.protocol === "HTTP" && assertion.field === "Destination port" && assertion.value === "80"), "routed sample must include a browser-checkable HTTP destination port header assertion");
assert(!requiresTypeScriptPingFallback(project), "basic routed ICMP project must remain eligible for the Rust WASM ping engine");
assert(requiresTypeScriptPingFallback(project, "http"), "non-ICMP service traffic must stay on the TypeScript engine until Rust models service protocols");
const hasHeader = (event, layer, field, value) => event.headers?.some((header) => header.layer === layer && header.field === field && header.value === value);
const icmpHeaderProject = fallbackPing(project, pc.id, server.id).project;
assert(icmpHeaderProject.simulationEvents.some((event) => event.type === "ICMP" && event.headers?.some((header) => header.layer === "Layer 4" && header.field === "Protocol" && header.value === "ICMP")), "simulation events must include explicit ICMP protocol headers");
assert(icmpHeaderProject.simulationEvents.some((event) => event.type === "ICMP" && hasHeader(event, "Layer 4", "Type", "Echo") && hasHeader(event, "Layer 4", "Code", "0")), "ICMP simulation events must include type/code PDU headers");
const httpHeaderProject = fallbackPing(project, pc.id, server.id, "http").project;
assert(httpHeaderProject.simulationEvents.some((event) => event.type === "HTTP" && event.headers?.some((header) => header.layer === "Layer 4" && header.field === "Ports" && header.value === "80")), "HTTP simulation events must include explicit TCP/80 PDU headers");
assert(httpHeaderProject.simulationEvents.some((event) => event.type === "HTTP" && hasHeader(event, "Layer 4", "Source port", "49152") && hasHeader(event, "Layer 4", "Destination port", "80") && hasHeader(event, "Layer 7", "Operation", "GET")), "HTTP simulation events must include source/destination port and operation PDU headers");
const dnsHeaderProject = fallbackPing(project, pc.id, server.id, "dns").project;
assert(dnsHeaderProject.simulationEvents.some((event) => event.type === "DNS" && event.headers?.some((header) => header.layer === "Layer 4" && header.field === "Ports" && header.value === "53")), "DNS simulation events must include explicit UDP/53 PDU headers");
assert(dnsHeaderProject.simulationEvents.some((event) => event.type === "DNS" && hasHeader(event, "Layer 4", "Destination port", "53") && hasHeader(event, "Layer 7", "Operation", "Query")), "DNS simulation events must include query operation PDU headers");
const dhcpHeaderProject = requestDhcp({ ...project, devices: project.devices.map((device) => device.id === pc.id ? { ...device, ports: device.ports.map((port) => port.name === "FastEthernet0" ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" } : port) } : device) }, pc.id).project;
assert(dhcpHeaderProject.simulationEvents.some((event) => event.type === "DHCP" && hasHeader(event, "Layer 4", "Source port", "68") && hasHeader(event, "Layer 4", "Destination port", "67") && hasHeader(event, "Layer 7", "Operation", "Discover/Request")), "DHCP simulation events must include client/server port PDU headers");
const projectReportText = buildProjectReportText(project, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const projectReportLines = buildProjectReportLines(project, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const httpHeaderReportText = buildProjectReportText(httpHeaderProject, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const legacyHeaderReportText = buildProjectReportText({ ...project, simulationEvents: [{ id: "evt_legacy_header_smoke", time: Date.now(), lastDeviceId: pc.id, atDeviceId: server.id, sourceDeviceId: pc.id, targetDeviceId: server.id, packetId: "packet_legacy_header_smoke", type: "TFTP", info: "legacy header smoke", status: "delivered", osiLayers: ["Layer 7", "Layer 4", "Layer 3"] }] }, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const addressPlan = analyzeAddressPlan(project);
const addressPlanText = buildAddressPlanReportText(project);
const capacityPlan = analyzeCapacityPlan(project);
const capacityPlanText = buildCapacityPlanReportText(project);
const projectAudit = analyzeProjectAudit(project);
const configDrift = analyzeConfigDrift(project);
const configDriftText = buildConfigDriftReportText(project);
const failureImpact = analyzeFailureImpact(project);
const failureImpactText = buildFailureImpactReportText(project);
const sampleSwitch = project.devices.find((device) => device.kind === "switch");
const stalePoweredOffSwitchProject = sampleSwitch ? {
  ...project,
  devices: project.devices.map((device) => device.id === sampleSwitch.id ? { ...device, powerOn: false } : device)
} : project;
const stalePoweredOffSwitchImpact = analyzeFailureImpact(stalePoweredOffSwitchProject);
const stalePoweredOffSwitchReachability = analyzeServiceReachability(stalePoweredOffSwitchProject);
const pcSwitchLink = sampleSwitch ? project.links.find((link) =>
  [link.endpointA.deviceId, link.endpointB.deviceId].includes(pc.id) &&
  [link.endpointA.deviceId, link.endpointB.deviceId].includes(sampleSwitch.id)
) : undefined;
const switchSideEndpoint = pcSwitchLink && sampleSwitch ? (pcSwitchLink.endpointA.deviceId === sampleSwitch.id ? pcSwitchLink.endpointA : pcSwitchLink.endpointB) : undefined;
const staleAdminDownSwitchPortProject = switchSideEndpoint ? {
  ...project,
  devices: project.devices.map((device) => device.id === switchSideEndpoint.deviceId
    ? { ...device, ports: device.ports.map((port) => port.id === switchSideEndpoint.portId ? { ...port, adminUp: false } : port) }
    : device)
} : project;
const staleAdminDownCapacityPlan = analyzeCapacityPlan(staleAdminDownSwitchPortProject);
const staleAdminDownCapacityText = buildCapacityPlanReportText(staleAdminDownSwitchPortProject);
assert(pcSwitchLink, "capacity stale-link smoke must find a removable PC-switch link");
const orphanedCapacityProject = {
  ...project,
  links: project.links.filter((link) => link.id !== pcSwitchLink.id)
};
const orphanedCapacityPlan = analyzeCapacityPlan(orphanedCapacityProject);
const staleAdminDownProjectAudit = analyzeProjectAudit(staleAdminDownSwitchPortProject);
const staleAdminDownProjectReportText = buildProjectReportText(staleAdminDownSwitchPortProject, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
const routerHelperPort = router.ports.find((port) => (port.helperAddresses ?? []).length > 0);
assert(routerHelperPort, "sample routed project must include a DHCP helper port");
const adminDownHelperProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? { ...device, ports: device.ports.map((port) => port.id === routerHelperPort.id ? { ...port, adminUp: false } : port) }
    : device)
};
const adminDownHelperAudit = analyzeProjectAudit(adminDownHelperProject);
const serviceReachability = analyzeServiceReachability(project);
const serviceReachabilityText = buildServiceReachabilityReportText(project);
const dmzSecurityProject = createSampleProjectFromTemplate("user_feature_smoke", "firewall-dmz");
const securityMatrix = analyzeSecurityMatrix(dmzSecurityProject);
const securityMatrixText = buildSecurityMatrixReportText(dmzSecurityProject);
const routingMatrix = analyzeRoutingMatrix(project);
const routingMatrixText = buildRoutingMatrixReportText(project);
const verificationPlan = buildVerificationPlan(project);
const verificationPlanText = buildVerificationPlanText(project);
const studentWorkbook = buildLabWorkbook(project, "student");
const instructorWorkbookText = buildLabWorkbookText(project, "instructor");
const staleAdminDownWorkbookText = buildLabWorkbookText(staleAdminDownSwitchPortProject, "student");
assert(addressPlan.totals.subnets >= 2 && addressPlan.totals.hosts >= 4, "address plan must discover routed sample subnets and hosts");
assert(addressPlan.duplicateIps.length === 0, "address plan must not treat endpoint default gateway references as duplicate assigned interface IPs");
assert(addressPlanText.includes("Address Plan") && addressPlanText.includes("Subnets") && addressPlanText.includes("Assignments"), "address plan text must include subnet and assignment sections");
assert(capacityPlan.totals.devices >= 4 && capacityPlan.totals.portsTotal > 0, "capacity plan must summarize devices and ports");
assert(capacityPlan.totals.portsActive <= capacityPlan.totals.portsConnected, "capacity plan active ports must be bounded by connected ports");
assert(capacityPlanText.includes("Capacity Plan") && capacityPlanText.includes("Device Capacity") && capacityPlanText.includes("active"), "capacity plan text must include device capacity and active port sections");
assert(staleAdminDownCapacityPlan.devices.some((device) => device.portsConnected > device.portsActive && device.warnings.some((warning) => warning.includes("inactive"))), "capacity plan must warn when connected ports are not active");
assert(staleAdminDownCapacityText.includes("connected port(s) inactive"), "capacity plan text must surface inactive connected ports");
assert(orphanedCapacityPlan.devices.some((device) => device.warnings.some((warning) => warning.includes("stale link reference"))), "capacity plan must warn about port link IDs that do not have matching link objects");
assert(projectAudit.checks.length >= 10 && projectAudit.categories.some((category) => category.name === "addressing"), "project audit must inspect multiple design categories");
assert(projectAudit.score >= 0 && projectAudit.score <= 100, "project audit score must be bounded");
assert(staleAdminDownProjectAudit.checks.some((check) => check.label === "Operational links" && check.severity === "critical" && check.summary.includes("inactive stored-up")), "project audit must flag stale up links with admin-down endpoint ports as operational failures");
assert(adminDownHelperAudit.checks.some((check) => check.label === "DHCP relay placement" && check.summary.includes("No active helper-address")), "project audit must not count helper-address on admin-down interfaces as active DHCP relay placement");
assert(configDrift.devices.some((device) => device.status === "unsaved"), "config drift must identify unsaved network devices");
assert(configDriftText.includes("Configuration Drift Report") && configDriftText.includes("Status Summary") && configDriftText.includes("Device Status") && configDriftText.includes("startup-config is not saved"), "config drift text must include status tables and unsaved startup-config details");
assert(failureImpact.endpointCount >= 2 && failureImpact.scenarios.length >= project.links.length, "failure impact must inspect link and device scenarios");
assert(failureImpactText.includes("Failure Impact Report") && failureImpactText.includes("Severity Summary") && failureImpactText.includes("Top Scenarios"), "failure impact text must include severity summary and scenario output");
assert(stalePoweredOffSwitchImpact.vulnerableEndpointPairs === 0 && stalePoweredOffSwitchImpact.bridgeLinks.length === 0, "failure impact must not treat stale up links through powered-off devices as active paths");
assert(stalePoweredOffSwitchReachability.checks.some((check) => check.service === "http" && check.status === "blocked" && check.reason.includes("active topology component")), "service reachability must not treat stale up links through powered-off devices as active components");
assert(!fallbackPing(staleAdminDownSwitchPortProject, pc.id, server.id).success, "simulation must not traverse stale up links when either endpoint port is admin-down");
assert(diagnoseProject(staleAdminDownSwitchPortProject).some((issue) => issue.title.includes("링크 상태 불일치")), "diagnostics must warn when a link is stored up but an endpoint port is admin-down");
assert(serviceReachability.totals.clients >= 2 && serviceReachability.totals.servers >= 1, "service reachability must discover clients and service endpoints");
assert(serviceReachabilityText.includes("Service Reachability Report") && serviceReachabilityText.includes("Service Status Summary") && serviceReachabilityText.includes("Service Log Summary") && serviceReachabilityText.includes("| DNS") && serviceReachabilityText.includes("Listening Ports") && serviceReachabilityText.includes(":80") && serviceReachabilityText.includes("PID") && serviceReachabilityText.includes("Process") && serviceReachabilityText.includes("4080") && serviceReachabilityText.includes("ptweb-http.exe") && serviceReachabilityText.includes("Checks"), "service reachability text must include service summary, service logs, listener PID/process, and check output");
assert(securityMatrix.totals.aclRules >= 2 && securityMatrix.totals.natRules >= 2, "security matrix must discover firewall ACL and NAT policy");
assert(securityMatrixText.includes("Security Matrix") && securityMatrixText.includes("Policy Type Summary") && securityMatrixText.includes("Policies") && securityMatrixText.includes("Service Exposure"), "security matrix text must include policy summary and exposure sections");
const dmzHttpExposure = securityMatrix.exposures.find((exposure) => exposure.service === "HTTP" && exposure.ipAddress === "203.0.113.10" && exposure.exposure === "outside" && exposure.reason.includes("Static NAT"));
assert(dmzHttpExposure, "security matrix must report static NAT published services as outside exposure");
const poweredOffDmzServiceProject = dmzHttpExposure ? {
  ...dmzSecurityProject,
  devices: dmzSecurityProject.devices.map((device) => device.id === dmzHttpExposure.deviceId ? { ...device, powerOn: false } : device)
} : dmzSecurityProject;
assert(!analyzeSecurityMatrix(poweredOffDmzServiceProject).exposures.some((exposure) => exposure.service === "HTTP" && exposure.ipAddress === "203.0.113.10"), "security matrix must not report static NAT service exposure for powered-off service devices");
const dmzNatPolicyDevice = dmzSecurityProject.devices.find((device) => device.config.natRules.some((rule) => rule.type === "static" && rule.insideGlobal === "203.0.113.10"));
const poweredOffNatPolicyProject = dmzNatPolicyDevice ? {
  ...dmzSecurityProject,
  devices: dmzSecurityProject.devices.map((device) => device.id === dmzNatPolicyDevice.id ? { ...device, powerOn: false } : device)
} : dmzSecurityProject;
assert(!analyzeSecurityMatrix(poweredOffNatPolicyProject).exposures.some((exposure) => exposure.service === "HTTP" && exposure.ipAddress === "203.0.113.10"), "security matrix must not report static NAT service exposure when the NAT policy device is powered off");
const dmzNatOutsidePort = dmzNatPolicyDevice?.ports.find((port) => port.name === "Ethernet1/3");
assert(dmzNatOutsidePort, "DMZ NAT smoke must find the static NAT outside interface");
const adminDownNatOutsideProject = {
  ...dmzSecurityProject,
  devices: dmzSecurityProject.devices.map((device) => device.id === dmzNatPolicyDevice.id
    ? { ...device, ports: device.ports.map((port) => port.id === dmzNatOutsidePort.id ? { ...port, adminUp: false } : port) }
    : device)
};
assert(!analyzeSecurityMatrix(adminDownNatOutsideProject).exposures.some((exposure) => exposure.service === "HTTP" && exposure.ipAddress === "203.0.113.10"), "security matrix must not report static NAT service exposure when the NAT outside interface is admin-down");
const hostFormatNatProject = {
  ...dmzSecurityProject,
  devices: dmzSecurityProject.devices.map((device) => ({
    ...device,
    config: {
      ...device.config,
      natRules: device.config.natRules.map((rule) => rule.type === "static" && rule.insideGlobal === "203.0.113.10"
        ? { ...rule, insideLocal: `host ${rule.insideLocal}`, insideGlobal: `host ${rule.insideGlobal}` }
        : rule)
    }
  }))
};
const hostFormatSecurityMatrix = analyzeSecurityMatrix(hostFormatNatProject);
assert(hostFormatSecurityMatrix.policies.some((policy) => policy.policyType === "nat" && policy.source.includes("10.30.20.10") && policy.sourceZone !== "unknown"), "security matrix must parse host-form static NAT local addresses for policy zones");
assert(hostFormatSecurityMatrix.exposures.some((exposure) => exposure.service === "HTTP" && exposure.ipAddress === "203.0.113.10"), "security matrix must parse host-form static NAT global addresses for exposure IPs");
assert(routingMatrix.totals.subnets >= 2 && routingMatrix.coverage.length > 0, "routing matrix must discover subnets and route coverage");
assert(routingMatrixText.includes("Routing Matrix") && routingMatrixText.includes("Device Coverage Summary") && routingMatrixText.includes("Device Coverage"), "routing matrix text must include device summary and coverage output");
assert(verificationPlan.tasks.length >= 8 && verificationPlan.totals.required >= 1, "verification plan must generate required verification tasks");
assert(verificationPlanText.includes("Verification Plan") && verificationPlanText.includes("CLI Tasks") && verificationPlanText.includes("PDU Tasks"), "verification plan text must include grouped task sections");
assert(verificationPlanText.includes("Verify desktop identity") && verificationPlanText.includes("Desktop > Command Prompt > getmac") && verificationPlanText.includes("Desktop > Command Prompt > getmac /v") && verificationPlanText.includes("Desktop > Command Prompt > netsh interface ip show config") && verificationPlanText.includes("Desktop > Command Prompt > route print") && verificationPlanText.includes("Desktop > Command Prompt > route print -4"), "verification plan text must include Desktop identity and adapter evidence checks");
assert(verificationPlanText.includes("Desktop > Command Prompt > Test-NetConnection <server> -Port <port>") && verificationPlanText.includes("Desktop > Command Prompt > netstat -an") && verificationPlanText.includes("Desktop > Command Prompt > netstat -ano") && verificationPlanText.includes("Desktop > Command Prompt > netstat -abno") && verificationPlanText.includes("Desktop > Command Prompt > tasklist /svc") && verificationPlanText.includes("Desktop > Command Prompt > sc queryex <service>") && verificationPlanText.includes("Desktop > Command Prompt > nslookup <record> [dns-server]") && verificationPlanText.includes("Desktop Test-NetConnection reports expected TcpTestSucceeded state") && verificationPlanText.includes("Desktop netstat shows expected listening service ports") && verificationPlanText.includes("Desktop netstat -ano shows listener PID evidence") && verificationPlanText.includes("Desktop netstat -abno shows listener process names") && verificationPlanText.includes("Desktop tasklist /svc maps listener PIDs to service process names") && verificationPlanText.includes("Desktop sc queryex shows service state and PID evidence") && verificationPlanText.includes("show services summary") && verificationPlanText.includes("show service logs summary") && verificationPlanText.includes("show ip dhcp pool summary") && verificationPlanText.includes("show ip dhcp binding summary") && verificationPlanText.includes("show hosts summary") && verificationPlanText.includes("show service logs dns") && verificationPlanText.includes("show service logs http"), "verification plan text must include service-specific Desktop, directed DNS, service, and log checks for service devices");
assert(studentWorkbook.sections.length >= 8, "lab workbook must generate multiple student sections");
assert(instructorWorkbookText.includes("Instructor Workbook") && instructorWorkbookText.includes("Grading Checklist"), "instructor workbook must include grading checklist");
assert(instructorWorkbookText.includes("Instructor Activity Checks") && instructorWorkbookText.includes("Router show version output") && instructorWorkbookText.includes("HTTP destination port header"), "instructor workbook must include detailed Activity command-output and packet-header grading checks");
assert(instructorWorkbookText.includes("Service summary") && instructorWorkbookText.includes("listeners") && instructorWorkbookText.includes("HTTP:4080") && instructorWorkbookText.includes("DNS:4053") && instructorWorkbookText.includes("DHCP leases") && instructorWorkbookText.includes("logs DNS") && instructorWorkbookText.includes("SYSLOG"), "lab workbook must include service configuration, listener PID, and DNS/log summary evidence");
assert(instructorWorkbookText.includes("netsh interface ip show config") && instructorWorkbookText.includes("Test-NetConnection <server> -Port <port>") && instructorWorkbookText.includes("Desktop Command Prompt netstat -an, netstat -ano, or netstat -abno plus tasklist /svc and sc queryex <service>") && instructorWorkbookText.includes("PID evidence") && instructorWorkbookText.includes("process names") && instructorWorkbookText.includes("service state") && instructorWorkbookText.includes("nslookup <record> <dns-server>") && instructorWorkbookText.includes("show services summary") && instructorWorkbookText.includes("show ip dhcp pool summary") && instructorWorkbookText.includes("show ip dhcp binding summary") && instructorWorkbookText.includes("show hosts summary") && instructorWorkbookText.includes("show service logs dns") && instructorWorkbookText.includes("show service logs summary"), "lab workbook must recommend Desktop netsh, Test-NetConnection, listener/PID/process/state, directed DNS, service, DHCP, DNS, and log summary checks");
assert(staleAdminDownWorkbookText.includes("inactive (stored up)"), "lab workbook must label stale up links with admin-down endpoint ports as inactive");
assert(projectReportText.includes("## Project Summary"), "project report must include a summary section");
assert(projectReportText.includes("## Device Inventory"), "project report must include device inventory");
assert(staleAdminDownProjectReportText.includes("inactive (stored up)") && staleAdminDownProjectReportText.includes("active)"), "project report must label stale up links and show active port counts");
assert(projectReportText.includes("## Interface Addressing"), "project report must include interface addressing");
assert(projectReportText.includes("## Address Plan") && projectReportText.includes("Subnet Summary"), "project report must include address plan output");
assert(projectReportText.includes("## Capacity Plan") && projectReportText.includes("Device Capacity"), "project report must include capacity plan output");
assert(projectReportText.includes("## Routing Matrix") && projectReportText.includes("Device Coverage Summary") && projectReportText.includes("Subnet Path Checks"), "project report must include routing matrix summary and path-check output");
assert(projectReportText.includes("## Services"), "project report must include services");
assert(projectReportText.includes("Service Summary") && projectReportText.includes("Enabled services") && projectReportText.includes("Runtime logs") && projectReportText.includes("Service Log Summary") && projectReportText.includes("Listening Ports") && projectReportText.includes(":80") && projectReportText.includes("PID") && projectReportText.includes("Process") && projectReportText.includes("4080") && projectReportText.includes("ptweb-http.exe") && projectReportText.includes("| Device") && projectReportText.includes("| DNS"), "project report services section must include service, listener PID/process, and DNS log summary rows");
assert(projectReportText.includes("## Service Reachability") && projectReportText.includes("Service Status Summary") && projectReportText.includes("Service Checks"), "project report must include service reachability summary and check output");
assert(projectReportText.includes("## Security Matrix") && projectReportText.includes("Policy Type Summary") && projectReportText.includes("exposures") && projectReportText.includes("Policy Matrix"), "project report must include security matrix summary and policy output");
assert(projectReportText.includes("## Wireless Survey") && projectReportText.includes("Client Coverage"), "project report must include wireless survey output");
assert(projectReportText.includes("## Runtime Tables") && projectReportText.includes("Runtime Summary") && projectReportText.includes("NAT Translations"), "project report must include runtime summary output");
assert(projectReportText.includes("## Design Audit") && projectReportText.includes("Category Summary"), "project report must include design audit output");
assert(projectReportText.includes("## Configuration Drift") && projectReportText.includes("Device Status"), "project report must include configuration drift output");
assert(projectReportText.includes("## Failure Impact") && projectReportText.includes("Severity Summary") && projectReportText.includes("Top Failure Scenarios"), "project report must include failure impact summary and scenario output");
assert(projectReportText.includes("## Verification Plan") && projectReportText.includes("Generated Tasks"), "project report must include verification plan output");
assert(projectReportText.includes("## Lab Workbook") && projectReportText.includes("Student Sections"), "project report must include lab workbook output");
assert(projectReportText.includes("HTTP") && projectReportText.includes("DNS") && projectReportText.includes("DHCP"), "project report must include enabled services");
assert(projectReportText.includes("Command Output Assertions") && projectReportText.includes("Router show version output"), "project report must include Activity command output assertion details");
assert(projectReportText.includes("Packet Header Assertions") && projectReportText.includes("HTTP destination port header") && projectReportText.includes("Destination port"), "project report must include Activity packet-header assertion details");
assert(httpHeaderReportText.includes("Latest PDU Headers") && httpHeaderReportText.includes("Destination port=80") && httpHeaderReportText.includes("Layer 7 Operation=GET"), "project report must include explicit PDU header summaries for simulation events");
assert(legacyHeaderReportText.includes("Destination port=69") && legacyHeaderReportText.includes("Layer 7 Operation=Read request"), "project report must infer PDU header summaries for legacy events without stored headers");
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
const ospfVerificationPlanText = buildVerificationPlanText(ospfCampus);
assert(ospfVerificationPlanText.includes("show ip ospf interface brief") && ospfVerificationPlanText.includes("show ip ospf neighbor"), "verification plan must include OSPF-specific CLI checks for OSPF labs");
assert(ospfVerificationPlanText.includes("show spanning-tree summary") && ospfVerificationPlanText.includes("show ip dhcp snooping summary"), "verification plan must include STP and DHCP snooping summary checks for switching labs");
const dualWanPbr = sampleProjectsByTemplate["dual-wan-pbr"];
const dualWanKinds = new Set(dualWanPbr.activity.requirements.map((requirement) => requirement.kind));
const pbrBranch = dualWanPbr.devices.find((device) => device.config.hostname === "BRANCH-PBR");
assert(dualWanKinds.has("pbr-route-map-count") && dualWanKinds.has("ip-sla-track-count") && dualWanKinds.has("prefix-list-count"), "Dual-WAN sample must use PBR and IP SLA Activity requirements");
assert(pbrBranch && pbrBranch.config.prefixLists.some((entry) => entry.name === "APP-NET"), "Dual-WAN sample must include an application prefix-list");
assert(pbrBranch.config.routeMaps.some((entry) => entry.name === "PBR-APP" && entry.setNextHop === "198.51.100.1"), "Dual-WAN sample must include a policy route-map with backup next-hop");
assert(pbrBranch.config.ipSlaOperations.some((operation) => operation.operationId === 10) && pbrBranch.config.trackObjects.some((track) => track.trackId === 10), "Dual-WAN sample must include IP SLA and track objects");
assert(pbrBranch.config.staticRoutes.some((route) => route.trackId === 10) && pbrBranch.config.staticRoutes.some((route) => route.distance === 200), "Dual-WAN sample must include tracked primary and floating backup defaults");
const dualWanVerificationPlanText = buildVerificationPlanText(dualWanPbr);
assert(dualWanVerificationPlanText.includes("show route-map summary") && dualWanVerificationPlanText.includes("show ip prefix-list summary"), "verification plan must include policy summary CLI checks for PBR labs");
const dualWanWorkbookText = buildLabWorkbookText(dualWanPbr, "instructor");
assert(dualWanWorkbookText.includes("Prefix-list entries:") && dualWanWorkbookText.includes("Route-map entries:") && dualWanWorkbookText.includes("PBR-enabled ports:"), "instructor workbook must summarize prefix-list, route-map, and PBR port policy counts");
const dualWanSecurityMatrixText = buildSecurityMatrixReportText(dualWanPbr);
assert(dualWanSecurityMatrixText.includes("Prefix-list entries:") && dualWanSecurityMatrixText.includes("Route-map entries:"), "security matrix must summarize prefix-list and route-map policy counts");
const firewallDmz = sampleProjectsByTemplate["firewall-dmz"];
const firewallKinds = new Set(firewallDmz.activity.requirements.map((requirement) => requirement.kind));
const dmzFirewall = firewallDmz.devices.find((device) => device.config.hostname === "FPR-DMZ");
assert(firewallKinds.has("acl-rule-count") && firewallKinds.has("nat-rule-count") && firewallKinds.has("routed-port-count"), "DMZ sample must use security Activity requirements");
assert(dmzFirewall && dmzFirewall.kind === "firewall", "DMZ sample must include a firewall device");
assert(dmzFirewall.config.accessRules.some((rule) => rule.listName === "OUTSIDE-IN" && rule.protocol === "http"), "DMZ sample must include outside HTTP ACL policy");
assert(dmzFirewall.config.natRules.some((rule) => rule.type === "static" && rule.insideGlobal === "203.0.113.10"), "DMZ sample must publish the DMZ server with static NAT");
assert(dmzFirewall.ports.some((port) => port.natRole === "inside") && dmzFirewall.ports.some((port) => port.natRole === "outside"), "DMZ sample must mark inside and outside NAT roles");
assert(buildVerificationPlanText(firewallDmz).includes("show access-list summary"), "verification plan must include ACL summary CLI checks for security labs");
const firewallReportText = buildProjectReportText(firewallDmz, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
assert(firewallReportText.includes("Policy Summary") && firewallReportText.includes("FPR-DMZ"), "project report must include security policy summary rows for policy-heavy labs");
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
const wirelessAp = wirelessCampus.devices.find((device) => device.modelId === "ap-catalyst-9120axi");
const wirelessApUplink = wirelessAp?.ports.find((port) => port.kind !== "wireless" && port.kind !== "console" && port.linkId);
assert(wirelessAp && wirelessApUplink, "wireless campus sample must include a linked AP wired uplink");
const adminDownWirelessBackhaulProject = {
  ...wirelessCampus,
  devices: wirelessCampus.devices.map((device) => device.id === wirelessAp.id
    ? { ...device, ports: device.ports.map((port) => port.id === wirelessApUplink.id ? { ...port, adminUp: false } : port) }
    : device)
};
const adminDownWirelessSurvey = analyzeWirelessSurvey(adminDownWirelessBackhaulProject);
assert(adminDownWirelessSurvey.infrastructure.some((node) => node.deviceId === wirelessAp.id && node.uplinkCount === 0), "wireless survey must count only line-protocol-up wired AP uplinks");
assert(adminDownWirelessSurvey.backhaul.some((check) => check.deviceLabel === wirelessAp.label && check.status === "critical" && check.detail.includes("no active wired backhaul")), "wireless survey must not treat a stale up link on an admin-down AP port as active backhaul");
const poweredOffWirelessApProject = {
  ...wirelessCampus,
  devices: wirelessCampus.devices.map((device) => device.id === wirelessAp.id ? { ...device, powerOn: false } : device)
};
const poweredOffWirelessApSurvey = analyzeWirelessSurvey(poweredOffWirelessApProject);
assert(poweredOffWirelessApSurvey.grid.every((cell) => cell.bestAp !== wirelessAp.label) && poweredOffWirelessApSurvey.channelReuse.every((check) => check.leftAp !== wirelessAp.label && check.rightAp !== wirelessAp.label), "wireless survey must not use powered-off APs as active RF coverage or channel-reuse candidates");
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
assert(dualGeNim.ok && dualGeNim.device.ports.some((port) => port.name === "GigabitEthernet0/1/1" && port.kind === "fiber" && port.mode === "routed" && port.mediaSelection === "auto" && port.mediaOptions?.includes("gigabit-ethernet")), "ISR 4451-X must accept NIM-2GE-CU-SFP and create routed dual-media GE ports");

const cat2960x = createDevice("switch-2960x-24ps", { x: 20, y: 20 }, []);
assert(cat2960x.ports.filter((port) => port.kind === "gigabit-ethernet").length >= 24, "2960X-24PS must expose 24 Gigabit access ports");
assert(cat2960x.ports.filter((port) => port.kind === "fiber").length === 4, "2960X-24PS must expose 4 SFP uplinks");

const cat2960tcA = createDevice("switch-2960-24tc", { x: 24, y: 20 }, []);
const cat2960tcB = createDevice("switch-2960-24tc", { x: 28, y: 20 }, [cat2960tcA]);
const dualA = cat2960tcA.ports.find((port) => port.name === "GigabitEthernet0/1");
const dualB = cat2960tcB.ports.find((port) => port.name === "GigabitEthernet0/1");
assert(dualA && dualB && dualA.mediaOptions?.includes("fiber") && dualA.mediaOptions?.includes("gigabit-ethernet"), "2960-24TC uplinks must model dual-purpose RJ-45/SFP media");
assert(effectivePortKind(dualA) === "fiber" && getTransceiverSpec(dualA.transceiverId)?.media === "mmf", "2960-24TC dual-purpose uplink must default to an optical SFP");
assert(dualA.mediaSelection === "auto" && canPortUseCable(dualA, "fiber") && canPortUseCable(dualA, "copper-straight"), "2960-24TC auto-select uplink must accept either SFP or RJ-45 cabling before link-up");
let dualProject = { id: "project_dual_media_smoke", ownerId: "user_feature_smoke", name: "Dual media smoke", devices: [cat2960tcA, cat2960tcB], links: [], notes: [], drawings: [], simulationEvents: [] };
let dualConnect = validateConnection(dualProject, cat2960tcA.id, cat2960tcB.id, "fiber", dualA.id, dualB.id);
assert(dualConnect.ok && dualConnect.link.type === "fiber", "SFP-active dual-purpose ports must connect with fiber");
const lxLhCompatibleProject = {
  ...dualProject,
  devices: dualProject.devices.map((device) => ({
    ...device,
    ports: device.ports.map((port) => port.id === dualB.id ? { ...port, transceiverId: "GLC-LH-SMD" } : port)
  }))
};
const lxLhCompatibleA = lxLhCompatibleProject.devices[0].ports.find((port) => port.id === dualA.id);
const lxLhCompatibleB = lxLhCompatibleProject.devices[1].ports.find((port) => port.id === dualB.id);
const lxLhCompatibleConnect = validateConnection(lxLhCompatibleProject, cat2960tcA.id, cat2960tcB.id, "fiber", lxLhCompatibleA.id, lxLhCompatibleB.id);
assert(lxLhCompatibleConnect.ok && lxLhCompatibleConnect.link.status === "up", "1000BASE-SX and 1000BASE-LX/LH optics must share MMF compatibility in short lab links");
const tenGigBaseA = createDevice("switch-3560x-24t", { x: 30, y: 20 }, []);
const tenGigBaseB = createDevice("switch-3560x-24t", { x: 34, y: 20 }, [tenGigBaseA]);
const tenGigInstallA = installModule({ ...tenGigBaseA, powerOn: false }, "slot1", "C3KX-NM-10G");
const tenGigInstallB = installModule({ ...tenGigBaseB, powerOn: false }, "slot1", "C3KX-NM-10G");
assert(tenGigInstallA.ok && tenGigInstallB.ok, "Catalyst 3560X must accept C3KX-NM-10G for SR/LR optic compatibility checks");
const tenGigA = { ...tenGigInstallA.device, powerOn: true };
const tenGigB = { ...tenGigInstallB.device, powerOn: true };
const tenGigPortA = tenGigA.ports.find((port) => port.name === "TenGigabitEthernet1/1/1");
const tenGigPortB = tenGigB.ports.find((port) => port.name === "TenGigabitEthernet1/1/1");
assert(tenGigPortA && tenGigPortB, "Catalyst 3560X C3KX-NM-10G must expose 10G fiber ports for SR/LR optic compatibility checks");
const tenGigMismatchProject = {
  ...project,
  devices: [
    tenGigA,
    { ...tenGigB, ports: tenGigB.ports.map((port) => port.id === tenGigPortB.id ? { ...port, transceiverId: "SFP-10G-LR" } : port) }
  ],
  links: []
};
const tenGigMismatchB = tenGigMismatchProject.devices[1].ports.find((port) => port.id === tenGigPortB.id);
const tenGigMismatchConnect = validateConnection(tenGigMismatchProject, tenGigA.id, tenGigB.id, "fiber", tenGigPortA.id, tenGigMismatchB.id);
assert(tenGigMismatchConnect.ok && tenGigMismatchConnect.link.status === "down", "10GBASE-SR MMF and 10GBASE-LR SMF optics must keep the same fiber link down");
const tenGigMismatchLinked = addLink(tenGigMismatchProject, tenGigMismatchConnect.link);
assert(diagnoseProject(recalc(tenGigMismatchLinked)).some((issue) => issue.title.includes("광 모듈 불일치")), "diagnostics must explain fiber optic media mismatch");
dualConnect = validateConnection(dualProject, cat2960tcA.id, cat2960tcB.id, "copper-cross", dualA.id, dualB.id);
assert(dualConnect.ok && dualConnect.link.type === "copper-cross", "auto-select dual-purpose ports must also validate explicit RJ-45 copper cabling");
const copperAutoProject = addLink(dualProject, dualConnect.link);
const copperAutoPort = copperAutoProject.devices[0].ports.find((port) => port.id === dualA.id);
assert(effectivePortKind(copperAutoPort) === "gigabit-ethernet" && !copperAutoPort.transceiverId, "auto-select dual-purpose ports must activate built-in RJ-45 media after copper link-up");
dualProject = { ...dualProject, devices: [
  { ...cat2960tcA, ports: cat2960tcA.ports.map((port) => port.id === dualA.id ? { ...port, mediaSelection: "rj45", activeMedia: "gigabit-ethernet", transceiverId: undefined } : port) },
  { ...cat2960tcB, ports: cat2960tcB.ports.map((port) => port.id === dualB.id ? { ...port, mediaSelection: "rj45", activeMedia: "gigabit-ethernet", transceiverId: undefined } : port) }
] };
const dualCopperA = dualProject.devices[0].ports.find((port) => port.id === dualA.id);
const dualCopperB = dualProject.devices[1].ports.find((port) => port.id === dualB.id);
assert(effectivePortKind(dualCopperA) === "gigabit-ethernet" && !dualCopperA.transceiverId, "RJ-45 active dual-purpose uplink must expose built-in copper media without an SFP transceiver");
assert(canPortUseCable(dualCopperA, "copper-straight") && !canPortUseCable(dualCopperA, "fiber"), "RJ-45 active dual-purpose uplink must accept copper and reject fiber");
dualConnect = validateConnection(dualProject, cat2960tcA.id, cat2960tcB.id, "fiber", dualCopperA.id, dualCopperB.id);
assert(!dualConnect.ok, "RJ-45 active dual-purpose ports must reject explicit fiber cable");
dualConnect = validateConnection(dualProject, cat2960tcA.id, cat2960tcB.id, "auto", dualCopperA.id, dualCopperB.id);
assert(dualConnect.ok && dualConnect.link.type === "copper-cross", "RJ-45 active dual-purpose switch-to-switch auto cable must infer copper crossover");
const staleFiberLink = {
  id: "link_stale_fiber_media",
  type: "fiber",
  endpointA: { deviceId: cat2960tcA.id, portId: dualCopperA.id },
  endpointB: { deviceId: cat2960tcB.id, portId: dualCopperB.id },
  status: "up",
  createdAt: Date.now()
};
const staleFiberProject = {
  ...dualProject,
  links: [staleFiberLink],
  devices: dualProject.devices.map((device) => ({
    ...device,
    ports: device.ports.map((port) => port.id === dualCopperA.id || port.id === dualCopperB.id ? { ...port, linkId: staleFiberLink.id } : port)
  }))
};
const staleFiberRecalc = recalc(staleFiberProject);
assert(staleFiberRecalc.links[0].status === "down", "recalc must mark links down when cable type no longer matches manual media selection");
assert(diagnoseProject(staleFiberRecalc).some((issue) => issue.title === "케이블/media 불일치"), "diagnostics must report stale cable/media mismatches");

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
const cat9300x24y = createDevice("switch-9300x-24y", { x: 58, y: 20 }, [cat9300]);
assert(cat9300x24y.ports.filter((port) => port.name.startsWith("TwentyFiveGigabitEthernet1/0/")).length === 24, "Catalyst 9300X-24Y must expose 24 25G SFP28 fiber ports");
assert(!cat9300x24y.ports.some((port) => port.name.startsWith("GigabitEthernet1/0/")), "Catalyst 9300X-24Y must not downgrade SFP28 ports to generic GigabitEthernet names");
assert(getTransceiverSpec(cat9300x24y.ports.find((port) => port.name === "TwentyFiveGigabitEthernet1/0/1")?.transceiverId)?.speedMbps === 25000, "Catalyst 9300X-24Y ports must default to 25G SFP28 optics");

const cat9500 = createDevice("switch-9500-32c", { x: 60, y: 20 }, []);
assert(cat9500.modules.length === 0, "Catalyst 9500 fixed distribution models must not expose removable network modules");
assert(cat9500.ports.filter((port) => port.name.startsWith("HundredGigabitEthernet1/0/") && port.ipCapable).length === 32, "Catalyst 9500-32C must expose routed 100G fiber ports");
const cat9500y4c = createDevice("switch-9500-24y4c", { x: 61, y: 20 }, [cat9500]);
assert(cat9500y4c.ports.filter((port) => port.name.startsWith("TwentyFiveGigabitEthernet1/0/")).length === 24, "Catalyst 9500-24Y4C must expose 24 routed 25G SFP28 ports");
assert(cat9500y4c.ports.filter((port) => port.name.startsWith("HundredGigabitEthernet1/0/")).length === 4, "Catalyst 9500-24Y4C must expose four routed 100G QSFP28 uplinks");
assert(getTransceiverSpec(cat9500y4c.ports.find((port) => port.name === "TwentyFiveGigabitEthernet1/0/1")?.transceiverId)?.speedMbps === 25000, "Catalyst 9500-24Y4C 25G ports must default to SFP28 optics");
assert(getTransceiverSpec(cat9500y4c.ports.find((port) => port.name === "HundredGigabitEthernet1/0/25")?.transceiverId)?.speedMbps === 100000, "Catalyst 9500-24Y4C 100G uplinks must default to QSFP28 optics");
const cat9500y48 = createDevice("switch-9500-48y4c", { x: 62, y: 20 }, [cat9500, cat9500y4c]);
assert(cat9500y48.ports.filter((port) => port.name.startsWith("TwentyFiveGigabitEthernet1/0/")).length === 48, "Catalyst 9500-48Y4C must expose 48 routed 25G SFP28 ports");
assert(cat9500y48.ports.filter((port) => port.name.startsWith("HundredGigabitEthernet1/0/")).length === 4, "Catalyst 9500-48Y4C must expose four routed 100G QSFP28 uplinks");
const cat9500Port = cat9500.ports.find((port) => port.name === "HundredGigabitEthernet1/0/1");
assert(cat9500Port && getTransceiverSpec(cat9500Port.transceiverId)?.speedMbps === 100000, "Catalyst 9500 100G ports must default to a 100G QSFP28 transceiver");
const badOpticsProject = {
  ...project,
  devices: [{ ...cat9500, ports: cat9500.ports.map((port) => port.id === cat9500Port.id ? { ...port, transceiverId: "GLC-SX-MMD" } : port) }],
  links: []
};
assert(diagnoseProject(badOpticsProject).some((issue) => issue.title.includes("transceiver speed 불일치")), "diagnostics must reject a 1G SFP installed in a 100G port");
const cat9500Peer = createDevice("switch-9500-32c", { x: 62, y: 20 }, [cat9500]);
const badOpticsA = { ...cat9500, ports: cat9500.ports.map((port) => port.id === cat9500Port.id ? { ...port, transceiverId: "GLC-SX-MMD" } : port) };
const cat9500PeerPort = cat9500Peer.ports.find((port) => port.name === "HundredGigabitEthernet1/0/1");
const badOpticsLinkProject = { ...project, devices: [badOpticsA, cat9500Peer], links: [] };
const badOpticsConnect = validateConnection(badOpticsLinkProject, badOpticsA.id, cat9500Peer.id, "fiber", cat9500Port.id, cat9500PeerPort.id);
assert(badOpticsConnect.ok && badOpticsConnect.link.status === "down", "1G optic in a 100G port must keep the fiber link down");
const badOpticsLinked = addLink(badOpticsLinkProject, badOpticsConnect.link);
assert(recalc(badOpticsLinked).links[0].status === "down", "recalc must keep mismatched 100G optics down");
assert(diagnoseProject(recalc(badOpticsLinked)).some((issue) => issue.title.includes("광 모듈 불일치")), "diagnostics must explain 100G fiber optic speed mismatch on connected links");
const normalizedOpticsProject = normalizeProject({
  ...project,
  devices: [{ ...cat9500, ports: cat9500.ports.map((port) => port.id === cat9500Port.id ? { ...port, transceiverId: undefined } : port) }],
  links: []
});
const normalizedOpticsPort = normalizedOpticsProject.devices[0].ports.find((port) => port.id === cat9500Port.id);
assert(getTransceiverSpec(normalizedOpticsPort?.transceiverId)?.speedMbps === 100000, "normalizeProject must restore missing 100G optics with a 100G transceiver");
const normalizedUnknownOpticsProject = normalizeProject({
  ...project,
  devices: [{ ...cat9500, ports: cat9500.ports.map((port) => port.id === cat9500Port.id ? { ...port, transceiverId: "UNKNOWN-QSFP" } : port) }],
  links: []
});
const normalizedUnknownOpticsPort = normalizedUnknownOpticsProject.devices[0].ports.find((port) => port.id === cat9500Port.id);
assert(getTransceiverSpec(normalizedUnknownOpticsPort?.transceiverId)?.speedMbps === 100000, "normalizeProject must replace unknown optics with a port-speed default transceiver");

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

const serverDataPort = server.ports.find((port) => port.kind !== "console" && port.ipAddress);
assert(serverDataPort, "service ACL smoke must find the routed sample server data port");
const httpAclProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.id === natOutsidePort.id ? { ...port, accessGroupOut: "WEB-FILTER" } : port),
        config: {
          ...device.config,
          accessRules: [
            ...device.config.accessRules,
            { id: "acl_http_deny_smoke", listName: "WEB-FILTER", listType: "extended", interfaceName: "WEB-FILTER", action: "deny", protocol: "http", source: "192.168.10.0 0.0.0.255", destination: `host ${serverDataPort.ipAddress}`, sequence: 10, hits: 0 },
            { id: "acl_http_permit_rest_smoke", listName: "WEB-FILTER", listType: "extended", interfaceName: "WEB-FILTER", action: "permit", protocol: "ip", source: "any", destination: "any", sequence: 20, hits: 0 }
          ]
        }
      }
    : device)
};
const httpBlocked = fallbackPing(httpAclProject, pc.id, server.id, "http");
const httpBlockedRouter = httpBlocked.project.devices.find((device) => device.id === router.id);
assert(!httpBlocked.success && httpBlocked.message.includes("HTTP"), "HTTP fallback traffic must be evaluated against service-specific ACL rules");
assert(httpBlockedRouter.config.accessRules.some((rule) => rule.id === "acl_http_deny_smoke" && rule.hits === 1), "service-specific ACL deny rule must increment hits for HTTP traffic");
assert(fallbackPing(httpAclProject, pc.id, server.id).success, "service-specific HTTP deny ACL with a later permit ip rule must not block ICMP ping");
assert(analyzeServiceReachability(httpAclProject).checks.some((check) => check.client.deviceId === pc.id && check.service === "http" && check.status === "blocked" && check.reason.includes("HTTP")), "service reachability must reflect service-specific ACL blocks");
assert(requiresTypeScriptPingFallback(httpAclProject), "ACL projects must stay on the TypeScript ping engine until Rust evaluates ACLs");

const dnsAclProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.id === natOutsidePort.id ? { ...port, accessGroupOut: "DNS-FILTER" } : port),
        config: {
          ...device.config,
          accessRules: [
            ...device.config.accessRules,
            { id: "acl_dns_udp_deny_smoke", listName: "DNS-FILTER", listType: "extended", interfaceName: "DNS-FILTER", action: "deny", protocol: "udp", source: "192.168.10.0 0.0.0.255", destination: `host ${serverDataPort.ipAddress}`, sequence: 10, hits: 0 },
            { id: "acl_dns_permit_rest_smoke", listName: "DNS-FILTER", listType: "extended", interfaceName: "DNS-FILTER", action: "permit", protocol: "ip", source: "any", destination: "any", sequence: 20, hits: 0 }
          ]
        }
      }
    : device)
};
const dnsBlocked = fallbackPing(dnsAclProject, pc.id, server.id, "dns");
const dnsBlockedRouter = dnsBlocked.project.devices.find((device) => device.id === router.id);
assert(!dnsBlocked.success && dnsBlocked.message.includes("DNS"), "DNS fallback traffic must match UDP ACL rules");
assert(dnsBlockedRouter.config.accessRules.some((rule) => rule.id === "acl_dns_udp_deny_smoke" && rule.hits === 1), "UDP deny rule must increment hits for DNS traffic");
assert(fallbackPing(dnsAclProject, pc.id, server.id, "http").success, "UDP deny ACL with a later permit ip rule must not block HTTP/TCP traffic");
assert(analyzeServiceReachability(dnsAclProject).checks.some((check) => check.client.deviceId === pc.id && check.service === "dns" && check.status === "blocked" && check.reason.includes("DNS")), "service reachability must reflect UDP ACL blocks for DNS");

const hsrpPcPort = pc.ports.find((port) => port.kind !== "console");
const routerLanPort = router.ports.find((port) => port.ipAddress === "192.168.10.1");
assert(hsrpPcPort && routerLanPort, "HSRP smoke must find PC data port and router LAN interface");
const missingGatewayProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.id === hsrpPcPort.id ? { ...port, gateway: "192.168.10.254" } : port) }
    : device)
};
assert(diagnoseProject(missingGatewayProject).some((issue) => issue.title.includes("gateway가 프로젝트에 없습니다") && issue.detail.includes("192.168.10.254")), "diagnostics must warn when an endpoint gateway address is not owned by any router, SVI, HSRP, or VRRP interface");
assert(analyzeProjectAudit(missingGatewayProject).checks.some((check) => check.label === "Gateway reachability" && check.severity === "critical" && check.summary.includes("1 endpoints")), "project audit must fail gateway reachability when a gateway IP is merely in-subnet but not owned");
const offSubnetOwnedGatewayProject = {
  ...project,
  devices: project.devices.map((device) => device.id === pc.id
    ? { ...device, ports: device.ports.map((port) => port.id === hsrpPcPort.id ? { ...port, gateway: "10.10.10.1" } : port) }
    : device)
};
assert(analyzeProjectAudit(offSubnetOwnedGatewayProject).checks.some((check) => check.label === "Gateway reachability" && check.severity === "critical"), "project audit must fail gateway reachability when the gateway IP is owned outside the host subnet");
assert(analyzeServiceReachability(offSubnetOwnedGatewayProject).checks.some((check) => check.client.deviceId === pc.id && check.status === "blocked" && check.reason.includes("Gateway 10.10.10.1")), "service reachability must reject a gateway IP that is owned outside the client subnet");
const poweredOffGatewayProject = {
  ...project,
  devices: project.devices.map((device) => device.id === router.id ? { ...device, powerOn: false } : device)
};
assert(analyzeProjectAudit(poweredOffGatewayProject).checks.some((check) => check.label === "Gateway reachability" && check.severity === "critical"), "project audit must fail gateway reachability when the gateway owner is powered off");
assert(diagnoseProject(poweredOffGatewayProject).some((issue) => issue.title.includes("gateway가 프로젝트에 없습니다") && issue.detail.includes("192.168.10.1")), "diagnostics must reject powered-off gateway owners for endpoint gateway validation");
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
assert(!diagnoseProject(hsrpProject).some((issue) => issue.title.includes("gateway가 프로젝트에 없습니다")), "diagnostics must accept HSRP virtual IPs as valid endpoint gateways");
assert(!analyzeProjectAudit(hsrpProject).checks.some((check) => check.label === "Gateway reachability" && check.severity === "critical"), "project audit must accept HSRP virtual IPs as owned endpoint gateways");
assert(requiresTypeScriptPingFallback(hsrpProject), "HSRP virtual gateway projects must stay on the TypeScript engine until Rust supports FHRP");

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
assert(!diagnoseProject(vrrpProject).some((issue) => issue.title.includes("gateway가 프로젝트에 없습니다")), "diagnostics must accept VRRP virtual IPs as valid endpoint gateways");
assert(!analyzeProjectAudit(vrrpProject).checks.some((check) => check.label === "Gateway reachability" && check.severity === "critical"), "project audit must accept VRRP virtual IPs as owned endpoint gateways");
assert(requiresTypeScriptPingFallback(vrrpProject), "VRRP virtual gateway projects must stay on the TypeScript engine until Rust supports FHRP");

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
assert(requiresTypeScriptPingFallback(secondaryGatewayProject), "secondary gateway projects must stay on the TypeScript engine until Rust supports secondary interface addresses");

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

function dataPort(device, index = 0) {
  return device.ports.filter((port) => port.kind !== "console" && port.kind !== "serial")[index];
}

function withPort(device, targetPort, patch) {
  return { ...device, ports: device.ports.map((port) => port.id === targetPort.id ? { ...port, ...patch } : port) };
}

function routingProtocolProcess(protocol, networks, options = {}) {
  return {
    id: options.id ?? `routing_${protocol}_smoke`,
    protocol,
    processId: options.processId ?? "10",
    networks,
    routerId: options.routerId,
    version: protocol === "rip" ? "2" : undefined,
    autoSummary: false,
    passiveInterfaces: options.passiveInterfaces ?? [],
    passiveInterfaceDefault: Boolean(options.passiveInterfaceDefault),
    passiveInterfaceExceptions: options.passiveInterfaceExceptions ?? [],
    redistributeStatic: false,
    defaultInformationOriginate: false,
    defaultInformationAlways: false
  };
}

function ospfProcess(networks, options = {}) {
  return routingProtocolProcess("ospf", networks, options);
}

function eigrpProcess(networks, options = {}) {
  return routingProtocolProcess("eigrp", networks, options);
}

function buildDynamicRoutingSmoke(options) {
  const dynPc = createDevice("pc-pt", { x: 20, y: 500 }, []);
  const dynR1 = createDevice("router-1941", { x: 190, y: 500 }, [dynPc]);
  const dynR2 = createDevice("router-1941", { x: 360, y: 500 }, [dynPc, dynR1]);
  const dynServer = createDevice("server-pt", { x: 530, y: 500 }, [dynPc, dynR1, dynR2]);
  const pcPort = dataPort(dynPc);
  const r1Lan = dataPort(dynR1, 0);
  const r1Wan = dataPort(dynR1, 1);
  const r2Wan = dataPort(dynR2, 0);
  const r2Lan = dataPort(dynR2, 1);
  const serverPort = dataPort(dynServer);
  assert(pcPort && r1Lan && r1Wan && r2Wan && r2Lan && serverPort, "dynamic routing smoke must have enough Ethernet ports");
  const protocolProcess = options.protocol === "eigrp" ? eigrpProcess : ospfProcess;
  let dynProject = {
    id: `project_dynamic_routing_${options.id}`,
    ownerId: "user_feature_smoke",
    name: `Dynamic routing smoke ${options.id}`,
    devices: [
      withPort(dynPc, pcPort, { ipAddress: "192.168.1.10", subnetMask: "255.255.255.0", gateway: "192.168.1.1" }),
      {
        ...withPort(withPort(dynR1, r1Lan, { mode: "routed", allowedVlans: [1], ipAddress: "192.168.1.1", subnetMask: "255.255.255.0" }), r1Wan, { mode: "routed", allowedVlans: [1], ipAddress: "10.0.12.1", subnetMask: "255.255.255.252" }),
        config: { ...dynR1.config, routingProtocols: [protocolProcess(options.r1Networks, { id: `${options.protocol ?? "ospf"}_r1_${options.id}`, processId: options.r1ProcessId, routerId: "1.1.1.1", passiveInterfaces: options.r1PassiveInterfaces, passiveInterfaceDefault: options.r1PassiveDefault, passiveInterfaceExceptions: options.r1PassiveExceptions })] }
      },
      {
        ...withPort(withPort(dynR2, r2Wan, { mode: "routed", allowedVlans: [1], ipAddress: "10.0.12.2", subnetMask: "255.255.255.252" }), r2Lan, { mode: "routed", allowedVlans: [1], ipAddress: "192.168.2.1", subnetMask: "255.255.255.0" }),
        config: { ...dynR2.config, routingProtocols: [protocolProcess(options.r2Networks, { id: `${options.protocol ?? "ospf"}_r2_${options.id}`, processId: options.r2ProcessId, routerId: "2.2.2.2", passiveInterfaces: options.r2PassiveInterfaces, passiveInterfaceDefault: options.r2PassiveDefault, passiveInterfaceExceptions: options.r2PassiveExceptions })] }
      },
      withPort(dynServer, serverPort, { ipAddress: "192.168.2.10", subnetMask: "255.255.255.0", gateway: "192.168.2.1" })
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
    [dynPc, dynR1, pcPort, r1Lan, "PC to R1"],
    [dynR1, dynR2, r1Wan, r2Wan, "R1 to R2 transit"],
    [dynR2, dynServer, r2Lan, serverPort, "R2 to server"]
  ]) {
    const connection = validateConnection(dynProject, leftDevice.id, rightDevice.id, "auto", leftPort.id, rightPort.id);
    assert(connection.link, `dynamic routing ${label} link must validate`);
    dynProject = addLink(dynProject, connection.link);
  }
  return { project: recalc(dynProject), sourceId: dynPc.id, targetId: dynServer.id };
}

const dynamicOspfGood = buildDynamicRoutingSmoke({
  id: "good",
  r1Networks: ["10.0.12.0 0.0.0.3", "192.168.1.0 0.0.0.255"],
  r2Networks: ["10.0.12.0 0.0.0.3", "192.168.2.0 0.0.0.255"]
});
assert(fallbackPing(dynamicOspfGood.project, dynamicOspfGood.sourceId, dynamicOspfGood.targetId).success, "dynamic routing must learn a remote connected network through an advertised OSPF transit adjacency");
const dynamicOspfFirstRouter = dynamicOspfGood.project.devices.find((device) => device.config.routingProtocols?.some((protocol) => protocol.protocol === "ospf"));
assert(dynamicOspfFirstRouter, "dynamic routing smoke must expose an OSPF router for matrix power-state checks");
const poweredOffDynamicOspfMatrix = analyzeRoutingMatrix({
  ...dynamicOspfGood.project,
  devices: dynamicOspfGood.project.devices.map((device) => device.id === dynamicOspfFirstRouter.id ? { ...device, powerOn: false } : device)
});
const poweredOffDynamicOspfCoverage = poweredOffDynamicOspfMatrix.coverage.find((entry) => entry.deviceId === dynamicOspfFirstRouter.id && entry.subnetKey === "192.168.2.0/24");
assert(poweredOffDynamicOspfCoverage?.coverage === "missing", "routing matrix must not report dynamic route coverage from powered-off routing devices");

const dynamicOspfUnadvertisedTarget = buildDynamicRoutingSmoke({
  id: "unadvertised_target",
  r1Networks: ["10.0.12.0 0.0.0.3"],
  r2Networks: ["10.0.12.0 0.0.0.3"]
});
assert(!fallbackPing(dynamicOspfUnadvertisedTarget.project, dynamicOspfUnadvertisedTarget.sourceId, dynamicOspfUnadvertisedTarget.targetId).success, "dynamic routing must not learn a neighbor connected network unless that network is advertised");
assert(diagnoseProject(dynamicOspfUnadvertisedTarget.project).some((issue) => issue.title.includes("동적 라우팅 연결망 미광고") && issue.detail.includes("192.168.2.0/24")), "diagnostics must explain unadvertised dynamic routing connected networks");

const dynamicOspfMissingTransit = buildDynamicRoutingSmoke({
  id: "missing_transit",
  r1Networks: ["10.0.12.0 0.0.0.3"],
  r2Networks: ["192.168.2.0 0.0.0.255"]
});
assert(!fallbackPing(dynamicOspfMissingTransit.project, dynamicOspfMissingTransit.sourceId, dynamicOspfMissingTransit.targetId).success, "dynamic routing must not form an adjacency when the peer does not advertise the transit interface");
assert(diagnoseProject(dynamicOspfMissingTransit.project).some((issue) => issue.title.includes("동적 라우팅 transit network 누락") && issue.detail.includes("missing")), "diagnostics must explain missing dynamic routing transit network statements");

const dynamicEigrpProcessMismatch = buildDynamicRoutingSmoke({
  id: "eigrp_process_mismatch",
  protocol: "eigrp",
  r1ProcessId: "10",
  r2ProcessId: "20",
  r1Networks: ["10.0.12.0 0.0.0.3", "192.168.1.0 0.0.0.255"],
  r2Networks: ["10.0.12.0 0.0.0.3", "192.168.2.0 0.0.0.255"]
});
assert(!fallbackPing(dynamicEigrpProcessMismatch.project, dynamicEigrpProcessMismatch.sourceId, dynamicEigrpProcessMismatch.targetId).success, "EIGRP dynamic routing must not form an adjacency when process IDs do not match");
assert(diagnoseProject(dynamicEigrpProcessMismatch.project).some((issue) => issue.title.includes("동적 라우팅 프로토콜 불일치") && issue.detail.includes("EIGRP 10") && issue.detail.includes("EIGRP 20")), "diagnostics must explain EIGRP process/AS mismatches");

const dynamicOspfPassive = buildDynamicRoutingSmoke({
  id: "passive",
  r1Networks: ["10.0.12.0 0.0.0.3"],
  r2Networks: ["10.0.12.0 0.0.0.3", "192.168.2.0 0.0.0.255"],
  r1PassiveInterfaces: ["GigabitEthernet0/1"]
});
assert(!fallbackPing(dynamicOspfPassive.project, dynamicOspfPassive.sourceId, dynamicOspfPassive.targetId).success, "dynamic routing must not form an adjacency over a passive interface");
assert(diagnoseProject(dynamicOspfPassive.project).some((issue) => issue.title.includes("동적 라우팅 passive interface") && issue.detail.includes("passive")), "diagnostics must explain dynamic routing passive-interface adjacency suppression");

const dynamicOspfPassiveDefaultException = buildDynamicRoutingSmoke({
  id: "passive_default_exception",
  r1Networks: ["10.0.12.0 0.0.0.3"],
  r2Networks: ["10.0.12.0 0.0.0.3", "192.168.2.0 0.0.0.255"],
  r1PassiveDefault: true,
  r1PassiveExceptions: ["GigabitEthernet0/1"]
});
assert(fallbackPing(dynamicOspfPassiveDefaultException.project, dynamicOspfPassiveDefaultException.sourceId, dynamicOspfPassiveDefaultException.targetId).success, "dynamic routing must allow an adjacency on a no passive-interface exception when passive-interface default is enabled");

const loopSwitchA = createDevice("switch-2960-24tt", { x: 20, y: 530 }, []);
const loopSwitchB = createDevice("switch-2960-24tt", { x: 190, y: 530 }, [loopSwitchA]);
const loopSwitchC = createDevice("switch-2960-24tt", { x: 105, y: 660 }, [loopSwitchA, loopSwitchB]);
const loopA0 = dataPort(loopSwitchA, 0);
const loopA1 = dataPort(loopSwitchA, 1);
const loopB0 = dataPort(loopSwitchB, 0);
const loopB1 = dataPort(loopSwitchB, 1);
const loopC0 = dataPort(loopSwitchC, 0);
const loopC1 = dataPort(loopSwitchC, 1);
assert(loopA0 && loopA1 && loopB0 && loopB1 && loopC0 && loopC1, "Layer 2 loop smoke must have enough switch ports");
let layer2LoopProject = {
  id: "project_layer2_loop_smoke",
  ownerId: "user_feature_smoke",
  name: "Layer 2 loop smoke",
  devices: [loopSwitchA, loopSwitchB, loopSwitchC],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
for (const [leftDevice, rightDevice, leftPort, rightPort, label] of [
  [loopSwitchA, loopSwitchB, loopA0, loopB0, "A-B"],
  [loopSwitchB, loopSwitchC, loopB1, loopC0, "B-C"],
  [loopSwitchC, loopSwitchA, loopC1, loopA1, "C-A"]
]) {
  const connection = validateConnection(layer2LoopProject, leftDevice.id, rightDevice.id, "auto", leftPort.id, rightPort.id);
  assert(connection.link, `Layer 2 loop ${label} link must validate`);
  layer2LoopProject = addLink(layer2LoopProject, connection.link);
}
assert(diagnoseProject(layer2LoopProject).some((issue) => issue.title.includes("Layer 2 loop")), "diagnostics must warn about VLAN Layer 2 loop candidates");

const bundleSwitchA = createDevice("switch-2960-24tt", { x: 20, y: 700 }, []);
const bundleSwitchB = createDevice("switch-2960-24tt", { x: 190, y: 700 }, [bundleSwitchA]);
const bundleA0 = dataPort(bundleSwitchA, 0);
const bundleA1 = dataPort(bundleSwitchA, 1);
const bundleB0 = dataPort(bundleSwitchB, 0);
const bundleB1 = dataPort(bundleSwitchB, 1);
assert(bundleA0 && bundleA1 && bundleB0 && bundleB1, "EtherChannel loop suppression smoke must have enough switch ports");
let etherChannelProject = {
  id: "project_etherchannel_loop_suppression",
  ownerId: "user_feature_smoke",
  name: "EtherChannel loop suppression smoke",
  devices: [
    { ...bundleSwitchA, ports: bundleSwitchA.ports.map((port) => port.id === bundleA0.id || port.id === bundleA1.id ? { ...port, channelGroup: { id: 1, mode: "active" } } : port) },
    { ...bundleSwitchB, ports: bundleSwitchB.ports.map((port) => port.id === bundleB0.id || port.id === bundleB1.id ? { ...port, channelGroup: { id: 1, mode: "active" } } : port) }
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
  [bundleSwitchA, bundleSwitchB, bundleA0, bundleB0, "member 1"],
  [bundleSwitchA, bundleSwitchB, bundleA1, bundleB1, "member 2"]
]) {
  const connection = validateConnection(etherChannelProject, leftDevice.id, rightDevice.id, "auto", leftPort.id, rightPort.id);
  assert(connection.link, `EtherChannel ${label} link must validate`);
  etherChannelProject = addLink(etherChannelProject, connection.link);
}
assert(!diagnoseProject(etherChannelProject).some((issue) => issue.title.includes("Layer 2 loop")), "diagnostics must treat same channel-group parallel links as one logical Layer 2 edge");

const mismatchChannelSwitchA = createDevice("switch-2960-24tt", { x: 20, y: 760 }, []);
const mismatchChannelSwitchB = createDevice("switch-2960-24tt", { x: 190, y: 760 }, [mismatchChannelSwitchA]);
const mismatchChannelA0 = dataPort(mismatchChannelSwitchA, 0);
const mismatchChannelB0 = dataPort(mismatchChannelSwitchB, 0);
assert(mismatchChannelA0 && mismatchChannelB0, "EtherChannel mismatch smoke must have switch ports");
let etherChannelMismatchProject = {
  id: "project_etherchannel_mismatch",
  ownerId: "user_feature_smoke",
  name: "EtherChannel mismatch smoke",
  devices: [
    { ...mismatchChannelSwitchA, ports: mismatchChannelSwitchA.ports.map((port) => port.id === mismatchChannelA0.id ? { ...port, channelGroup: { id: 1, mode: "active" } } : port) },
    mismatchChannelSwitchB
  ],
  links: [],
  notes: [],
  drawings: [],
  activity: { title: "", objectives: [], requirements: [] },
  simulationEvents: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const mismatchChannelLink = validateConnection(etherChannelMismatchProject, mismatchChannelSwitchA.id, mismatchChannelSwitchB.id, "auto", mismatchChannelA0.id, mismatchChannelB0.id);
assert(mismatchChannelLink.link, "EtherChannel mismatch link must validate");
etherChannelMismatchProject = addLink(etherChannelMismatchProject, mismatchChannelLink.link);
assert(diagnoseProject(etherChannelMismatchProject).some((issue) => issue.title.includes("EtherChannel 불일치") && issue.detail.includes("한쪽 포트만")), "diagnostics must warn when only one side of a link is in an EtherChannel");

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

const longestStaticRouteProject = {
  ...pbrProject,
  id: "project_static_longest_prefix_smoke",
  name: "Static longest-prefix smoke",
  devices: pbrProject.devices.map((device) => device.id === pbrR1.id
    ? {
        ...device,
        ports: device.ports.map((port) => port.id === pbrR1Lan.id ? { ...port, policyRouteMap: "" } : port),
        config: {
          ...device.config,
          accessRules: [],
          prefixLists: [],
          routeMaps: [],
          staticRoutes: [
            { id: "route_default_lower_distance_smoke", network: "0.0.0.0", mask: "0.0.0.0", nextHop: "10.12.0.2", distance: 1 },
            { id: "route_specific_higher_distance_smoke", network: "10.30.0.0", mask: "255.255.255.0", nextHop: "10.13.0.3", distance: 200 }
          ]
        }
      }
    : device)
};
assert(fallbackPing(longestStaticRouteProject, pbrClient.id, pbrTarget.id).success, "static route lookup must prefer the longest prefix over a lower-distance default route");
assert(!requiresTypeScriptPingFallback(longestStaticRouteProject), "distance-only static route projects can remain eligible for Rust after longest-prefix parity");
const longestStaticRouteMatrix = analyzeRoutingMatrix(longestStaticRouteProject);
const longestStaticRouteCoverage = longestStaticRouteMatrix.coverage.find((entry) => entry.deviceId === pbrR1.id && entry.subnetKey === "10.30.0.0/24");
assert(longestStaticRouteCoverage?.coverage === "static" && longestStaticRouteCoverage.detail.includes("10.30.0.0/24") && longestStaticRouteCoverage.detail.includes("distance 200"), "routing matrix must report the selected longest-prefix static route rather than the default route");
const poweredOffStaticRouteProject = {
  ...longestStaticRouteProject,
  id: "project_powered_off_static_route_matrix_smoke",
  devices: longestStaticRouteProject.devices.map((device) => device.id === pbrR1.id ? { ...device, powerOn: false } : device)
};
const poweredOffStaticRouteMatrix = analyzeRoutingMatrix(poweredOffStaticRouteProject);
const poweredOffStaticRouteCoverage = poweredOffStaticRouteMatrix.coverage.find((entry) => entry.deviceId === pbrR1.id && entry.subnetKey === "10.30.0.0/24");
assert(poweredOffStaticRouteCoverage?.coverage === "missing", "routing matrix must not report static route coverage from powered-off L3 devices");
assert(!poweredOffStaticRouteMatrix.subnets.some((subnet) => subnet.connectedDevices.includes(pbrR1.label)), "routing matrix subnet summary must not list powered-off L3 devices as connected subnet owners");

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
const trackedRouteMatrix = analyzeRoutingMatrix(trackedRouteProject);
const trackedRouteCoverage = trackedRouteMatrix.coverage.find((entry) => entry.deviceId === trackR1.id && entry.subnetKey === "10.50.0.0/24");
assert(trackedRouteCoverage?.coverage === "static" && trackedRouteCoverage.via === "10.13.0.3" && trackedRouteCoverage.detail.includes("distance 200"), "routing matrix must ignore a down tracked static route and report the floating backup route");
assert(trackedRouteMatrix.warnings.some((warning) => warning.includes("Tracked static routes currently inactive")), "routing matrix must warn when tracked static routes are currently inactive");
const interfaceTrackPrimaryLink = trackedRouteProject.links.find((link) =>
  (link.endpointA.deviceId === trackR1.id && link.endpointA.portId === trackR1Primary.id) ||
  (link.endpointB.deviceId === trackR1.id && link.endpointB.portId === trackR1Primary.id)
);
assert(interfaceTrackPrimaryLink, "interface track smoke must find the primary tracked link");
const interfaceTrackedRouteProject = {
  ...trackedRouteProject,
  id: "project_interface_tracked_route_smoke",
  name: "Interface tracked static route smoke",
  devices: trackedRouteProject.devices.map((device) => device.id === trackR1.id
    ? {
        ...device,
        config: {
          ...device.config,
          staticRoutes: [
            { id: "route_interface_track_primary_smoke", network: "10.50.0.0", mask: "255.255.255.0", nextHop: "10.12.0.2", distance: 1, trackId: 2 },
            { id: "route_interface_track_backup_smoke", network: "10.50.0.0", mask: "255.255.255.0", nextHop: "10.13.0.3", distance: 200 }
          ],
          ipSlaOperations: [],
          trackObjects: [{ id: "track_interface_smoke", trackId: 2, type: "interface", interfaceName: trackR1Primary.name, mode: "line-protocol" }]
        }
      }
    : device),
  links: trackedRouteProject.links.map((link) => link.id === interfaceTrackPrimaryLink.id ? { ...link, status: "down" } : link)
};
const interfaceTrackedRouteCoverage = analyzeRoutingMatrix(interfaceTrackedRouteProject).coverage.find((entry) => entry.deviceId === trackR1.id && entry.subnetKey === "10.50.0.0/24");
assert(interfaceTrackedRouteCoverage?.coverage === "static" && interfaceTrackedRouteCoverage.via === "10.13.0.3", "routing matrix must treat interface tracked routes as inactive when the tracked link is down");
const trackedDefaultRouteProject = {
  ...trackedRouteProject,
  id: "project_tracked_default_route_matrix_smoke",
  name: "Tracked default route matrix smoke",
  devices: trackedRouteProject.devices.map((device) => device.id === trackR1.id
    ? {
        ...device,
        config: {
          ...device.config,
          staticRoutes: [
            { id: "route_track_default_primary_smoke", network: "0.0.0.0", mask: "0.0.0.0", nextHop: "10.12.0.2", distance: 1, trackId: 1 },
            { id: "route_track_default_backup_smoke", network: "0.0.0.0", mask: "0.0.0.0", nextHop: "10.13.0.3", distance: 200 }
          ]
        }
      }
    : device)
};
assert(fallbackPing(trackedDefaultRouteProject, trackClient.id, trackTarget.id).success, "tracked default route must fail over to the floating backup route");
const trackedDefaultRouteMatrix = analyzeRoutingMatrix(trackedDefaultRouteProject);
const trackedDefaultRouteCoverage = trackedDefaultRouteMatrix.coverage.find((entry) => entry.deviceId === trackR1.id && entry.subnetKey === "10.50.0.0/24");
assert(trackedDefaultRouteCoverage?.coverage === "default" && trackedDefaultRouteCoverage.via === "10.13.0.3" && trackedDefaultRouteCoverage.detail.includes("distance 200"), "routing matrix must select the active tracked default route rather than the lower-distance down route");
const trackedDefaultRouteAudit = analyzeProjectAudit(trackedDefaultRouteProject);
const trackedDefaultRouteCheck = trackedDefaultRouteAudit.checks.find((check) => check.category === "routing" && check.label === "Default route");
assert(trackedDefaultRouteCheck?.severity === "pass" && trackedDefaultRouteCheck.evidence.some((line) => line.includes("10.13.0.3")) && !trackedDefaultRouteCheck.evidence.some((line) => line.includes("10.12.0.2")), "project audit must count only active tracked default routes");
const downOnlyDefaultRouteProject = {
  ...trackedDefaultRouteProject,
  id: "project_down_only_default_route_audit_smoke",
  devices: trackedDefaultRouteProject.devices.map((device) => device.id === trackR1.id
    ? { ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.filter((route) => route.trackId === 1) } }
    : device)
};
const downOnlyDefaultRouteAudit = analyzeProjectAudit(downOnlyDefaultRouteProject);
const downOnlyDefaultRouteCheck = downOnlyDefaultRouteAudit.checks.find((check) => check.category === "routing" && check.label === "Default route");
assert(downOnlyDefaultRouteCheck?.severity === "info" && downOnlyDefaultRouteCheck.summary.includes("No active default route") && downOnlyDefaultRouteCheck.evidence.some((line) => line.includes("10.12.0.2 track 1")), "project audit must not pass a down-only tracked default route");
const trackedDefaultRouteReport = buildProjectReportText(trackedDefaultRouteProject, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
assert(trackedDefaultRouteReport.includes("Static Routes") && trackedDefaultRouteReport.includes("inactive") && trackedDefaultRouteReport.includes("untracked"), "project report must show tracked static route active state");
const trackedDefaultVerification = buildVerificationPlan(trackedDefaultRouteProject);
const trackedDefaultRoutingTask = trackedDefaultVerification.tasks.find((item) => item.deviceId === trackR1.id && item.title.includes("Verify routing"));
assert(trackedDefaultRoutingTask?.commands.includes("show track") && trackedDefaultRoutingTask.commands.includes("show ip route 0.0.0.0 0.0.0.0") && trackedDefaultRoutingTask.expected.some((line) => line.includes("tracked static routes currently inactive")), "verification plan must require track validation and exact route lookup for tracked static routes");

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
const normalizedActivityReportText = buildProjectReportText(normalized, { generatedAt: new Date("2026-01-01T00:00:00.000Z") });
assert(normalizedActivityReportText.includes("Command Rules") && normalizedActivityReportText.includes("Hostname saved"), "project report must include Activity command rule details");
assert(normalizedActivityReportText.includes("Command Sequences") && normalizedActivityReportText.includes("Interface sequence"), "project report must include Activity command sequence details");
assert(normalizedActivityReportText.includes("Interface Expectations") && normalizedActivityReportText.includes("PC IP"), "project report must include Activity interface expectation details");
assert(normalizedActivityReportText.includes("Answer Snapshot") && normalizedActivityReportText.includes("Service devices") && normalizedActivityReportText.includes("Startup configs"), "project report must include Activity answer snapshot details");
const normalizedInstructorWorkbookText = buildLabWorkbookText(normalized, "instructor");
assert(normalizedInstructorWorkbookText.includes("Answer snapshot") && normalizedInstructorWorkbookText.includes("service devices") && normalizedInstructorWorkbookText.includes("startup configs"), "instructor workbook must include Activity answer snapshot details");

const corruptMediaSwitch = createDevice("switch-2960-24tt", { x: 15, y: 15 }, []);
const corruptMediaPort = corruptMediaSwitch.ports.find((port) => port.kind === "fast-ethernet");
assert(corruptMediaPort, "corrupt media normalize smoke must find a fixed copper switchport");
const fixedMediaProject = normalizeProject({
  ...project,
  devices: [{
    ...corruptMediaSwitch,
    ports: corruptMediaSwitch.ports.map((port) => port.id === corruptMediaPort.id ? { ...port, activeMedia: "fiber", transceiverId: "GLC-SX-MMD" } : port)
  }],
  links: []
});
const fixedMediaPort = fixedMediaProject.devices[0].ports.find((port) => port.id === corruptMediaPort.id);
assert(fixedMediaPort.activeMedia === "fast-ethernet" && !canPortUseCable(fixedMediaPort, "fiber"), "normalizeProject must reject activeMedia values unsupported by a fixed copper port");

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

global.localStorage = createMemoryStorage();
global.sessionStorage = createMemoryStorage();
const storageOwner = "user_storage_recovery_smoke";
const storageProject = localStore.saveProject({ ...localStore.createBlankProject(storageOwner), name: "Recovered local project" });
localStorage.setItem("new-network-editor-projects", "{not-valid-json");
const recoveredProjects = localStore.loadProjects(storageOwner);
assert(recoveredProjects.some((item) => item.id === storageProject.id && item.name === "Recovered local project"), "local storage must recover project lists from backup when the primary project key is corrupted");
assert(localStorage.getItem("new-network-editor-projects")?.includes(storageProject.id), "local storage recovery must restore the primary project key from backup");
const secondStorageProject = localStore.saveProject({ ...localStore.createBlankProject(storageOwner), name: "Deleted local project" });
localStore.deleteProject(storageOwner, secondStorageProject.id);
localStorage.setItem("new-network-editor-projects", "{not-valid-json");
const recoveredAfterDelete = localStore.loadProjects(storageOwner);
assert(!recoveredAfterDelete.some((item) => item.id === secondStorageProject.id), "local storage backup must reflect deletions as well as saves");

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
