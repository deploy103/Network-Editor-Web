import { defaultConfig } from "../data/deviceCatalog";
import { createId } from "../utils/id";
import { isIpv4, maskToPrefix, networkAddress } from "./ip";
import type { DhcpPool, DeviceConfig, NetworkDevice, NetworkPort, RuntimeState } from "../types/network";

export type CliMode = "exec" | "privileged" | "global" | "interface" | "vlan" | "dhcp" | "line" | "router" | "acl";
export type CliPendingAction = "reload" | "erase-startup" | "enable-password";

export interface CliSession {
  mode: CliMode;
  interfaceId?: string;
  vlanId?: number;
  dhcpPoolId?: string;
  lineId?: string;
  routingId?: string;
  aclName?: string;
  aclType?: "standard" | "extended";
  pendingAction?: CliPendingAction;
}

export interface CliResult {
  device: NetworkDevice;
  session: CliSession;
  output: string;
}

type LineConfig = NonNullable<DeviceConfig["lineConfigs"]>[number];
type RoutingProtocol = NonNullable<DeviceConfig["routingProtocols"]>[number];
type AccessRule = DeviceConfig["accessRules"][number];
type NatRule = DeviceConfig["natRules"][number];

export function initialCliSession(): CliSession {
  return { mode: "exec" };
}

export function cliPrompt(device: NetworkDevice, session: CliSession): string {
  const hostname = device.config.hostname || device.label;
  if (session.mode === "exec") return `${hostname}>`;
  if (session.mode === "global") return `${hostname}(config)#`;
  if (session.mode === "interface") return `${hostname}(config-if)#`;
  if (session.mode === "vlan") return `${hostname}(config-vlan)#`;
  if (session.mode === "dhcp") return `${hostname}(dhcp-config)#`;
  if (session.mode === "line") return `${hostname}(config-line)#`;
  if (session.mode === "router") return `${hostname}(config-router)#`;
  if (session.mode === "acl") return `${hostname}(${session.aclType === "standard" ? "config-std-nacl" : "config-ext-nacl"})#`;
  return `${hostname}#`;
}

export function runCliCommand(device: NetworkDevice, session: CliSession, rawCommand: string): CliResult {
  const raw = cleanCommand(rawCommand);
  if (session.pendingAction) return confirmPendingAction(device, session, raw);
  if (isContextHelp(rawCommand)) return result(device, session, contextHelp(device, session, rawCommand));
  const command = expandCliCommand(raw, session);
  const lower = command.toLowerCase();
  if (!command) return result(device, session, "");

  if (!device.powerOn) {
    if (lower === "power on" || lower === "boot") {
      return result(bootDevice({ ...device, powerOn: true }), { mode: "exec" }, bootBanner(device));
    }
    if (lower === "help" || lower === "?") return result(device, session, "power on, boot");
    return result(device, session, "% 장비 전원이 꺼져 있습니다. 'power on' 또는 Physical 탭에서 전원을 켜세요.");
  }

  if (lower === "help" || lower === "?") return result(device, session, help(session.mode));
  if (lower.startsWith("help ")) return result(device, session, searchHelp(command.slice(5)));
  if (lower === "enable") {
    if (session.mode === "exec" && (device.config.enableSecret || device.config.enablePassword)) {
      return result(device, { mode: "exec", pendingAction: "enable-password" }, "Password:");
    }
    return result(device, { mode: "privileged" }, "");
  }
  if (lower === "disable") return result(device, { mode: "exec" }, "");
  if (lower === "end") return result(device, { mode: "privileged" }, "");
  if (lower === "exit") return result(device, exitSession(session), "");
  if (lower === "power off" || lower === "shutdown system") {
    return result({ ...device, powerOn: false, runtime: emptyRuntime() }, { mode: "exec" }, "System halted.\n전원이 꺼졌습니다.");
  }
  if (lower === "power cycle") {
    return result(bootDevice({ ...device, powerOn: true }), { mode: "exec" }, `System halted.\n${bootBanner(device)}`);
  }
  if (lower === "power on" || lower === "boot") return result(device, session, "System is already powered on.");
  if (lower === "configure terminal" || lower === "conf t") {
    if (session.mode !== "privileged") return result(device, session, "% 먼저 enable 명령으로 privileged EXEC 모드에 들어가세요.");
    return result(device, { mode: "global" }, "Enter configuration commands, one per line. End with CNTL/Z.");
  }
  if (lower.startsWith("terminal ")) return result(device, session, "");
  if (lower === "write memory" || lower === "wr" || lower === "copy running-config startup-config") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    const startupConfig = runningConfig(device).split("\n");
    return result({ ...device, config: { ...device.config, startupConfig } }, session, "Building configuration...\n[OK]");
  }
  if (lower === "copy startup-config running-config") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    if (!device.config.startupConfig.length) return result(device, session, "% Startup config is not saved.");
    return result(applyStartupConfig(device), session, "Destination filename [running-config]?\n[OK]");
  }
  if (lower === "reload" || lower === "reboot") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return result(device, { ...session, pendingAction: "reload" }, "Proceed with reload? [confirm]");
  }
  if (lower === "erase startup-config" || lower === "write erase") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return result(device, { ...session, pendingAction: "erase-startup" }, "Erasing the nvram filesystem will remove all configuration files! [confirm]");
  }

  if (lower.startsWith("do ")) return runDoCommand(device, session, command.slice(3));

  if (lower === "show privilege") {
    return result(device, session, `Current privilege level is ${session.mode === "exec" ? 1 : 15}`);
  }
  if (lower === "show history") {
    return result(device, session, "Terminal command history is enabled, history size is 80. Use Up/Down arrows to recall commands.");
  }

  if (session.mode === "global") return globalCommand(device, session, command, lower);
  if (session.mode === "interface") return interfaceCommand(device, session, command, lower);
  if (session.mode === "vlan") return vlanCommand(device, session, command, lower);
  if (session.mode === "dhcp") return dhcpCommand(device, session, command, lower);
  if (session.mode === "line") return lineCommand(device, session, command, lower);
  if (session.mode === "router") return routerCommand(device, session, command, lower);
  if (session.mode === "acl") return aclCommand(device, session, command, lower);

  if (lower.startsWith("show ")) {
    const showTarget = lower.split("|")[0].trim();
    if (session.mode === "exec" && privilegedShowCommands.some((item) => showTarget === item || showTarget.startsWith(`${item} `))) {
      return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    }
    return result(device, session, applyPipe(showCommand(device, showTarget), command));
  }
  if (lower.startsWith("clear ")) {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return clearCommand(device, session, lower);
  }
  if (lower === "dir" || lower === "dir flash:" || lower === "show flash" || lower === "show flash:") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return result(device, session, flashDirectory(device));
  }

  return result(device, session, "% Unsupported command. Type help or ?.");
}

export function cliCompletions(device: NetworkDevice, session: CliSession, input: string): string[] {
  const query = input.trim().toLowerCase().replace(/\s+/g, " ");
  return completionMatches(device, session, input).slice(0, query ? 24 : 16);
}

function completionMatches(device: NetworkDevice, session: CliSession, input: string): string[] {
  const query = input.trim().toLowerCase().replace(/\s+/g, " ");
  const candidates = commandCandidates(device, session);
  if (!query) return candidates;
  return candidates
    .filter((candidate) => candidate.toLowerCase().startsWith(query) || abbreviatedCandidateMatch(query, candidate));
}

function cleanCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isContextHelp(value: string): boolean {
  return value.trimEnd().endsWith("?");
}

function contextHelp(device: NetworkDevice, session: CliSession, rawCommand: string): string {
  const query = rawCommand.trimEnd().replace(/\?$/, "").trimEnd();
  const matches = completionMatches(device, session, query);
  if (matches.length === 0) return "% No matching commands.";
  return formatColumns(matches);
}

function commandCandidates(device: NetworkDevice, session: CliSession): string[] {
  if (!device.powerOn) return ["power on", "boot"];
  if (session.pendingAction === "enable-password") return [];
  if (session.pendingAction) return ["", "yes", "no"];
  const base = session.mode === "exec"
    ? ["enable", "show version", "show clock", "show privilege", "show history", "show interfaces", "show ip interface brief", "show ip route", "show route", "show cdp neighbors", "show arp", "ping ", "traceroute ", "terminal length 0", "help"]
    : session.mode === "privileged"
      ? ["disable", "configure terminal", "conf t", "show running-config", "show running-config all", "show startup-config", "show version", "show clock", "show privilege", "show history", "show inventory", "show logging", "show users", "show line", "show terminal", "show protocols", "show file systems", "show flash", "dir", "show processes cpu", "show memory", "show controllers", "show controllers serial", "show spanning-tree", "show interfaces", "show interfaces description", "show interfaces status", "show interfaces trunk", "show interfaces switchport", "show ip interface", "show ip interface brief", "show ip route", "show ip route summary", "show ip route connected", "show ip route static", "show route", "show ip protocols", "show ip ospf", "show ip ospf neighbor", "show ip ospf interface brief", "show ip eigrp neighbors", "show ip rip database", "show ip nat translations", "show ip nat statistics", "show vlan brief", "show mac address-table", "show cdp neighbors", "show cdp neighbors detail", "show arp", "show ip dhcp binding", "show ip dhcp pool", "show hosts", "show access-list", "show ip access-lists", "show nat", "clear arp", "clear arp-cache", "clear mac address-table", "clear ip dhcp binding", "write memory", "wr", "copy running-config startup-config", "copy run start", "copy startup-config running-config", "copy start run", "reload", "reboot", "erase startup-config", "write erase", "terminal length 0", "power off", "power cycle", "ping ", "traceroute ", "help"]
      : session.mode === "global"
        ? ["hostname ", "enable secret ", "enable password ", "no enable secret", "banner motd #", "no banner motd", "interface ", "int ", "default interface ", "vlan ", "no vlan ", "line console 0", "line vty 0 4", "router rip", "router ospf 1", "router eigrp 1", "ip route ", "no ip route ", "ip default-gateway ", "no ip default-gateway", "ip domain-lookup", "no ip domain-lookup", "ip dhcp pool ", "no ip dhcp pool ", "ip host ", "no ip host ", "ip nat inside source static 192.168.1.10 203.0.113.10", "no ip nat inside source static ", "ip access-list standard ", "ip access-list extended ", "no ip access-list extended ", "access-list 101 permit ip any any", "access-list 10 permit 192.168.1.0 0.0.0.255", "no access-list ", "nat ", "no nat ", "service dhcp", "no service dhcp", "service dns", "service http", "do show ip route", "do show running-config", "do write memory", "end", "exit", "help"]
      : session.mode === "interface"
          ? ["description ", "desc ", "no description", "ip address ", "ip add ", "no ip address", "ip nat inside", "ip nat outside", "no ip nat inside", "no ip nat outside", "ip access-group 101 in", "ip access-group 101 out", "no ip access-group 101 in", "shutdown", "shut", "no shutdown", "no shut", "switchport mode access", "switchport mode trunk", "switchport access vlan ", "switchport trunk allowed vlan ", "no switchport", "spanning-tree portfast", "no spanning-tree portfast", "spanning-tree bpduguard enable", "spanning-tree bpduguard disable", "clock rate ", "no clock rate", "do show ip interface brief", "do show running-config interface ", "end", "exit", "help"]
          : session.mode === "vlan"
            ? ["name ", "end", "exit", "help"]
            : session.mode === "dhcp"
              ? ["network ", "default-router ", "dns-server ", "start-ip ", "max-leases ", "shutdown", "no shutdown", "end", "exit", "help"]
              : session.mode === "line"
                ? ["password ", "login", "no login", "transport input all", "transport input ssh", "transport input telnet", "transport input none", "exec-timeout 10 0", "logging synchronous", "no logging synchronous", "end", "exit", "help"]
                : session.mode === "router"
                  ? ["network ", "version 2", "auto-summary", "no auto-summary", "passive-interface ", "no passive-interface ", "redistribute static", "no redistribute static", "end", "exit", "help"]
                  : session.aclType === "standard"
                    ? ["permit any", "permit host ", "permit 192.168.1.0 0.0.0.255", "deny any", "deny host ", "no 10", "do show access-lists", "end", "exit", "help"]
                    : ["permit ip any any", "deny ip any any", "permit tcp any host 192.168.1.10 eq 80", "permit icmp any any", "no 10", "do show access-lists", "end", "exit", "help"];
  return unique([...base, ...device.ports.flatMap((port) => [`interface ${port.name}`, `int ${shortPortAlias(port.name)}`, `show interface ${port.name}`])]);
}

function abbreviatedCandidateMatch(query: string, candidate: string): boolean {
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTokens.length > candidateTokens.length) return false;
  return queryTokens.every((token, index) => candidateTokens[index]?.startsWith(token));
}

function expandCliCommand(rawCommand: string, session: CliSession): string {
  const command = rawCommand.trim().replace(/\s+/g, " ");
  if (!command) return "";
  const pipeIndex = command.indexOf("|");
  const head = pipeIndex >= 0 ? command.slice(0, pipeIndex).trim() : command;
  const pipe = pipeIndex >= 0 ? command.slice(pipeIndex).trim() : "";
  const expandedHead = expandCliHead(head, session);
  return pipe ? `${expandedHead} ${pipe}` : expandedHead;
}

