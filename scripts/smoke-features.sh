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
assert(router.ports.some((port) => (port.helperAddresses || []).includes("10.10.10.10")), "router must include DHCP helper-address");
assert((server.config.dhcpExcludedRanges || []).some((range) => range.startIp === "192.168.10.1" && range.endIp === "192.168.10.20"), "sample server must include DHCP excluded range");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP helper")), "routed sample must not report DHCP helper diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("DHCP 제외")), "routed sample must not report DHCP excluded range diagnostics");
assert(!diagnoseProject(project).some((issue) => issue.title.includes("서비스에 접근 가능한 IP")), "routed sample services must have reachable server IPs");

const normalized = normalizeProject({
  ...project,
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
