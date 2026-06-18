#!/usr/bin/env python3
from __future__ import annotations

import copy
import ipaddress
import re
import time
import uuid
from typing import Any


IOSSession = dict[str, Any]
NetworkDevice = dict[str, Any]


def run_cli_command(device: NetworkDevice, session: IOSSession, raw_command: str) -> dict[str, Any]:
    next_device = normalize_device(copy.deepcopy(device or {}))
    next_session = dict(session or {"mode": "exec"})
    command = str(raw_command or "").strip()

    if next_session.get("pendingAction") == "enable-password":
        return _finish_enable_password(next_device, next_session, command)
    if next_session.get("pendingAction") == "reload":
        if command.lower() in ("n", "no"):
            next_session.pop("pendingAction", None)
            return _result(next_device, next_session, "Reload cancelled.")
        reloaded = apply_startup_config(next_device)
        return _result(reloaded, {"mode": "exec"}, "System Bootstrap, Version 15.2(PTWEB)\nSystem returned to ROM by reload.")
    if next_session.get("pendingAction") == "erase-startup":
        if command.lower() in ("n", "no"):
            next_session.pop("pendingAction", None)
            return _result(next_device, next_session, "Erase cancelled.")
        cfg(next_device)["startupConfig"] = []
        return _result(next_device, {"mode": "privileged"}, "[OK]")

    expanded = expand_command(command, next_session)
    lower = ios_lower(expanded)
    mode = next_session.get("mode", "exec")

    if not lower:
        return _result(next_device, next_session, "")
    if lower in ("?", "help"):
        return _result(next_device, next_session, help_text(mode))
    if lower.startswith("do ") and mode not in ("exec", "privileged"):
        nested = run_cli_command(next_device, {"mode": "privileged"}, expanded[3:].strip())
        return _result(nested["device"], next_session, nested["output"])

    common = run_common(next_device, next_session, expanded, lower)
    if common is not None:
        return common
    if mode == "exec":
        return run_exec(next_device, next_session, expanded, lower)
    if mode == "privileged":
        return run_privileged(next_device, next_session, expanded, lower)
    if mode == "global":
        return run_global(next_device, next_session, expanded, lower)
    if mode == "interface":
        return run_interface(next_device, next_session, expanded, lower)
    if mode == "vlan":
        return run_vlan(next_device, next_session, expanded, lower)
    if mode == "dhcp":
        return run_dhcp(next_device, next_session, expanded, lower)
    if mode == "line":
        return run_line(next_device, next_session, expanded, lower)
    if mode == "router":
        return run_router(next_device, next_session, expanded, lower)
    if mode == "acl":
        return run_acl(next_device, next_session, expanded, lower)
    return _result(next_device, next_session, "% Unsupported command. Type help or ?.")


def cli_completions(device: NetworkDevice, session: IOSSession, input_text: str) -> list[str]:
    normalized = " ".join(str(input_text or "").lower().split())
    candidates = command_candidates(normalize_device(copy.deepcopy(device or {})), session or {"mode": "exec"})
    if not normalized:
        return candidates[:40]
    return [candidate for candidate in candidates if abbreviated_candidate_match(normalized, candidate.lower())][:40]


def command_candidates(device: NetworkDevice, session: IOSSession) -> list[str]:
    mode = session.get("mode", "exec")
    if session.get("pendingAction"):
        return []
    if mode == "exec":
        base = ["enable", "show version", "show clock", "show ip interface brief", "show ip route", "show protocols", "show cdp neighbors", "show arp", "power on", "help"]
    elif mode == "privileged":
        base = ["disable", "configure terminal", "conf t", "show running-config", "show running-config | include ", "show running-config | section ", "show startup-config", "show version", "show inventory", "show flash", "show file systems", "show users", "show line", "show protocols", "show controllers", "show processes cpu", "show memory", "show interfaces", "show interfaces description", "show interfaces status", "show interfaces trunk", "show interfaces switchport", "show ip interface", "show ip interface brief", "show ip route", "show ip route summary", "show ip protocols", "show ip ospf", "show ip eigrp neighbors", "show ip rip database", "show ip nat translations", "show ip nat statistics", "show ip dhcp binding", "show ip dhcp conflict", "show ip dhcp pool", "show ip dhcp server statistics", "show access-lists", "clear arp", "clear mac address-table", "clear ip dhcp binding", "clear ip dhcp conflict *", "clear ip nat translation *", "write memory", "copy running-config startup-config", "reload", "write erase", "power off", "power cycle", "help"]
    elif mode == "global":
        base = ["hostname ", "enable secret ", "enable password ", "banner motd #", "no banner motd", "username admin privilege 15 secret cisco", "interface ", "interface range fa0/1 - 2", "default interface ", "vlan ", "line console 0", "line vty 0 4", "router rip", "router ospf 1", "router eigrp 1", "ip route ", "no ip route ", "ip default-gateway ", "ip domain-name lab.local", "ip domain-lookup", "no ip domain-lookup", "crypto key generate rsa modulus 1024", "ip dhcp excluded-address ", "ip dhcp pool ", "ip access-list standard ", "ip access-list extended ", "access-list 101 permit ip any any", "ip nat inside source static ", "service password-encryption", "no service password-encryption", "do show running-config", "end", "exit", "help"]
    elif mode == "interface":
        base = ["description ", "no description", "ip address ", "no ip address", "ip helper-address ", "no ip helper-address ", "ip nat inside", "ip nat outside", "no ip nat inside", "no ip nat outside", "ip access-group 101 in", "ip access-group 101 out", "shutdown", "no shutdown", "switchport mode access", "switchport mode trunk", "switchport access vlan ", "switchport trunk native vlan ", "switchport trunk allowed vlan ", "switchport nonegotiate", "no switchport nonegotiate", "spanning-tree portfast", "spanning-tree bpduguard enable", "clock rate ", "do show running-config interface ", "end", "exit", "help"]
    elif mode == "dhcp":
        base = ["network ", "default-router ", "dns-server ", "start-ip ", "max-leases ", "shutdown", "no shutdown", "end", "exit", "help"]
    elif mode == "line":
        base = ["password ", "login", "login local", "no login", "transport input all", "transport input ssh", "transport input telnet", "transport input none", "exec-timeout 10 0", "logging synchronous", "no logging synchronous", "end", "exit", "help"]
    elif mode == "router":
        base = ["network ", "no network ", "router-id 1.1.1.1", "version 2", "auto-summary", "no auto-summary", "passive-interface default", "no passive-interface default", "passive-interface ", "no passive-interface ", "default-information originate", "default-information originate always", "no default-information originate", "redistribute static", "no redistribute static", "end", "exit", "help"]
    elif mode == "acl":
        base = ["permit ip any any", "deny ip any any", "permit tcp any host 192.168.1.10 eq 80", "permit icmp any any", "no 10", "remark ", "do show access-lists", "end", "exit", "help"]
    else:
        base = ["exit", "end", "help"]
    interface_items = []
    for port in device.get("ports", []):
        name = port.get("name", "")
        interface_items.extend([f"interface {name}", f"show interface {name}", f"show running-config interface {name}"])
    return unique(base + interface_items)


def abbreviated_candidate_match(query: str, candidate: str) -> bool:
    query_tokens = query.split()
    candidate_tokens = candidate.split()
    if len(query_tokens) > len(candidate_tokens):
        return False
    return all(candidate_tokens[index].startswith(token) for index, token in enumerate(query_tokens))


def prompt(device: NetworkDevice, session: IOSSession) -> str:
    hostname = cfg(device).get("hostname") or device.get("label") or "Router"
    mode = (session or {}).get("mode", "exec")
    if mode == "exec":
        return f"{hostname}>"
    if mode == "privileged":
        return f"{hostname}#"
    if mode == "global":
        return f"{hostname}(config)#"
    if mode == "interface":
        return f"{hostname}(config-if)#"
    if mode == "vlan":
        return f"{hostname}(config-vlan)#"
    if mode == "dhcp":
        return f"{hostname}(dhcp-config)#"
    if mode == "line":
        return f"{hostname}(config-line)#"
    if mode == "router":
        return f"{hostname}(config-router)#"
    if mode == "acl":
        acl_type = session.get("aclType", "extended")
        return f"{hostname}(config-{'std' if acl_type == 'standard' else 'ext'}-nacl)#"
    return f"{hostname}#"


def expand_command(command: str, session: IOSSession) -> str:
    tokens = command.strip().split()
    if not tokens:
        return ""
    lower = [token.lower() for token in tokens]
    first = lower[0]
    rest = tokens[1:]
    lrest = lower[1:]
    mode = session.get("mode", "exec")

    if first in ("?",):
        return "?"
    if abbr(first, "enable", 2):
        if mode == "global" and lrest and abbr(lrest[0], "secret"):
            return "enable secret " + " ".join(rest[1:])
        if mode == "global" and lrest and abbr(lrest[0], "password"):
            return "enable password " + " ".join(rest[1:])
        return "enable"
    if abbr(first, "disable", 3):
        return "disable"
    if abbr(first, "configure", 3) and lrest and abbr(lrest[0], "terminal", 1):
        return "configure terminal"
    if first == "conf" and lrest and lrest[0] == "t":
        return "configure terminal"
    if first == "end" or abbr(first, "end", 2):
        return "end"
    if first == "exit" or abbr(first, "exit", 2):
        return "exit"
    if first == "do":
        return "do " + expand_command(" ".join(rest), {"mode": "privileged"})
    if first in ("sh", "sho") or abbr(first, "show", 2):
        return expand_show(rest)
    if first == "wr" or abbr(first, "write", 2):
        return "write erase" if lrest and abbr(lrest[0], "erase") else "write memory"
    if first == "dir":
        return "show flash"
    if abbr(first, "copy", 2):
        text = " ".join(lrest)
        if text in ("run start", "running-config startup-config"):
            return "copy running-config startup-config"
        if text in ("start run", "startup-config running-config"):
            return "copy startup-config running-config"
        return "copy " + " ".join(rest)
    if abbr(first, "erase", 2):
        return "erase startup-config"
    if abbr(first, "reload", 3):
        return "reload"
    if abbr(first, "reboot", 3):
        return "reboot"
    if first == "power":
        return expand_power(rest)
    if first == "no":
        return expand_no(rest)
    if first == "int" or abbr(first, "interface", 3):
        return "interface " + " ".join(rest)
    if abbr(first, "hostname", 4):
        return "hostname " + " ".join(rest)
    if abbr(first, "banner", 3):
        return "banner " + " ".join(rest)
    if abbr(first, "username", 4):
        return "username " + " ".join(rest)
    if abbr(first, "line", 2):
        return "line " + " ".join(rest)
    if abbr(first, "router", 3):
        return "router " + " ".join(rest)
    if first == "ip":
        return expand_ip(rest, mode)
    if first in ("desc",) or abbr(first, "description", 4):
        return "description " + " ".join(rest)
    if abbr(first, "shutdown", 2):
        return "shutdown"
    if abbr(first, "switchport", 2):
        return expand_switchport(tokens)
    if abbr(first, "spanning-tree", 2):
        return "spanning-tree " + " ".join(rest)
    if abbr(first, "vlan", 1):
        return "vlan " + " ".join(rest)
    if abbr(first, "access-list", 3):
        return "access-list " + " ".join(rest)
    if abbr(first, "crypto", 3):
        return expand_crypto(rest)
    if abbr(first, "service", 3):
        return "service " + " ".join(rest)
    if abbr(first, "logging", 3):
        return "logging " + " ".join(rest)
    if abbr(first, "default", 3):
        return "default interface " + " ".join(rest[1:]) if lrest and (abbr(lrest[0], "interface", 3) or lrest[0] == "int") else "default " + " ".join(rest)
    if abbr(first, "clear", 2):
        return expand_clear(rest)
    if mode == "router":
        return expand_router_subcommand(first, rest, lrest, command)
    return command