function expandCliHead(command: string, session: CliSession): string {
  const tokens = command.split(/\s+/);
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  const first = lowerTokens[0] ?? "";
  const rest = tokens.slice(1);
  const lowerRest = lowerTokens.slice(1);

  if (session.mode === "exec" && isAbbrev(first, "enable", 2)) return "enable";
  if (session.mode === "global" && isAbbrev(first, "enable", 2)) return expandEnableCommand(rest);
  if (isAbbrev(first, "disable", 3)) return "disable";
  if (session.mode !== "exec" && isAbbrev(first, "end", 2)) return "end";
  if (isAbbrev(first, "exit", 2)) return "exit";
  if (isAbbrev(first, "configure", 3)) {
    if (isAbbrev(lowerRest[0], "terminal")) return "configure terminal";
  }
  if (isAbbrev(first, "terminal", 4)) return expandTerminalCommand(rest);
  if (first === "wr" || isAbbrev(first, "write", 2)) return expandWriteCommand(rest);
  if (isAbbrev(first, "erase", 2)) return expandEraseCommand(rest);
  if (isAbbrev(first, "copy", 2) && rest.length) return expandCopyCommand(rest);
  if (first === "dir") return rest.length ? `dir ${rest.join(" ")}` : "dir";
  if (isAbbrev(first, "show", 2) && rest.length) return expandShowCommand(rest);
  if (isAbbrev(first, "interface", 3) || first === "int") return `interface ${rest.join(" ")}`;
  if (isAbbrev(first, "hostname", 4)) return `hostname ${rest.join(" ")}`;
  if (isAbbrev(first, "default", 3)) return expandDefaultCommand(rest);
  if (isAbbrev(first, "banner", 3)) return expandBannerCommand(rest);
  if (isAbbrev(first, "line", 2)) return expandLineCommand(rest);
  if (isAbbrev(first, "router", 3)) return expandRouterCommand(rest);
  if (isAbbrev(first, "description", 4) || first === "desc") return `description ${rest.join(" ")}`;
  if ((session.mode === "acl") && (first === "permit" || first === "deny" || /^\d+$/.test(first))) return command;
  if (isAbbrev(first, "shutdown", 2)) return "shutdown";
  if (first === "no") return expandNoCommand(rest);
  if (first === "ip") return expandIpCommand(rest, session);
  if (isAbbrev(first, "switchport", 2)) return expandSwitchportCommand(tokens);
  if (isAbbrev(first, "spanning-tree", 2)) return expandSpanningTreeCommand(tokens);
  if (isAbbrev(first, "vlan", 1)) return `vlan ${rest.join(" ")}`;
  if (isAbbrev(first, "access-list", 3)) return `access-list ${rest.join(" ")}`;
  if (first === "nat") return `nat ${rest.join(" ")}`;
  if (isAbbrev(first, "service", 3)) return `service ${rest.join(" ")}`;
  if (isAbbrev(first, "clear", 2)) return expandClearCommand(rest);
  if (isAbbrev(first, "reload", 3)) return "reload";
  if (isAbbrev(first, "reboot", 3)) return "reboot";
  if (first === "power") return expandPowerCommand(rest);
  if (first === "do" && rest.length) return `do ${expandCliCommand(rest.join(" "), { mode: "privileged" })}`;

  if (session.mode === "global" && first === "router") return command;
  return command;
}

function expandTerminalCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "length")) return `terminal length ${rest[1] ?? "24"}`;
  if (isAbbrev(lowerRest[0], "no")) return "terminal no monitor";
  if (isAbbrev(lowerRest[0], "monitor")) return "terminal monitor";
  return `terminal ${rest.join(" ")}`;
}

function expandEnableCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "secret")) return `enable secret ${rest.slice(1).join(" ")}`;
  if (isAbbrev(lowerRest[0], "password")) return `enable password ${rest.slice(1).join(" ")}`;
  return `enable ${rest.join(" ")}`;
}

function expandBannerCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "motd")) return `banner motd ${rest.slice(1).join(" ")}`;
  return `banner ${rest.join(" ")}`;
}

function expandDefaultCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "interface", 3) || lowerRest[0] === "int") return `default interface ${rest.slice(1).join(" ")}`;
  return `default ${rest.join(" ")}`;
}

function expandLineCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "console", 3)) return `line console ${rest.slice(1).join(" ") || "0"}`;
  if (isAbbrev(lowerRest[0], "vty")) return `line vty ${rest.slice(1).join(" ") || "0 4"}`;
  return `line ${rest.join(" ")}`;
}

function expandRouterCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "rip")) return "router rip";
  if (isAbbrev(lowerRest[0], "ospf")) return `router ospf ${rest[1] ?? "1"}`;
  if (isAbbrev(lowerRest[0], "eigrp")) return `router eigrp ${rest[1] ?? "1"}`;
  return `router ${rest.join(" ")}`;
}

function expandWriteCommand(rest: string[]): string {
  const first = rest[0]?.toLowerCase();
  if (!first || isAbbrev(first, "memory")) return "write memory";
  if (isAbbrev(first, "erase")) return "write erase";
  return `write ${rest.join(" ")}`;
}

function expandEraseCommand(rest: string[]): string {
  const first = rest[0]?.toLowerCase();
  if (isAbbrev(first, "startup-config") || isAbbrev(first, "startup")) return "erase startup-config";
  return `erase ${rest.join(" ")}`;
}

function expandCopyCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "running-config") && isAbbrev(lowerRest[1], "startup-config")) {
    return "copy running-config startup-config";
  }
  if (isAbbrev(lowerRest[0], "run") && isAbbrev(lowerRest[1], "start")) {
    return "copy running-config startup-config";
  }
  if (isAbbrev(lowerRest[0], "startup-config") && isAbbrev(lowerRest[1], "running-config")) {
    return "copy startup-config running-config";
  }
  if (isAbbrev(lowerRest[0], "start") && isAbbrev(lowerRest[1], "run")) {
    return "copy startup-config running-config";
  }
  return `copy ${rest.join(" ")}`;
}

function expandNoCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  if (isAbbrev(first, "shutdown", 2)) return "no shutdown";
  if (isAbbrev(first, "description", 4)) return "no description";
  if (isAbbrev(first, "switchport", 2)) return "no switchport";
  if (isAbbrev(first, "spanning-tree", 2) && isAbbrev(lowerRest[1], "portfast", 4)) return "no spanning-tree portfast";
  if (isAbbrev(first, "enable", 2)) {
    if (isAbbrev(lowerRest[1], "secret")) return "no enable secret";
    if (isAbbrev(lowerRest[1], "password")) return "no enable password";
  }
  if (isAbbrev(first, "banner", 3) && isAbbrev(lowerRest[1], "motd")) return "no banner motd";
  if (first === "ip") {
    if (isAbbrev(lowerRest[1], "address")) return "no ip address";
    if (isAbbrev(lowerRest[1], "route")) return `no ip route ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "default-gateway", 3)) return "no ip default-gateway";
    if (isAbbrev(lowerRest[1], "domain-lookup", 3)) return "no ip domain-lookup";
    if (isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "pool")) return `no ip dhcp pool ${rest.slice(3).join(" ")}`;
    if (isAbbrev(lowerRest[1], "host")) return `no ip host ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "access-group", 3)) return `no ip access-group ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "access-list", 3)) return `no ip access-list ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "nat", 2)) return `no ip nat ${rest.slice(2).join(" ")}`;
  }
  if (isAbbrev(first, "vlan")) return `no vlan ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "access-list", 3)) return `no access-list ${rest.slice(1).join(" ")}`;
  if (first === "nat") return `no nat ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "service", 3)) return `no service ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "clock")) return "no clock rate";
  return `no ${rest.join(" ")}`;
}

function expandIpCommand(rest: string[], session: CliSession): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  if (session.mode === "interface" && isAbbrev(first, "address")) return `ip address ${rest.slice(1).join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "access-group", 3)) return `ip access-group ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "route")) return `ip route ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "default-gateway", 3)) return `ip default-gateway ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "domain-lookup", 3)) return "ip domain-lookup";
  if (isAbbrev(first, "host")) return `ip host ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "dhcp") && isAbbrev(lowerRest[1], "pool")) return `ip dhcp pool ${rest.slice(2).join(" ")}`;
  if (isAbbrev(first, "access-list", 3)) return `ip access-list ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "nat", 2)) return `ip nat ${rest.slice(1).join(" ")}`;
  return `ip ${rest.join(" ")}`;
}

function expandClearCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  if (isAbbrev(first, "arp") || (first === "ip" && isAbbrev(lowerRest[1], "arp"))) return "clear arp";
  if (isAbbrev(first, "mac")) return "clear mac address-table";
  if (first === "ip" && isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "binding")) return "clear ip dhcp binding";
  return `clear ${rest.join(" ")}`;
}

function expandPowerCommand(rest: string[]): string {
  const first = rest[0]?.toLowerCase();
  if (isAbbrev(first, "on")) return "power on";
  if (isAbbrev(first, "off")) return "power off";
  if (isAbbrev(first, "cycle")) return "power cycle";
  return `power ${rest.join(" ")}`;
}

function expandShowCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  const second = lowerRest[1] ?? "";
  if (first === "run" || isAbbrev(first, "running-config", 3)) {
    if (isAbbrev(second, "interface", 3) || second === "int") return `show running-config interface ${rest.slice(2).join(" ")}`;
    return ["show running-config", ...rest.slice(1)].join(" ");
  }
  if (isAbbrev(first, "history", 3)) return "show history";
  if (isAbbrev(first, "privilege", 3)) return "show privilege";
  if (isAbbrev(first, "startup-config", 3)) return "show startup-config";
  if (isAbbrev(first, "version", 3)) return "show version";
  if (isAbbrev(first, "clock", 2)) return "show clock";
  if (isAbbrev(first, "inventory", 3)) return "show inventory";
  if (isAbbrev(first, "logging", 3)) return "show logging";
  if (isAbbrev(first, "flash", 2)) return "show flash";
  if (isAbbrev(first, "file") && isAbbrev(second, "systems")) return "show file systems";
  if (isAbbrev(first, "processes", 3) && isAbbrev(second, "cpu")) return "show processes cpu";
  if (isAbbrev(first, "memory", 3)) return "show memory";
  if (isAbbrev(first, "controllers", 4)) return rest.length > 1 ? `show controllers ${rest.slice(1).join(" ")}` : "show controllers";
  if (isAbbrev(first, "spanning-tree", 2)) return "show spanning-tree";
  if (isAbbrev(first, "users", 2)) return "show users";
  if (isAbbrev(first, "line", 2)) return "show line";
  if (isAbbrev(first, "terminal", 4)) return "show terminal";
  if (isAbbrev(first, "protocols", 3)) return "show protocols";
  if (first === "route" || first === "ro") return "show ip route";
  if (first === "arp") return "show arp";
  if (first === "host" || first === "hosts") return "show hosts";
  if (first === "nat") return "show nat";
  if (isAbbrev(first, "vlan")) return "show vlan brief";
  if (isAbbrev(first, "mac")) return "show mac address-table";
  if (isAbbrev(first, "access-list", 3) || first === "access-lists") return ["show access-list", ...rest.slice(1)].join(" ");
  if (first === "cdp" && isAbbrev(second, "neighbors", 3)) return lowerRest[2]?.startsWith("det") ? "show cdp neighbors detail" : "show cdp neighbors";
  if (first === "ip") {
    if (isAbbrev(second, "route", 2)) return ["show ip route", ...rest.slice(2)].join(" ");
    if (isAbbrev(second, "protocols", 3)) return "show ip protocols";
    if (isAbbrev(second, "arp")) return "show ip arp";
    if (isAbbrev(second, "interface", 3)) {
      if (isAbbrev(lowerRest[2], "brief", 1)) return "show ip interface brief";
      if (rest.length > 2) return `show ip interface ${rest.slice(2).join(" ")}`;
      return "show ip interface";
    }
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "binding")) return "show ip dhcp binding";
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "pool")) return "show ip dhcp pool";
    if (isAbbrev(second, "access-lists", 3) || isAbbrev(second, "access-list", 3)) return ["show access-list", ...rest.slice(2)].join(" ");
    if (isAbbrev(second, "ospf", 2)) return expandShowIpOspf(rest.slice(2));
    if (isAbbrev(second, "eigrp", 2)) return expandShowIpEigrp(rest.slice(2));
    if (isAbbrev(second, "rip", 2)) return expandShowIpRip(rest.slice(2));
    if (isAbbrev(second, "nat", 2)) return expandShowIpNat(rest.slice(2));
  }
  if (isAbbrev(first, "interfaces", 3) || first === "int") {
    if (isAbbrev(second, "description", 4)) return "show interfaces description";
    if (isAbbrev(second, "status", 2)) return "show interfaces status";
    if (isAbbrev(second, "trunk", 2)) return "show interfaces trunk";
    if (isAbbrev(second, "switchport", 2)) return "show interfaces switchport";
    if (rest.length > 1) return `show interface ${rest.slice(1).join(" ")}`;
    return "show interfaces";
  }
  return `show ${rest.join(" ")}`;
}

function expandShowIpOspf(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "neighbor", 3) || isAbbrev(lowerRest[0], "neighbors", 3)) return "show ip ospf neighbor";
  if (isAbbrev(lowerRest[0], "interface", 3)) return isAbbrev(lowerRest[1], "brief", 1) ? "show ip ospf interface brief" : "show ip ospf interface";
  return "show ip ospf";
}

function expandShowIpEigrp(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "neighbors", 3) || isAbbrev(lowerRest[0], "neighbor", 3)) return "show ip eigrp neighbors";
  if (isAbbrev(lowerRest[0], "interfaces", 3) || isAbbrev(lowerRest[0], "interface", 3)) return "show ip eigrp interfaces";
  if (isAbbrev(lowerRest[0], "topology", 3)) return "show ip eigrp topology";
  return "show ip eigrp";
}

function expandShowIpRip(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "database", 3)) return "show ip rip database";
  return "show ip rip";
}

function expandShowIpNat(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "translations", 2) || isAbbrev(lowerRest[0], "translation", 2)) return "show ip nat translations";
  if (isAbbrev(lowerRest[0], "statistics", 3) || isAbbrev(lowerRest[0], "stats", 3)) return "show ip nat statistics";
  return "show ip nat translations";
}

function expandSwitchportCommand(tokens: string[]): string {
  const rest = tokens.slice(1);
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "mode")) return `switchport mode ${isAbbrev(lowerRest[1], "trunk", 2) ? "trunk" : "access"}`;
  if (isAbbrev(lowerRest[0], "access")) {
    const vlanValues = isAbbrev(lowerRest[1], "vlan") ? rest.slice(2) : rest.slice(1);
    return `switchport access vlan ${vlanValues.join(" ")}`;
  }
  if (isAbbrev(lowerRest[0], "trunk")) {
    const vlanValues = rest.slice(1).filter((_, index) => {
      const token = lowerRest[index + 1];
      return !isAbbrev(token, "allowed") && !isAbbrev(token, "vlan");
    });
    return `switchport trunk allowed vlan ${vlanValues.join(" ")}`;
  }
  return `switchport ${rest.join(" ")}`;
}

function expandSpanningTreeCommand(tokens: string[]): string {
  const rest = tokens.slice(1);
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "portfast", 4)) return "spanning-tree portfast";
  if (isAbbrev(lowerRest[0], "bpduguard", 4)) {
    if (isAbbrev(lowerRest[1], "disable", 3)) return "spanning-tree bpduguard disable";
    return "spanning-tree bpduguard enable";
  }
  return `spanning-tree ${rest.join(" ")}`;
}

const privilegedShowCommands = [
  "show running-config",
  "show run",
  "show startup-config",
  "show access-list",
  "show access-lists",
  "show ip nat",
  "show nat"
];

function confirmPendingAction(device: NetworkDevice, session: CliSession, raw: string): CliResult {
  const lower = raw.toLowerCase();
  if (session.pendingAction === "enable-password") {
    const expected = device.config.enableSecret || device.config.enablePassword || "";
    if (raw === expected) return result(device, { mode: "privileged" }, "");
    return result(device, { mode: "exec" }, "% Access denied");
  }
  if (lower === "n" || lower === "no") {
    return result(device, withoutPending(session), "Action cancelled.");
  }
  if (lower && lower !== "y" && lower !== "yes") return result(device, session, "Press Enter to confirm, or type no to cancel.");
  if (session.pendingAction === "reload") {
    return result(bootDevice({ ...device, powerOn: true }), { mode: "exec" }, bootBanner(device));
  }
  if (session.pendingAction === "erase-startup") {
    return result({ ...device, config: { ...device.config, startupConfig: [] } }, withoutPending(session), "[OK]\nStartup configuration erased.");
  }
  return result(device, withoutPending(session), "");
}

function runDoCommand(device: NetworkDevice, session: CliSession, command: string): CliResult {
  const nested = runCliCommand(device, { mode: "privileged" }, command);
  if (!nested.device.powerOn) return result(nested.device, { mode: "exec" }, nested.output);
  if (nested.session.pendingAction) return result(nested.device, { ...session, pendingAction: nested.session.pendingAction }, nested.output);
  if (nested.session.mode === "exec" && command.trim().toLowerCase().startsWith("reload")) return result(nested.device, nested.session, nested.output);
  return result(nested.device, session, nested.output);
}

function withoutPending(session: CliSession): CliSession {
  const { pendingAction: _pendingAction, ...next } = session;
  return next;
}

export function bootBanner(device: NetworkDevice): string {
  return [
    "System Bootstrap, Version PTWEB",
    "Copyright (c) Network Editor Web",
    `${device.model} processor with ${device.ports.length} interfaces`,
    "Loading startup-config...",
    device.config.startupConfig.length ? "[OK]" : "No startup-config found.",
    "Press RETURN to get started!"
  ].join("\n");
}

function bootDevice(device: NetworkDevice): NetworkDevice {
  const powered = { ...device, powerOn: true, runtime: emptyRuntime() };
  return device.config.startupConfig.length ? applyStartupConfig(powered) : powered;
}

function applyStartupConfig(device: NetworkDevice): NetworkDevice {
  const startupConfig = [...device.config.startupConfig];
  let next: NetworkDevice = {
    ...device,
    config: { ...defaultConfig(device.label, device.kind), startupConfig },
    ports: device.ports.map((port) => resetPortForBoot(device, port))
  };
  let context: { mode: "global" } | { mode: "interface"; portId: string } | { mode: "vlan"; vlanId: number } | { mode: "dhcp"; poolId: string } | { mode: "line"; lineId: string } | { mode: "router"; routingId: string } | { mode: "acl"; name: string; aclType: "standard" | "extended" } = { mode: "global" };

  for (const line of startupConfig) {
    const command = line.trim();
    const lower = command.toLowerCase();
    if (!command) continue;
    if (command === "!") {
      context = { mode: "global" };
      continue;
    }

    if (lower.startsWith("hostname ")) {
      const hostname = command.slice("hostname ".length).trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32);
      if (hostname) next = { ...next, label: hostname, config: { ...next.config, hostname } };
      context = { mode: "global" };
      continue;
    }

    if (lower.startsWith("vlan ")) {
      const vlanId = numberAfter(command, "vlan");
      if (validVlan(vlanId)) {
        next = ensureVlan(next, vlanId);
        context = { mode: "vlan", vlanId };
      }
      continue;
    }

    if (lower.startsWith("interface ")) {
      const name = command.slice("interface ".length).trim();
      const port = findPort(next, name);
      if (port) {
        context = { mode: "interface", portId: port.id };
      } else {
        const svi = createSviInterface(next, name);
        if (svi) {
          next = svi.device;
          context = { mode: "interface", portId: svi.port.id };
        } else {
          context = { mode: "global" };
        }
      }
      continue;
    }

    if (lower.startsWith("ip dhcp pool ")) {
      const name = command.slice("ip dhcp pool ".length).trim();
      if (name) {
        const existing = next.config.dhcpPools.find((pool) => pool.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          context = { mode: "dhcp", poolId: existing.id };
        } else {
          const pool = defaultPool(name);
          next = { ...next, config: { ...next.config, services: { ...next.config.services, dhcp: true }, dhcpPools: [...next.config.dhcpPools, pool] } };
          context = { mode: "dhcp", poolId: pool.id };
        }
      }
      continue;
    }

    if (lower.startsWith("line ")) {
      const line = parseLineTarget(command);
      if (line) {
        const ensured = ensureLineConfig(next, line.kind, line.range);
        next = ensured.device;
        context = { mode: "line", lineId: ensured.line.id };
      }
      continue;
    }

    if (lower.startsWith("router ")) {
      const routing = parseRoutingTarget(command);
      if (routing) {
        const ensured = ensureRoutingProtocol(next, routing.protocol, routing.processId);
        next = ensured.device;
        context = { mode: "router", routingId: ensured.protocol.id };
      }
      continue;
    }

    if (lower.startsWith("ip access-list ")) {
      const acl = parseAccessListTarget(command);
      if (acl) context = { mode: "acl", name: acl.name, aclType: acl.type };
      continue;
    }

    if (isGlobalStartupLine(lower)) {
      context = { mode: "global" };
      next = applyStartupGlobalLine(next, command, lower);
      continue;
    }

    if (context.mode === "interface") {
      next = applyStartupInterfaceLine(next, context.portId, command, lower);
      continue;
    }
    if (context.mode === "vlan") {
      if (lower.startsWith("name ")) {
        const vlanId = context.vlanId;
        const name = command.slice("name ".length).trim().slice(0, 32) || `VLAN${vlanId}`;
        next = { ...next, config: { ...next.config, vlans: next.config.vlans.map((vlan) => vlan.id === vlanId ? { ...vlan, name } : vlan) } };
      }
      continue;
    }
    if (context.mode === "dhcp") {
      next = applyStartupDhcpLine(next, context.poolId, command, lower);
      continue;
    }
    if (context.mode === "line") {
      next = applyStartupLineLine(next, context.lineId, command, lower);
      continue;
    }
    if (context.mode === "router") {
      next = applyStartupRouterLine(next, context.routingId, command, lower);
      continue;
    }
    if (context.mode === "acl") {
      next = applyStartupAclLine(next, context.name, context.aclType, command, lower);
      continue;
    }
    next = applyStartupGlobalLine(next, command, lower);
  }

  return next;
}

function isGlobalStartupLine(lower: string): boolean {
  return lower.startsWith("enable ") ||
    lower.startsWith("banner ") ||
    lower.startsWith("ip route ") ||
    lower.startsWith("ip host ") ||
    lower.startsWith("ip default-gateway ") ||
    lower === "no ip default-gateway" ||
    lower === "ip domain-lookup" ||
    lower === "no ip domain-lookup" ||
    lower.startsWith("ip access-list ") ||
    lower.startsWith("no ip access-list ") ||
    lower.startsWith("ip nat inside source static ") ||
    lower.startsWith("no ip nat inside source static ") ||
    lower.startsWith("access-list ") ||
    lower.startsWith("nat ") ||
    lower.startsWith("service ") ||
    lower.startsWith("no service ");
}

function resetPortForBoot(device: NetworkDevice, port: NetworkPort): NetworkPort {
  const isVirtualInterface = port.name.toLowerCase().startsWith("vlan");
  const defaultMode = port.kind === "console"
    ? port.mode
    : isVirtualInterface || device.kind === "router" || device.kind === "firewall" || port.kind === "serial"
      ? "routed"
      : "access";
  return {
    ...port,
    description: "",
    ipAddress: "",
    subnetMask: "",
    gateway: "",
    dnsServer: "",
    mode: defaultMode,
    vlan: vlanFromInterfaceName(port.name) ?? 1,
    allowedVlans: [1],
    adminUp: true,
    accessGroupIn: "",
    accessGroupOut: "",
    natRole: undefined,
    clockRate: undefined
  };
}

function vlanFromInterfaceName(name: string): number | undefined {
  const match = name.match(/^vlan(\d+)$/i);
  if (!match) return undefined;
  const vlan = Number(match[1]);
  return validVlan(vlan) ? vlan : undefined;
}

function applyStartupGlobalLine(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("enable secret ")) return { ...device, config: { ...device.config, enableSecret: command.slice("enable secret ".length).trim() } };
  if (lower.startsWith("enable password ")) return { ...device, config: { ...device.config, enablePassword: command.slice("enable password ".length).trim() } };
  if (lower === "no enable secret") return { ...device, config: { ...device.config, enableSecret: undefined } };
  if (lower === "no enable password") return { ...device, config: { ...device.config, enablePassword: undefined } };
  if (lower.startsWith("banner motd ")) return { ...device, config: { ...device.config, motdBanner: parseBannerText(command.slice("banner motd ".length)) } };
  if (lower === "no banner motd") return { ...device, config: { ...device.config, motdBanner: undefined } };
  if (lower.startsWith("ip default-gateway ")) {
    const gateway = command.split(/\s+/)[2] ?? "";
    return isIpv4(gateway) ? { ...device, config: { ...device.config, defaultGateway: gateway } } : device;
  }
  if (lower === "no ip default-gateway") return { ...device, config: { ...device.config, defaultGateway: undefined } };
  if (lower === "ip domain-lookup") return { ...device, config: { ...device.config, domainLookup: true } };
  if (lower === "no ip domain-lookup") return { ...device, config: { ...device.config, domainLookup: false } };
  if (lower.startsWith("ip route ")) {
    const [, , network, mask, nextHop] = command.split(/\s+/);
    if (!isIpv4(network) || !isIpv4(mask) || !isIpv4(nextHop)) return device;
    return network && mask && nextHop
      ? { ...device, config: { ...device.config, staticRoutes: [...device.config.staticRoutes, { id: createId("route"), network, mask, nextHop }] } }
      : device;
  }
  if (lower.startsWith("ip host ")) {
    const [, , name, value] = command.split(/\s+/);
    return name && value
      ? { ...device, config: { ...device.config, services: { ...device.config.services, dns: true }, dnsRecords: [...device.config.dnsRecords.filter((record) => record.name.toLowerCase() !== name.toLowerCase()), { id: createId("dns"), name, value }] } }
      : device;
  }
  if (lower.startsWith("access-list ")) {
    const rule = parseAccessList(command);
    return rule ? { ...device, config: { ...device.config, accessRules: [...device.config.accessRules, rule] } } : device;
  }
  if (lower.startsWith("no ip access-list ")) {
    const acl = parseAccessListTarget(command.slice(3));
    return acl ? removeAccessList(device, acl.name) : device;
  }
  if (lower.startsWith("ip nat inside source static ")) {
    const nat = parseStaticNat(command, device);
    return nat ? { ...device, config: { ...device.config, natRules: [...device.config.natRules, nat] } } : device;
  }
  if (lower.startsWith("no ip nat inside source static ")) {
    const nat = parseStaticNat(command.slice(3), device);
    return nat ? removeStaticNat(device, nat.insideLocal, nat.insideGlobal) : device;
  }
  if (lower.startsWith("nat ")) {
    const [, insideLocal, insideGlobal, outsideInterface] = command.split(/\s+/);
    return insideLocal && insideGlobal && outsideInterface
      ? { ...device, config: { ...device.config, natRules: [...device.config.natRules, { id: createId("nat"), insideLocal, insideGlobal, outsideInterface, hits: 0 }] } }
      : device;
  }
  if (lower.startsWith("service ") || lower.startsWith("no service ")) {
    const disable = lower.startsWith("no ");
    const service = command.split(/\s+/).at(-1) as keyof NetworkDevice["config"]["services"] | undefined;
    return service && service in device.config.services
      ? { ...device, config: { ...device.config, services: { ...device.config.services, [service]: !disable } } }
      : device;
  }
  return device;
}

function applyStartupInterfaceLine(device: NetworkDevice, portId: string, command: string, lower: string): NetworkDevice {
  const port = device.ports.find((item) => item.id === portId);
  if (!port) return device;
  if (lower.startsWith("description ")) return updatePort(device, port.id, { description: command.slice("description ".length).trim().slice(0, 80) });
  if (lower.startsWith("ip address ")) {
    const [, , ipAddress, subnetMask] = command.split(/\s+/);
    return ipAddress && subnetMask ? updatePort(device, port.id, { ipAddress, subnetMask, mode: "routed" }) : device;
  }
  if (lower === "switchport mode access") return updatePort(device, port.id, { mode: "access", ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" });
  if (lower === "switchport mode trunk") return updatePort(device, port.id, { mode: "trunk", allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1], ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" });
  if (lower === "no switchport") return updatePort(device, port.id, { mode: "routed", ipCapable: true });
  if (lower === "spanning-tree portfast") return updatePort(device, port.id, { stpPortfast: true });
  if (lower === "no spanning-tree portfast") return updatePort(device, port.id, { stpPortfast: false });
  if (lower === "spanning-tree bpduguard enable") return updatePort(device, port.id, { bpduGuard: true });
  if (lower === "spanning-tree bpduguard disable") return updatePort(device, port.id, { bpduGuard: false });
  if (lower === "ip nat inside") return updatePort(device, port.id, { natRole: "inside" });
  if (lower === "ip nat outside") return updatePort(device, port.id, { natRole: "outside" });
  if (lower === "no ip nat inside" || lower === "no ip nat outside") return updatePort(device, port.id, { natRole: undefined });
  if (lower.startsWith("ip access-group ")) {
    const acl = parseAccessGroup(command);
    return acl ? updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: acl.name } : { accessGroupOut: acl.name }) : device;
  }
  if (lower.startsWith("no ip access-group ")) {
    const acl = parseAccessGroup(command.slice(3));
    if (!acl) return device;
    return updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: "" } : { accessGroupOut: "" });
  }
  if (lower.startsWith("switchport access vlan ")) {
    const vlan = numberAfter(command, "switchport access vlan");
    return validVlan(vlan) ? ensureVlan(updatePort(device, port.id, { mode: "access", vlan }), vlan) : device;
  }
  if (lower.startsWith("switchport trunk allowed vlan ")) {
    const allowedVlans = parseVlans(command.slice("switchport trunk allowed vlan ".length));
    let next = allowedVlans.length ? updatePort(device, port.id, { mode: "trunk", allowedVlans }) : device;
    for (const vlan of allowedVlans) next = ensureVlan(next, vlan);
    return next;
  }
  if (lower.startsWith("clock rate ")) return updatePort(device, port.id, { clockRate: numberAfter(command, "clock rate") });
  if (lower === "shutdown") return updatePort(device, port.id, { adminUp: false });
  if (lower === "no shutdown") return updatePort(device, port.id, { adminUp: true });
  return device;
}

function applyStartupDhcpLine(device: NetworkDevice, poolId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("network ")) {
    const [, network, mask] = command.split(/\s+/);
    return updatePool(device, poolId, { network: network ?? "", mask: mask ?? "" });
  }
  if (lower.startsWith("default-router ")) return updatePool(device, poolId, { defaultGateway: command.split(/\s+/)[1] ?? "" });
  if (lower.startsWith("dns-server ")) return updatePool(device, poolId, { dnsServer: command.split(/\s+/)[1] ?? "" });
  if (lower.startsWith("start-ip ")) return updatePool(device, poolId, { startIp: command.split(/\s+/)[1] ?? "" });
  if (lower.startsWith("max-leases ")) return updatePool(device, poolId, { maxLeases: Math.max(1, numberAfter(command, "max-leases")) });
  if (lower === "shutdown") return updatePool(device, poolId, { enabled: false });
  if (lower === "no shutdown") return updatePool(device, poolId, { enabled: true });
  return device;
}

function applyStartupLineLine(device: NetworkDevice, lineId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("password ")) return updateLineConfig(device, lineId, { password: command.slice("password ".length).trim() });
  if (lower === "login") return updateLineConfig(device, lineId, { login: true });
  if (lower === "no login") return updateLineConfig(device, lineId, { login: false });
  if (lower.startsWith("transport input ")) return updateLineConfig(device, lineId, { transportInput: command.slice("transport input ".length).trim() || "all" });
  if (lower.startsWith("exec-timeout ")) return updateLineConfig(device, lineId, { execTimeout: command.slice("exec-timeout ".length).trim() || "10 0" });
  if (lower === "logging synchronous") return updateLineConfig(device, lineId, { loggingSynchronous: true });
  if (lower === "no logging synchronous") return updateLineConfig(device, lineId, { loggingSynchronous: false });
  return device;
}

function applyStartupRouterLine(device: NetworkDevice, routingId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("network ")) {
    const network = command.slice("network ".length).trim();
    return network ? updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, networks: unique([...protocol.networks, network]) })) : device;
  }
  if (lower.startsWith("version ")) return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, version: command.split(/\s+/)[1] ?? protocol.version }));
  if (lower === "auto-summary") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, autoSummary: true }));
  if (lower === "no auto-summary") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, autoSummary: false }));
  if (lower.startsWith("passive-interface ")) {
    const name = command.slice("passive-interface ".length).trim();
    return name ? updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, passiveInterfaces: unique([...protocol.passiveInterfaces, name]) })) : device;
  }
  if (lower.startsWith("no passive-interface ")) {
    const name = command.slice("no passive-interface ".length).trim().toLowerCase();
    return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, passiveInterfaces: protocol.passiveInterfaces.filter((item) => item.toLowerCase() !== name) }));
  }
  if (lower === "redistribute static") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, redistributeStatic: true }));
  if (lower === "no redistribute static") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, redistributeStatic: false }));
  return device;
}

function applyStartupAclLine(device: NetworkDevice, aclName: string, aclType: "standard" | "extended", command: string, lower: string): NetworkDevice {
  if (lower.startsWith("permit ") || lower.startsWith("deny ") || /^\d+\s+(permit|deny)\s+/i.test(command)) {
    const rule = parseAclSubmodeRule(aclName, aclType, command);
    return rule ? { ...device, config: { ...device.config, accessRules: [...device.config.accessRules, rule] } } : device;
  }
  return device;
}

function globalCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  if (lower.startsWith("hostname ")) {
    const hostname = command.split(/\s+/)[1]?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32);
    if (!hostname) return result(device, session, "% Invalid hostname.");
    return result({ ...device, label: hostname, config: { ...device.config, hostname } }, session, "");
  }

  if (lower.startsWith("enable secret ")) return result({ ...device, config: { ...device.config, enableSecret: command.slice("enable secret ".length).trim() } }, session, "");
  if (lower.startsWith("enable password ")) return result({ ...device, config: { ...device.config, enablePassword: command.slice("enable password ".length).trim() } }, session, "");
  if (lower === "no enable secret") return result({ ...device, config: { ...device.config, enableSecret: undefined } }, session, "");
  if (lower === "no enable password") return result({ ...device, config: { ...device.config, enablePassword: undefined } }, session, "");
  if (lower.startsWith("banner motd ")) return result({ ...device, config: { ...device.config, motdBanner: parseBannerText(command.slice("banner motd ".length)) } }, session, "");
  if (lower === "no banner motd") return result({ ...device, config: { ...device.config, motdBanner: undefined } }, session, "");

  if (lower.startsWith("interface ")) {
    const name = command.slice(command.indexOf(" ") + 1);
    const existing = findPort(device, name);
    if (existing) return result(device, { mode: "interface", interfaceId: existing.id }, "");
    const svi = createSviInterface(device, name);
    if (svi) return result(svi.device, { mode: "interface", interfaceId: svi.port.id }, "");
    return result(device, session, `% Interface ${name} not found.`);
  }

  if (lower.startsWith("vlan ")) {
    const id = numberAfter(command, "vlan");
    if (!validVlan(id)) return result(device, session, "% VLAN id must be 1-4094.");
    const exists = device.config.vlans.some((vlan) => vlan.id === id);
    const next = exists ? device : { ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: `VLAN${id}` }].sort((a, b) => a.id - b.id) } };
    return result(next, { mode: "vlan", vlanId: id }, "");
  }

  if (lower.startsWith("line ")) {
    const line = parseLineTarget(command);
    if (!line) return result(device, session, "% Usage: line console 0 | line vty 0 4");
    const ensured = ensureLineConfig(device, line.kind, line.range);
    return result(ensured.device, { mode: "line", lineId: ensured.line.id }, "");
  }

  if (lower.startsWith("router ")) {
    const routing = parseRoutingTarget(command);
    if (!routing) return result(device, session, "% Usage: router rip | router ospf <process-id> | router eigrp <as-number>");
    const ensured = ensureRoutingProtocol(device, routing.protocol, routing.processId);
    return result(ensured.device, { mode: "router", routingId: ensured.protocol.id }, "");
  }

  if (lower.startsWith("default interface ")) {
    const name = command.slice("default interface ".length).trim();
    const port = findPort(device, name);
    if (!port) return result(device, session, `% Interface ${name} not found.`);
    return result({ ...device, ports: device.ports.map((item) => item.id === port.id ? resetPortForBoot(device, item) : item) }, session, "");
  }

  if (lower.startsWith("no vlan ")) {
    const id = numberAfter(command, "no vlan");
    if (id === 1) return result(device, session, "% VLAN 1 cannot be removed.");
    return result({
      ...device,
      config: { ...device.config, vlans: device.config.vlans.filter((vlan) => vlan.id !== id) },
      ports: device.ports.map((port) => port.vlan === id ? { ...port, vlan: 1, allowedVlans: port.allowedVlans.filter((vlan) => vlan !== id) } : port)
    }, session, "");
  }

  if (lower.startsWith("ip access-list ")) {
    const acl = parseAccessListTarget(command);
    if (!acl) return result(device, session, "% Usage: ip access-list standard|extended <name>");
    return result(device, { mode: "acl", aclName: acl.name, aclType: acl.type }, "");
  }

  if (lower.startsWith("no ip access-list ")) {
    const acl = parseAccessListTarget(command.slice(3));
    if (!acl) return result(device, session, "% Usage: no ip access-list standard|extended <name>");
    return result(removeAccessList(device, acl.name), session, "");
  }

  if (lower.startsWith("ip nat inside source static ")) {
    const nat = parseStaticNat(command, device);
    if (!nat) return result(device, session, "% Usage: ip nat inside source static <inside-local> <inside-global>");
    return result({ ...device, config: { ...device.config, natRules: [...device.config.natRules.filter((rule) => !(rule.insideLocal === nat.insideLocal && rule.insideGlobal === nat.insideGlobal)), nat] } }, session, "");
  }

  if (lower.startsWith("no ip nat inside source static ")) {
    const nat = parseStaticNat(command.slice(3), device);
    if (!nat) return result(device, session, "% Usage: no ip nat inside source static <inside-local> <inside-global>");
    return result(removeStaticNat(device, nat.insideLocal, nat.insideGlobal), session, "");
  }

  if (lower.startsWith("ip route ")) {
    const [, , network, mask, nextHop] = command.split(/\s+/);
    if (!network || !mask || !nextHop) return result(device, session, "% Usage: ip route <network> <mask> <next-hop>");
    if (!isIpv4(network) || !isIpv4(mask) || !isIpv4(nextHop)) return result(device, session, "% Invalid IP address or mask.");
    return result({ ...device, config: { ...device.config, staticRoutes: [...device.config.staticRoutes, { id: createId("route"), network, mask, nextHop }] } }, session, "");
  }

  if (lower.startsWith("ip default-gateway ")) {
    const gateway = command.split(/\s+/)[2] ?? "";
    if (!isIpv4(gateway)) return result(device, session, "% Invalid default gateway address.");
    return result({ ...device, config: { ...device.config, defaultGateway: gateway } }, session, "");
  }
  if (lower === "no ip default-gateway") return result({ ...device, config: { ...device.config, defaultGateway: undefined } }, session, "");
  if (lower === "ip domain-lookup") return result({ ...device, config: { ...device.config, domainLookup: true } }, session, "");
  if (lower === "no ip domain-lookup") return result({ ...device, config: { ...device.config, domainLookup: false } }, session, "");

  if (lower.startsWith("no ip route ")) {
    const [, , , network, mask, nextHop] = command.split(/\s+/);
    return result({ ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.filter((route) => !(route.network === network && route.mask === mask && (!nextHop || route.nextHop === nextHop))) } }, session, "");
  }

  if (lower.startsWith("ip dhcp pool ")) {
    const name = command.slice("ip dhcp pool ".length).trim();
    if (!name) return result(device, session, "% Pool name required.");
    const existing = device.config.dhcpPools.find((pool) => pool.name.toLowerCase() === name.toLowerCase());
    if (existing) return result(device, { mode: "dhcp", dhcpPoolId: existing.id }, "");
    const pool = defaultPool(name);
    return result({ ...device, config: { ...device.config, services: { ...device.config.services, dhcp: true }, dhcpPools: [...device.config.dhcpPools, pool] } }, { mode: "dhcp", dhcpPoolId: pool.id }, "");
  }

  if (lower.startsWith("no ip dhcp pool ")) {
    const name = command.slice("no ip dhcp pool ".length).trim().toLowerCase();
    return result({
      ...device,
      config: { ...device.config, dhcpPools: device.config.dhcpPools.filter((pool) => pool.name.toLowerCase() !== name) },
      runtime: { ...device.runtime, dhcpLeases: [] }
    }, session, "");
  }

  if (lower.startsWith("ip host ")) {
    const [, , name, value] = command.split(/\s+/);
    if (!name || !value) return result(device, session, "% Usage: ip host <name> <address>");
    if (!isIpv4(value)) return result(device, session, "% Invalid host address.");
    return result({
      ...device,
      config: {
        ...device.config,
        services: { ...device.config.services, dns: true },
        dnsRecords: [...device.config.dnsRecords.filter((record) => record.name.toLowerCase() !== name.toLowerCase()), { id: createId("dns"), name, value }]
      }
    }, session, "");
  }

  if (lower.startsWith("no ip host ")) {
    const name = command.slice("no ip host ".length).trim().toLowerCase();
    return result({ ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.filter((record) => record.name.toLowerCase() !== name) } }, session, "");
  }

  if (lower.startsWith("access-list ")) {
    const rule = parseAccessList(command);
    if (!rule) return result(device, session, aclUsage());
    return result({
      ...device,
      config: {
        ...device.config,
        accessRules: [...device.config.accessRules, rule]
      }
    }, session, "");
  }

  if (lower.startsWith("no access-list ")) {
    const listName = command.slice("no access-list ".length).trim().split(/\s+/)[0] ?? "";
    if (!listName) return result(device, session, "% Usage: no access-list <list>");
    return result({
      ...device,
      config: { ...device.config, accessRules: device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() !== listName.toLowerCase()) }
    }, session, "");
  }

  if (lower.startsWith("nat ")) {
    const [, insideLocal, insideGlobal, outsideInterface] = command.split(/\s+/);
    if (!insideLocal || !insideGlobal || !outsideInterface) return result(device, session, "% Usage: nat <inside-local> <inside-global> <outside-interface>");
    return result({ ...device, config: { ...device.config, natRules: [...device.config.natRules, { id: createId("nat"), insideLocal, insideGlobal, outsideInterface, hits: 0 }] } }, session, "");
  }

  if (lower.startsWith("no nat ")) {
    const insideLocal = command.slice("no nat ".length).trim();
    return result({ ...device, config: { ...device.config, natRules: device.config.natRules.filter((rule) => rule.insideLocal !== insideLocal) } }, session, "");
  }

  if (lower.startsWith("service ") || lower.startsWith("no service ")) {
    const disable = lower.startsWith("no ");
    const service = command.split(/\s+/).at(-1) as keyof NetworkDevice["config"]["services"] | undefined;
    if (!service || !(service in device.config.services)) return result(device, session, "% Unknown service.");
    return result({ ...device, config: { ...device.config, services: { ...device.config.services, [service]: !disable } } }, session, "");
  }

  return result(device, session, "% Unsupported global configuration command.");
}

function interfaceCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const port = device.ports.find((item) => item.id === session.interfaceId);
  if (!port) return result(device, { mode: "global" }, "% Interface context is missing.");

  if (lower.startsWith("ip address ")) {
    const [, , ipAddress, subnetMask] = command.split(/\s+/);
    if (!ipAddress || !subnetMask) return result(device, session, "% Usage: ip address <ip> <mask>");
    if (!isIpv4(ipAddress) || !isIpv4(subnetMask)) return result(device, session, "% Invalid IP address or mask.");
    if (!port.ipCapable && port.mode !== "routed") return result(device, session, "% IP address is not supported on this layer-2 interface.");
    return result(updatePort(device, port.id, { ipAddress, subnetMask, mode: "routed" }), session, "");
  }
  if (lower === "no ip address") return result(updatePort(device, port.id, { ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
  if (lower === "shutdown") return result(updatePort(device, port.id, { adminUp: false }), session, "");
  if (lower === "no shutdown") return result(updatePort(device, port.id, { adminUp: true }), session, "");
  if (lower === "switchport mode access") return result(updatePort(device, port.id, { mode: "access", ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
  if (lower === "switchport mode trunk") return result(updatePort(device, port.id, { mode: "trunk", allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1], ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
  if (lower === "no switchport") return result(updatePort(device, port.id, { mode: "routed", ipCapable: true }), session, "");
  if (lower === "spanning-tree portfast") return result(updatePort(device, port.id, { stpPortfast: true }), session, "");
  if (lower === "no spanning-tree portfast") return result(updatePort(device, port.id, { stpPortfast: false }), session, "");
  if (lower === "spanning-tree bpduguard enable") return result(updatePort(device, port.id, { bpduGuard: true }), session, "");
  if (lower === "spanning-tree bpduguard disable") return result(updatePort(device, port.id, { bpduGuard: false }), session, "");
  if (lower === "ip nat inside") return result(updatePort(device, port.id, { natRole: "inside" }), session, "");
  if (lower === "ip nat outside") return result(updatePort(device, port.id, { natRole: "outside" }), session, "");
  if (lower === "no ip nat inside" || lower === "no ip nat outside") return result(updatePort(device, port.id, { natRole: undefined }), session, "");
  if (lower.startsWith("ip access-group ")) {
    const acl = parseAccessGroup(command);
    if (!acl) return result(device, session, "% Usage: ip access-group <list> in|out");
    return result(updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: acl.name } : { accessGroupOut: acl.name }), session, "");
  }
  if (lower.startsWith("no ip access-group ")) {
    const acl = parseAccessGroup(command.slice(3));
    if (!acl) return result(device, session, "% Usage: no ip access-group <list> in|out");
    return result(updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: "" } : { accessGroupOut: "" }), session, "");
  }
  if (lower.startsWith("description ")) return result(updatePort(device, port.id, { description: command.slice("description ".length).trim().slice(0, 80) }), session, "");
  if (lower === "no description") return result(updatePort(device, port.id, { description: "" }), session, "");
  if (lower.startsWith("switchport access vlan ")) {
    const vlan = numberAfter(command, "switchport access vlan");
    if (!validVlan(vlan)) return result(device, session, "% VLAN id must be 1-4094.");
    return result(ensureVlan(updatePort(device, port.id, { mode: "access", vlan }), vlan), session, "");
  }
  if (lower.startsWith("switchport trunk allowed vlan ")) {
    const allowedVlans = parseVlans(command.slice("switchport trunk allowed vlan ".length));
    if (allowedVlans.length === 0) return result(device, session, "% Provide at least one VLAN.");
    let next = updatePort(device, port.id, { mode: "trunk", allowedVlans });
    for (const vlan of allowedVlans) next = ensureVlan(next, vlan);
    return result(next, session, "");
  }
  if (lower.startsWith("clock rate ")) {
    const clockRate = numberAfter(command, "clock rate");
    if (port.kind !== "serial") return result(device, session, "% Clock rate applies to serial interfaces only.");
    return result(updatePort(device, port.id, { clockRate }), session, "");
  }
  if (lower === "no clock rate") return result(updatePort(device, port.id, { clockRate: undefined }), session, "");
  return result(device, session, "% Unsupported interface command.");
}

function vlanCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const vlanId = session.vlanId;
  if (!vlanId) return result(device, { mode: "global" }, "% VLAN context is missing.");
  if (lower.startsWith("name ")) {
    const name = command.slice(5).trim().slice(0, 32) || `VLAN${vlanId}`;
    return result({ ...device, config: { ...device.config, vlans: device.config.vlans.map((vlan) => vlan.id === vlanId ? { ...vlan, name } : vlan) } }, session, "");
  }
  return result(device, session, "% Unsupported VLAN command.");
}

function dhcpCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const pool = device.config.dhcpPools.find((item) => item.id === session.dhcpPoolId);
  if (!pool) return result(device, { mode: "global" }, "% DHCP 풀 컨텍스트가 없습니다.");
  if (lower.startsWith("network ")) {
    const [, network, mask] = command.split(/\s+/);
    if ((network && !isIpv4(network)) || (mask && !isIpv4(mask))) return result(device, session, "% Invalid DHCP network or mask.");
    return result(updatePool(device, pool.id, { network: network ?? "", mask: mask ?? "" }), session, "");
  }
  if (lower.startsWith("default-router ")) {
    const gateway = command.split(/\s+/)[1] ?? "";
    return isIpv4(gateway) ? result(updatePool(device, pool.id, { defaultGateway: gateway }), session, "") : result(device, session, "% Invalid default-router address.");
  }
  if (lower.startsWith("dns-server ")) {
    const dnsServer = command.split(/\s+/)[1] ?? "";
    return isIpv4(dnsServer) ? result(updatePool(device, pool.id, { dnsServer }), session, "") : result(device, session, "% Invalid dns-server address.");
  }
  if (lower.startsWith("start-ip ")) {
    const startIp = command.split(/\s+/)[1] ?? "";
    return isIpv4(startIp) ? result(updatePool(device, pool.id, { startIp }), session, "") : result(device, session, "% Invalid start-ip address.");
  }
  if (lower.startsWith("max-leases ")) return result(updatePool(device, pool.id, { maxLeases: Math.max(1, numberAfter(command, "max-leases")) }), session, "");
  if (lower === "shutdown") return result(updatePool(device, pool.id, { enabled: false }), session, "");
  if (lower === "no shutdown") return result(updatePool(device, pool.id, { enabled: true }), session, "");
  return result(device, session, "% 지원하지 않는 DHCP 풀 명령입니다.");
}

function lineCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const line = lineConfigs(device).find((item) => item.id === session.lineId);
  if (!line) return result(device, { mode: "global" }, "% Line context is missing.");
  if (lower.startsWith("password ")) return result(updateLineConfig(device, line.id, { password: command.slice("password ".length).trim() }), session, "");
  if (lower === "login") return result(updateLineConfig(device, line.id, { login: true }), session, "");
  if (lower === "no login") return result(updateLineConfig(device, line.id, { login: false }), session, "");
  if (lower.startsWith("transport input ")) return result(updateLineConfig(device, line.id, { transportInput: command.slice("transport input ".length).trim() || "all" }), session, "");
  if (lower.startsWith("exec-timeout ")) return result(updateLineConfig(device, line.id, { execTimeout: command.slice("exec-timeout ".length).trim() || "10 0" }), session, "");
  if (lower === "logging synchronous") return result(updateLineConfig(device, line.id, { loggingSynchronous: true }), session, "");
  if (lower === "no logging synchronous") return result(updateLineConfig(device, line.id, { loggingSynchronous: false }), session, "");
  return result(device, session, "% Unsupported line configuration command.");
}

function routerCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const routing = routingProtocols(device).find((item) => item.id === session.routingId);
  if (!routing) return result(device, { mode: "global" }, "% Router context is missing.");
  if (lower.startsWith("network ")) {
    const network = command.slice("network ".length).trim();
    if (!network) return result(device, session, "% Usage: network <network> [wildcard-mask]");
    return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, networks: unique([...protocol.networks, network]) })), session, "");
  }
  if (lower.startsWith("version ")) return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, version: command.split(/\s+/)[1] ?? protocol.version })), session, "");
  if (lower === "auto-summary") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, autoSummary: true })), session, "");
  if (lower === "no auto-summary") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, autoSummary: false })), session, "");
  if (lower.startsWith("passive-interface ")) {
    const name = command.slice("passive-interface ".length).trim();
    if (!name) return result(device, session, "% Usage: passive-interface <interface>");
    return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, passiveInterfaces: unique([...protocol.passiveInterfaces, name]) })), session, "");
  }
  if (lower.startsWith("no passive-interface ")) {
    const name = command.slice("no passive-interface ".length).trim().toLowerCase();
    return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, passiveInterfaces: protocol.passiveInterfaces.filter((item) => item.toLowerCase() !== name) })), session, "");
  }
  if (lower === "redistribute static") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, redistributeStatic: true })), session, "");
  if (lower === "no redistribute static") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, redistributeStatic: false })), session, "");
  return result(device, session, "% Unsupported router configuration command.");
}

function aclCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const aclName = session.aclName;
  const aclType = session.aclType ?? "extended";
  if (!aclName) return result(device, { mode: "global" }, "% ACL context is missing.");
  if (lower.startsWith("permit ") || lower.startsWith("deny ") || /^\d+\s+(permit|deny)\s+/i.test(command)) {
    const rule = parseAclSubmodeRule(aclName, aclType, command);
    if (!rule) return result(device, session, aclType === "standard" ? "% Usage: permit|deny <source> [wildcard]" : "% Usage: permit|deny <protocol> <source> <destination>");
    return result({ ...device, config: { ...device.config, accessRules: [...device.config.accessRules, rule] } }, session, "");
  }
  if (/^no\s+\d+$/i.test(command)) {
    const sequence = Number(command.split(/\s+/)[1]);
    return result(removeAccessListSequence(device, aclName, sequence), session, "");
  }
  if (lower.startsWith("no permit ") || lower.startsWith("no deny ")) {
    const rule = parseAclSubmodeRule(aclName, aclType, command.slice(3));
    return result(rule ? removeAccessRule(device, rule) : device, session, "");
  }
  if (lower.startsWith("remark ")) return result(device, session, "");
  return result(device, session, "% Unsupported access-list configuration command.");
}

function showCommand(device: NetworkDevice, lower: string): string {
  if (lower.startsWith("show running-config interface ")) {
    const name = lower.slice("show running-config interface ".length);
    const port = findPort(device, name);
    return port ? interfaceConfig(port).join("\n") : `% Interface ${name} not found.`;
  }
  if (lower === "show run" || lower === "show running-config" || lower === "show running-config all" || lower === "show running-config brief") return runningConfig(device);
  if (lower === "show version") return [`${device.model} Software, Network Editor Web`, `Device uptime is simulated`, `System image file is "ptweb:${device.modelId}"`, `${device.ports.length} interfaces`, `${device.powerOn ? "System returned to ROM by power-on" : "System is powered off"}`].join("\n");
  if (lower === "show clock") return new Date().toLocaleString("ko-KR", { hour12: false });
  if (lower === "show inventory") return [`NAME: "${device.label}", DESCR: "${device.model}"`, `PID: ${device.modelId}, VID: PTWEB, SN: ${device.id}`, ...device.modules.map((module) => `NAME: "${module.slotId}", PID: ${module.moduleId}`)].join("\n");
  if (lower === "show logging") return device.runtime.logs.length ? device.runtime.logs.map((log) => `${new Date(log.createdAt).toLocaleString("ko-KR", { hour12: false })} ${log.level.toUpperCase()}: ${log.message}`).join("\n") : "No logging messages.";
  if (lower === "show flash" || lower === "show flash:") return flashDirectory(device);
  if (lower === "show file systems") return fileSystems(device);
  if (lower === "show processes cpu") return "CPU utilization for five seconds: 1%/0%; one minute: 1%; five minutes: 1%";
  if (lower === "show memory") return "Processor Pool Total: 262144 Used: 98304 Free: 163840\nI/O Pool Total: 65536 Used: 8192 Free: 57344";
  if (lower === "show controllers" || lower.startsWith("show controllers ")) return controllersStatus(device, lower.slice("show controllers".length).trim());
  if (lower === "show users") return ["Line       User       Host(s)              Idle       Location", "* 0 con 0  console    idle                 00:00:00   local"].join("\n");
  if (lower === "show line") return lineStatus(device);
  if (lower === "show terminal") return ["Line 0, Location: local", "Length: 24 lines, Width: 80 columns", "History is enabled, history size is 80", "Editing is enabled. Completion is enabled."].join("\n");
  if (lower === "show protocols") return protocolsStatus(device);
  if (lower === "show spanning-tree") return spanningTreeStatus(device);
  if (lower === "show startup-config") return device.config.startupConfig.join("\n") || "% Startup config is not saved.";
  if (lower === "show ip interface brief") {
    return ["Interface              IP-Address      OK? Method Status", ...device.ports.map((port) => `${port.name.padEnd(22)}${(port.ipAddress || "unassigned").padEnd(16)}YES manual ${port.adminUp && device.powerOn ? "up" : "down"}`)].join("\n");
  }
  if (lower === "show ip interface") return ipInterfaceStatus(device);
  if (lower.startsWith("show ip interface ")) {
    const name = lower.slice("show ip interface ".length);
    const port = findPort(device, name);
    return port ? ipInterfaceStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show interfaces") return device.ports.map((port) => interfaceStatus(device, port)).join("\n\n");
  if (lower === "show interfaces description") return interfaceDescriptions(device);
  if (lower === "show interfaces switchport") return switchportStatus(device);
  if (lower === "show interfaces trunk") return trunkStatus(device);
  if (lower.startsWith("show interface ")) {
    const name = lower.slice("show interface ".length);
    const port = findPort(device, name);
    return port ? interfaceStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show interfaces status") {
    return ["Port                  Status      Mode    VLAN  Type", ...device.ports.map((port) => `${port.name.padEnd(22)}${(port.linkId ? "connected" : "notconnect").padEnd(12)}${port.mode.padEnd(8)}${String(port.vlan).padEnd(6)}${port.kind}`)].join("\n");
  }
  if (lower === "show vlan brief") return ["VLAN  Name", ...device.config.vlans.map((vlan) => `${vlan.id.toString().padEnd(6)}${vlan.name}`)].join("\n");
  if (lower === "show mac address-table") return device.runtime.macTable.length ? ["Vlan  Mac Address         Type      Ports", ...device.runtime.macTable.map((entry) => `${String(entry.vlan).padEnd(6)}${entry.macAddress.padEnd(20)}${entry.type.padEnd(10)}${entry.portName}`)].join("\n") : "No entries learned.";
  if (lower === "show arp" || lower === "show ip arp") return device.runtime.arpTable.length ? ["Protocol  Address         Hardware Addr       Interface", ...device.runtime.arpTable.map((entry) => `Internet  ${entry.ipAddress.padEnd(16)}${entry.macAddress.padEnd(20)}${entry.portName}`)].join("\n") : "No ARP entries.";
  if (lower === "show ip route") return routeTable(device);
  if (lower === "show ip route summary") return routeSummary(device);
  if (lower.startsWith("show ip route ")) return routeTable(device, lower.slice("show ip route ".length).trim());
  if (lower === "show ip protocols") return ipProtocols(device);
  if (lower === "show ip ospf") return ospfProcessStatus(device);
  if (lower === "show ip ospf neighbor") return ospfNeighbors(device);
  if (lower === "show ip ospf interface" || lower === "show ip ospf interface brief") return ospfInterfaceStatus(device, lower.endsWith("brief"));
  if (lower === "show ip eigrp neighbors") return eigrpNeighbors(device);
  if (lower === "show ip eigrp interfaces") return eigrpInterfaces(device);
  if (lower === "show ip eigrp topology") return eigrpTopology(device);
  if (lower === "show ip eigrp") return eigrpStatus(device);
  if (lower === "show ip rip" || lower === "show ip rip database") return ripDatabase(device);
  if (lower === "show ip nat translations") return natTranslations(device);
  if (lower === "show ip nat statistics") return natStatistics(device);
  if (lower === "show ip dhcp binding") return device.runtime.dhcpLeases.map((lease) => `${lease.ipAddress.padEnd(16)}${lease.macAddress.padEnd(20)}${lease.deviceId}`).join("\n") || "No DHCP bindings.";
  if (lower === "show ip dhcp pool") return device.config.dhcpPools.map((pool) => [`풀 ${pool.name}`, `  네트워크 ${pool.network} ${pool.mask}`, `  기본 라우터 ${pool.defaultGateway}`, `  DNS 서버 ${pool.dnsServer}`, `  시작 범위 ${pool.startIp}, 최대 임대 ${pool.maxLeases}`, `  상태 ${pool.enabled ? "활성" : "비활성"}`].join("\n")).join("\n\n") || "DHCP 풀이 없습니다.";
  if (lower === "show hosts") return device.config.dnsRecords.map((record) => `${record.name.padEnd(32)}${record.value}`).join("\n") || "호스트 레코드가 없습니다.";
  if (lower === "show access-list" || lower === "show access-lists") return accessListStatus(device);
  if (lower.startsWith("show access-list ")) return accessListStatus(device, lower.slice("show access-list ".length).trim());
  if (lower === "show nat") return natTranslations(device);
  return "% Unsupported show command.";
}

function clearCommand(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  if (lower === "clear arp-cache" || lower === "clear arp") return result({ ...device, runtime: { ...device.runtime, arpTable: [] } }, session, "");
  if (lower === "clear mac address-table") return result({ ...device, runtime: { ...device.runtime, macTable: [] } }, session, "");
  if (lower === "clear ip dhcp binding") return result({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } }, session, "");
  return result(device, session, "% Unsupported clear command.");
}

function flashDirectory(device: NetworkDevice): string {
  const startupBytes = device.config.startupConfig.join("\n").length;
  const imageBytes = 8192 + device.ports.length * 256;
  return [
    "Directory of flash:/",
    "",
    `    1  -rw-       ${String(imageBytes).padStart(8)}  ptweb-${device.modelId}.bin`,
    `    2  -rw-       ${String(startupBytes).padStart(8)}  startup-config`,
    "64016384 bytes total (63901696 bytes free)"
  ].join("\n");
}

function fileSystems(device: NetworkDevice): string {
  return [
    "File Systems:",
    "",
    "     Size(b)     Free(b)      Type  Flags  Prefixes",
    `*   64016384    63901696     flash     rw  flash:`,
    `       ${String(device.config.startupConfig.join("\n").length || 1).padStart(6)}       0     nvram     rw  nvram:`,
    "           -       -    network     rw  tftp:",
    "           -       -    opaque      rw  system:"
  ].join("\n");
}

function controllersStatus(device: NetworkDevice, filter = ""): string {
  const wanted = filter.trim().toLowerCase();
  const ports = device.ports.filter((port) => {
    if (!wanted) return port.kind !== "console";
    return port.name.toLowerCase().includes(wanted) || port.kind.includes(wanted);
  });
  if (!ports.length) return "% No controllers found.";
  return ports.map((port) => [
    `${port.name} controller`,
    `  Hardware is ${port.kind}`,
    `  DCE/DTE status: ${port.kind === "serial" ? (port.clockRate ? "DCE, clock rate set" : "DTE or clock rate not set") : "not applicable"}`,
    `  Clock rate: ${port.clockRate ?? "not set"}`,
    `  Cable state: ${port.linkId ? "connected" : "not connected"}`,
    `  Interface reset count: 0`
  ].join("\n")).join("\n\n");
}

function runningConfig(device: NetworkDevice): string {
  return [
    `hostname ${device.config.hostname}`,
    ...(device.config.enableSecret ? [`enable secret ${device.config.enableSecret}`] : []),
    ...(device.config.enablePassword ? [`enable password ${device.config.enablePassword}`] : []),
    ...(device.config.domainLookup === false ? ["no ip domain-lookup"] : []),
    ...(device.config.defaultGateway ? [`ip default-gateway ${device.config.defaultGateway}`] : []),
    ...(device.config.motdBanner ? [`banner motd #${device.config.motdBanner}#`] : []),
    ...device.config.vlans.map((vlan) => [`vlan ${vlan.id}`, ` name ${vlan.name}`]).flat(),
    ...device.ports.flatMap((port) => interfaceConfig(port)),
    ...device.config.staticRoutes.map((route) => `ip route ${route.network} ${route.mask} ${route.nextHop}`),
    ...device.config.dnsRecords.map((record) => `ip host ${record.name} ${record.value}`),
    ...accessRulesConfig(device.config.accessRules),
    ...device.config.natRules.map((rule) => `ip nat inside source static ${rule.insideLocal} ${rule.insideGlobal}`),
    ...Object.entries(device.config.services).map(([name, enabled]) => `${enabled ? "" : "no "}service ${name}`),
    ...device.config.dhcpPools.flatMap((pool) => [
      `ip dhcp pool ${pool.name}`,
      ` network ${pool.network} ${pool.mask}`,
      ` default-router ${pool.defaultGateway}`,
      ` dns-server ${pool.dnsServer}`,
      ` start-ip ${pool.startIp}`,
      ` max-leases ${pool.maxLeases}`,
      pool.enabled ? " no shutdown" : " shutdown"
    ]),
    ...lineConfigs(device).flatMap(lineConfig),
    ...routingProtocols(device).flatMap(routingProtocolConfig)
  ].join("\n");
}

