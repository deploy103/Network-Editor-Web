#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}"
python3 -m py_compile cli-engine-python/ios_engine.py cli-engine-python/server.py

python3 - <<'PY'
import sys
import copy

sys.path.insert(0, "cli-engine-python")
from ios_engine import cli_completions, prompt, run_cli_command


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


device = {
    "id": "dev1",
    "label": "Switch0",
    "kind": "switch",
    "model": "Catalyst 2960",
    "modelId": "switch-2960",
    "powerOn": True,
    "ports": [
        {"id": "fa1", "name": "FastEthernet0/1", "kind": "fast-ethernet", "mode": "access", "vlan": 1, "allowedVlans": [1], "adminUp": True},
        {"id": "fa2", "name": "FastEthernet0/2", "kind": "fast-ethernet", "mode": "access", "vlan": 1, "allowedVlans": [1], "adminUp": True},
        {"id": "vlan1", "name": "Vlan1", "kind": "ethernet", "mode": "routed", "vlan": 1, "allowedVlans": [1], "adminUp": True, "ipCapable": True},
    ],
    "config": {
        "hostname": "Switch0",
        "startupConfig": [],
        "services": {"http": False, "dhcp": False, "dns": False, "tftp": False, "syslog": False},
    },
    "runtime": {"arpTable": [], "macTable": [], "dhcpLeases": [], "logs": []},
}
session = {"mode": "exec"}


def run(command):
    global device, session
    result = run_cli_command(device, session, command)
    device = result["device"]
    session = result["session"]
    return result.get("output") or ""


blank = copy.deepcopy(device)
blank["id"] = "blank"
blank["powerOn"] = False
blank["config"]["startupConfig"] = []
blank_boot = run_cli_command(blank, {"mode": "exec"}, "power on")
assert_true("initial configuration dialog" in blank_boot["output"], "blank Python device boot must ask for initial configuration dialog")
assert_true(blank_boot["session"].get("pendingAction") == "initial-config", "blank Python device boot must wait for setup answer")
blank_boot = run_cli_command(blank_boot["device"], blank_boot["session"], "no")
assert_true("Press RETURN" in blank_boot["output"] and not blank_boot["session"].get("pendingAction"), "setup no answer must continue to EXEC")

auth_device = copy.deepcopy(device)
auth_device["id"] = "auth"
auth_session = {"mode": "exec"}


def run_auth(command):
    global auth_device, auth_session
    result = run_cli_command(auth_device, auth_session, command)
    auth_device = result["device"]
    auth_session = result["session"]
    return result.get("output") or ""


run_auth("enable")
run_auth("configure terminal")
run_auth("username admin secret cisco")
run_auth("line console 0")
run_auth("login local")
run_auth("exit")
run_auth("end")
run_auth("write memory")
run_auth("reload")
auth_boot = run_auth("")
assert_true("User Access Verification" in auth_boot and auth_session.get("pendingAction") == "console-username", "console login local must prompt for username after reload")
assert_true("Password" in run_auth("admin"), "console login local must prompt for password after username")
assert_true("Login invalid" in run_auth("wrong") and auth_session.get("pendingAction") == "console-username", "wrong console local password must restart login")
run_auth("admin")
run_auth("cisco")
assert_true(not auth_session.get("pendingAction") and prompt(auth_device, auth_session).endswith(">"), "valid console local login must enter user EXEC")