def expand_show(rest: list[str]) -> str:
    lower = [x.lower() for x in rest]
    if "|" in lower:
        index = lower.index("|")
        return f"{expand_show(rest[:index])} | {' '.join(rest[index + 1:])}"
    first = lower[0] if lower else ""
    second = lower[1] if len(lower) > 1 else ""
    if first in ("run", "running-config") or abbr(first, "running-config", 3):
        if second in ("int", "interface") or abbr(second, "interface", 3):
            return "show running-config interface " + " ".join(rest[2:])
        return "show running-config"
    if abbr(first, "startup-config", 3):
        return "show startup-config"
    if abbr(first, "version", 3):
        return "show version"
    if abbr(first, "clock", 2):
        return "show clock"
    if abbr(first, "inventory", 3):
        return "show inventory"
    if abbr(first, "flash", 2):
        return "show flash"
    if abbr(first, "file") and abbr(second, "systems"):
        return "show file systems"
    if abbr(first, "history", 3):
        return "show history"
    if abbr(first, "privilege", 3):
        return "show privilege"
    if abbr(first, "logging", 3):
        return "show logging"
    if abbr(first, "protocols", 3):
        return "show protocols"
    if abbr(first, "controllers", 4):
        return "show controllers " + " ".join(rest[1:])
    if abbr(first, "processes", 3) and abbr(second, "cpu"):
        return "show processes cpu"
    if abbr(first, "memory", 3):
        return "show memory"
    if abbr(first, "users", 2):
        return "show users"
    if abbr(first, "line", 2):
        return "show line"
    if abbr(first, "terminal", 4):
        return "show terminal"
    if abbr(first, "interfaces", 3) or first in ("int", "interface"):
        if second == "trunk" or abbr(second, "trunk", 2):
            return "show interfaces trunk"
        if second == "status" or abbr(second, "status", 3):
            return "show interfaces status"
        if second == "switchport" or abbr(second, "switchport", 2):
            return "show interfaces switchport"
        if second == "description" or abbr(second, "description", 4):
            return "show interfaces description"
        if len(rest) > 1:
            return "show interface " + " ".join(rest[1:])
        return "show interfaces"
    if first == "route" or first == "ro":
        return "show ip route"
    if abbr(first, "vlan", 1):
        return "show vlan " + " ".join(rest[1:]) if len(rest) > 1 else "show vlan brief"
    if abbr(first, "mac", 3):
        return "show mac address-table " + " ".join(rest[1:])
    if first == "arp":
        return "show arp"
    if first == "nat":
        return "show nat"
    if first == "cdp" and abbr(second, "neighbors", 3):
        return "show cdp neighbors detail" if len(lower) > 2 and lower[2].startswith("det") else "show cdp neighbors"
    if first == "access-lists" or abbr(first, "access-list", 3):
        return "show access-list " + " ".join(rest[1:])
    if first == "ip":
        third = lower[2] if len(lower) > 2 else ""
        if abbr(second, "interface", 3):
            if third and abbr(third, "brief", 1):
                return "show ip interface brief"
            return "show ip interface " + " ".join(rest[2:]) if len(rest) > 2 else "show ip interface"
        if abbr(second, "route", 2):
            return "show ip route " + " ".join(rest[2:])
        if abbr(second, "protocols", 3):
            return "show ip protocols"
        if abbr(second, "ssh", 2):
            return "show ip ssh"
        if abbr(second, "arp"):
            return "show ip arp"
        if abbr(second, "dhcp"):
            if abbr(third, "binding"):
                return "show ip dhcp binding"
            if abbr(third, "conflict", 4):
                return "show ip dhcp conflict"
            if abbr(third, "pool"):
                return "show ip dhcp pool"
            if abbr(third, "server") and len(lower) > 3 and abbr(lower[3], "statistics", 3):
                return "show ip dhcp server statistics"
        if abbr(second, "nat", 2):
            if third.startswith("stat"):
                return "show ip nat statistics"
            return "show ip nat translations"
        if abbr(second, "ospf", 2):
            if third.startswith("nei"):
                return "show ip ospf neighbor"
            if third.startswith("int"):
                return "show ip ospf interface brief"
            return "show ip ospf"
        if abbr(second, "eigrp", 2):
            if third.startswith("nei"):
                return "show ip eigrp neighbors"
            if third.startswith("int"):
                return "show ip eigrp interfaces"
            if third.startswith("top"):
                return "show ip eigrp topology"
            return "show ip eigrp"
        if abbr(second, "rip", 2):
            return "show ip rip database"
        if abbr(second, "access-lists", 3) or abbr(second, "access-list", 3):
            return "show access-list " + " ".join(rest[2:])
    return "show " + " ".join(rest)


def expand_no(rest: list[str]) -> str:
    lower = [x.lower() for x in rest]
    first = lower[0] if lower else ""
    if abbr(first, "shutdown", 2):
        return "no shutdown"
    if abbr(first, "description", 4):
        return "no description"
    if abbr(first, "switchport", 2):
        if len(lower) > 1 and abbr(lower[1], "nonegotiate", 4):
            return "no switchport nonegotiate"
        if len(lower) > 2 and abbr(lower[1], "trunk") and abbr(lower[2], "native"):
            return "no switchport trunk native vlan"
        return "no switchport"
    if first == "ip":
        second = lower[1] if len(lower) > 1 else ""
        if abbr(second, "address"):
            return "no ip address"
        if abbr(second, "helper-address", 4):
            return "no ip helper-address " + " ".join(rest[2:])
        if abbr(second, "route"):
            return "no ip route " + " ".join(rest[2:])
        if abbr(second, "default-gateway", 3):
            return "no ip default-gateway"
        if abbr(second, "domain-name", 3):
            return "no ip domain-name"
        if abbr(second, "dhcp") and len(lower) > 2 and abbr(lower[2], "excluded-address", 3):
            return "no ip dhcp excluded-address " + " ".join(rest[3:])
        if abbr(second, "dhcp") and len(lower) > 2 and abbr(lower[2], "pool"):
            return "no ip dhcp pool " + " ".join(rest[3:])
        if abbr(second, "access-group", 3):
            return "no ip access-group " + " ".join(rest[2:])
        if abbr(second, "access-list", 3):
            return "no ip access-list " + " ".join(rest[2:])
        if abbr(second, "nat", 2):
            return "no ip nat " + " ".join(rest[2:])
    if abbr(first, "enable", 2):
        return "no enable secret" if len(lower) > 1 and abbr(lower[1], "secret") else "no enable password"
    if abbr(first, "banner", 3) and len(lower) > 1 and abbr(lower[1], "motd"):
        return "no banner motd"
    if abbr(first, "vlan"):
        return "no vlan " + " ".join(rest[1:])
    if abbr(first, "access-list", 3):
        return "no access-list " + " ".join(rest[1:])
    if abbr(first, "passive-interface", 4):
        return "no passive-interface " + " ".join(rest[1:])
    if abbr(first, "network", 3):
        return "no network " + " ".join(rest[1:])
    if abbr(first, "redistribute", 3):
        return "no redistribute " + " ".join(rest[1:])
    if abbr(first, "default-information", 3):
        return "no default-information originate"
    if abbr(first, "service", 3):
        return "no service " + " ".join(rest[1:])
    if abbr(first, "username", 4):
        return "no username " + " ".join(rest[1:])
    return "no " + " ".join(rest)


def expand_ip(rest: list[str], mode: str) -> str:
    lower = [x.lower() for x in rest]
    first = lower[0] if lower else ""
    if mode == "interface" and abbr(first, "address"):
        return "ip address " + " ".join(rest[1:])
    if mode == "interface" and abbr(first, "helper-address", 4):
        return "ip helper-address " + " ".join(rest[1:])
    if mode == "interface" and abbr(first, "access-group", 3):
        return "ip access-group " + " ".join(rest[1:])
    if abbr(first, "route"):
        return "ip route " + " ".join(rest[1:])
    if abbr(first, "default-gateway", 3):
        return "ip default-gateway " + " ".join(rest[1:])
    if abbr(first, "domain-name", 3):
        return "ip domain-name " + " ".join(rest[1:])
    if abbr(first, "domain-lookup", 3):
        return "ip domain-lookup"
    if abbr(first, "ssh", 2):
        return "ip ssh version " + (rest[2] if len(rest) > 2 else "2")
    if abbr(first, "dhcp") and len(lower) > 1 and abbr(lower[1], "excluded-address", 3):
        return "ip dhcp excluded-address " + " ".join(rest[2:])
    if abbr(first, "dhcp") and len(lower) > 1 and abbr(lower[1], "pool"):
        return "ip dhcp pool " + " ".join(rest[2:])
    if abbr(first, "access-list", 3):
        return "ip access-list " + " ".join(rest[1:])
    if abbr(first, "nat", 2):
        return "ip nat " + " ".join(rest[1:])
    if abbr(first, "host"):
        return "ip host " + " ".join(rest[1:])
    return "ip " + " ".join(rest)


def expand_switchport(tokens: list[str]) -> str:
    lower = [x.lower() for x in tokens]
    if len(lower) > 1 and abbr(lower[1], "mode", 2):
        return "switchport mode " + (tokens[2] if len(tokens) > 2 else "")
    if len(lower) > 2 and abbr(lower[1], "access") and abbr(lower[2], "vlan"):
        return "switchport access vlan " + " ".join(tokens[3:])
    if len(lower) > 3 and abbr(lower[1], "trunk") and abbr(lower[2], "native"):
        return "switchport trunk native vlan " + " ".join(tokens[4:] if lower[3] == "vlan" else tokens[3:])
    if len(lower) > 3 and abbr(lower[1], "trunk") and abbr(lower[2], "allowed"):
        return "switchport trunk allowed vlan " + " ".join(tokens[4:] if lower[3] == "vlan" else tokens[3:])
    if len(lower) > 1 and abbr(lower[1], "nonegotiate", 4):
        return "switchport nonegotiate"
    return "switchport " + " ".join(tokens[1:])


def expand_crypto(rest: list[str]) -> str:
    lower = [x.lower() for x in rest]
    if len(lower) >= 3 and lower[0].startswith("key") and lower[1].startswith("gen") and lower[2].startswith("rsa"):
        modulus = "1024"
        if "modulus" in lower:
            index = lower.index("modulus")
            if index + 1 < len(rest):
                modulus = rest[index + 1]
        return f"crypto key generate rsa modulus {modulus}"
    if len(lower) >= 3 and lower[0].startswith("key") and lower[1].startswith("zero") and lower[2].startswith("rsa"):
        return "crypto key zeroize rsa"
    return "crypto " + " ".join(rest)


def expand_clear(rest: list[str]) -> str:
    lower = [x.lower() for x in rest]
    if lower and (lower[0].startswith("arp") or (lower[0] == "ip" and len(lower) > 1 and lower[1].startswith("arp"))):
        return "clear arp"
    if lower and lower[0].startswith("mac"):
        return "clear mac address-table"
    if len(lower) >= 3 and lower[0] == "ip" and lower[1].startswith("dhcp"):
        if lower[2].startswith("bind"):
            return "clear ip dhcp binding"
        if lower[2].startswith("conf"):
            return "clear ip dhcp conflict *"
    if len(lower) >= 4 and lower[0] == "ip" and lower[1].startswith("nat") and lower[2].startswith("translation"):
        return "clear ip nat translation *"
    return "clear " + " ".join(rest)


def expand_power(rest: list[str]) -> str:
    first = rest[0].lower() if rest else ""
    if abbr(first, "on"):
        return "power on"
    if abbr(first, "off"):
        return "power off"
    if abbr(first, "cycle"):
        return "power cycle"
    return "power " + " ".join(rest)


def expand_router_subcommand(first: str, rest: list[str], lower_rest: list[str], command: str) -> str:
    if abbr(first, "network", 3):
        return "network " + " ".join(rest)
    if abbr(first, "version", 3):
        return "version " + " ".join(rest)
    if abbr(first, "router-id", 3):
        return "router-id " + " ".join(rest)
    if abbr(first, "passive-interface", 4):
        return "passive-interface " + " ".join(rest)
    if abbr(first, "redistribute", 3):
        return "redistribute " + " ".join(rest)
    if abbr(first, "auto-summary", 3):
        return "auto-summary"
    if abbr(first, "default-information", 3) and lower_rest and abbr(lower_rest[0], "originate", 3):
        return "default-information originate always" if len(lower_rest) > 1 and abbr(lower_rest[1], "always", 2) else "default-information originate"
    return command


def run_common(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any] | None:
    if lower == "enable":
        secret = cfg(device).get("enableSecret") or cfg(device).get("enablePassword")
        if secret:
            return _result(device, {"mode": "exec", "pendingAction": "enable-password"}, "Password:")
        return _result(device, {"mode": "privileged"}, "")
    if lower == "disable":
        return _result(device, {"mode": "exec"}, "")
    if lower == "end":
        return _result(device, {"mode": "privileged"}, "")
    if lower == "exit":
        mode = session.get("mode", "exec")
        if mode == "global":
            return _result(device, {"mode": "privileged"}, "")
        if mode in ("interface", "vlan", "dhcp", "line", "router", "acl"):
            return _result(device, {"mode": "global"}, "")
        return _result(device, {"mode": "exec"}, "")
    if lower.startswith("show "):
        return _result(device, session, show_command(device, lower))
    if lower == "terminal length 0" or lower.startswith("terminal "):
        return _result(device, session, "")
    if lower in ("power off", "power on", "power cycle"):
        return run_power(device, lower)
    return None