function lineConfig(line: LineConfig): string[] {
  return [
    `line ${line.kind} ${line.range}`,
    ...(line.password ? [` password ${line.password}`] : []),
    line.login ? " login" : " no login",
    ...(line.transportInput ? [` transport input ${line.transportInput}`] : []),
    ...(line.execTimeout ? [` exec-timeout ${line.execTimeout}`] : []),
    line.loggingSynchronous ? " logging synchronous" : " no logging synchronous"
  ];
}

function routingProtocolConfig(protocol: RoutingProtocol): string[] {
  return [
    `router ${protocol.protocol}${protocol.processId ? ` ${protocol.processId}` : ""}`,
    ...(protocol.version ? [` version ${protocol.version}`] : []),
    ...protocol.networks.map((network) => ` network ${network}`),
    protocol.autoSummary ? " auto-summary" : " no auto-summary",
    ...protocol.passiveInterfaces.map((name) => ` passive-interface ${name}`),
    ...(protocol.redistributeStatic ? [" redistribute static"] : [])
  ];
}

function interfaceConfig(port: NetworkPort): string[] {
  const lines = [`interface ${port.name}`];
  if (port.description) lines.push(` description ${port.description}`);
  if (port.mode === "routed" && port.ipAddress) lines.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
  if (port.mode === "access") lines.push(" switchport mode access", ` switchport access vlan ${port.vlan}`);
  if (port.mode === "trunk") lines.push(" switchport mode trunk", ` switchport trunk allowed vlan ${port.allowedVlans.join(",")}`);
  if (port.natRole) lines.push(` ip nat ${port.natRole}`);
  if (port.accessGroupIn) lines.push(` ip access-group ${port.accessGroupIn} in`);
  if (port.accessGroupOut) lines.push(` ip access-group ${port.accessGroupOut} out`);
  if (port.stpPortfast) lines.push(" spanning-tree portfast");
  if (port.bpduGuard) lines.push(" spanning-tree bpduguard enable");
  if (port.kind === "serial" && port.clockRate) lines.push(` clock rate ${port.clockRate}`);
  lines.push(port.adminUp ? " no shutdown" : " shutdown");
  return lines;
}

