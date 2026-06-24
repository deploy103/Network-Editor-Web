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
  "$ROOT/web/src/engine/desktopTerminal.ts" \
  "$ROOT/web/src/engine/diagnostics.ts" \
  "$ROOT/web/src/engine/simulation.ts" \
  "$ROOT/web/src/engine/topology.ts" \
  "$ROOT/web/src/engine/ip.ts" \
  "$ROOT/web/src/storage/importPreview.ts" \
  "$ROOT/web/src/storage/normalizeProject.ts" \
  "$ROOT/web/src/utils/id.ts"

node - "$TMPDIR" <<'NODE'
const path = require("path");
const tmpdir = process.argv[2];
const { createRoutedSampleProject } = require(path.join(tmpdir, "data/sampleProject.js"));
const { desktopConsoleTargets } = require(path.join(tmpdir, "engine/desktopTerminal.js"));
const { diagnoseProject } = require(path.join(tmpdir, "engine/diagnostics.js"));
const { requestDhcp } = require(path.join(tmpdir, "engine/simulation.js"));
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
assert(project.activity && project.activity.requirements.some((requirement) => requirement.kind === "device-count" && requirement.target === 4), "sample project must include Activity Wizard requirements");
assert(project.activity.requirements.some((requirement) => requirement.kind === "tdr-normal-count" && requirement.target === 3), "sample project must include Activity Wizard TDR requirements");
assert(router.ports.some((port) => (port.helperAddresses || []).includes("10.10.10.10")), "router must include DHCP helper-address");
assert((server.config.dhcpExcludedRanges || []).some((range) => range.startIp === "192.168.10.1" && range.endIp === "192.168.10.20"), "sample server must include DHCP excluded range");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP helper")), "routed sample must not report DHCP helper diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP 제외")), "routed sample must not report DHCP excluded range diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("서비스에 접근 가능한 IP")), "routed sample services must have reachable server IPs");

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
    : device)
});
const normalizedServer = normalized.devices.find((device) => device.id === server.id);
const normalizedRouter = normalized.devices.find((device) => device.id === router.id);
assert(normalizedServer.config.services.ftp && normalizedServer.config.services.email && normalizedServer.config.services.tftp && normalizedServer.config.services.syslog, "normalizeProject must preserve FTP, EMAIL, TFTP, and SYSLOG service flags");
assert(normalizedServer.config.dhcpExcludedRanges.some((range) => range.startIp === "192.168.10.1"), "normalizeProject must preserve DHCP excluded ranges");
assert(normalizedServer.runtime.logs.some((log) => log.message === "normalize syslog"), "normalizeProject must preserve runtime syslog logs");
assert(normalizedRouter.ports.some((port) => (port.helperAddresses || []).includes("10.10.10.10")), "normalizeProject must preserve DHCP helper-addresses");
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
