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

let blankDevice = createDevice("router-1941", { x: 0, y: 0 }, []);
blankDevice = { ...blankDevice, powerOn: false };
let blankBoot = runCliCommand(blankDevice, initialCliSession(), "power on");
assert(blankBoot.output.includes("initial configuration dialog"), "blank device boot must ask for initial configuration dialog");
assert(blankBoot.session.pendingAction === "initial-config", "blank device boot must wait for initial configuration answer");
blankBoot = runCliCommand(blankBoot.device, blankBoot.session, "no");
assert(blankBoot.output.includes("Press RETURN"), "answering no to setup dialog must continue to EXEC");
assert(!blankBoot.session.pendingAction, "setup dialog answer must clear pending state");

let authDevice = createDevice("router-1941", { x: 0, y: 0 }, []);
let authSession = initialCliSession();
const runAuth = (command) => {
  const result = runCliCommand(authDevice, authSession, command);
  authDevice = result.device;
  authSession = result.session;
  return result.output || "";
};
runAuth("enable");
runAuth("configure terminal");
runAuth("username admin secret cisco");
runAuth("line console 0");
runAuth("login local");
runAuth("exit");
runAuth("end");
runAuth("write memory");
runAuth("reload");
const authBoot = runAuth("");
assert(authBoot.includes("User Access Verification") && authSession.pendingAction === "console-username", "console login local must prompt for username after reload");
assert(runAuth("admin").includes("Password"), "console login local must prompt for password after username");
assert(runAuth("wrong").includes("Login invalid") && authSession.pendingAction === "console-username", "wrong console local password must restart login");
runAuth("admin");
runAuth("cisco");
assert(!authSession.pendingAction && cliPrompt(authDevice, authSession).endsWith(">"), "valid console local login must enter user EXEC");