function interfaceStatus(device: NetworkDevice, port: NetworkPort): string {
  const operational = device.powerOn && port.adminUp && Boolean(port.linkId);
  return [
    `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${operational ? "up" : "down"}`,
    ...(port.description ? [`  Description: ${port.description}`] : []),
    `  Hardware is ${port.kind}, address is ${port.macAddress}`,
    `  Internet address is ${port.ipAddress ? `${port.ipAddress} ${port.subnetMask}` : "unassigned"}`,
    `  Mode ${port.mode}${port.mode === "access" ? `, access VLAN ${port.vlan}` : ""}${port.mode === "trunk" ? `, allowed VLANs ${port.allowedVlans.join(",")}` : ""}`,
    ...(port.kind === "serial" ? [`  Clock rate ${port.clockRate ?? "not set"}`] : []),
    `  ${port.linkId ? "Connected" : "Not connected"}`
  ].join("\n");
}

function interfaceDescriptions(device: NetworkDevice): string {
  return [
    "Interface                      Status         Protocol Description",
    ...device.ports.map((port) => {
      const status = device.powerOn && port.adminUp ? "up" : "admin down";
      const protocol = device.powerOn && port.adminUp && port.linkId ? "up" : "down";
      return `${port.name.padEnd(30)}${status.padEnd(15)}${protocol.padEnd(9)}${port.description || ""}`;
    })
  ].join("\n");
}