def run_exec(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    if lower == "configure terminal":
        return _result(device, session, "% Please enter privileged EXEC mode first. Type enable.")
    return _result(device, session, "% Invalid input detected at '^' marker.")


def run_privileged(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    if lower in ("configure terminal", "conf t"):
        return _result(device, {"mode": "global"}, "Enter configuration commands, one per line.  End with CNTL/Z.")
    if lower in ("write memory", "copy running-config startup-config"):
        cfg(device)["startupConfig"] = running_config(device).splitlines()
        return _result(device, session, "Building configuration...\n[OK]")
    if lower == "copy startup-config running-config":
        return _result(apply_startup_config(device), session, "Destination filename [running-config]?\n[OK]")
    if lower in ("reload", "reboot"):
        return _result(device, {**session, "pendingAction": "reload"}, "Proceed with reload? [confirm]")
    if lower in ("write erase", "erase startup-config"):
        return _result(device, {**session, "pendingAction": "erase-startup"}, "Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]")
    if lower == "clear arp":
        runtime(device)["arpTable"] = []
        return _result(device, session, "")
    if lower == "clear mac address-table":
        runtime(device)["macTable"] = []
        return _result(device, session, "")
    if lower == "clear ip dhcp binding":
        runtime(device)["dhcpLeases"] = []
        return _result(device, session, "")
    if lower in ("clear ip dhcp conflict", "clear ip dhcp conflict *"):
        return _result(device, session, "")
    if lower in ("clear ip nat translation", "clear ip nat translation *"):
        return _result(device, session, "")
    return _result(device, session, "% Unsupported privileged EXEC command.")


def run_power(device: NetworkDevice, lower: str) -> dict[str, Any]:
    if lower == "power off":
        device["powerOn"] = False
        runtime(device)["arpTable"] = []
        runtime(device)["macTable"] = []
        runtime(device)["dhcpLeases"] = []
        return _result(device, {"mode": "exec"}, "System halted.\nPower is off.")
    if lower == "power on":
        device["powerOn"] = True
        return _result(device, {"mode": "exec"}, "System Bootstrap, Version 15.2(PTWEB)\nPower restored.")
    device["powerOn"] = True
    runtime(device)["arpTable"] = []
    runtime(device)["macTable"] = []
    runtime(device)["dhcpLeases"] = []
    return _result(apply_startup_config(device), {"mode": "exec"}, "System Bootstrap, Version 15.2(PTWEB)\nSystem restarted after power cycle.")


def run_global(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    config = cfg(device)
    if lower.startswith("hostname "):
        hostname = re.sub(r"[^a-zA-Z0-9_.-]", "", command.split(maxsplit=1)[1])[:32]
        if not hostname:
            return _result(device, session, "% Invalid hostname.")
        device["label"] = hostname
        config["hostname"] = hostname
        return _result(device, session, "")
    if lower.startswith("default interface "):
        port = find_port(device, command[len("default interface "):].strip())
        if not port:
            return _result(device, session, "% Interface not found.")
        reset_port(port)
        return _result(device, session, "")
    if lower.startswith("enable secret "):
        config["enableSecret"] = command[len("enable secret "):].strip()
        return _result(device, session, "")
    if lower.startswith("enable password "):
        config["enablePassword"] = command[len("enable password "):].strip()
        return _result(device, session, "")
    if lower == "no enable secret":
        config.pop("enableSecret", None)
        return _result(device, session, "")
    if lower == "no enable password":
        config.pop("enablePassword", None)
        return _result(device, session, "")
    if lower.startswith("interface range "):
        selected = parse_interface_range(device, command[len("interface range "):])
        if not selected:
            return _result(device, session, "% Interface range not found.")
        return _result(device, {"mode": "interface", "interfaceId": selected[0]["id"], "interfaceIds": [p["id"] for p in selected]}, "")
    if lower.startswith("interface "):
        name = command[len("interface "):].strip()
        port = find_port(device, name)
        if not port and re.match(r"^vlan\s*\d+$", name, re.I):
            port = create_svi(device, int(re.findall(r"\d+", name)[0]))
        if not port:
            return _result(device, session, f"% Interface {name} not found.")
        return _result(device, {"mode": "interface", "interfaceId": port["id"]}, "")
    if lower.startswith("vlan "):
        vlan = number_after(command, "vlan")
        if not valid_vlan(vlan):
            return _result(device, session, "% VLAN id must be 1-4094.")
        ensure_vlan(device, vlan)
        return _result(device, {"mode": "vlan", "vlanId": vlan}, "")
    if lower.startswith("no vlan "):
        vlan = number_after(command, "no vlan")
        config["vlans"] = [v for v in config.get("vlans", []) if v.get("id") != vlan]
        return _result(device, session, "")
    if lower.startswith("line "):
        line = ensure_line(device, command[len("line "):].strip())
        if not line:
            return _result(device, session, "% Usage: line console 0 | line vty 0 4")
        return _result(device, {"mode": "line", "lineId": line["id"]}, "")
    if lower.startswith("router "):
        route = ensure_routing(device, command[len("router "):].strip())
        if not route:
            return _result(device, session, "% Usage: router rip | router ospf <process-id> | router eigrp <as-number>")
        return _result(device, {"mode": "router", "routingId": route["id"]}, "")
    if lower.startswith("ip route "):
        tokens = command.split()
        if len(tokens) < 5 or not is_ipv4(tokens[2]) or not is_ipv4(tokens[3]) or not is_ipv4(tokens[4]):
            return _result(device, session, "% Usage: ip route <network> <mask> <next-hop>")
        config["staticRoutes"].append({"id": create_id("route"), "network": tokens[2], "mask": tokens[3], "nextHop": tokens[4]})
        return _result(device, session, "")
    if lower.startswith("no ip route "):
        tokens = command.split()
        network = tokens[3] if len(tokens) > 3 else ""
        mask = tokens[4] if len(tokens) > 4 else ""
        next_hop = tokens[5] if len(tokens) > 5 else ""
        config["staticRoutes"] = [r for r in config.get("staticRoutes", []) if not (r.get("network") == network and r.get("mask") == mask and (not next_hop or r.get("nextHop") == next_hop))]
        return _result(device, session, "")
    if lower.startswith("ip default-gateway "):
        gateway = command.split()[2]
        if not is_ipv4(gateway):
            return _result(device, session, "% Invalid default gateway address.")
        config["defaultGateway"] = gateway
        return _result(device, session, "")
    if lower == "no ip default-gateway":
        config.pop("defaultGateway", None)
        return _result(device, session, "")
    if lower.startswith("ip domain-name "):
        config["domainName"] = command[len("ip domain-name "):].strip()
        return _result(device, session, "")
    if lower == "no ip domain-name":
        config.pop("domainName", None)
        return _result(device, session, "")
    if lower == "ip domain-lookup":
        config["domainLookup"] = True
        return _result(device, session, "")
    if lower == "no ip domain-lookup":
        config["domainLookup"] = False
        return _result(device, session, "")
    if lower.startswith("banner motd "):
        config["motdBanner"] = parse_banner(command[len("banner motd "):])
        return _result(device, session, "")
    if lower == "no banner motd":
        config.pop("motdBanner", None)
        return _result(device, session, "")
    if lower.startswith("ip ssh version "):
        version = command.split()[-1]
        if version not in ("1", "2"):
            return _result(device, session, "% SSH version must be 1 or 2.")
        config["sshVersion"] = version
        return _result(device, session, "")
    if lower.startswith("crypto key generate rsa"):
        config["rsaKeyGenerated"] = True
        modulus = command.split()[-1] if command.split()[-1].isdigit() else "1024"
        return _result(device, session, f"The name for the keys will be: {config.get('hostname')}.{config.get('domainName') or 'local'}\n% The key modulus size is {modulus} bits\n% Generating {modulus} bit RSA keys, keys will be non-exportable...[OK]")
    if lower == "crypto key zeroize rsa":
        config["rsaKeyGenerated"] = False
        return _result(device, session, "% All RSA keys zeroized.")
    if lower.startswith("username "):
        user = parse_user(command)
        if not user:
            return _result(device, session, "% Usage: username <name> [privilege <level>] secret|password <value>")
        config["localUsers"] = [u for u in config.get("localUsers", []) if u.get("name", "").lower() != user["name"].lower()] + [user]
        return _result(device, session, "")
    if lower.startswith("no username "):
        name = command[len("no username "):].split()[0]
        config["localUsers"] = [u for u in config.get("localUsers", []) if u.get("name") != name]
        return _result(device, session, "")
    if lower == "service password-encryption":
        config["passwordEncryption"] = True
        return _result(device, session, "")
    if lower == "no service password-encryption":
        config["passwordEncryption"] = False
        return _result(device, session, "")
    if lower.startswith("service ") or lower.startswith("no service "):
        disable = lower.startswith("no ")
        service = command.split()[-1]
        if service not in config["services"]:
            return _result(device, session, "% Unknown service.")
        config["services"][service] = not disable
        return _result(device, session, "")
    if lower.startswith("ip dhcp pool "):
        name = command[len("ip dhcp pool "):].strip()
        pool = find_pool(device, name) or create_pool(device, name)
        return _result(device, {"mode": "dhcp", "dhcpPoolId": pool["id"]}, "")
    if lower.startswith("no ip dhcp pool "):
        name = command[len("no ip dhcp pool "):].strip().lower()
        config["dhcpPools"] = [p for p in config.get("dhcpPools", []) if p.get("name", "").lower() != name]
        runtime(device)["dhcpLeases"] = []
        return _result(device, session, "")
    if lower.startswith("ip dhcp excluded-address "):
        parts = command.split()
        if len(parts) < 4 or not is_ipv4(parts[3]) or (len(parts) > 4 and not is_ipv4(parts[4])):
            return _result(device, session, "% Usage: ip dhcp excluded-address <start-ip> [end-ip]")
        upsert_excluded(device, parts[3], parts[4] if len(parts) > 4 else None)
        return _result(device, session, "")
    if lower.startswith("no ip dhcp excluded-address "):
        parts = command.split()
        start = parts[4] if len(parts) > 4 else ""
        end = parts[5] if len(parts) > 5 else None
        config["dhcpExcludedRanges"] = [r for r in config.get("dhcpExcludedRanges", []) if not (r.get("startIp") == start and (not end or r.get("endIp") == end))]
        return _result(device, session, "")
    if lower.startswith("ip access-list "):
        tokens = command.split()
        if len(tokens) < 4 or tokens[2] not in ("standard", "extended"):
            return _result(device, session, "% Usage: ip access-list standard|extended <name>")
        return _result(device, {"mode": "acl", "aclName": tokens[3], "aclType": tokens[2]}, "")
    if lower.startswith("no ip access-list "):
        name = command.split()[-1]
        remove_acl(device, name)
        return _result(device, session, "")
    if lower.startswith("access-list "):
        rule = parse_acl_rule(command)
        if not rule:
            return _result(device, session, "% Usage: access-list <list> permit|deny <protocol> <source> <destination>")
        config["accessRules"].append(rule)
        return _result(device, session, "")
    if lower.startswith("no access-list "):
        name = command.split()[2]
        remove_acl(device, name)
        return _result(device, session, "")
    if lower.startswith("ip nat inside source static "):
        parts = command.split()
        if len(parts) < 7 or not is_ipv4(parts[5]) or not is_ipv4(parts[6]):
            return _result(device, session, "% Usage: ip nat inside source static <inside-local> <inside-global>")
        config["natRules"] = [n for n in config.get("natRules", []) if not (n.get("insideLocal") == parts[5] and n.get("insideGlobal") == parts[6])]
        config["natRules"].append({"id": create_id("nat"), "insideLocal": parts[5], "insideGlobal": parts[6], "outsideInterface": "", "hits": 0})
        return _result(device, session, "")
    if lower.startswith("no ip nat inside source static "):
        parts = command.split()
        local = parts[6] if len(parts) > 6 else ""
        global_ip = parts[7] if len(parts) > 7 else ""
        config["natRules"] = [n for n in config.get("natRules", []) if not (n.get("insideLocal") == local and n.get("insideGlobal") == global_ip)]
        return _result(device, session, "")
    if lower.startswith("logging ") or lower.startswith("no logging "):
        apply_logging(device, command, lower)
        return _result(device, session, "")
    return _result(device, session, "% Unsupported global configuration command.")


def run_interface(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    ports = selected_ports(device, session)
    if not ports:
        return _result(device, {"mode": "global"}, "% Interface context is missing.")
    if lower.startswith("description "):
        update_ports(ports, {"description": command[len("description "):].strip()[:80]})
        return _result(device, session, "")
    if lower == "no description":
        update_ports(ports, {"description": ""})
        return _result(device, session, "")
    if lower.startswith("ip address "):
        parts = command.split()
        if len(parts) < 4 or not is_ipv4(parts[2]) or not is_ipv4(parts[3]):
            return _result(device, session, "% Usage: ip address <ip> <mask>")
        if len(ports) > 1:
            return _result(device, session, "% IP address cannot be applied to an interface range.")
        update_ports(ports, {"ipAddress": parts[2], "subnetMask": parts[3], "mode": "routed", "ipCapable": True})
        return _result(device, session, "")
    if lower == "no ip address":
        update_ports(ports, {"ipAddress": "", "subnetMask": "", "gateway": "", "dnsServer": ""})
        return _result(device, session, "")
    if lower.startswith("ip helper-address "):
        helper = command.split()[2]
        if not is_ipv4(helper):
            return _result(device, session, "% Usage: ip helper-address <address>")
        for port in ports:
            port["helperAddresses"] = unique((port.get("helperAddresses") or []) + [helper])
        return _result(device, session, "")
    if lower.startswith("no ip helper-address"):
        helper = command.split()[3] if len(command.split()) > 3 else ""
        for port in ports:
            port["helperAddresses"] = [h for h in (port.get("helperAddresses") or []) if helper and h != helper] if helper else []
        return _result(device, session, "")
    if lower == "shutdown":
        update_ports(ports, {"adminUp": False})
        return _result(device, session, "")
    if lower == "no shutdown":
        update_ports(ports, {"adminUp": True})
        return _result(device, session, "")
    if lower == "switchport mode access":
        update_ports(ports, {"mode": "access", "ipAddress": "", "subnetMask": ""})
        return _result(device, session, "")
    if lower == "switchport mode trunk":
        update_ports(ports, {"mode": "trunk", "allowedVlans": ports[0].get("allowedVlans") or [1], "ipAddress": "", "subnetMask": ""})
        return _result(device, session, "")
    if lower == "no switchport":
        update_ports(ports, {"mode": "routed", "ipCapable": True})
        return _result(device, session, "")
    if lower.startswith("switchport access vlan "):
        vlan = number_after(command, "switchport access vlan")
        if not valid_vlan(vlan):
            return _result(device, session, "% VLAN id must be 1-4094.")
        ensure_vlan(device, vlan)
        update_ports(ports, {"mode": "access", "vlan": vlan})
        return _result(device, session, "")
    if lower.startswith("switchport trunk native vlan "):
        vlan = number_after(command, "switchport trunk native vlan")
        if not valid_vlan(vlan):
            return _result(device, session, "% VLAN id must be 1-4094.")
        ensure_vlan(device, vlan)
        update_ports(ports, {"mode": "trunk", "nativeVlan": vlan})
        return _result(device, session, "")
    if lower.startswith("switchport trunk allowed vlan "):
        vlans = parse_vlans(command[len("switchport trunk allowed vlan "):])
        if not vlans:
            return _result(device, session, "% Provide at least one VLAN.")
        for vlan in vlans:
            ensure_vlan(device, vlan)
        update_ports(ports, {"mode": "trunk", "allowedVlans": vlans})
        return _result(device, session, "")
    if lower == "switchport nonegotiate":
        update_ports(ports, {"switchportNonegotiate": True})
        return _result(device, session, "")
    if lower == "no switchport nonegotiate":
        update_ports(ports, {"switchportNonegotiate": False})
        return _result(device, session, "")
    if lower == "spanning-tree portfast":
        update_ports(ports, {"stpPortfast": True})
        return _result(device, session, "")
    if lower == "no spanning-tree portfast":
        update_ports(ports, {"stpPortfast": False})
        return _result(device, session, "")
    if lower == "spanning-tree bpduguard enable":
        update_ports(ports, {"bpduGuard": True})
        return _result(device, session, "")
    if lower == "spanning-tree bpduguard disable":
        update_ports(ports, {"bpduGuard": False})
        return _result(device, session, "")
    if lower == "ip nat inside":
        update_ports(ports, {"natRole": "inside"})
        return _result(device, session, "")
    if lower == "ip nat outside":
        update_ports(ports, {"natRole": "outside"})
        return _result(device, session, "")
    if lower in ("no ip nat inside", "no ip nat outside"):
        update_ports(ports, {"natRole": None})
        return _result(device, session, "")
    if lower.startswith("ip access-group "):
        parts = command.split()
        if len(parts) < 4 or parts[3] not in ("in", "out"):
            return _result(device, session, "% Usage: ip access-group <list> in|out")
        update_ports(ports, {"accessGroupIn" if parts[3] == "in" else "accessGroupOut": parts[2]})
        return _result(device, session, "")
    if lower.startswith("no ip access-group "):
        parts = command.split()
        direction = parts[4] if len(parts) > 4 else ""
        update_ports(ports, {"accessGroupIn" if direction == "in" else "accessGroupOut": ""})
        return _result(device, session, "")
    if lower.startswith("clock rate "):
        update_ports(ports, {"clockRate": number_after(command, "clock rate")})
        return _result(device, session, "")
    if lower == "no clock rate":
        update_ports(ports, {"clockRate": None})
        return _result(device, session, "")
    return _result(device, session, "% Unsupported interface command.")


def run_vlan(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    vlan_id = session.get("vlanId")
    if lower.startswith("name "):
        name = command[len("name "):].strip()[:32] or f"VLAN{vlan_id}"
        for vlan in cfg(device).get("vlans", []):
            if vlan.get("id") == vlan_id:
                vlan["name"] = name
        return _result(device, session, "")
    return _result(device, session, "% Unsupported VLAN command.")


def run_dhcp(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    pool = find_pool_by_id(device, session.get("dhcpPoolId"))
    if not pool:
        return _result(device, {"mode": "global"}, "% DHCP pool context is missing.")
    if lower.startswith("network "):
        parts = command.split()
        if len(parts) < 3 or not is_ipv4(parts[1]) or not is_ipv4(parts[2]):
            return _result(device, session, "% Invalid DHCP network or mask.")
        pool["network"] = parts[1]
        pool["mask"] = parts[2]
        return _result(device, session, "")
    if lower.startswith("default-router "):
        pool["defaultGateway"] = command.split()[1]
        return _result(device, session, "")
    if lower.startswith("dns-server "):
        pool["dnsServer"] = command.split()[1]
        return _result(device, session, "")
    if lower.startswith("start-ip "):
        pool["startIp"] = command.split()[1]
        return _result(device, session, "")
    if lower.startswith("max-leases "):
        pool["maxLeases"] = max(1, number_after(command, "max-leases"))
        return _result(device, session, "")
    if lower == "shutdown":
        pool["enabled"] = False
        return _result(device, session, "")
    if lower == "no shutdown":
        pool["enabled"] = True
        return _result(device, session, "")
    return _result(device, session, "% Unsupported DHCP pool command.")


def run_line(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    line = find_line_by_id(device, session.get("lineId"))
    if not line:
        return _result(device, {"mode": "global"}, "% Line context is missing.")
    if lower.startswith("password "):
        line["password"] = command[len("password "):].strip()
        return _result(device, session, "")
    if lower == "login local":
        line["login"] = True
        line["loginLocal"] = True
        return _result(device, session, "")
    if lower == "login":
        line["login"] = True
        line["loginLocal"] = False
        return _result(device, session, "")
    if lower == "no login":
        line["login"] = False
        line["loginLocal"] = False
        return _result(device, session, "")
    if lower.startswith("transport input "):
        line["transportInput"] = command[len("transport input "):].strip() or "all"
        return _result(device, session, "")
    if lower.startswith("exec-timeout "):
        line["execTimeout"] = command[len("exec-timeout "):].strip() or "10 0"
        return _result(device, session, "")
    if lower == "logging synchronous":
        line["loggingSynchronous"] = True
        return _result(device, session, "")
    if lower == "no logging synchronous":
        line["loggingSynchronous"] = False
        return _result(device, session, "")
    return _result(device, session, "% Unsupported line configuration command.")


def run_router(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    proto = find_routing_by_id(device, session.get("routingId"))
    if not proto:
        return _result(device, {"mode": "global"}, "% Router context is missing.")
    if lower.startswith("network "):
        proto["networks"] = unique((proto.get("networks") or []) + [command[len("network "):].strip()])
        return _result(device, session, "")
    if lower.startswith("no network "):
        wanted = command[len("no network "):].strip().lower()
        proto["networks"] = [n for n in proto.get("networks", []) if n.lower() != wanted]
        return _result(device, session, "")
    if lower.startswith("version "):
        proto["version"] = command.split()[1]
        return _result(device, session, "")
    if lower.startswith("router-id "):
        router_id = command.split()[1]
        if not is_ipv4(router_id):
            return _result(device, session, "% Invalid router-id.")
        proto["routerId"] = router_id
        return _result(device, session, "")
    if lower == "auto-summary":
        proto["autoSummary"] = True
        return _result(device, session, "")
    if lower == "no auto-summary":
        proto["autoSummary"] = False
        return _result(device, session, "")
    if lower == "passive-interface default":
        proto["passiveInterfaceDefault"] = True
        proto["passiveInterfaceExceptions"] = []
        return _result(device, session, "")
    if lower == "no passive-interface default":
        proto["passiveInterfaceDefault"] = False
        proto["passiveInterfaceExceptions"] = []
        return _result(device, session, "")
    if lower.startswith("passive-interface "):
        name = command[len("passive-interface "):].strip()
        if proto.get("passiveInterfaceDefault"):
            proto["passiveInterfaceExceptions"] = [x for x in proto.get("passiveInterfaceExceptions", []) if x.lower() != name.lower()]
        else:
            proto["passiveInterfaces"] = unique((proto.get("passiveInterfaces") or []) + [name])
        return _result(device, session, "")
    if lower.startswith("no passive-interface "):
        name = command[len("no passive-interface "):].strip()
        if proto.get("passiveInterfaceDefault"):
            proto["passiveInterfaceExceptions"] = unique((proto.get("passiveInterfaceExceptions") or []) + [name])
        else:
            proto["passiveInterfaces"] = [x for x in proto.get("passiveInterfaces", []) if x.lower() != name.lower()]
        return _result(device, session, "")
    if lower == "redistribute static":
        proto["redistributeStatic"] = True
        return _result(device, session, "")
    if lower == "no redistribute static":
        proto["redistributeStatic"] = False
        return _result(device, session, "")
    if lower in ("default-information originate", "default-information originate always"):
        proto["defaultInformationOriginate"] = True
        proto["defaultInformationAlways"] = lower.endswith(" always")
        return _result(device, session, "")
    if lower == "no default-information originate":
        proto["defaultInformationOriginate"] = False
        proto["defaultInformationAlways"] = False
        return _result(device, session, "")
    return _result(device, session, "% Unsupported router configuration command.")


def run_acl(device: NetworkDevice, session: IOSSession, command: str, lower: str) -> dict[str, Any]:
    if lower.startswith("remark "):
        return _result(device, session, "")
    if lower.startswith("permit ") or lower.startswith("deny ") or re.match(r"^\d+\s+(permit|deny)\s+", command, re.I):
        rule = parse_acl_rule(command, session.get("aclName"), session.get("aclType"))
        if not rule:
            return _result(device, session, "% Usage: permit|deny <protocol> <source> <destination>")
        cfg(device)["accessRules"].append(rule)
        return _result(device, session, "")
    if re.match(r"^no\s+\d+$", lower):
        sequence = int(command.split()[1])
        remove_acl_sequence(device, session.get("aclName"), sequence)
        return _result(device, session, "")
    if lower.startswith("no permit ") or lower.startswith("no deny "):
        rule = parse_acl_rule(command[3:], session.get("aclName"), session.get("aclType"))
        if rule:
            remove_acl_rule(device, rule)
        return _result(device, session, "")
    return _result(device, session, "% Unsupported access-list configuration command.")


def show_command(device: NetworkDevice, lower: str) -> str:
    if " | " in lower:
        base, pipe = lower.split(" | ", 1)
        return apply_show_filter(show_command(device, base), pipe)
    if lower.startswith("show running-config interface "):
        port = find_port(device, lower[len("show running-config interface "):])
        return "\n".join(interface_config(port)) if port else "% Interface not found."
    if lower in ("show running-config", "show run", "show running-config all", "show running-config brief"):
        return running_config(device)
    if lower == "show startup-config":
        lines = cfg(device).get("startupConfig") or []
        return "\n".join(lines) if lines else "% Startup config is not saved."
    if lower == "show version":
        return f"{device.get('model', 'Cisco IOS')} Software, Network Editor Python IOS\nDevice uptime is simulated\nSystem image file is \"python-ios:{device.get('modelId', 'generic')}\"\n{len(device.get('ports', []))} interfaces\n{'System returned to ROM by power-on' if device.get('powerOn', True) else 'System is powered off'}"
    if lower == "show clock":
        return time.strftime("%Y-%m-%d %H:%M:%S KST", time.localtime())
    if lower == "show inventory":
        return f"NAME: \"{device.get('label', 'Device')}\", DESCR: \"{device.get('model', 'Cisco IOS')}\"\nPID: {device.get('modelId', 'generic')}, VID: PYIOS, SN: {device.get('id', 'unknown')}"
    if lower in ("show flash", "show flash:"):
        startup_bytes = len("\n".join(cfg(device).get("startupConfig", [])))
        image_bytes = 8192 + len(device.get("ports", [])) * 256
        return f"Directory of flash:/\n\n    1  -rw-       {image_bytes:8d}  python-ios-{device.get('modelId', 'generic')}.bin\n    2  -rw-       {startup_bytes:8d}  startup-config\n64016384 bytes total (63901696 bytes free)"
    if lower == "show file systems":
        startup_bytes = len("\n".join(cfg(device).get("startupConfig", []))) or 1
        return f"File Systems:\n\n     Size(b)     Free(b)      Type  Flags  Prefixes\n*   64016384    63901696     flash     rw  flash:\n       {startup_bytes:6d}       0     nvram     rw  nvram:"
    if lower == "show privilege":
        return "Current privilege level is 15"
    if lower == "show history":
        return "Command history is maintained by the terminal session."
    if lower == "show logging":
        return logging_status(device)
    if lower == "show protocols":
        return protocols_status(device)
    if lower.startswith("show controllers"):
        return controllers_status(device, lower[len("show controllers"):].strip())
    if lower == "show processes cpu":
        return "CPU utilization for five seconds: 1%/0%; one minute: 1%; five minutes: 1%"
    if lower == "show memory":
        return "Processor Pool Total: 262144 Used: 98304 Free: 163840\nI/O Pool Total: 65536 Used: 8192 Free: 57344"
    if lower == "show users":
        return "Line       User       Host(s)              Idle       Location\n* 0 con 0  console    idle                 00:00:00   local"
    if lower == "show ip interface brief":
        return "\n".join(["Interface              IP-Address      OK? Method Status", *[f"{p.get('name','').ljust(22)}{(p.get('ipAddress') or 'unassigned').ljust(16)}YES manual {'up' if p.get('adminUp', True) and device.get('powerOn', True) else 'down'}" for p in device.get("ports", [])]])
    if lower == "show ip interface":
        return ip_interface_status(device)
    if lower.startswith("show ip interface "):
        port = find_port(device, lower[len("show ip interface "):])
        return ip_interface_status(device, port) if port else "% Interface not found."
    if lower == "show interfaces":
        return "\n\n".join(interface_status(device, p) for p in device.get("ports", []) if p.get("kind") != "console")
    if lower.startswith("show interface "):
        port = find_port(device, lower[len("show interface "):])
        return interface_status(device, port) if port else "% Interface not found."
    if lower == "show interfaces description":
        return interfaces_description(device)
    if lower == "show interfaces status":
        return interfaces_status(device)
    if lower == "show interfaces trunk":
        return trunk_status(device)
    if lower == "show interfaces switchport":
        return switchport_status(device)
    if lower == "show vlan brief":
        return vlan_brief(device)
    if lower.startswith("show vlan "):
        return vlan_detail(device, lower[len("show vlan "):])
    if lower.startswith("show mac address-table"):
        return mac_table(device, lower)
    if lower in ("show arp", "show ip arp"):
        arp = runtime(device).get("arpTable", [])
        return "\n".join(["Protocol  Address         Hardware Addr       Interface", *[f"Internet  {a.get('ipAddress','').ljust(16)}{a.get('macAddress','').ljust(20)}{a.get('portName','')}" for a in arp]]) if arp else "No ARP entries."
    if lower == "show ip route":
        return route_table(device)
    if lower == "show ip route summary":
        return route_summary(device)
    if lower.startswith("show ip route "):
        return route_table(device, lower[len("show ip route "):].strip())
    if lower == "show ip protocols":
        return ip_protocols(device)
    if lower == "show ip ssh":
        return ip_ssh(device)
    if lower == "show ip ospf":
        return ospf_status(device)
    if lower == "show ip ospf neighbor":
        return "Neighbor ID     Pri   State           Dead Time   Address         Interface\nNo OSPF neighbors are currently discovered in this device-only CLI context."
    if lower in ("show ip ospf interface", "show ip ospf interface brief"):
        return ospf_interfaces(device)
    if lower == "show ip eigrp" or lower == "show ip eigrp neighbors":
        return eigrp_status(device)
    if lower == "show ip eigrp interfaces":
        return eigrp_interfaces(device)
    if lower == "show ip eigrp topology":
        return eigrp_topology(device)
    if lower in ("show ip rip", "show ip rip database"):
        return rip_database(device)
    if lower == "show ip nat translations" or lower == "show nat":
        return nat_translations(device)
    if lower == "show ip nat statistics":
        return nat_statistics(device)
    if lower == "show ip dhcp binding":
        leases = runtime(device).get("dhcpLeases", [])
        return "\n".join(f"{l.get('ipAddress','').ljust(16)}{l.get('macAddress','').ljust(20)}{l.get('deviceId','')}" for l in leases) if leases else "No DHCP bindings."
    if lower == "show ip dhcp conflict":
        return "No DHCP conflicts."
    if lower == "show ip dhcp pool":
        pools = cfg(device).get("dhcpPools", [])
        return "\n\n".join(f"Pool {p.get('name')}\n  Network {p.get('network')} {p.get('mask')}\n  Default router {p.get('defaultGateway')}\n  DNS server {p.get('dnsServer')}\n  Start address {p.get('startIp')}, maximum leases {p.get('maxLeases')}\n  State {'active' if p.get('enabled', True) else 'disabled'}" for p in pools) if pools else "No DHCP pools."
    if lower == "show ip dhcp server statistics":
        return dhcp_stats(device)
    if lower in ("show access-list", "show access-lists") or lower.startswith("show access-list "):
        name = lower[len("show access-list "):].strip() if lower.startswith("show access-list ") else ""
        return access_lists(device, name)
    if lower == "show hosts":
        records = cfg(device).get("dnsRecords", [])
        return "\n".join(f"{r.get('name','').ljust(32)}{r.get('value','')}" for r in records) if records else "No host records."
    if lower in ("show cdp neighbors", "show cdp neighbors detail"):
        return "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\nNo CDP neighbors discovered by the Python device-local CLI engine."
    if lower == "show line":
        return line_status(device)
    if lower == "show terminal":
        return "Line 0, Location: local\nLength: 24 lines, Width: 80 columns\nHistory is enabled. Completion is enabled."
    return "% Unsupported show command."


def running_config(device: NetworkDevice) -> str:
    config = cfg(device)
    lines: list[str] = [f"hostname {config.get('hostname') or device.get('label') or 'Router'}"]
    if config.get("enableSecret"):
        lines.append(f"enable secret {config['enableSecret']}")
    if config.get("enablePassword"):
        lines.append(f"enable password {config['enablePassword']}")
    if config.get("passwordEncryption"):
        lines.append("service password-encryption")
    log = config.get("logging") or {}
    if log.get("console") is False:
        lines.append("no logging console")
    if log.get("trap"):
        lines.append(f"logging trap {log['trap']}")
    lines.extend(f"logging host {host}" for host in log.get("hosts", []))
    if config.get("domainName"):
        lines.append(f"ip domain-name {config['domainName']}")
    if config.get("domainLookup") is False:
        lines.append("no ip domain-lookup")
    if config.get("sshVersion"):
        lines.append(f"ip ssh version {config['sshVersion']}")
    if config.get("rsaKeyGenerated"):
        lines.append("crypto key generate rsa modulus 1024")
    if config.get("defaultGateway"):
        lines.append(f"ip default-gateway {config['defaultGateway']}")
    if config.get("motdBanner"):
        lines.append(f"banner motd #{config['motdBanner']}#")
    lines.extend(user_config(user) for user in config.get("localUsers", []))
    for vlan in config.get("vlans", []):
        lines.extend([f"vlan {vlan.get('id')}", f" name {vlan.get('name')}"])
    for port in device.get("ports", []):
        lines.extend(interface_config(port))
    lines.extend(f"ip route {r.get('network')} {r.get('mask')} {r.get('nextHop')}" for r in config.get("staticRoutes", []))
    for item in config.get("dhcpExcludedRanges", []):
        lines.append(f"ip dhcp excluded-address {item.get('startIp')}{' ' + item.get('endIp') if item.get('endIp') else ''}")
    for pool in config.get("dhcpPools", []):
        lines.extend([f"ip dhcp pool {pool.get('name')}", f" network {pool.get('network')} {pool.get('mask')}", f" default-router {pool.get('defaultGateway')}", f" dns-server {pool.get('dnsServer')}", f" start-ip {pool.get('startIp')}", f" max-leases {pool.get('maxLeases')}", " no shutdown" if pool.get("enabled", True) else " shutdown"])
    lines.extend(acl_config(config.get("accessRules", [])))
    lines.extend(f"ip nat inside source static {n.get('insideLocal')} {n.get('insideGlobal')}" for n in config.get("natRules", []))
    for line in config.get("lineConfigs", []):
        lines.extend(line_config(line))
    for proto in config.get("routingProtocols", []):
        lines.extend(routing_config(proto))
    return "\n".join(lines)


def interface_config(port: dict[str, Any] | None) -> list[str]:
    if not port:
        return []
    lines = [f"interface {port.get('name')}"]
    if port.get("description"):
        lines.append(f" description {port['description']}")
    if port.get("mode") == "routed" and port.get("ipAddress"):
        lines.append(f" ip address {port.get('ipAddress')} {port.get('subnetMask')}")
    if port.get("mode") == "access":
        lines.extend([" switchport mode access", f" switchport access vlan {port.get('vlan', 1)}"])
    if port.get("mode") == "trunk":
        lines.append(" switchport mode trunk")
        if port.get("nativeVlan", 1) != 1:
            lines.append(f" switchport trunk native vlan {port.get('nativeVlan')}")
        lines.append(f" switchport trunk allowed vlan {','.join(map(str, port.get('allowedVlans') or [1]))}")
    if port.get("switchportNonegotiate"):
        lines.append(" switchport nonegotiate")
    if port.get("natRole"):
        lines.append(f" ip nat {port['natRole']}")
    for helper in port.get("helperAddresses") or []:
        lines.append(f" ip helper-address {helper}")
    if port.get("accessGroupIn"):
        lines.append(f" ip access-group {port['accessGroupIn']} in")
    if port.get("accessGroupOut"):
        lines.append(f" ip access-group {port['accessGroupOut']} out")
    if port.get("stpPortfast"):
        lines.append(" spanning-tree portfast")
    if port.get("bpduGuard"):
        lines.append(" spanning-tree bpduguard enable")
    if port.get("clockRate"):
        lines.append(f" clock rate {port['clockRate']}")
    lines.append(" no shutdown" if port.get("adminUp", True) else " shutdown")
    return lines


def routing_config(proto: dict[str, Any]) -> list[str]:
    lines = [f"router {proto.get('protocol')}{' ' + str(proto.get('processId')) if proto.get('processId') else ''}"]
    if proto.get("routerId"):
        lines.append(f" router-id {proto['routerId']}")
    if proto.get("version"):
        lines.append(f" version {proto['version']}")
    lines.extend(f" network {network}" for network in proto.get("networks", []))
    lines.append(" auto-summary" if proto.get("autoSummary") else " no auto-summary")
    if proto.get("passiveInterfaceDefault"):
        lines.append(" passive-interface default")
    lines.extend(f" passive-interface {name}" for name in proto.get("passiveInterfaces", []))
    lines.extend(f" no passive-interface {name}" for name in proto.get("passiveInterfaceExceptions", []))
    if proto.get("redistributeStatic"):
        lines.append(" redistribute static")
    if proto.get("defaultInformationOriginate"):
        lines.append(f" default-information originate{' always' if proto.get('defaultInformationAlways') else ''}")
    return lines


def apply_startup_config(device: NetworkDevice) -> NetworkDevice:
    startup = list(cfg(device).get("startupConfig") or [])
    if not startup:
        runtime(device)["arpTable"] = []
        runtime(device)["macTable"] = []
        runtime(device)["dhcpLeases"] = []
        return device
    preserved = copy.deepcopy(device)
    preserved["config"] = {
        **cfg(preserved),
        "hostname": cfg(device).get("hostname") or device.get("label") or "Router",
        "startupConfig": startup,
        "staticRoutes": [],
        "vlans": [{"id": 1, "name": "default"}],
        "dhcpPools": [],
        "dhcpExcludedRanges": [],
        "dnsRecords": [],
        "accessRules": [],
        "natRules": [],
        "localUsers": [],
        "lineConfigs": [],
        "routingProtocols": [],
    }
    for port in preserved.get("ports", []):
        reset_port(port)
    session = {"mode": "global"}
    for line in startup:
        stripped = line.strip()
        if not stripped:
            continue
        if not line.startswith(" "):
            session = {"mode": "global"}
        result = run_cli_command(preserved, session, stripped)
        preserved = result["device"]
        session = result["session"]
    runtime(preserved)["arpTable"] = []
    runtime(preserved)["macTable"] = []
    runtime(preserved)["dhcpLeases"] = []
    return preserved


def normalize_device(device: NetworkDevice) -> NetworkDevice:
    device.setdefault("label", "Router0")
    device.setdefault("kind", "router")
    device.setdefault("model", "Cisco IOS")
    device.setdefault("modelId", "router")
    device.setdefault("powerOn", True)
    device.setdefault("ports", [])
    config = device.setdefault("config", {})
    config.setdefault("hostname", device.get("label") or "Router0")
    config.setdefault("startupConfig", [])
    config.setdefault("domainLookup", True)
    config.setdefault("sshVersion", "2")
    config.setdefault("rsaKeyGenerated", False)
    config.setdefault("passwordEncryption", False)
    config.setdefault("logging", {"console": True, "buffered": True, "hosts": [], "trap": "informational"})
    config.setdefault("lineConfigs", [])
    config.setdefault("routingProtocols", [])
    config.setdefault("staticRoutes", [])
    config.setdefault("vlans", [{"id": 1, "name": "default"}])
    config.setdefault("dhcpPools", [])
    config.setdefault("dhcpExcludedRanges", [])
    config.setdefault("dnsRecords", [])
    config.setdefault("accessRules", [])
    config.setdefault("natRules", [])
    config.setdefault("localUsers", [])
    config.setdefault("services", {"http": False, "dhcp": False, "dns": False, "tftp": False, "syslog": False})
    device.setdefault("runtime", {"arpTable": [], "macTable": [], "dhcpLeases": [], "logs": []})
    for index, port in enumerate(device["ports"]):
        normalize_port(port, index)
    return device


def normalize_port(port: dict[str, Any], index: int) -> None:
    port.setdefault("id", create_id("port"))
    port.setdefault("name", f"FastEthernet0/{index}")
    port.setdefault("kind", "fast-ethernet")
    port.setdefault("description", "")
    port.setdefault("macAddress", f"02:00:00:00:00:{index:02x}")
    port.setdefault("mode", "access")
    port.setdefault("vlan", 1)
    port.setdefault("allowedVlans", [1])
    port.setdefault("nativeVlan", 1)
    port.setdefault("ipAddress", "")
    port.setdefault("subnetMask", "")
    port.setdefault("gateway", "")
    port.setdefault("dnsServer", "")
    port.setdefault("adminUp", True)
    port.setdefault("ipCapable", port.get("mode") == "routed")
    port.setdefault("stpPortfast", False)
    port.setdefault("bpduGuard", False)
    port.setdefault("accessGroupIn", "")
    port.setdefault("accessGroupOut", "")
    port.setdefault("helperAddresses", [])
    port.setdefault("switchportNonegotiate", False)


def cfg(device: NetworkDevice) -> dict[str, Any]:
    return device.setdefault("config", {})


def runtime(device: NetworkDevice) -> dict[str, Any]:
    return device.setdefault("runtime", {"arpTable": [], "macTable": [], "dhcpLeases": [], "logs": []})


def _result(device: NetworkDevice, session: IOSSession, output: str) -> dict[str, Any]:
    return {"device": device, "session": session, "output": output}


def _finish_enable_password(device: NetworkDevice, session: IOSSession, command: str) -> dict[str, Any]:
    secret = cfg(device).get("enableSecret") or cfg(device).get("enablePassword") or ""
    if command == secret:
        return _result(device, {"mode": "privileged"}, "")
    return _result(device, {"mode": "exec"}, "% Access denied")


def abbr(value: str | None, full: str, min_len: int = 1) -> bool:
    return bool(value) and len(value) >= min_len and full.startswith(value)


def ios_lower(value: str) -> str:
    return " ".join(value.strip().lower().split())


def create_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4()}"


def is_ipv4(value: Any) -> bool:
    try:
        ipaddress.IPv4Address(str(value))
        return True
    except Exception:
        return False


def mask_to_prefix(mask: str) -> int:
    try:
        return ipaddress.IPv4Network(f"0.0.0.0/{mask}").prefixlen
    except Exception:
        return 0


def network_address(ip: str, mask: str) -> str:
    try:
        return str(ipaddress.IPv4Network(f"{ip}/{mask}", strict=False).network_address)
    except Exception:
        return "0.0.0.0"


def number_after(command: str, prefix: str) -> int:
    tail = command[len(prefix):].strip()
    match = re.search(r"\d+", tail)
    return int(match.group(0)) if match else 0


def valid_vlan(vlan: int) -> bool:
    return 1 <= int(vlan) <= 4094


def unique(values: list[Any]) -> list[Any]:
    seen = set()
    output = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            output.append(value)
    return output


def normalize_port_name(name: str) -> str:
    compact = re.sub(r"\s+", "", str(name).lower())
    replacements = [("fastethernet", "fastethernet"), ("gigabitethernet", "gigabitethernet"), ("serial", "serial"), ("vlan", "vlan"), ("fa", "fastethernet"), ("f", "fastethernet"), ("gi", "gigabitethernet"), ("g", "gigabitethernet"), ("se", "serial"), ("s", "serial")]
    for prefix, full in replacements:
        if compact.startswith(prefix):
            return full + compact[len(prefix):]
    return compact


def find_port(device: NetworkDevice, name: str) -> dict[str, Any] | None:
    wanted = normalize_port_name(name)
    for port in device.get("ports", []):
        if normalize_port_name(port.get("name", "")) == wanted:
            return port
    return None


def selected_ports(device: NetworkDevice, session: IOSSession) -> list[dict[str, Any]]:
    ids = session.get("interfaceIds") or ([session.get("interfaceId")] if session.get("interfaceId") else [])
    return [p for p in device.get("ports", []) if p.get("id") in ids]


def parse_interface_range(device: NetworkDevice, text: str) -> list[dict[str, Any]]:
    names: list[str] = []
    for token in re.sub(r"\s*-\s*", "-", text.replace(" ", "")).split(","):
        match = re.match(r"^([a-zA-Z]+)(\d+/)(\d+)-(\d+)$", token)
        if match:
            prefix, slot, start, end = match.groups()
            names.extend(f"{prefix}{slot}{number}" for number in range(int(start), int(end) + 1))
        elif token:
            names.append(token)
    ports = []
    for name in names:
        port = find_port(device, name)
        if port and port not in ports:
            ports.append(port)
    return ports


def update_ports(ports: list[dict[str, Any]], patch: dict[str, Any]) -> None:
    for port in ports:
        for key, value in patch.items():
            if value is None:
                port.pop(key, None)
            else:
                port[key] = value


def create_svi(device: NetworkDevice, vlan: int) -> dict[str, Any]:
    ensure_vlan(device, vlan)
    port = {
        "id": create_id("port"),
        "name": f"Vlan{vlan}",
        "kind": "ethernet",
        "description": "",
        "macAddress": f"02:00:00:ff:{vlan // 256:02x}:{vlan % 256:02x}",
        "mode": "routed",
        "vlan": vlan,
        "allowedVlans": [vlan],
        "nativeVlan": 1,
        "ipAddress": "",
        "subnetMask": "",
        "gateway": "",
        "dnsServer": "",
        "adminUp": True,
        "ipCapable": True,
        "accessGroupIn": "",
        "accessGroupOut": "",
        "helperAddresses": [],
    }
    device.setdefault("ports", []).append(port)
    return port


def reset_port(port: dict[str, Any]) -> None:
    mode = "routed" if port.get("name", "").lower().startswith("vlan") or port.get("kind") in ("serial",) else "access"
    port.update({"description": "", "ipAddress": "", "subnetMask": "", "gateway": "", "dnsServer": "", "mode": mode, "vlan": 1, "allowedVlans": [1], "nativeVlan": 1, "adminUp": True, "accessGroupIn": "", "accessGroupOut": "", "helperAddresses": [], "natRole": None, "switchportNonegotiate": False})


def ensure_vlan(device: NetworkDevice, vlan_id: int) -> None:
    vlans = cfg(device).setdefault("vlans", [])
    if not any(v.get("id") == vlan_id for v in vlans):
        vlans.append({"id": vlan_id, "name": f"VLAN{vlan_id}"})
        vlans.sort(key=lambda item: item.get("id", 0))


def parse_vlans(value: str) -> list[int]:
    out: list[int] = []
    for part in value.split(","):
        if "-" in part:
            start, end = part.split("-", 1)
            out.extend(range(int(start), int(end) + 1))
        elif part.strip().isdigit():
            out.append(int(part.strip()))
    return [v for v in unique(out) if valid_vlan(v)]


def find_pool(device: NetworkDevice, name: str) -> dict[str, Any] | None:
    return next((p for p in cfg(device).get("dhcpPools", []) if p.get("name", "").lower() == name.lower()), None)


def find_pool_by_id(device: NetworkDevice, pool_id: str | None) -> dict[str, Any] | None:
    return next((p for p in cfg(device).get("dhcpPools", []) if p.get("id") == pool_id), None)


def create_pool(device: NetworkDevice, name: str) -> dict[str, Any]:
    pool = {"id": create_id("pool"), "name": name, "network": "192.168.1.0", "mask": "255.255.255.0", "defaultGateway": "192.168.1.1", "dnsServer": "8.8.8.8", "startIp": "192.168.1.10", "maxLeases": 64, "enabled": True}
    cfg(device).setdefault("dhcpPools", []).append(pool)
    cfg(device).setdefault("services", {}).setdefault("dhcp", True)
    cfg(device)["services"]["dhcp"] = True
    return pool


def upsert_excluded(device: NetworkDevice, start: str, end: str | None) -> None:
    ranges = cfg(device).setdefault("dhcpExcludedRanges", [])
    ranges[:] = [r for r in ranges if r.get("startIp") != start]
    item = {"id": create_id("dhcp_exclude"), "startIp": start}
    if end:
        item["endIp"] = end
    ranges.append(item)


def ensure_line(device: NetworkDevice, target: str) -> dict[str, Any] | None:
    parts = target.split()
    if not parts or parts[0] not in ("console", "vty"):
        return None
    kind = parts[0]
    line_range = " ".join(parts[1:]) or ("0" if kind == "console" else "0 4")
    lines = cfg(device).setdefault("lineConfigs", [])
    existing = next((line for line in lines if line.get("kind") == kind and line.get("range") == line_range), None)
    if existing:
        return existing
    line = {"id": create_id("line"), "kind": kind, "range": line_range, "password": "", "login": False, "loginLocal": False, "transportInput": "all" if kind == "vty" else "", "execTimeout": "10 0", "loggingSynchronous": False}
    lines.append(line)
    return line


def find_line_by_id(device: NetworkDevice, line_id: str | None) -> dict[str, Any] | None:
    return next((line for line in cfg(device).get("lineConfigs", []) if line.get("id") == line_id), None)


def ensure_routing(device: NetworkDevice, target: str) -> dict[str, Any] | None:
    parts = target.split()
    if not parts or parts[0] not in ("rip", "ospf", "eigrp"):
        return None
    protocol = parts[0]
    process_id = None if protocol == "rip" else (parts[1] if len(parts) > 1 else "1")
    routes = cfg(device).setdefault("routingProtocols", [])
    existing = next((r for r in routes if r.get("protocol") == protocol and (r.get("processId") or "") == (process_id or "")), None)
    if existing:
        return existing
    route = {"id": create_id("routing"), "protocol": protocol, "processId": process_id, "networks": [], "version": "2" if protocol == "rip" else None, "routerId": None, "autoSummary": False, "passiveInterfaceDefault": False, "passiveInterfaces": [], "passiveInterfaceExceptions": [], "redistributeStatic": False, "defaultInformationOriginate": False, "defaultInformationAlways": False}
    routes.append(route)
    return route


def find_routing_by_id(device: NetworkDevice, routing_id: str | None) -> dict[str, Any] | None:
    return next((route for route in cfg(device).get("routingProtocols", []) if route.get("id") == routing_id), None)


def parse_user(command: str) -> dict[str, Any] | None:
    tokens = command.split()
    if len(tokens) < 4:
        return None
    name = tokens[1]
    user = {"id": create_id("user"), "name": name}
    if "privilege" in tokens:
        index = tokens.index("privilege")
        if index + 1 < len(tokens) and tokens[index + 1].isdigit():
            user["privilege"] = int(tokens[index + 1])
    if "secret" in tokens:
        index = tokens.index("secret")
        user["secret"] = " ".join(tokens[index + 1:])
        return user if user["secret"] else None
    if "password" in tokens:
        index = tokens.index("password")
        user["password"] = " ".join(tokens[index + 1:])
        return user if user["password"] else None
    return None


def parse_banner(value: str) -> str:
    text = value.strip()
    if len(text) >= 2:
        delimiter = text[0]
        end = text.find(delimiter, 1)
        if end > 0:
            return text[1:end]
    return text.strip("#")


def parse_acl_rule(command: str, list_name: str | None = None, acl_type: str | None = None) -> dict[str, Any] | None:
    tokens = command.split()
    if tokens and tokens[0].isdigit():
        sequence = int(tokens.pop(0))
    else:
        sequence = None
    if tokens and tokens[0] == "access-list":
        if len(tokens) < 4:
            return None
        list_name = tokens[1]
        tokens = tokens[2:]
    if len(tokens) < 2 or tokens[0] not in ("permit", "deny"):
        return None
    action = tokens[0]
    protocol = "ip"
    if acl_type == "standard" or (list_name and list_name.isdigit() and 1 <= int(list_name) <= 99):
        source = " ".join(tokens[1:]) or "any"
        destination = "any"
        acl_type = "standard"
    else:
        protocol = tokens[1] if len(tokens) > 1 else "ip"
        source = tokens[2] if len(tokens) > 2 else "any"
        destination = " ".join(tokens[3:]) if len(tokens) > 3 else "any"
        acl_type = "extended"
    return {"id": create_id("acl"), "action": action, "protocol": protocol if protocol in ("ip", "icmp", "tcp", "udp", "http", "dns", "dhcp") else "ip", "source": source, "destination": destination, "interfaceName": list_name or "", "listName": list_name or "", "listType": acl_type, "hits": 0, **({"sequence": sequence} if sequence is not None else {})}


def remove_acl(device: NetworkDevice, name: str) -> None:
    cfg(device)["accessRules"] = [r for r in cfg(device).get("accessRules", []) if acl_name(r).lower() != name.lower()]


def remove_acl_sequence(device: NetworkDevice, name: str | None, sequence: int) -> None:
    cfg(device)["accessRules"] = [r for r in cfg(device).get("accessRules", []) if not (acl_name(r) == name and r.get("sequence") == sequence)]


def remove_acl_rule(device: NetworkDevice, target: dict[str, Any]) -> None:
    cfg(device)["accessRules"] = [
        rule for rule in cfg(device).get("accessRules", [])
        if not (
            acl_name(rule).lower() == acl_name(target).lower()
            and rule.get("action") == target.get("action")
            and rule.get("protocol") == target.get("protocol")
            and rule.get("source") == target.get("source")
            and rule.get("destination") == target.get("destination")
        )
    ]


def acl_name(rule: dict[str, Any]) -> str:
    return str(rule.get("listName") or rule.get("interfaceName") or "")


def apply_logging(device: NetworkDevice, command: str, lower: str) -> None:
    log = cfg(device).setdefault("logging", {"console": True, "buffered": True, "hosts": [], "trap": "informational"})
    if lower == "logging console":
        log["console"] = True
    elif lower == "no logging console":
        log["console"] = False
    elif lower.startswith("logging trap "):
        log["trap"] = command[len("logging trap "):].strip()
    elif lower.startswith("logging host "):
        host = command[len("logging host "):].strip()
        if is_ipv4(host):
            log["hosts"] = unique(log.get("hosts", []) + [host])
    elif lower.startswith("no logging host "):
        host = command[len("no logging host "):].strip()
        log["hosts"] = [item for item in log.get("hosts", []) if item != host]


def route_table(device: NetworkDevice, filter_text: str = "") -> str:
    lines = []
    for port in device.get("ports", []):
        if port.get("adminUp", True) and port.get("ipAddress") and port.get("subnetMask"):
            network = network_address(port["ipAddress"], port["subnetMask"])
            prefix = mask_to_prefix(port["subnetMask"])
            lines.extend([f"C    {network}/{prefix} is directly connected, {port.get('name')}", f"L    {port.get('ipAddress')}/32 is directly connected, {port.get('name')}"])
    for route in cfg(device).get("staticRoutes", []):
        lines.append(f"S    {route.get('network')}/{mask_to_prefix(route.get('mask', '0.0.0.0'))} [1/0] via {route.get('nextHop')}")
    if filter_text:
        lines = [line for line in lines if filter_text in line or (filter_text == "connected" and line.startswith(("C", "L"))) or (filter_text == "static" and line.startswith("S"))]
    default = next((r for r in cfg(device).get("staticRoutes", []) if r.get("network") == "0.0.0.0" and r.get("mask") == "0.0.0.0"), None)
    gateway = f"Gateway of last resort is {default.get('nextHop')} to network 0.0.0.0" if default else "Gateway of last resort is not set"
    return "\n".join(["Codes: C - connected, S - static, L - local", gateway, "", *(lines or ["No routes installed."])])


def apply_show_filter(output: str, pipe: str) -> str:
    tokens = pipe.split(maxsplit=1)
    if not tokens:
        return output
    action = tokens[0]
    pattern = tokens[1] if len(tokens) > 1 else ""
    if not pattern:
        return output
    lines = output.splitlines()
    if action in ("include", "inc"):
        return "\n".join(line for line in lines if pattern.lower() in line.lower()) or ""
    if action in ("exclude", "exc"):
        return "\n".join(line for line in lines if pattern.lower() not in line.lower())
    if action in ("begin", "beg"):
        for index, line in enumerate(lines):
            if pattern.lower() in line.lower():
                return "\n".join(lines[index:])
        return ""
    if action in ("section", "sec"):
        sections: list[str] = []
        index = 0
        while index < len(lines):
            line = lines[index]
            if line and not line.startswith(" ") and pattern.lower() in line.lower():
                sections.append(line)
                index += 1
                while index < len(lines) and (not lines[index] or lines[index].startswith(" ")):
                    sections.append(lines[index])
                    index += 1
                continue
            index += 1
        return "\n".join(sections)
    return output


def route_summary(device: NetworkDevice) -> str:
    connected = len([p for p in device.get("ports", []) if p.get("ipAddress")])
    static = len(cfg(device).get("staticRoutes", []))
    dynamic = sum(len(p.get("networks", [])) for p in cfg(device).get("routingProtocols", []))
    return f"Route Source    Networks    Memory (bytes)\nconnected       {connected:<12}{connected * 128}\nstatic          {static:<12}{static * 128}\ndynamic         {dynamic:<12}{dynamic * 128}\nTotal routes: {connected * 2 + static + dynamic}"


def ip_protocols(device: NetworkDevice) -> str:
    lines = []
    for proto in cfg(device).get("routingProtocols", []):
        lines.extend([f"Routing Protocol is \"{proto.get('protocol')}{' ' + str(proto.get('processId')) if proto.get('processId') else ''}\"", f"  Automatic network summarization is {'in effect' if proto.get('autoSummary') else 'not in effect'}"])
        if proto.get("version"):
            lines.append(f"  Sending updates version {proto.get('version')}")
        lines.extend(["  Routing for Networks:", *[f"    {network}" for network in proto.get("networks", [])]] if proto.get("networks") else ["  No networks configured."])
        if proto.get("passiveInterfaceDefault"):
            lines.extend(["  Passive Interface(s):", "    default"])
        if proto.get("passiveInterfaces"):
            lines.extend(["  Passive Interface(s):", *[f"    {name}" for name in proto.get("passiveInterfaces", [])]])
        if proto.get("passiveInterfaceExceptions"):
            lines.extend(["  Non-passive Interface(s):", *[f"    {name}" for name in proto.get("passiveInterfaceExceptions", [])]])
        if proto.get("redistributeStatic"):
            lines.append("  Redistributing: static")
        if proto.get("defaultInformationOriginate"):
            lines.append(f"  Default information originate{' always' if proto.get('defaultInformationAlways') else ''}")
    return "\n".join(lines) if lines else "No routing protocols configured."


def interface_status(device: NetworkDevice, port: dict[str, Any] | None) -> str:
    if not port:
        return "% Interface not found."
    operational = device.get("powerOn", True) and port.get("adminUp", True) and bool(port.get("linkId"))
    return "\n".join([f"{port.get('name')} is {'up' if device.get('powerOn', True) and port.get('adminUp', True) else 'down'}, line protocol is {'up' if operational else 'down'}", *( [f"  Description: {port.get('description')}"] if port.get("description") else []), f"  Hardware is {port.get('kind')}, address is {port.get('macAddress')}", f"  Internet address is {port.get('ipAddress') + ' ' + port.get('subnetMask') if port.get('ipAddress') else 'unassigned'}", f"  Mode {port.get('mode')}", f"  {'Connected' if port.get('linkId') else 'Not connected'}"])


def ip_interface_status(device: NetworkDevice, selected: dict[str, Any] | None = None) -> str:
    ports = [selected] if selected else [p for p in device.get("ports", []) if p.get("kind") != "console"]
    blocks = []
    for port in ports:
        blocks.append("\n".join([f"{port.get('name')} is {'up' if device.get('powerOn', True) and port.get('adminUp', True) else 'down'}, line protocol is {'up' if port.get('linkId') else 'down'}", f"  Internet address is {port.get('ipAddress') + '/' + str(mask_to_prefix(port.get('subnetMask'))) if port.get('ipAddress') else 'Internet protocol processing disabled'}", f"  Helper address is {', '.join(port.get('helperAddresses') or []) or 'not set'}", f"  Outgoing access list is {port.get('accessGroupOut') or 'not set'}", f"  Inbound access list is {port.get('accessGroupIn') or 'not set'}"]))
    return "\n\n".join(blocks)


def interfaces_description(device: NetworkDevice) -> str:
    return "\n".join(["Interface                      Status         Protocol Description", *[f"{p.get('name','').ljust(30)}{('up' if p.get('adminUp', True) else 'admin down').ljust(15)}{('up' if p.get('linkId') else 'down').ljust(9)}{p.get('description','')}" for p in device.get("ports", [])]])


def interfaces_status(device: NetworkDevice) -> str:
    return "\n".join(["Port                  Status      Mode    VLAN  Type", *[f"{p.get('name','').ljust(22)}{('connected' if p.get('linkId') else 'notconnect').ljust(12)}{p.get('mode','').ljust(8)}{str(p.get('vlan',1)).ljust(6)}{p.get('kind','')}" for p in device.get("ports", [])]])


def protocols_status(device: NetworkDevice) -> str:
    rows = []
    for port in device.get("ports", []):
        if port.get("kind") == "console":
            continue
        status = "up" if device.get("powerOn", True) and port.get("adminUp", True) else "down"
        protocol = "up" if port.get("linkId") else "down"
        ip_line = f"\n  Internet address is {port.get('ipAddress')}/{mask_to_prefix(port.get('subnetMask', '0.0.0.0'))}" if port.get("ipAddress") else ""
        rows.append(f"{port.get('name')} is {status}, line protocol is {protocol}{ip_line}")
    return "\n\n".join(rows) if rows else "No protocol interfaces."


def controllers_status(device: NetworkDevice, filter_text: str = "") -> str:
    wanted = filter_text.strip().lower()
    ports = []
    for port in device.get("ports", []):
        name = port.get("name", "")
        kind = port.get("kind", "")
        if kind == "console":
            continue
        if not wanted or wanted in name.lower() or wanted in kind:
            ports.append(port)
    if not ports:
        return "% No controllers found."
    return "\n\n".join("\n".join([f"{port.get('name')} controller", f"  Hardware is {port.get('kind')}", f"  DCE/DTE status: {'DCE, clock rate set' if port.get('clockRate') else 'DTE or clock rate not set' if port.get('kind') == 'serial' else 'not applicable'}", f"  Clock rate: {port.get('clockRate') or 'not set'}", f"  Cable state: {'connected' if port.get('linkId') else 'not connected'}", "  Interface reset count: 0"]) for port in ports)


def switchport_status(device: NetworkDevice) -> str:
    return "\n\n".join("\n".join([f"Name: {p.get('name')}", f"Switchport: {'Disabled' if p.get('mode') == 'routed' else 'Enabled'}", f"Administrative Mode: {p.get('mode')}", f"Operational Mode: {p.get('mode')}", f"Access Mode VLAN: {p.get('vlan', 1)}", f"Trunking VLANs Enabled: {','.join(map(str, p.get('allowedVlans') or [])) if p.get('mode') == 'trunk' else 'none'}", f"Native VLAN: {p.get('nativeVlan', 1)}", f"Negotiation of Trunking: {'Off' if p.get('switchportNonegotiate') else 'On'}"]) for p in device.get("ports", []) if p.get("kind") != "console") or "% No switchport interfaces."


def trunk_status(device: NetworkDevice) -> str:
    trunks = [p for p in device.get("ports", []) if p.get("mode") == "trunk"]
    if not trunks:
        return "No trunking interfaces."
    return "\n".join(["Port                  Mode         Status        Native vlan", *[f"{p.get('name','').ljust(22)}on           {('trunking' if p.get('adminUp', True) else 'disabled').ljust(14)}{p.get('nativeVlan', 1)}" for p in trunks], "", "Port                  Vlans allowed on trunk", *[f"{p.get('name','').ljust(22)}{','.join(map(str, p.get('allowedVlans') or []))}" for p in trunks]])


def vlan_brief(device: NetworkDevice) -> str:
    return "\n".join(["VLAN  Name", *[f"{str(v.get('id')).ljust(6)}{v.get('name')}" for v in cfg(device).get("vlans", [])]])


def vlan_detail(device: NetworkDevice, filt: str) -> str:
    tokens = filt.split()
    vlan_id = int(tokens[1]) if tokens and tokens[0] == "id" and len(tokens) > 1 and tokens[1].isdigit() else int(tokens[0]) if tokens and tokens[0].isdigit() else None
    vlan = next((v for v in cfg(device).get("vlans", []) if v.get("id") == vlan_id), None)
    if not vlan:
        return "% VLAN not found."
    ports = [p.get("name") for p in device.get("ports", []) if p.get("mode") == "access" and p.get("vlan") == vlan_id]
    return f"VLAN  Name                             Status    Ports\n{str(vlan_id).ljust(6)}{vlan.get('name','').ljust(33)}active    {', '.join(ports) or '-'}"


def mac_table(device: NetworkDevice, lower: str) -> str:
    entries = runtime(device).get("macTable", [])
    return "\n".join(["Vlan  Mac Address         Type      Ports", *[f"{str(e.get('vlan',1)).ljust(6)}{e.get('macAddress','').ljust(20)}{e.get('type','dynamic').ljust(10)}{e.get('portName','')}" for e in entries]]) if entries else "No entries learned."


def access_lists(device: NetworkDevice, name_filter: str = "") -> str:
    rules = [r for r in cfg(device).get("accessRules", []) if not name_filter or acl_name(r).lower() == name_filter.lower()]
    if not rules:
        return "No access lists configured."
    grouped: dict[str, list[dict[str, Any]]] = {}
    for rule in rules:
        grouped.setdefault(acl_name(rule), []).append(rule)
    lines = []
    for name, items in grouped.items():
        acl_type = items[0].get("listType", "extended").capitalize()
        lines.append(f"{acl_type} IP access list {name}")
        for index, item in enumerate(items, 10):
            seq = item.get("sequence", index)
            lines.append(f"    {seq} {item.get('action')} {item.get('protocol')} {item.get('source')} {item.get('destination')} ({item.get('hits',0)} matches)")
    return "\n".join(lines)


def acl_config(rules: list[dict[str, Any]]) -> list[str]:
    lines = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for rule in rules:
        name = acl_name(rule)
        if name:
            grouped.setdefault(name, []).append(rule)
    for name, items in grouped.items():
        numbered = name.isdigit()
        acl_type = items[0].get("listType", "extended")
        if numbered:
            for rule in items:
                lines.append(f"access-list {name} {rule.get('action')} {rule.get('protocol')} {rule.get('source')} {rule.get('destination')}")
            continue
        lines.append(f"ip access-list {acl_type} {name}")
        for index, rule in enumerate(items, 10):
            sequence = rule.get("sequence", index)
            body = f"{rule.get('action')} {rule.get('protocol')} {rule.get('source')} {rule.get('destination')}" if acl_type == "extended" else f"{rule.get('action')} {rule.get('source')}"
            lines.append(f" {sequence} {body}")
    return lines


def nat_translations(device: NetworkDevice) -> str:
    rules = cfg(device).get("natRules", [])
    return "\n".join(["Pro  Inside global      Inside local       Outside local      Outside global", *[f"---  {n.get('insideGlobal','').ljust(18)}{n.get('insideLocal','').ljust(18)}---                ---" for n in rules]]) if rules else "No NAT translations."


def nat_statistics(device: NetworkDevice) -> str:
    inside = [p.get("name") for p in device.get("ports", []) if p.get("natRole") == "inside"]
    outside = [p.get("name") for p in device.get("ports", []) if p.get("natRole") == "outside"]
    return f"Total active translations: {len(cfg(device).get('natRules', []))}\nInside interfaces: {', '.join(inside) or 'none'}\nOutside interfaces: {', '.join(outside) or 'none'}"


def dhcp_stats(device: NetworkDevice) -> str:
    leases = [l for l in runtime(device).get("dhcpLeases", []) if l.get("expiresAt", 0) > time.time() * 1000]
    return "\n".join(["Memory usage         0", f"Address pools        {len(cfg(device).get('dhcpPools', []))}", "Database agents      0", f"Automatic bindings   {len(leases)}", "Manual bindings      0", "Expired bindings     0", "", "Message              Received", f"DHCPDISCOVER         {len(leases)}", f"DHCPREQUEST          {len(leases)}", "", "Message              Sent", f"DHCPOFFER            {len(leases)}", f"DHCPACK              {len(leases)}", "", f"DHCP service         {'enabled' if cfg(device).get('services', {}).get('dhcp') else 'disabled'}", f"Excluded ranges      {len(cfg(device).get('dhcpExcludedRanges', []))}"])


def ip_ssh(device: NetworkDevice) -> str:
    enabled = bool(cfg(device).get("domainName") and cfg(device).get("rsaKeyGenerated") and cfg(device).get("localUsers"))
    return f"SSH {'Enabled' if enabled else 'Disabled'} - version {cfg(device).get('sshVersion', '2')}.0\nAuthentication methods: {'password' if cfg(device).get('localUsers') else 'none configured'}\nDomain name: {cfg(device).get('domainName') or 'not set'}"


def ospf_status(device: NetworkDevice) -> str:
    protocols = [p for p in cfg(device).get("routingProtocols", []) if p.get("protocol") == "ospf"]
    return "\n\n".join(f" Routing Process \"ospf {p.get('processId','1')}\" with ID {p.get('routerId') or router_id(device)}\n Number of areas in this router is 1. 1 normal 0 stub 0 nssa" for p in protocols) if protocols else "%OSPF: Router process not configured"


def ospf_interfaces(device: NetworkDevice) -> str:
    return "\n".join(["Interface    PID   Area            IP Address/Mask    Cost  State", *[f"{p.get('name','').ljust(12)}1     0               {p.get('ipAddress','unassigned')}/{mask_to_prefix(p.get('subnetMask','0.0.0.0')):<5}1     DR" for p in device.get("ports", []) if p.get("ipAddress")]])


def eigrp_status(device: NetworkDevice) -> str:
    protocols = [p for p in cfg(device).get("routingProtocols", []) if p.get("protocol") == "eigrp"]
    return "\n\n".join(f"EIGRP-IPv4 Protocol for AS({p.get('processId','1')})\n  Router-ID: {p.get('routerId') or router_id(device)}\n  Topology : 0 routes" for p in protocols) if protocols else "% EIGRP not configured"


def eigrp_interfaces(device: NetworkDevice) -> str:
    return "\n".join(["EIGRP-IPv4 Interfaces", "Interface              Peers  Xmit Queue   Mean SRTT", *[f"{p.get('name','').ljust(22)}0      0            0" for p in device.get("ports", []) if p.get("ipAddress")]])


def eigrp_topology(device: NetworkDevice) -> str:
    routes = [network_address(p.get("ipAddress"), p.get("subnetMask")) for p in device.get("ports", []) if p.get("ipAddress")]
    return "\n".join(["EIGRP-IPv4 Topology Table", *[f"P {network}/24, 1 successors, FD is 28160" for network in routes]]) if routes else "EIGRP topology table is empty."


def rip_database(device: NetworkDevice) -> str:
    protocols = [p for p in cfg(device).get("routingProtocols", []) if p.get("protocol") == "rip"]
    networks = [network for proto in protocols for network in proto.get("networks", [])]
    return "\n".join(["RIP database", *[f"{network} auto-summary" for network in networks]]) if protocols else "% RIP not configured"


def router_id(device: NetworkDevice) -> str:
    addresses = [p.get("ipAddress") for p in device.get("ports", []) if is_ipv4(p.get("ipAddress"))]
    return sorted(addresses)[-1] if addresses else "0.0.0.0"


def logging_status(device: NetworkDevice) -> str:
    log = cfg(device).get("logging") or {}
    return f"Syslog logging: {'enabled' if log.get('console', True) or log.get('hosts') else 'disabled'}\n    Console logging: {'enabled' if log.get('console', True) else 'disabled'}\n    Trap logging: level {log.get('trap','informational')}\n    Logging to hosts: {', '.join(log.get('hosts', [])) or 'none'}"


def line_status(device: NetworkDevice) -> str:
    return "\n".join(["Tty Typ     Range     Login         Transport", *[f"{idx:<3} {line.get('kind','').upper().ljust(7)} {line.get('range','').ljust(9)} {'login local' if line.get('loginLocal') else 'login' if line.get('login') else 'nologin'}    {line.get('transportInput') or '-'}" for idx, line in enumerate(cfg(device).get("lineConfigs", []), 1)]])


def user_config(user: dict[str, Any]) -> str:
    priv = f" privilege {user.get('privilege')}" if user.get("privilege") is not None else ""
    if user.get("secret"):
        return f"username {user.get('name')}{priv} secret {user.get('secret')}"
    return f"username {user.get('name')}{priv} password {user.get('password','')}"


def line_config(line: dict[str, Any]) -> list[str]:
    return [f"line {line.get('kind')} {line.get('range')}", *([f" password {line.get('password')}"] if line.get("password") else []), " login local" if line.get("loginLocal") else " login" if line.get("login") else " no login", *([f" transport input {line.get('transportInput')}"] if line.get("transportInput") else []), *([f" exec-timeout {line.get('execTimeout')}"] if line.get("execTimeout") else []), " logging synchronous" if line.get("loggingSynchronous") else " no logging synchronous"]


def help_text(mode: str) -> str:
    if mode == "exec":
        return "enable, show version, show ip interface brief, show ip route, ping, traceroute, help"
    if mode == "privileged":
        return "configure terminal, show running-config, show ip route, clear ..., write memory, reload, write erase"
    if mode == "global":
        return "hostname, interface, vlan, line, router, ip route, ip dhcp pool, access-list, username, service, end"
    if mode == "interface":
        return "ip address, ip helper-address, switchport ..., ip access-group, ip nat inside|outside, shutdown, no shutdown"
    if mode == "router":
        return "network, router-id, passive-interface, default-information originate, redistribute static, no network, exit"
    return "exit, end, help"