assert(cliPrompt(device, session).endsWith(">"), "initial prompt must be user EXEC");
assert(run("conf t").includes("enable"), "configure terminal must require enable");
run("en");
assert(cliPrompt(device, session).endsWith("#"), "enable must enter privileged EXEC");
assert(run("sh priv").includes("15"), "show privilege must report privileged level after enable");
assert(run("sh hist").includes("history"), "show history must be supported");
assert(run("debug ip icmp").includes("debugging is on"), "debug ip icmp must enable session debug");
assert(run("show debugging").includes("ip icmp"), "show debugging must list enabled debug flags");
assert(run("undebug all").includes("turned off"), "undebug all must clear debug flags");
assert(run("show debugging").includes("No debugging"), "show debugging must report empty debug state");
assert(run("show version").includes("Configuration register is 0x2102"), "show version must render IOS hardware details");
run("clock set 12:34:56 Jun 19 2026");
assert(run("show clock").includes("12:34:56 Jun 19 2026"), "clock set must affect show clock");
run("terminal length 0");
run("terminal width 120");
run("terminal no monitor");
const terminalStatus = run("show terminal");
assert(terminalStatus.includes("Length: 0 lines, Width: 120 columns") && terminalStatus.includes("Monitor logging: disabled"), "terminal settings must affect show terminal");
assert(run("definitely-invalid-command").includes("Invalid input detected"), "unknown commands must render IOS-style invalid input marker");
assert(run("show boot").includes("BOOT path-list"), "show boot must render boot image and startup state");
assert(run("show platform").includes("Chassis type"), "show platform must render chassis details");
assert(run("show environment").includes("SYSTEM POWER"), "show environment must render power diagnostics");
assert(run("show tech-support").includes("show running-config") && run("show tech-support").includes("show ip route"), "show tech-support must include core diagnostic sections");
assert(run("setup").includes("initial configuration dialog"), "setup must open the initial configuration dialog");
assert(session.pendingAction === "initial-config", "setup must wait for initial configuration answer");
run("no");
run("enable");
const initialRun = run("show running-config");
assert(initialRun.includes("Building configuration") && initialRun.includes("Current configuration") && initialRun.includes("end"), "show running-config must render IOS-style config wrapper");
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
run(`int ${sparePort}`);
run("no switchport");
assert(run("ip address 10.0.0.1 255.0.255.0").includes("Invalid"), "interface IP command must reject non-contiguous masks");
run("ip address 10.0.0.1 255.255.255.0");
run("ip helper-address 10.0.0.254");
run("ip nat inside");
run("switchport mode access");
const layer2Reset = run(`do show running-config interface ${sparePort}`);
assert(!layer2Reset.includes("ip helper-address") && !layer2Reset.includes("ip nat inside"), "switchport mode access must clear L3-only interface fields");
run("exit");
run(`default interface ${sparePort}`);
run("int range fa0/2 - 3");
assert(cliPrompt(device, session).includes("(config-if-range)#"), "interface range must enter range configuration mode");
run("description edge-range");
run("switchport access vlan 20");
run("exit");
run("service password-encryption");
run("service ftp");
run("service email");
run("service tftp");
run("service syslog");
run("spanning-tree vlan 20 root primary");
const services = run("do show services");
assert(services.includes("FTP") && services.includes("enabled"), "show services must show enabled FTP service");
assert(services.includes("EMAIL") && services.includes("enabled"), "show services must show enabled EMAIL service");
assert(run("do show running-config | include service").includes("service ftp"), "show pipe include must filter matching lines");
assert(!run("do show running-config | exclude service").includes("service ftp"), "show pipe exclude must remove matching lines");
assert(run(`do show running-config | section interface ${sparePort}`).includes("description"), "show pipe section must render matching config section");
assert(run("do show running-config | begin service ftp").startsWith("service ftp"), "show pipe begin must start at matching line");
assert(run("do show running-config | count service").includes("Number of lines which match regexp"), "show pipe count must report a match count");
assert(services.includes("TFTP") && services.includes("enabled"), "show services must show enabled TFTP service");
assert(services.includes("SYSLOG") && services.includes("enabled"), "show services must show enabled SYSLOG service");
assert(run("do show services ftp").includes("FTP") && !run("do show services email").includes("FTP"), "show services <name> must filter service output");
assert(run("ip route 10.20.0.0 255.0.255.0 192.168.10.1").includes("Invalid"), "static route command must reject non-contiguous masks");
run("ip route 0.0.0.0 0.0.0.0 192.168.10.1");
assert(run("do show ip route").includes("0.0.0.0/0"), "static default route must allow a /0 mask");
run("ip dhcp pool BADMASK");
assert(run("network 10.20.0.0 255.0.255.0").includes("Invalid"), "DHCP pool network command must reject non-contiguous masks");
run("exit");
run("no ip dhcp pool BADMASK");
run("ip dhcp pool CHECK");
run("network 192.168.10.0 255.255.255.0");
assert(run("default-router 172.16.10.1").includes("DHCP network"), "DHCP pool default-router must stay inside the configured network");
run("default-router 192.168.10.1");
assert(run("start-ip 172.16.10.100").includes("DHCP network"), "DHCP pool start-ip must stay inside the configured network");
run("start-ip 192.168.10.100");
run("exit");
run("no ip dhcp pool CHECK");
run("ip dhcp pool ORDER");
assert(!run("default-router 10.0.0.1").includes("DHCP network"), "new DHCP pools must allow default-router before network configuration");
run("exit");
run("no ip dhcp pool ORDER");
run("logging host 192.168.10.50");
run("logging trap warnings");
run("no logging console");
run("ip dhcp excluded-address 192.168.10.1 192.168.10.20");
run("ip domain-name lab.local");
run("ip name-server 8.8.8.8 1.1.1.1");
run("username admin privilege 15 secret cisco");
run("ip ssh version 2");
assert(run("crypto key generate rsa modulus 1024").includes("[OK]"), "crypto key generate rsa must report success");
run("int vlan 1");
run("ip add 192.168.10.2 255.255.255.0");
run("ip helper-address 192.168.10.254");
run("ip nat inside");
run("exit");
run("int fa0/1");
run("duplex full");
run("speed 100");
run("mtu 1600");
run("bandwidth 100000");
const physicalStatus = run("do show interface fa0/1");
assert(physicalStatus.includes("MTU 1600 bytes") && physicalStatus.includes("BW 100000 Kbit/sec"), "show interface must show configured MTU and bandwidth");
assert(physicalStatus.includes("Full-duplex setting is full") && physicalStatus.includes("media speed is 100"), "show interface must show configured duplex and speed");
run("span portfast");
run("span bpduguard enable");
run("switchport mode trunk");
run("switchport trunk native vlan 99");
run("switchport trunk allowed vlan 20-22,99");
const physicalStatusTable = run("do show interfaces status");
assert(physicalStatusTable.includes("trunk") && physicalStatusTable.includes("full") && physicalStatusTable.includes("100"), "show interfaces status must show configured VLAN mode, duplex, and speed");
run("switchport nonegotiate");
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
run("passive-interface default");
run("no passive-interface vlan 1");
run("default-information originate always");
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
const stpVlan = run("show spanning-tree vlan 20");
assert(stpVlan.includes("VLAN0020") && stpVlan.includes("This bridge is the root"), "spanning-tree vlan root primary must affect VLAN STP output");
assert(run("sh int trunk").includes("99"), "show interfaces trunk must show native VLAN");
assert(run("sh int desc").includes("Interface"), "show interfaces description must be supported");
assert(run("show interfaces counters").includes("InOctets"), "show interfaces counters must be supported");
assert(run("sh controllers").includes("controller"), "show controllers must be supported");
assert(run("sh mac address-table dynamic").includes("No entries"), "show mac address-table dynamic must be supported");
const otherPort = device.ports.find((port) => port.name !== sparePort && port.kind !== "console")?.name ?? sparePort;
device = {
  ...device,
  runtime: {
    ...device.runtime,
    macTable: [
      { vlan: 20, macAddress: "02:aa:aa:aa:aa:20", portName: sparePort, type: "dynamic" },
      { vlan: 99, macAddress: "02:aa:aa:aa:aa:99", portName: otherPort, type: "dynamic" },
      { vlan: 20, macAddress: "02:bb:bb:bb:bb:20", portName: sparePort, type: "static" }
    ],
    arpTable: [
      { ipAddress: "192.168.10.2", macAddress: "02:aa:aa:aa:aa:20", portName: sparePort },
      { ipAddress: "192.168.10.3", macAddress: "02:aa:aa:aa:aa:99", portName: otherPort }
    ],
    dhcpLeases: [
      { ipAddress: "192.168.10.50", macAddress: "02:cc:cc:cc:cc:50", deviceId: "pc-a", expiresAt: Date.now() + 60000 },
      { ipAddress: "192.168.10.51", macAddress: "02:cc:cc:cc:cc:51", deviceId: "pc-b", expiresAt: Date.now() + 60000 }
    ]
  }
};
const dhcpBinding = run("show ip dhcp binding");
assert(dhcpBinding.includes("Bindings from all pools") && dhcpBinding.includes("Lease expiration") && dhcpBinding.includes("pc-a"), "show ip dhcp binding must render IOS-style binding table");
run(`clear mac address-table dynamic interface ${sparePort}`);
assert(!device.runtime.macTable.some((entry) => entry.type === "dynamic" && entry.portName === sparePort), "clear mac address-table dynamic interface must remove matching dynamic entries only");
assert(device.runtime.macTable.some((entry) => entry.type === "static" && entry.portName === sparePort), "clear mac address-table dynamic interface must keep static entries");
run("clear mac address-table vlan 99");
assert(!device.runtime.macTable.some((entry) => entry.vlan === 99), "clear mac address-table vlan must remove matching VLAN entries");
run("clear mac address-table static address 02:bb:bb:bb:bb:20");
assert(device.runtime.macTable.length === 0, "clear mac address-table static address must remove the matching static MAC");
run("clear arp 192.168.10.2");
assert(device.runtime.arpTable.length === 1 && device.runtime.arpTable[0].ipAddress === "192.168.10.3", "clear arp <ip> must remove only the matching ARP entry");
run("clear ip arp *");
assert(device.runtime.arpTable.length === 0, "clear ip arp * must remove all ARP entries");
run("clear ip dhcp binding 192.168.10.50");
assert(device.runtime.dhcpLeases.length === 1 && device.runtime.dhcpLeases[0].ipAddress === "192.168.10.51", "clear ip dhcp binding <ip> must remove only the matching lease");
run("clear ip dhcp binding *");
assert(device.runtime.dhcpLeases.length === 0, "clear ip dhcp binding * must remove all leases");
assert(run("sh vlan id 20").includes("VLAN20"), "show vlan id must render VLAN detail");
assert(run("show vlan name VLAN20").includes("Trunk ports allowing VLAN 20"), "show vlan name must render VLAN detail");
assert(run("show vlan summary").includes("Number of active VLANs"), "show vlan summary must render VLAN counters");
const acl = run("sh access-lists");
assert(acl.includes("Extended IP access list 101"), "show access-lists must group IOS ACLs by list");
assert(acl.includes("permit ip any any"), "show access-lists must show IOS ACL entry body");
assert(acl.includes("Extended IP access list WEB-FILTER"), "named ACL must show as extended access list");
assert(acl.includes("permit tcp any host 192.168.10.2 eq 80"), "named ACL must preserve entry options");
const ipInterface = run("sh ip int fa0/1");
assert(ipInterface.includes("Inbound access list is 101"), "show ip interface must show inbound ACL binding");
const sviInterface = run("sh ip int vlan 1");
assert(sviInterface.includes("192.168.10.254"), "show ip interface must show helper-address");
const ipBrief = run("sh ip int br");
assert(ipBrief.includes("IP-Address"), "show ip int br must still expand to brief output");
assert(ipBrief.includes("Protocol"), "show ip interface brief must include protocol state");
const ospfNeighbors = run("sh ip ospf nei");
assert(ospfNeighbors.includes("Neighbor ID"), "show ip ospf neighbor must render IOS-style header");
assert(run("sh ip ospf").includes("1.1.1.1"), "show ip ospf must use configured router-id");
const protocols = run("sh ip protocols");
assert(protocols.includes("Passive Interface(s)") && protocols.includes("Non-passive Interface(s)") && protocols.includes("Default information originate always"), "show ip protocols must show passive defaults and default-information originate");
const eigrpNeighbors = run("sh ip eigrp nei");
assert(eigrpNeighbors.includes("EIGRP-IPv4 Neighbors"), "show ip eigrp neighbors must render IOS-style header");
assert(run("sh ip eigrp").includes("2.2.2.2"), "show ip eigrp must use configured router-id");
const ripDb = run("sh ip rip database");
assert(ripDb.includes("RIP database"), "show ip rip database must be supported");
const sshStatus = run("sh ip ssh");
assert(sshStatus.includes("SSH Enabled") && sshStatus.includes("RSA key: generated") && sshStatus.includes("VTY lines permitting SSH: vty 0 4"), "show ip ssh must reflect key, users, and SSH-capable VTY lines");
const lineVty = run("show line vty");
assert(lineVty.includes("vty 0 4") && lineVty.includes("login local") && lineVty.includes("ssh"), "show line vty must show VTY auth and transport");
const usersAll = run("show users all");
assert(usersAll.includes("con 0") && usersAll.includes("vty 0 4") && usersAll.includes("transport ssh"), "show users all must show console and configured VTY lines");
const hosts = run("show hosts");
assert(hosts.includes("8.8.8.8") && hosts.includes("1.1.1.1"), "show hosts must show configured name servers");
const natTranslations = run("sh ip nat trans");
assert(natTranslations.includes("203.0.113.2"), "show ip nat translations must show static mapping");
const natStats = run("sh ip nat stat");
assert(natStats.includes("Inside interfaces"), "show ip nat statistics must show NAT roles");
const dhcpStats = run("sh ip dhcp server stat");
assert(dhcpStats.includes("Address pools"), "show ip dhcp server statistics must be supported");
assert(dhcpStats.includes("Excluded ranges"), "show ip dhcp server statistics must include excluded ranges");
assert(run("sh ip dhcp conflict").includes("No DHCP conflicts"), "show ip dhcp conflict must be supported");
run("clear ip dhcp conflict *");
const logging = run("sh logging");
assert(logging.includes("192.168.10.50"), "show logging must show configured host");
assert(logging.includes("Console logging: disabled"), "show logging must show console logging state");
device = { ...device, runtime: { ...device.runtime, logs: [{ id: "log_cli_smoke", level: "info", message: "cli smoke log", createdAt: Date.now() }] } };
assert(run("show logging").includes("cli smoke log"), "show logging must show buffered runtime logs");
device = { ...device, runtime: { ...device.runtime, logs: [
  { id: "log_http_smoke", level: "info", message: "HTTP GET from PC0", createdAt: Date.now() },
  { id: "log_ftp_smoke", level: "info", message: "FTP LIST from PC0", createdAt: Date.now() }
] } };
const ftpServiceLogs = run("show service logs ftp");
assert(ftpServiceLogs.includes("Service log: FTP") && ftpServiceLogs.includes("FTP LIST from PC0"), "show service logs ftp must show filtered service logs");
assert(!ftpServiceLogs.includes("HTTP GET from PC0"), "show service logs ftp must hide other service logs");
run("clear service logs ftp");
assert(run("show logging").includes("HTTP GET from PC0"), "clear service logs ftp must preserve other service logs");
assert(!run("show logging").includes("FTP LIST from PC0"), "clear service logs ftp must remove FTP logs");
run("clear logging");
assert(run("show logging").includes("No logging messages"), "clear logging must remove buffered runtime logs");
run("wr");
run("power off");
assert(device.powerOn === false, "power off must update device state");
assert(run("show version").includes("powered off"), "show version must report powered-off state");
const powerOnOutput = run("power on");
assert(powerOnOutput.includes("Self decompressing the image") && powerOnOutput.includes("POST: CPU self-test passed"), "power on must print boot diagnostics");
run("en");
run("cisco");
run("conf t");
run("hostname UnsavedName");
run("end");
run("reload");
const reloadOutput = run("");
assert(reloadOutput.includes("Loading startup-config") && reloadOutput.includes("Self decompressing the image"), "reload must print startup boot diagnostics");
run("en");
run("cisco");
assert(run("show clock").includes("12:34:56 Jun 19 2026"), "clock setting must survive reload");
const config = run("sh run");
assert(config.includes("hostname Switch0"), "reload must restore saved startup-config");
assert(run("sh run all").includes("hostname Switch0"), "show running-config all must be supported");
assert(config.includes("service password-encryption"), "service password-encryption must survive reload");
assert(config.includes("service ftp"), "FTP service must survive reload");
assert(config.includes("service email"), "EMAIL service must survive reload");
assert(config.includes("service tftp"), "TFTP service must survive reload");
assert(config.includes("service syslog"), "SYSLOG service must survive reload");
assert(config.includes("logging host 192.168.10.50"), "logging host must survive reload");
assert(config.includes("logging trap warnings"), "logging trap level must survive reload");
assert(config.includes("no logging console"), "no logging console must survive reload");
assert(config.includes("ip dhcp excluded-address 192.168.10.1 192.168.10.20"), "DHCP excluded-address must survive reload");
assert(config.includes("ip helper-address 192.168.10.254"), "ip helper-address must survive reload");
assert(config.includes("ip route 0.0.0.0 0.0.0.0 192.168.10.1"), "default static route must survive reload");
assert(config.includes("description edge-range"), "interface range description must survive reload");
assert(config.includes("switchport access vlan 20"), "interface range VLAN must survive reload");
assert(config.includes("ip domain-name lab.local"), "domain name must survive reload");
assert(config.includes("ip name-server 8.8.8.8") && config.includes("ip name-server 1.1.1.1"), "name servers must survive reload");
assert(config.includes("ip ssh version 2"), "SSH version must survive reload");
assert(config.includes("crypto key generate rsa modulus 1024"), "RSA key state must survive reload");
assert(config.includes("username admin privilege 15 secret cisco"), "local username must survive reload");
assert(config.includes("access-list 101 permit ip any any"), "ACL must survive reload");
assert(config.includes("ip access-group 101 in"), "interface ACL binding must survive reload");
assert(config.includes("ip nat inside"), "inside NAT interface role must survive reload");
assert(config.includes("ip nat outside"), "outside NAT interface role must survive reload");
assert(config.includes("duplex full"), "interface duplex must survive reload");
assert(config.includes("speed 100"), "interface speed must survive reload");
assert(config.includes("mtu 1600"), "interface MTU must survive reload");
assert(config.includes("bandwidth 100000"), "interface bandwidth must survive reload");
assert(config.includes("switchport trunk native vlan 99"), "trunk native VLAN must survive reload");
assert(config.includes("switchport trunk allowed vlan 20,21,22,99"), "trunk allowed VLAN ranges must survive reload expanded");
assert(config.includes("switchport nonegotiate"), "switchport nonegotiate must survive reload");
assert(config.includes("spanning-tree vlan 20 root primary"), "spanning-tree root primary must survive reload");
assert(config.includes("ip nat inside source static 192.168.10.2 203.0.113.2"), "static NAT must survive reload");
assert(config.includes("ip access-list extended WEB-FILTER"), "named ACL header must survive reload");
assert(config.includes("10 permit tcp any host 192.168.10.2 eq 80"), "named ACL sequence entry must survive reload");
assert(config.includes("line vty 0 4"), "line config must survive reload");
assert(config.includes("login local"), "line login local must survive reload");
assert(config.includes("transport input ssh"), "line transport input ssh must survive reload");
assert(config.includes("router rip"), "router config must survive reload");
assert(config.includes("router ospf 1"), "OSPF config must survive reload");
assert(config.includes("router-id 1.1.1.1"), "OSPF router-id must survive reload");
assert(config.includes("passive-interface default"), "passive-interface default must survive reload");
assert(config.includes("no passive-interface vlan 1"), "passive-interface exception must survive reload");
assert(config.includes("default-information originate always"), "default-information originate must survive reload");
assert(config.includes("router eigrp 10"), "EIGRP config must survive reload");
assert(config.includes("router-id 2.2.2.2"), "EIGRP router-id must survive reload");
console.log("CLI smoke tests passed");
NODE