function ipInterfaceStatus(device: NetworkDevice, selectedPort?: NetworkPort): string {
  const ports = selectedPort ? [selectedPort] : device.ports.filter((port) => port.kind !== "console");
  return ports.map((port) => {
    const operational = device.powerOn && port.adminUp && Boolean(port.linkId);
    const ipLine = port.ipAddress
      ? `  Internet address is ${port.ipAddress}/${maskToPrefix(port.subnetMask)}`
      : "  Internet protocol processing disabled";
    return [
      `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${operational ? "up" : "down"}`,
      ipLine,
      `  Broadcast address is 255.255.255.255`,
      `  Address determined by ${port.ipAddress ? "manual configuration" : "unset"}`,
      `  MTU is 1500 bytes`,
      `  Helper address is not set`,
      `  Directed broadcast forwarding is disabled`,
      `  Outgoing access list is ${port.accessGroupOut || "not set"}`,
      `  Inbound access list is ${port.accessGroupIn || "not set"}`,
      `  Proxy ARP is enabled`,
      `  ICMP redirects are always sent`
    ].join("\n");
  }).join("\n\n");
}

function switchportStatus(device: NetworkDevice): string {
  return device.ports
    .filter((port) => port.kind !== "console")
    .map((port) => [
      `Name: ${port.name}`,
      `Switchport: ${port.mode === "routed" ? "Disabled" : "Enabled"}`,
      `Administrative Mode: ${port.mode}`,
      `Operational Mode: ${port.mode}`,
      `Access Mode VLAN: ${port.vlan}`,
      `Trunking VLANs Enabled: ${port.mode === "trunk" ? port.allowedVlans.join(",") : "none"}`,
      "Voice VLAN: none"
    ].join("\n"))
    .join("\n\n") || "% No switchport interfaces.";
}

function trunkStatus(device: NetworkDevice): string {
  const trunks = device.ports.filter((port) => port.mode === "trunk");
  if (trunks.length === 0) return "No trunking interfaces.";
  return [
    "Port                  Mode         Status        Native vlan",
    ...trunks.map((port) => `${port.name.padEnd(22)}on           ${(device.powerOn && port.adminUp ? "trunking" : "disabled").padEnd(14)}1`),
    "",
    "Port                  Vlans allowed on trunk",
    ...trunks.map((port) => `${port.name.padEnd(22)}${port.allowedVlans.join(",") || "none"}`)
  ].join("\n");
}

function lineStatus(device: NetworkDevice): string {
  const lines = lineConfigs(device);
  return [
    "Tty Typ     Tx/Rx     A Modem  Roty AccO AccI  Uses Noise Overruns Int",
    "0   CTY     -/-       - -      -    -    -     0    0     0/0      -",
    ...lines.map((line, index) => `${String(index + 1).padEnd(3)} ${line.kind.toUpperCase().padEnd(7)} ${line.range.padEnd(9)} - ${line.login ? "login" : "nologin"} transport ${line.transportInput || "-"}`)
  ].join("\n");
}

function protocolsStatus(device: NetworkDevice): string {
  return device.ports
    .filter((port) => port.kind !== "console")
    .map((port) => `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${device.powerOn && port.adminUp && port.linkId ? "up" : "down"}${port.ipAddress ? `\n  Internet address is ${port.ipAddress}/${maskToPrefix(port.subnetMask)}` : ""}`)
    .join("\n\n") || "No protocol interfaces.";
}

function spanningTreeStatus(device: NetworkDevice): string {
  const vlans = device.config.vlans.length ? device.config.vlans : [{ id: 1, name: "default" }];
  return vlans.map((vlan) => [
    `VLAN${String(vlan.id).padStart(4, "0")}`,
    "  Spanning tree enabled protocol ieee",
    `  Root ID    Priority    ${32768 + vlan.id}`,
    `             Address     ${device.ports[0]?.macAddress ?? "02:00:00:00:00:00"}`,
    "             This bridge is the root",
    "",
    "  Interface              Role Sts Cost      Prio.Nbr Type",
    ...device.ports
      .filter((port) => port.kind !== "console" && (port.mode === "access" ? port.vlan === vlan.id : port.mode === "trunk" ? port.allowedVlans.includes(vlan.id) : false))
      .map((port, index) => `${port.name.padEnd(23)}Desg ${port.adminUp && device.powerOn ? "FWD" : "BLK"} ${String(port.kind.includes("gigabit") ? 4 : 19).padEnd(9)}128.${String(index + 1).padEnd(4)}${port.stpPortfast ? "P2p Edge" : "P2p"}${port.bpduGuard ? " BPDU Guard" : ""}`)
  ].join("\n")).join("\n\n");
}

function routeTable(device: NetworkDevice, filter = ""): string {
  const connected = device.ports
    .filter((port) => port.adminUp && port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask))
    .flatMap((port) => {
      const network = networkAddress(port.ipAddress, port.subnetMask);
      const prefix = maskToPrefix(port.subnetMask);
      return [
        `C    ${network}/${prefix} is directly connected, ${port.name}`,
        `L    ${port.ipAddress}/32 is directly connected, ${port.name}`
      ];
    });
  const staticRoutes = device.config.staticRoutes.map((route) => {
    const prefix = isIpv4(route.mask) ? maskToPrefix(route.mask) : route.mask;
    return `S    ${route.network}/${prefix} [1/0] via ${route.nextHop}`;
  });
  const defaultRoute = device.config.staticRoutes.find((route) => route.network === "0.0.0.0" && route.mask === "0.0.0.0");
  const gatewayLine = defaultRoute ? `기본 경로 게이트웨이는 ${defaultRoute.nextHop} -> network 0.0.0.0 입니다` : device.config.defaultGateway ? `기본 게이트웨이는 ${device.config.defaultGateway} 입니다` : "기본 경로 게이트웨이가 설정되지 않았습니다";
  const body = filterRouteLines([...connected, ...staticRoutes].filter((line, index, list) => list.indexOf(line) === index), filter);
  return [
    "코드: C - 연결됨, S - 정적, L - 로컬",
    gatewayLine,
    "",
    ...(body.length ? body : ["설치된 라우트가 없습니다."])
  ].join("\n");
}

function routeSummary(device: NetworkDevice): string {
  const connected = connectedNetworks(device).length;
  const statics = device.config.staticRoutes.length;
  const dynamic = routingProtocols(device).reduce((count, protocol) => count + protocol.networks.length, 0);
  return [
    "IP routing table name is default (0x0)",
    `IP routing table maximum-paths is 32`,
    `Route Source    Networks    Subnets     Replicates  Overhead    Memory (bytes)`,
    `${"connected".padEnd(16)}${String(connected).padEnd(12)}0           0           64          ${connected * 128}`,
    `${"static".padEnd(16)}${String(statics).padEnd(12)}0           0           64          ${statics * 128}`,
    `${"dynamic".padEnd(16)}${String(dynamic).padEnd(12)}0           0           64          ${dynamic * 128}`,
    `Total routes: ${connected * 2 + statics + dynamic}`
  ].join("\n");
}

