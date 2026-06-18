#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}"
python3 -m py_compile cli-engine-python/ios_engine.py cli-engine-python/server.py

python3 - <<'PY'
import sys

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


assert_true(session["mode"] == "exec", "initial mode must be exec")
assert_true(prompt(device, session).endswith(">"), "Python prompt must render exec mode")
run("enable")
assert_true(session["mode"] == "privileged", "enable must enter privileged mode")
assert_true("show ip route" in cli_completions(device, session, "sh ip r"), "Python completions must expand abbreviated show route")
assert_true(run("conf t").startswith("Enter configuration"), "conf t must enter global config")
assert_true(session["mode"] == "global", "configure terminal must set global mode")
run("enable secret cisco")
run("service password-encryption")
run("banner motd #Authorized access only#")
run("no ip domain-lookup")
run("ip domain-name lab.local")
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
run("ip nat outside")
run("exit")
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

assert_true("192.168.10.0/24" in run("sh route"), "sh route must show connected route")
assert_true("192.168.10.254" in run("sh ip int vlan 1"), "show ip interface must show helper address")
assert_true("Off" in run("sh interfaces switchport"), "show switchport must show nonegotiate off")
assert_true("python-ios" in run("show flash"), "show flash must render Python IOS image")
assert_true("PID:" in run("show inventory"), "show inventory must render device identity")
assert_true("Line" in run("show users"), "show users must be supported")
assert_true("ip helper-address 192.168.10.254" in run("show running-config | include helper-address"), "show run pipe include must filter output")
assert_true("router ospf 1" in run("show running-config | section router"), "show run pipe section must include router section")
assert_true("FastEthernet0/1" in run("show protocols"), "show protocols must render interface protocol status")
assert_true("controller" in run("show controllers"), "show controllers must render controller status")
assert_true("CPU utilization" in run("show processes cpu"), "show processes cpu must be supported")
assert_true("Processor Pool" in run("show memory"), "show memory must be supported")
assert_true("No CDP neighbors" in run("show cdp neighbors"), "show cdp neighbors must be supported by Python")
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
run("reload")
run("")
assert_true(session["mode"] == "exec", "reload confirm must return to exec")
run("enable")
run("cisco")
config = run("sh run")
assert_true("service password-encryption" in config, "service password-encryption must survive reload")
assert_true("banner motd #Authorized access only#" in config, "banner motd must survive reload")
assert_true("no ip domain-lookup" in config, "domain lookup setting must survive reload")
assert_true("ip helper-address 192.168.10.254" in config, "helper address must survive reload")
assert_true("switchport nonegotiate" in config, "switchport nonegotiate must survive reload")
assert_true("ip access-list extended WEB-FILTER" in config, "named ACL block must survive reload")
assert_true("10 permit tcp any host 192.168.10.2 eq 80" in config, "named ACL sequence must survive reload")
assert_true("default-information originate always" in config, "default route originate must survive reload")
assert_true("Power is off" in run("power off"), "power off must halt the device")
assert_true(device["powerOn"] is False, "power off must update device state")
assert_true("powered off" in run("show version"), "show version must reflect powered-off state")
assert_true("Power restored" in run("power on"), "power on must boot the device")
assert_true(device["powerOn"] is True, "power on must update device state")

print("Python CLI smoke tests passed")
PY