assert_true(session["mode"] == "exec", "initial mode must be exec")
assert_true(prompt(device, session).endswith(">"), "Python prompt must render exec mode")
assert_true("privileged EXEC" in run("conf t"), "configure terminal from exec must require enable")
run("enable")
assert_true(session["mode"] == "privileged", "enable must enter privileged mode")
assert_true("show ip route" in cli_completions(device, session, "sh ip r"), "Python completions must expand abbreviated show route")
assert_true("debugging is on" in run("debug ip icmp"), "Python debug ip icmp must enable session debug")
assert_true("ip icmp" in run("show debugging"), "Python show debugging must list enabled flags")
assert_true("turned off" in run("undebug all"), "Python undebug all must clear debug flags")
assert_true("No debugging" in run("show debugging"), "Python show debugging must report empty debug state")
assert_true(run("conf t").startswith("Enter configuration"), "conf t must enter global config")
assert_true(session["mode"] == "global", "configure terminal must set global mode")
run("enable secret cisco")
run("service password-encryption")
run("banner motd #Authorized access only#")
run("no ip domain-lookup")
run("ip domain-name lab.local")
run("ip name-server 8.8.8.8 1.1.1.1")
run("ip host www.lab.local 192.168.10.10")
run("ip host old.lab.local 192.168.10.11")
run("no ip host old.lab.local")
run("logging host 192.168.10.50")
run("no logging buffered")
run("username admin privilege 15 secret cisco")
assert_true("[OK]" in run("crypto key generate rsa modulus 1024"), "RSA generation must return OK")
run("ip dhcp excluded-address 192.168.10.1 192.168.10.20")
run("ip dhcp pool USERS")
run("network 192.168.10.0 255.255.255.0")
run("default-router 192.168.10.1")
run("dns-server 8.8.8.8")
run("exit")
run("int vlan 1")
run("ip add 192.168.10.2 255.255.255.0")
run("ip helper-address 192.168.10.254")
run("ip nat inside")
run("exit")
run("int fa0/1")
run("switchport mode trunk")
run("switchport trunk native vlan 99")
run("switchport trunk allowed vlan 20,99")
run("switchport nonegotiate")
run("duplex full")
run("speed 100")
run("mtu 1600")
run("bandwidth 100000")
run("ip nat outside")
run("exit")
run("spanning-tree vlan 20 root primary")
run("access-list 101 permit ip any any")
run("ip access-list extended WEB-FILTER")
run("10 permit tcp any host 192.168.10.2 eq 80")
run("20 deny ip any any")
run("no 20")
run("exit")
run("ip nat inside source static 192.168.10.2 203.0.113.2")
run("router ospf 1")
run("router-id 1.1.1.1")
run("network 192.168.10.0 0.0.0.255 area 0")
run("passive-interface default")
run("no passive-interface vlan 1")
run("default-information originate always")
run("end")
run("clock set 12:34:56 Jun 19 2026")
run("terminal length 0")
run("terminal width 120")
run("terminal no monitor")
terminal = run("show terminal")
assert_true("Length: 0 lines, Width: 120 columns" in terminal and "Monitor logging: disabled" in terminal, "terminal settings must affect show terminal")