function filterRouteLines(lines: string[], filter: string): string[] {
  if (!filter) return lines;
  if (filter === "connected" || filter === "directly-connected") return lines.filter((line) => line.startsWith("C") || line.startsWith("L"));
  if (filter === "static") return lines.filter((line) => line.startsWith("S"));
  if (isIpv4(filter)) return lines.filter((line) => line.includes(filter));
  return lines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
}

function ipProtocols(device: NetworkDevice): string {
  const protocols = routingProtocols(device);
  const lines: string[] = [];
  if (device.config.staticRoutes.length) {
    lines.push(`Routing Protocol is "static"`, `  Static routes configured: ${device.config.staticRoutes.length}`, ...device.config.staticRoutes.map((route) => `  ${route.network} ${route.mask} via ${route.nextHop}`));
  }
  for (const protocol of protocols) {
    lines.push(
      `Routing Protocol is "${protocol.protocol}${protocol.processId ? ` ${protocol.processId}` : ""}"`,
      `  Outgoing update filter list for all interfaces is not set`,
      `  Incoming update filter list for all interfaces is not set`,
      `  Automatic network summarization is ${protocol.autoSummary ? "in effect" : "not in effect"}`,
      ...(protocol.version ? [`  Sending updates version ${protocol.version}`] : []),
      ...(protocol.networks.length ? ["  Routing for Networks:", ...protocol.networks.map((network) => `    ${network}`)] : ["  No networks configured."]),
      ...(protocol.passiveInterfaces.length ? ["  Passive Interface(s):", ...protocol.passiveInterfaces.map((name) => `    ${name}`)] : []),
      ...(protocol.redistributeStatic ? ["  Redistributing: static"] : [])
    );
  }
  return lines.length ? lines.join("\n") : "No routing protocols configured.";
}

function ospfProcessStatus(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "ospf");
  if (!protocols.length) return "%OSPF: Router process not configured";
  return protocols.map((protocol) => [
    ` Routing Process "ospf ${protocol.processId ?? "1"}" with ID ${routerId(device)}`,
    " Start time: 00:00:00.000, Time elapsed: simulated",
    " Supports only single TOS(TOS0) routes",
    ` Number of areas in this router is 1. 1 normal 0 stub 0 nssa`,
    protocol.networks.length ? ` Routing for Networks:\n${protocol.networks.map((network) => `  ${network}`).join("\n")}` : " No networks configured"
  ].join("\n")).join("\n\n");
}

function ospfNeighbors(device: NetworkDevice): string {
  if (!routingProtocols(device).some((protocol) => protocol.protocol === "ospf")) return "%OSPF: Router process not configured";
  return [
    "Neighbor ID     Pri   State           Dead Time   Address         Interface",
    "No OSPF neighbors are currently discovered in this device-only CLI context."
  ].join("\n");
}

function ospfInterfaceStatus(device: NetworkDevice, brief: boolean): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "ospf");
  if (!protocols.length) return "%OSPF: Router process not configured";
  const routedPorts = device.ports.filter((port) => port.adminUp && port.ipAddress && port.subnetMask);
  if (brief) {
    return [
      "Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C",
      ...routedPorts.map((port) => `${shortPortAlias(port.name).padEnd(12)}${(protocols[0].processId ?? "1").padEnd(6)}0               ${`${port.ipAddress}/${maskToPrefix(port.subnetMask)}`.padEnd(19)}${"1".padEnd(6)}DR    0/0`)
    ].join("\n");
  }
  return routedPorts.map((port) => [
    `${port.name} is up, line protocol is ${device.powerOn && port.linkId ? "up" : "down"}`,
    `  Internet Address ${port.ipAddress}/${maskToPrefix(port.subnetMask)}, Area 0`,
    `  Process ID ${protocols[0].processId ?? "1"}, Router ID ${routerId(device)}, Network Type BROADCAST, Cost: 1`,
    "  Timer intervals configured, Hello 10, Dead 40, Wait 40, Retransmit 5",
    "  Neighbor Count is 0, Adjacent neighbor count is 0"
  ].join("\n")).join("\n\n") || "No OSPF-enabled interfaces.";
}

function eigrpStatus(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "eigrp");
  if (!protocols.length) return "%DUAL-5-NBRCHANGE: EIGRP is not configured";
  return protocols.map((protocol) => [
    `IP-EIGRP AS(${protocol.processId ?? "1"}) is running`,
    `  Router-ID: ${routerId(device)}`,
    `  Topology: ${protocol.networks.length} configured network(s)`,
    `  Automatic summarization: ${protocol.autoSummary ? "enabled" : "disabled"}`
  ].join("\n")).join("\n\n");
}

function eigrpNeighbors(device: NetworkDevice): string {
  if (!routingProtocols(device).some((protocol) => protocol.protocol === "eigrp")) return "% EIGRP not configured";
  return [
    "EIGRP-IPv4 Neighbors for AS",
    "H   Address                 Interface              Hold Uptime   SRTT   RTO  Q  Seq",
    "No EIGRP neighbors are currently discovered in this device-only CLI context."
  ].join("\n");
}

function eigrpInterfaces(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "eigrp");
  if (!protocols.length) return "% EIGRP not configured";
  const routedPorts = device.ports.filter((port) => port.adminUp && port.ipAddress && port.subnetMask);
  return [
    `EIGRP-IPv4 Interfaces for AS(${protocols[0].processId ?? "1"})`,
    "Interface              Peers  Xmit Queue   Mean SRTT   Pacing Time   Multicast",
    ...routedPorts.map((port) => `${port.name.padEnd(22)}0      0            0           0             0`)
  ].join("\n");
}

function eigrpTopology(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "eigrp");
  if (!protocols.length) return "% EIGRP not configured";
  return [
    `EIGRP-IPv4 Topology Table for AS(${protocols[0].processId ?? "1"})/ID(${routerId(device)})`,
    "Codes: P - Passive, A - Active, U - Update, Q - Query, R - Reply",
    ...connectedNetworks(device).map((entry) => `P ${entry.network}/${entry.prefix}, 1 successors, FD is 28160\n        via Connected, ${entry.portName}`)
  ].join("\n");
}

function ripDatabase(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "rip");
  if (!protocols.length) return "% RIP is not configured";
  return [
    "RIP database",
    ...protocols.flatMap((protocol) => protocol.networks.length ? protocol.networks.map((network) => `${network.padEnd(18)} auto-summary ${protocol.autoSummary ? "enabled" : "disabled"}`) : ["No RIP networks configured."]),
    ...connectedNetworks(device).map((entry) => `${entry.network}/${entry.prefix} directly connected, ${entry.portName}`)
  ].join("\n");
}

function natTranslations(device: NetworkDevice): string {
  if (!device.config.natRules.length) return "Pro  Inside global      Inside local       Outside local      Outside global";
  return [
    "Pro  Inside global      Inside local       Outside local      Outside global",
    ...device.config.natRules.map((rule) => `---  ${rule.insideGlobal.padEnd(18)}${rule.insideLocal.padEnd(18)}---                ---`)
  ].join("\n");
}

function natStatistics(device: NetworkDevice): string {
  const inside = device.ports.filter((port) => port.natRole === "inside").map((port) => port.name).join(", ") || "none";
  const outside = device.ports.filter((port) => port.natRole === "outside").map((port) => port.name).join(", ") || "none";
  const hits = device.config.natRules.reduce((total, rule) => total + rule.hits, 0);
  return [
    `Total active translations: ${device.config.natRules.length} (static ${device.config.natRules.length}, dynamic 0)`,
    `Outside interfaces: ${outside}`,
    `Inside interfaces: ${inside}`,
    `Hits: ${hits}  Misses: 0`,
    "Expired translations: 0",
    "Dynamic mappings: none"
  ].join("\n");
}

function connectedNetworks(device: NetworkDevice): Array<{ network: string; prefix: number; portName: string }> {
  return device.ports
    .filter((port) => port.adminUp && port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask))
    .map((port) => ({ network: networkAddress(port.ipAddress, port.subnetMask), prefix: maskToPrefix(port.subnetMask), portName: port.name }));
}

function routerId(device: NetworkDevice): string {
  return device.ports.find((port) => port.ipAddress)?.ipAddress || "0.0.0.0";
}

function help(mode: CliMode): string {
  if (mode === "global") return "hostname <name>, interface <name>, vlan <id>, ip route <network> <mask> <next-hop>, ip nat inside source static <local> <global>, ip dhcp pool <name>, ip host <name> <address>, access-list <list> permit|deny <protocol> <source> <destination>, nat <local> <global> <outside>, service <name>, show ..., end";
  if (mode === "interface") return "description <text>, ip address <ip> <mask>, ip nat inside|outside, ip access-group <list> in|out, switchport mode access|trunk, switchport access vlan <id>, switchport trunk allowed vlan <list>, clock rate <value>, shutdown, no shutdown, exit";
  if (mode === "vlan") return "name <vlan-name>, exit, end";
  if (mode === "dhcp") return "network <network> <mask>, default-router <ip>, dns-server <ip>, start-ip <ip>, max-leases <n>, shutdown, no shutdown, exit";
  if (mode === "line") return "password <value>, login, no login, transport input <all|ssh|telnet|none>, exec-timeout <min> <sec>, logging synchronous, exit";
  if (mode === "router") return "network <network> [wildcard-mask], version <n>, auto-summary, no auto-summary, passive-interface <name>, redistribute static, exit";
  if (mode === "acl") return "permit|deny <protocol> <source> <destination>, permit|deny <source> [wildcard], no <sequence>, exit";
  return "enable, configure terminal, show run, show version, show interfaces, show interfaces description, show interfaces switchport, show interfaces trunk, show ip interface, show ip interface brief, show interfaces status, show vlan brief, show ip route, show ip route summary, show ip protocols, show ip ospf neighbor, show ip eigrp neighbors, show ip rip database, show ip dhcp pool, show hosts, show access-list, show nat, show cdp neighbors, show arp, show ip dhcp binding, clear ..., write memory, reload, write erase";
}

function searchHelp(term: string): string {
  const query = term.trim().toLowerCase();
  const commands = [
    "show running-config | include <text>",
    "show running-config | begin <text>",
    "show running-config | exclude <text>",
    "show running-config interface <name>",
    "show running-config all",
    "show version",
    "show privilege",
    "show history",
    "show ip interface",
    "show ip interface brief",
    "show interfaces",
    "show interfaces description",
    "show interfaces switchport",
    "show interfaces trunk",
    "show interface <name>",
    "show interfaces status",
    "show vlan brief",
    "show ip route",
    "show ip route summary",
    "show controllers",
    "show ip protocols",
    "show ip ospf",
    "show ip ospf neighbor",
    "show ip ospf interface brief",
    "show ip eigrp neighbors",
    "show ip eigrp interfaces",
    "show ip eigrp topology",
    "show ip rip database",
    "show ip nat translations",
    "show ip nat statistics",
    "show ip dhcp pool",
    "show hosts",
    "show access-list",
    "show nat",
    "show cdp neighbors",
    "reload",
    "write erase",
    "ping <ip-or-host>",
    "traceroute <ip-or-host>",
    "tracert <ip-or-host>",
    "configure terminal",
    "interface <name>",
    "default interface <name>",
    "ip address <ip> <mask>",
    "description <text>",
    "switchport mode access",
    "switchport mode trunk",
    "ip route <network> <mask> <next-hop>",
    "ip nat inside source static <inside-local> <inside-global>",
    "ip nat inside",
    "ip nat outside",
    "access-list 101 permit ip any any",
    "ip access-group 101 in",
    "ip dhcp pool <name>",
    "ip host <name> <address>"
  ];
  return commands.filter((command) => command.toLowerCase().includes(query)).join("\n") || "No matching commands.";
}

function applyPipe(output: string, rawCommand: string): string {
  const match = rawCommand.match(/\|\s*(i|inc|include|e|exc|exclude|b|beg|begin|s|sec|section)\s+(.+)$/i);
  if (!match) return output;
  const token = match[1].toLowerCase();
  const mode = token.startsWith("i") ? "include" : token.startsWith("e") ? "exclude" : token.startsWith("s") ? "section" : "begin";
  const term = match[2].trim().toLowerCase();
  const lines = output.split("\n");
  if (mode === "include") return lines.filter((line) => line.toLowerCase().includes(term)).join("\n") || "% No matching lines.";
  if (mode === "exclude") return lines.filter((line) => !line.toLowerCase().includes(term)).join("\n") || "% No lines remain.";
  if (mode === "section") return pipeSection(lines, term);
  const index = lines.findIndex((line) => line.toLowerCase().includes(term));
  return index >= 0 ? lines.slice(index).join("\n") : "% No matching start line.";
}

function pipeSection(lines: string[], term: string): string {
  const sections: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.toLowerCase().includes(term)) continue;
    sections.push(line);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] && !/^\s/.test(lines[cursor])) break;
      sections.push(lines[cursor]);
      index = cursor;
    }
  }
  return sections.join("\n") || "% No matching sections.";
}

function parseAccessList(command: string, forcedType?: "standard" | "extended"): AccessRule | null {
  const tokens = command.trim().split(/\s+/);
  const listName = tokens[1] ?? "";
  const action = tokens[2]?.toLowerCase();
  if (!listName || !isAction(action)) return null;
  if (tokens[3]?.toLowerCase() === "remark") return null;

  if (forcedType === "standard" || (!forcedType && isStandardAcl(listName))) {
    const source = parseAclAddress(tokens, 3);
    if (!source) return null;
    return {
      id: createId("acl"),
      listName,
      listType: "standard",
      interfaceName: listName,
      action,
      protocol: "ip",
      source: source.text,
      destination: "any",
      hits: 0
    };
  }

  const protocol = tokens[3]?.toLowerCase();
  if (!isProtocol(protocol)) return null;
  const source = parseAclAddress(tokens, 4);
  if (!source) return null;
  const destination = parseAclAddress(tokens, source.nextIndex);
  if (!destination) return null;
  const options = tokens.slice(destination.nextIndex).join(" ");
  return {
    id: createId("acl"),
    listName,
    listType: forcedType ?? "extended",
    interfaceName: listName,
    action,
    protocol,
    source: source.text,
    destination: options ? `${destination.text} ${options}` : destination.text,
    hits: 0
  };
}

