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
const sparePort = device.ports.find((port) => port.name.toLowerCase().includes("0/2"))?.name ?? device.ports.find((port) => port.kind !== "console")?.name ?? "FastEthernet0/2";
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
assert(run("sh priv").includes("15"), "show privilege must report privileged level after enable");
assert(run("sh hist").includes("history"), "show history must be supported");
run("conf t");
run("enable secret cisco");
run("end");
run("disable");
assert(cliPrompt(device, session).endsWith(">"), "disable must return to user EXEC");
assert(run("enable").includes("Password"), "enable must prompt when enable secret is configured");
assert(run("wrong").includes("Access denied"), "wrong enable secret must be denied");
assert(cliPrompt(device, session).endsWith(">"), "wrong enable secret must stay in user EXEC");
run("enable");
run("cisco");
assert(cliPrompt(device, session).endsWith("#"), "correct enable secret must enter privileged EXEC");
run("conf t");
run(`default interface ${sparePort}`);
run("int range fa0/2 - 3");
assert(cliPrompt(device, session).includes("(config-if-range)#"), "interface range must enter range configuration mode");
run("description edge-range");
run("switchport access vlan 20");
run("exit");
run("service password-encryption");
run("logging host 192.168.10.50");
run("logging trap warnings");
run("no logging console");
run("ip dhcp excluded-address 192.168.10.1 192.168.10.20");
run("ip domain-name lab.local");
run("username admin privilege 15 secret cisco");
run("ip ssh version 2");
assert(run("crypto key generate rsa modulus 1024").includes("[OK]"), "crypto key generate rsa must report success");
run("int vlan 1");
run("ip add 192.168.10.2 255.255.255.0");
run("ip nat inside");
run("exit");
run("int fa0/1");
run("span portfast");
run("span bpduguard enable");
run("switchport mode trunk");
run("switchport trunk native vlan 99");
run("switchport trunk allowed vlan 20,99");
run("ip nat outside");
run("exit");
run("access-list 101 permit ip any any");
run("ip nat inside source static 192.168.10.2 203.0.113.2");
run("int fa0/1");
run("ip access-group 101 in");
run("exit");
run("router rip");
run("network 192.168.10.0");
run("exit");
run("line vty 0 4");
run("password cisco");
run("login local");
run("transport input ssh");
run("exit");
run("ip access-list extended WEB-FILTER");
assert(cliPrompt(device, session).includes("(config-ext-nacl)#"), "named extended ACL must enter ACL submode");
run("10 permit tcp any host 192.168.10.2 eq 80");
run("exit");
run("router ospf 1");
run("router-id 1.1.1.1");
run("network 192.168.10.0 0.0.0.255 area 0");
run("exit");
run("router eigrp 10");
run("router-id 2.2.2.2");
run("network 192.168.10.0");
run("end");
const route = run("sh route");
assert(route.includes("192.168.10.0/24"), "sh route must show SVI connected route");
assert(run("sh ip route summary").includes("Total routes"), "show ip route summary must be supported");
const stp = run("sh spanning-tree");
assert(stp.includes("P2p Edge"), "spanning-tree portfast must show edge port");
assert(run("sh int trunk").includes("99"), "show interfaces trunk must show native VLAN");
assert(run("sh int desc").includes("Interface"), "show interfaces description must be supported");
assert(run("sh controllers").includes("controller"), "show controllers must be supported");
assert(run("sh mac address-table dynamic").includes("No entries"), "show mac address-table dynamic must be supported");
assert(run("sh vlan id 20").includes("VLAN20"), "show vlan id must render VLAN detail");
const acl = run("sh access-lists");
assert(acl.includes("Extended IP access list 101"), "show access-lists must group IOS ACLs by list");
assert(acl.includes("permit ip any any"), "show access-lists must show IOS ACL entry body");
assert(acl.includes("Extended IP access list WEB-FILTER"), "named ACL must show as extended access list");
assert(acl.includes("permit tcp any host 192.168.10.2 eq 80"), "named ACL must preserve entry options");
const ipInterface = run("sh ip int fa0/1");
assert(ipInterface.includes("Inbound access list is 101"), "show ip interface must show inbound ACL binding");
const ipBrief = run("sh ip int br");
assert(ipBrief.includes("IP-Address"), "show ip int br must still expand to brief output");
const ospfNeighbors = run("sh ip ospf nei");
assert(ospfNeighbors.includes("Neighbor ID"), "show ip ospf neighbor must render IOS-style header");
assert(run("sh ip ospf").includes("1.1.1.1"), "show ip ospf must use configured router-id");
const eigrpNeighbors = run("sh ip eigrp nei");
assert(eigrpNeighbors.includes("EIGRP-IPv4 Neighbors"), "show ip eigrp neighbors must render IOS-style header");
assert(run("sh ip eigrp").includes("2.2.2.2"), "show ip eigrp must use configured router-id");
const ripDb = run("sh ip rip database");
assert(ripDb.includes("RIP database"), "show ip rip database must be supported");
assert(run("sh ip ssh").includes("SSH Enabled"), "show ip ssh must reflect domain name and local users");
const natTranslations = run("sh ip nat trans");
assert(natTranslations.includes("203.0.113.2"), "show ip nat translations must show static mapping");
const natStats = run("sh ip nat stat");
assert(natStats.includes("Inside interfaces"), "show ip nat statistics must show NAT roles");
const dhcpStats = run("sh ip dhcp server stat");
assert(dhcpStats.includes("Address pools"), "show ip dhcp server statistics must be supported");
assert(dhcpStats.includes("Excluded ranges"), "show ip dhcp server statistics must include excluded ranges");
const logging = run("sh logging");
assert(logging.includes("192.168.10.50"), "show logging must show configured host");
assert(logging.includes("Console logging: disabled"), "show logging must show console logging state");
run("wr");
run("conf t");
run("hostname UnsavedName");
run("end");
run("reload");
run("");
run("en");
run("cisco");
const config = run("sh run");
assert(config.includes("hostname Switch0"), "reload must restore saved startup-config");
assert(run("sh run all").includes("hostname Switch0"), "show running-config all must be supported");
assert(config.includes("service password-encryption"), "service password-encryption must survive reload");
assert(config.includes("logging host 192.168.10.50"), "logging host must survive reload");
assert(config.includes("logging trap warnings"), "logging trap level must survive reload");
assert(config.includes("no logging console"), "no logging console must survive reload");
assert(config.includes("ip dhcp excluded-address 192.168.10.1 192.168.10.20"), "DHCP excluded-address must survive reload");
assert(config.includes("description edge-range"), "interface range description must survive reload");
assert(config.includes("switchport access vlan 20"), "interface range VLAN must survive reload");
assert(config.includes("ip domain-name lab.local"), "domain name must survive reload");
assert(config.includes("ip ssh version 2"), "SSH version must survive reload");
assert(config.includes("crypto key generate rsa modulus 1024"), "RSA key state must survive reload");
assert(config.includes("username admin privilege 15 secret cisco"), "local username must survive reload");
assert(config.includes("access-list 101 permit ip any any"), "ACL must survive reload");
assert(config.includes("ip access-group 101 in"), "interface ACL binding must survive reload");
assert(config.includes("ip nat inside"), "inside NAT interface role must survive reload");
assert(config.includes("ip nat outside"), "outside NAT interface role must survive reload");
assert(config.includes("switchport trunk native vlan 99"), "trunk native VLAN must survive reload");
assert(config.includes("ip nat inside source static 192.168.10.2 203.0.113.2"), "static NAT must survive reload");
assert(config.includes("ip access-list extended WEB-FILTER"), "named ACL header must survive reload");
assert(config.includes("10 permit tcp any host 192.168.10.2 eq 80"), "named ACL sequence entry must survive reload");
assert(config.includes("line vty 0 4"), "line config must survive reload");
assert(config.includes("login local"), "line login local must survive reload");
assert(config.includes("transport input ssh"), "line transport input ssh must survive reload");
assert(config.includes("router rip"), "router config must survive reload");
assert(config.includes("router ospf 1"), "OSPF config must survive reload");
assert(config.includes("router-id 1.1.1.1"), "OSPF router-id must survive reload");
assert(config.includes("router eigrp 10"), "EIGRP config must survive reload");
assert(config.includes("router-id 2.2.2.2"), "EIGRP router-id must survive reload");
console.log("CLI smoke tests passed");
NODE