tech = run("show tech-support")
assert_true("show running-config" in tech and "show ip route" in tech, "show tech-support must include core diagnostic sections")
assert_true("initial configuration dialog" in run("setup"), "setup must open the initial configuration dialog")
assert_true(session.get("pendingAction") == "initial-config", "setup must wait for initial configuration answer")
run("no")
run("enable")
run("cisco")
running_header = run("show running-config")
assert_true("Building configuration" in running_header and "Current configuration" in running_header and "end" in running_header, "show running-config must render IOS-style wrapper")
assert_true("192.168.10.0/24" in run("sh route"), "sh route must show connected route")
assert_true("12:34:56 Jun 19 2026" in run("show clock"), "clock set must affect show clock")
assert_true("192.168.10.254" in run("sh ip int vlan 1"), "show ip interface must show helper address")
assert_true("Off" in run("sh interfaces switchport"), "show switchport must show nonegotiate off")
physical = run("show interface fa0/1")
assert_true("MTU 1600" in physical and "full" in physical and "100" in physical, "show interface must render physical link settings")
physical_table = run("show interfaces status")
assert_true("trunk" in physical_table and "full" in physical_table and "100" in physical_table, "show interfaces status must render physical link settings")
assert_true("InOctets" in run("show interfaces counters"), "show interfaces counters must be supported")
assert_true("c2960-lanbasek9" in run("show flash"), "show flash must render the boot IOS image")
assert_true("PID:" in run("show inventory"), "show inventory must render device identity")
assert_true("BOOT path-list" in run("show boot"), "show boot must render boot image and startup state")
assert_true("Chassis type" in run("show platform"), "show platform must render chassis details")
assert_true("SYSTEM POWER" in run("show environment"), "show environment must render power diagnostics")
assert_true("Line" in run("show users"), "show users must be supported")
assert_true("ip helper-address 192.168.10.254" in run("show running-config | include helper-address"), "show run pipe include must filter output")
assert_true("router ospf 1" in run("show running-config | section router"), "show run pipe section must include router section")
assert_true("interface Vlan1" in run("show running-config | begin interface Vlan1"), "show run pipe begin must start at matched line")
assert_true("banner motd" not in run("show running-config | exclude banner"), "show run pipe exclude must filter output")
assert_true("FastEthernet0/1" in run("show protocols"), "show protocols must render interface protocol status")
assert_true("controller" in run("show controllers"), "show controllers must render controller status")
stp_vlan = run("show spanning-tree vlan 20")
assert_true("VLAN0020" in stp_vlan and "This bridge is the root" in stp_vlan, "show spanning-tree vlan must reflect root primary")
assert_true("CPU utilization" in run("show processes cpu"), "show processes cpu must be supported")
assert_true("Processor Pool" in run("show memory"), "show memory must be supported")
assert_true("No CDP neighbors" in run("show cdp neighbors"), "show cdp neighbors must be supported by Python")
logging = run("show logging")
assert_true("192.168.10.50" in logging and "Buffer logging: disabled" in logging, "show logging must reflect Python logging config")
hosts = run("show hosts")
assert_true("8.8.8.8" in hosts and "www.lab.local" in hosts and "old.lab.local" not in hosts, "show hosts must reflect Python DNS config")
assert_true("Success rate is 100 percent" in run("ping www.lab.local"), "Python ping must resolve DNS records")
assert_true("Tracing the route" in run("traceroute 192.168.10.10"), "Python traceroute must render route output")
assert_true("Address pools" in run("sh ip dhcp server stat"), "DHCP server statistics must work")
assert_true("No DHCP conflicts" in run("sh ip dhcp conflict"), "DHCP conflict command must work")
assert_true("203.0.113.2" in run("sh ip nat trans"), "NAT translations must show static NAT")
run("clear ip nat translation *")
assert_true("Extended IP access list 101" in run("sh access-lists"), "ACL display must work")
named_acl = run("show ip access-lists WEB-FILTER")
assert_true("WEB-FILTER" in named_acl and "permit tcp any host 192.168.10.2 eq 80" in named_acl, "named ACL display must work")
assert_true("deny ip any any" not in named_acl, "ACL sequence deletion must remove sequence")
protocols = run("sh ip protocols")
assert_true("Passive Interface(s)" in protocols and "Default information originate always" in protocols, "router protocol details must render")
run("conf t")
run("int fa0/2")
run("description temp-reset-check")
run("exit")
assert_true("temp-reset-check" in run("do show running-config interface fa0/2"), "interface description must apply before default interface")
run("default interface fa0/2")
run("end")
assert_true("temp-reset-check" not in run("show running-config interface fa0/2"), "default interface must reset interface-specific config")
run("wr")
startup = run("show startup-config")
assert_true("Using " in startup and "hostname Switch0" in startup, "show startup-config must render NVRAM usage and saved config")
run("reload")
run("")
assert_true(session["mode"] == "exec", "reload confirm must return to exec")
run("enable")
run("cisco")
config = run("sh run")
assert_true("service password-encryption" in config, "service password-encryption must survive reload")
assert_true("banner motd #Authorized access only#" in config, "banner motd must survive reload")
assert_true("no ip domain-lookup" in config, "domain lookup setting must survive reload")
assert_true("ip name-server 8.8.8.8" in config and "ip name-server 1.1.1.1" in config, "name servers must survive reload")
assert_true("ip host www.lab.local 192.168.10.10" in config, "ip host must survive reload")
assert_true("logging host 192.168.10.50" in config, "logging host must survive reload")
assert_true("no logging buffered" in config, "logging buffered setting must survive reload")
assert_true("spanning-tree vlan 20 root primary" in config, "spanning-tree root primary must survive reload")
assert_true("ip helper-address 192.168.10.254" in config, "helper address must survive reload")
assert_true("switchport nonegotiate" in config, "switchport nonegotiate must survive reload")
assert_true("duplex full" in config and "speed 100" in config and "mtu 1600" in config and "bandwidth 100000" in config, "physical interface settings must survive reload")
assert_true("ip access-list extended WEB-FILTER" in config, "named ACL block must survive reload")
assert_true("10 permit tcp any host 192.168.10.2 eq 80" in config, "named ACL sequence must survive reload")
assert_true("default-information originate always" in config, "default route originate must survive reload")
assert_true("Power is off" in run("power off"), "power off must halt the device")
assert_true(device["powerOn"] is False, "power off must update device state")
assert_true("powered off" in run("show version"), "show version must reflect powered-off state")
power_on_output = run("power on")
assert_true("Power restored" in power_on_output and "Self decompressing the image" in power_on_output and "POST: CPU self-test passed" in power_on_output, "power on must boot the device with diagnostics")
assert_true(device["powerOn"] is True, "power on must update device state")
run("enable")
run("cisco")
assert_true("Continue" in run("write erase"), "write erase must ask for confirmation")
run("")
assert_true("not saved" in run("show startup-config"), "write erase confirm must clear startup-config")

print("Python CLI smoke tests passed")
PY