function parseAclSubmodeRule(aclName: string, aclType: "standard" | "extended", command: string): AccessRule | null {
  const withoutSequence = command.trim().replace(/^\d+\s+/, "");
  return parseAccessList(`access-list ${aclName} ${withoutSequence}`, aclType);
}

function parseAccessListTarget(command: string): { type: "standard" | "extended"; name: string } | null {
  const match = command.match(/^ip access-list\s+(standard|extended)\s+(.+)$/i);
  const type = match?.[1]?.toLowerCase();
  const name = match?.[2]?.trim().split(/\s+/)[0] ?? "";
  if ((type !== "standard" && type !== "extended") || !name) return null;
  return { type, name };
}

function parseAclAddress(tokens: string[], index: number): { text: string; nextIndex: number } | null {
  const token = tokens[index];
  const lower = token?.toLowerCase();
  if (!token) return null;
  if (lower === "any") return { text: "any", nextIndex: index + 1 };
  if (lower === "host") {
    const host = tokens[index + 1];
    return host && isIpv4(host) ? { text: `host ${host}`, nextIndex: index + 2 } : null;
  }
  if (isIpv4(token)) {
    const wildcardOrMask = tokens[index + 1];
    return wildcardOrMask && isIpv4(wildcardOrMask)
      ? { text: `${token} ${wildcardOrMask}`, nextIndex: index + 2 }
      : { text: token, nextIndex: index + 1 };
  }
  return { text: token, nextIndex: index + 1 };
}

function parseAccessGroup(command: string): { name: string; direction: "in" | "out" } | null {
  const [, rawName, rawDirection] = command.match(/^ip access-group\s+(\S+)\s+(in|out)$/i) ?? [];
  const direction = rawDirection?.toLowerCase();
  if (!rawName || (direction !== "in" && direction !== "out")) return null;
  return { name: rawName, direction };
}

function parseStaticNat(command: string, device: NetworkDevice): NatRule | null {
  const [, , , , , insideLocal, insideGlobal] = command.split(/\s+/);
  if (!insideLocal || !insideGlobal || !isIpv4(insideLocal) || !isIpv4(insideGlobal)) return null;
  const outsideInterface = device.ports.find((port) => port.natRole === "outside")?.name || "outside";
  return { id: createId("nat"), insideLocal, insideGlobal, outsideInterface, hits: 0 };
}

function removeStaticNat(device: NetworkDevice, insideLocal: string, insideGlobal?: string): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      natRules: device.config.natRules.filter((rule) => !(rule.insideLocal === insideLocal && (!insideGlobal || rule.insideGlobal === insideGlobal)))
    }
  };
}

function aclUsage(): string {
  return "% Usage: access-list <list> permit|deny <protocol> <source> <destination>";
}

function accessListStatus(device: NetworkDevice, filter = ""): string {
  const rulesToShow = filter
    ? device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() === filter.toLowerCase())
    : device.config.accessRules;
  if (!rulesToShow.length) return "No access lists configured.";
  const groups = new Map<string, AccessRule[]>();
  for (const rule of rulesToShow) {
    const name = aclListName(rule);
    groups.set(name, [...(groups.get(name) ?? []), rule]);
  }
  return [...groups.entries()].flatMap(([name, rules]) => [
    `${rules.every(isStandardAccessRule) ? "Standard" : "Extended"} IP access list ${name}`,
    ...rules.map((rule, index) => `    ${String((index + 1) * 10).padEnd(4)} ${accessRuleBody(rule)} (${rule.hits} matches)`)
  ]).join("\n");
}

function accessRulesConfig(rules: AccessRule[]): string[] {
  const named = new Map<string, AccessRule[]>();
  const numbered: AccessRule[] = [];
  for (const rule of rules) {
    const name = aclListName(rule);
    if (/^\d+$/.test(name)) {
      numbered.push(rule);
    } else {
      named.set(name, [...(named.get(name) ?? []), rule]);
    }
  }
  return [
    ...numbered.map((rule) => `access-list ${aclListName(rule)} ${accessRuleBody(rule)}`),
    ...[...named.entries()].flatMap(([name, group]) => [
      `ip access-list ${group.every(isStandardAccessRule) ? "standard" : "extended"} ${name}`,
      ...group.map((rule, index) => ` ${(index + 1) * 10} ${accessRuleBody(rule)}`)
    ])
  ];
}

function accessRuleBody(rule: AccessRule): string {
  return isStandardAccessRule(rule)
    ? `${rule.action} ${rule.source}`
    : `${rule.action} ${rule.protocol} ${rule.source} ${rule.destination}`;
}

function isStandardAccessRule(rule: AccessRule): boolean {
  if (rule.listType) return rule.listType === "standard";
  return isStandardAcl(aclListName(rule)) && rule.protocol === "ip" && normalizeAclEndpoint(rule.destination) === "any";
}

function aclListName(rule: AccessRule): string {
  return rule.listName || rule.interfaceName || "ACL";
}

function removeAccessList(device: NetworkDevice, listName: string): NetworkDevice {
  return {
    ...device,
    config: { ...device.config, accessRules: device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() !== listName.toLowerCase()) }
  };
}

function removeAccessListSequence(device: NetworkDevice, listName: string, sequence: number): NetworkDevice {
  const targetIndex = Math.floor(sequence / 10) - 1;
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return device;
  let currentIndex = -1;
  return {
    ...device,
    config: {
      ...device.config,
      accessRules: device.config.accessRules.filter((rule) => {
        if (aclListName(rule).toLowerCase() !== listName.toLowerCase()) return true;
        currentIndex += 1;
        return currentIndex !== targetIndex;
      })
    }
  };
}

function removeAccessRule(device: NetworkDevice, target: AccessRule): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      accessRules: device.config.accessRules.filter((rule) =>
        !(aclListName(rule).toLowerCase() === aclListName(target).toLowerCase() &&
          rule.action === target.action &&
          rule.protocol === target.protocol &&
          normalizeAclEndpoint(rule.source) === normalizeAclEndpoint(target.source) &&
          normalizeAclEndpoint(rule.destination) === normalizeAclEndpoint(target.destination))
      )
    }
  };
}

function normalizeAclEndpoint(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isStandardAcl(value: string): boolean {
  const id = Number(value);
  return Number.isInteger(id) && ((id >= 1 && id <= 99) || (id >= 1300 && id <= 1999));
}

function updatePort(device: NetworkDevice, portId: string, patch: Partial<NetworkPort>): NetworkDevice {
  return { ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) };
}

function updatePool(device: NetworkDevice, poolId: string, patch: Partial<DhcpPool>): NetworkDevice {
  return { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((pool) => pool.id === poolId ? { ...pool, ...patch } : pool) } };
}

function lineConfigs(device: NetworkDevice): LineConfig[] {
  return device.config.lineConfigs ?? [];
}

function routingProtocols(device: NetworkDevice): RoutingProtocol[] {
  return device.config.routingProtocols ?? [];
}

function parseLineTarget(command: string): { kind: "console" | "vty"; range: string } | null {
  const [, rawKind, ...rangeParts] = command.split(/\s+/);
  const kind = rawKind?.toLowerCase();
  if (kind !== "console" && kind !== "vty") return null;
  const range = rangeParts.join(" ") || (kind === "console" ? "0" : "0 4");
  return { kind, range };
}

function parseRoutingTarget(command: string): { protocol: RoutingProtocol["protocol"]; processId?: string } | null {
  const [, rawProtocol, processId] = command.split(/\s+/);
  const protocol = rawProtocol?.toLowerCase();
  if (protocol !== "rip" && protocol !== "ospf" && protocol !== "eigrp") return null;
  return { protocol, processId: protocol === "rip" ? undefined : processId ?? "1" };
}

function defaultLineConfig(kind: "console" | "vty", range: string): LineConfig {
  return { id: createId("line"), kind, range, password: "", login: false, transportInput: kind === "vty" ? "all" : "", execTimeout: "10 0", loggingSynchronous: false };
}

function defaultRoutingProtocol(protocol: RoutingProtocol["protocol"], processId?: string): RoutingProtocol {
  return { id: createId("routing"), protocol, processId, networks: [], version: protocol === "rip" ? "2" : undefined, autoSummary: false, passiveInterfaces: [], redistributeStatic: false };
}

function ensureLineConfig(device: NetworkDevice, kind: "console" | "vty", range: string): { device: NetworkDevice; line: LineConfig } {
  const existing = lineConfigs(device).find((line) => line.kind === kind && line.range === range);
  if (existing) return { device, line: existing };
  const line = defaultLineConfig(kind, range);
  return { device: { ...device, config: { ...device.config, lineConfigs: [...lineConfigs(device), line] } }, line };
}

function ensureRoutingProtocol(device: NetworkDevice, protocol: RoutingProtocol["protocol"], processId?: string): { device: NetworkDevice; protocol: RoutingProtocol } {
  const existing = routingProtocols(device).find((item) => item.protocol === protocol && (item.processId ?? "") === (processId ?? ""));
  if (existing) return { device, protocol: existing };
  const next = defaultRoutingProtocol(protocol, processId);
  return { device: { ...device, config: { ...device.config, routingProtocols: [...routingProtocols(device), next] } }, protocol: next };
}

function updateLineConfig(device: NetworkDevice, lineId: string, patch: Partial<LineConfig>): NetworkDevice {
  return { ...device, config: { ...device.config, lineConfigs: lineConfigs(device).map((line) => line.id === lineId ? { ...line, ...patch } : line) } };
}

function updateRoutingProtocol(device: NetworkDevice, routingId: string, updater: (protocol: RoutingProtocol) => RoutingProtocol): NetworkDevice {
  return { ...device, config: { ...device.config, routingProtocols: routingProtocols(device).map((protocol) => protocol.id === routingId ? updater(protocol) : protocol) } };
}

function parseBannerText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && !/[a-zA-Z0-9\s]/.test(trimmed[0])) return trimmed.slice(1, -1);
  return trimmed;
}

function isAbbrev(token: string | undefined, full: string, min = 1): boolean {
  return Boolean(token && token.length >= min && full.startsWith(token));
}

function formatColumns(values: string[]): string {
  const longest = Math.max(...values.map((value) => value.length), 1);
  const width = Math.min(Math.max(longest + 3, 18), 36);
  return values
    .reduce<string[]>((rows, value, index) => {
      const cell = value.padEnd(width);
      const rowIndex = Math.floor(index / 2);
      rows[rowIndex] = `${rows[rowIndex] ?? ""}${cell}`;
      return rows;
    }, [])
    .map((row) => row.trimEnd())
    .join("\n");
}

function unique(values: string[]): string[] {
  return values.filter((value, index, list) => value && list.indexOf(value) === index);
}

function ensureVlan(device: NetworkDevice, id: number): NetworkDevice {
  if (device.config.vlans.some((vlan) => vlan.id === id)) return device;
  return { ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: `VLAN${id}` }].sort((a, b) => a.id - b.id) } };
}

function createSviInterface(device: NetworkDevice, name: string): { device: NetworkDevice; port: NetworkPort } | null {
  const match = name.trim().match(/^vlan\s*(\d+)$/i);
  if (!match) return null;
  const vlan = Number(match[1]);
  if (!validVlan(vlan)) return null;
  const port: NetworkPort = {
    id: createId("port"),
    name: `Vlan${vlan}`,
    kind: "ethernet",
    description: "",
    macAddress: virtualMac(device.ports.length),
    mode: "routed",
    vlan,
    allowedVlans: [vlan],
    ipAddress: "",
    subnetMask: "",
    gateway: "",
    dnsServer: "",
    adminUp: true,
    ipCapable: true,
    accessGroupIn: "",
    accessGroupOut: "",
    natRole: undefined
  };
  const next = ensureVlan({ ...device, ports: [...device.ports, port] }, vlan);
  return { device: next, port };
}

function virtualMac(index: number): string {
  const value = Math.max(0, index).toString(16).padStart(6, "0").slice(-6);
  return `02:00:00:${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
}

function findPort(device: NetworkDevice, name: string): NetworkPort | undefined {
  const wanted = normalizePortName(name);
  return device.ports.find((port) => normalizePortName(port.name) === wanted || compactAlias(port.name) === wanted);
}

function normalizePortName(name: string): string {
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.startsWith("fastethernet")) return compact;
  if (compact.startsWith("gigabitethernet")) return compact;
  if (compact.startsWith("serial")) return compact;
  if (compact.startsWith("vlan")) return compact;
  if (compact.startsWith("fa")) return compact.replace(/^fa/, "fastethernet");
  if (compact.startsWith("f")) return compact.replace(/^f/, "fastethernet");
  if (compact.startsWith("gi")) return compact.replace(/^gi/, "gigabitethernet");
  if (compact.startsWith("g")) return compact.replace(/^g/, "gigabitethernet");
  if (compact.startsWith("se")) return compact.replace(/^se/, "serial");
  if (compact.startsWith("s")) return compact.replace(/^s/, "serial");
  return compact;
}

function compactAlias(name: string): string {
  return normalizePortName(name).replace("fastethernet", "f").replace("gigabitethernet", "g").replace("serial", "s");
}

function shortPortAlias(name: string): string {
  return name
    .replace(/^FastEthernet/i, "fa")
    .replace(/^GigabitEthernet/i, "gi")
    .replace(/^Serial/i, "se")
    .replace(/^Ethernet/i, "e");
}

function parseVlans(value: string): number[] {
  return value.split(",").map((item) => Number(item.trim())).filter(validVlan).filter((item, index, list) => list.indexOf(item) === index);
}

function numberAfter(command: string, prefix: string): number {
  return Number(command.slice(prefix.length).trim().split(/\s+/)[0]);
}

function validVlan(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4094;
}

function defaultPool(name: string): DhcpPool {
  return {
    id: createId("pool"),
    name,
    network: "192.168.1.0",
    mask: "255.255.255.0",
    defaultGateway: "192.168.1.1",
    dnsServer: "192.168.1.10",
    startIp: "192.168.1.100",
    maxLeases: 50,
    enabled: true
  };
}

function emptyRuntime(): RuntimeState {
  return { arpTable: [], macTable: [], dhcpLeases: [], logs: [] };
}

function isAction(value: string | undefined): value is "permit" | "deny" {
  return value === "permit" || value === "deny";
}

function isProtocol(value: string | undefined): value is "ip" | "icmp" | "tcp" | "udp" | "http" | "dns" | "dhcp" {
  return value === "ip" || value === "icmp" || value === "tcp" || value === "udp" || value === "http" || value === "dns" || value === "dhcp";
}

function exitSession(session: CliSession): CliSession {
  if (session.mode === "global") return { mode: "privileged" };
  if (session.mode === "interface" || session.mode === "vlan" || session.mode === "dhcp" || session.mode === "line" || session.mode === "router" || session.mode === "acl") return { mode: "global" };
  return { mode: "exec" };
}

function result(device: NetworkDevice, session: CliSession, output: string): CliResult {
  return { device, session, output };
}
