#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d /tmp/network-cli-smoke-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

"$ROOT/node_modules/.bin/tsc" \
  --target ES2022 \
  --module commonjs \
  --moduleResolution node \
  --skipLibCheck \
  --esModuleInterop \
  --outDir "$TMPDIR" \
  "$ROOT/web/src/engine/cli.ts" \
  "$ROOT/web/src/engine/simulation.ts" \
  "$ROOT/web/src/engine/topology.ts" \
  "$ROOT/web/src/engine/ip.ts" \
  "$ROOT/web/src/data/deviceCatalog.ts" \
  "$ROOT/web/src/utils/id.ts"

node - "$TMPDIR" <<'NODE'
const path = require("path");
const tmpdir = process.argv[2];
const { createDevice } = require(path.join(tmpdir, "data/deviceCatalog.js"));
const { initialCliSession, cliPrompt, runCliCommand } = require(path.join(tmpdir, "engine/cli.js"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let device = createDevice("switch-2960", { x: 0, y: 0 }, []);
let session = initialCliSession();
const run = (command) => {
  const result = runCliCommand(device, session, command);
  device = result.device;
  session = result.session;
  return result.output || "";
};

assert(cliPrompt(device, session).endsWith(">"), "initial prompt must be user EXEC");
assert(run("conf t").includes("enable"), "configure terminal must require enable");
run("en");
assert(cliPrompt(device, session).endsWith("#"), "enable must enter privileged EXEC");
run("conf t");
run("int vlan 1");
run("ip add 192.168.10.2 255.255.255.0");
run("exit");
run("int fa0/1");
run("span portfast");
run("span bpduguard enable");
run("exit");
run("router rip");
run("network 192.168.10.0");
run("exit");
run("line vty 0 4");
run("password cisco");
run("login");
run("end");
const route = run("sh route");
assert(route.includes("192.168.10.0/24"), "sh route must show SVI connected route");
const stp = run("sh spanning-tree");
assert(stp.includes("P2p Edge"), "spanning-tree portfast must show edge port");
run("wr");
run("conf t");
run("hostname UnsavedName");
run("end");
run("reload");
run("");
run("en");
const config = run("sh run");
assert(config.includes("hostname Switch0"), "reload must restore saved startup-config");
assert(config.includes("line vty 0 4"), "line config must survive reload");
assert(config.includes("router rip"), "router config must survive reload");
console.log("CLI smoke tests passed");
NODE
