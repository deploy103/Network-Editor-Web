import { defaultConfig, getDeviceModel, getModuleSpec } from "../data/deviceCatalog";
import { createId } from "../utils/id";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import type { DhcpExcludedRange, DhcpPool, DeviceConfig, NetworkDevice, NetworkPort, PrefixListEntry, RouteMapEntry, RuntimeState } from "../types/network";

export type CliMode = "exec" | "privileged" | "global" | "interface" | "vlan" | "dhcp" | "line" | "router" | "acl" | "route-map" | "ip-sla";
export type CliPendingAction = "reload" | "erase-startup" | "enable-password" | "initial-config" | "console-username" | "console-password";

export interface CliSession {
  mode: CliMode;
  interfaceId?: string;
  interfaceIds?: string[];
  vlanId?: number;
  dhcpPoolId?: string;
  lineId?: string;
  routingId?: string;
  aclName?: string;
  aclType?: "standard" | "extended";
  routeMapId?: string;
  ipSlaId?: string;
  pendingAction?: CliPendingAction;
  authUsername?: string;
  debugFlags?: string[];
  terminalLength?: number;
  terminalWidth?: number;
  terminalMonitor?: boolean;
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
type LocalUser = NonNullable<DeviceConfig["localUsers"]>[number];
type HsrpGroup = NonNullable<NetworkPort["hsrpGroups"]>[number];
type VrrpGroup = NonNullable<NetworkPort["vrrpGroups"]>[number];
type StaticRouteConfig = DeviceConfig["staticRoutes"][number];
type RouteMapConfig = NonNullable<DeviceConfig["routeMaps"]>[number];
type PrefixListConfig = NonNullable<DeviceConfig["prefixLists"]>[number];
type IpSlaConfig = NonNullable<DeviceConfig["ipSlaOperations"]>[number];
type TrackConfig = NonNullable<DeviceConfig["trackObjects"]>[number];

export function initialCliSession(): CliSession {
  return { mode: "exec" };
}

export function initialConsoleSession(device: NetworkDevice): CliSession {
  return consoleAuthSession(device) ?? initialCliSession();
}

export function cliPrompt(device: NetworkDevice, session: CliSession): string {
  const hostname = device.config.hostname || device.label;
  if (session.mode === "exec") return `${hostname}>`;
  if (session.mode === "global") return `${hostname}(config)#`;
  if (session.mode === "interface") return `${hostname}${session.interfaceIds && session.interfaceIds.length > 1 ? "(config-if-range)#" : "(config-if)#"}`;
  if (session.mode === "vlan") return `${hostname}(config-vlan)#`;
  if (session.mode === "dhcp") return `${hostname}(dhcp-config)#`;
  if (session.mode === "line") return `${hostname}(config-line)#`;
  if (session.mode === "router") return `${hostname}(config-router)#`;
  if (session.mode === "acl") return `${hostname}(${session.aclType === "standard" ? "config-std-nacl" : "config-ext-nacl"})#`;
  if (session.mode === "route-map") return `${hostname}(config-route-map)#`;
  if (session.mode === "ip-sla") return `${hostname}(config-ip-sla)#`;
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
      const booted = bootDevice({ ...device, powerOn: true });
      const nextSession = bootSession(booted);
      return result(booted, nextSession, appendConsoleAuthPrompt(bootBanner(device), nextSession));
    }
    if (lower === "show version") return result(device, session, showVersion(device));
    if (lower === "help" || lower === "?") return result(device, session, "power on, boot, show version");
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
  if (lower === "setup") return result(device, { mode: "exec", pendingAction: "initial-config" }, initialConfigurationDialogLines().join("\n"));
  if (lower === "power off" || lower === "shutdown system") {
    return result({ ...device, powerOn: false, runtime: { ...emptyRuntime(), clock: device.runtime.clock } }, { mode: "exec" }, "System halted.\n전원이 꺼졌습니다.");
  }
  if (lower === "power cycle") {
    const booted = bootDevice({ ...device, powerOn: true });
    const nextSession = bootSession(booted);
    return result(booted, nextSession, appendConsoleAuthPrompt(`System halted.\n${bootBanner(device)}`, nextSession));
  }
  if (lower === "power on" || lower === "boot") return result(device, session, "System is already powered on.");
  if (lower === "configure terminal" || lower === "conf t") {
    if (session.mode !== "privileged") return result(device, session, "% 먼저 enable 명령으로 privileged EXEC 모드에 들어가세요.");
    return result(device, { mode: "global" }, "Enter configuration commands, one per line. End with CNTL/Z.");
  }
  if (lower.startsWith("clock set ")) {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    const clock = command.slice("clock set ".length).trim();
    if (!clock) return result(device, session, "% Usage: clock set <hh:mm:ss> <month> <day> <year>");
    return result({ ...device, runtime: { ...device.runtime, clock } }, session, "");
  }
  if (lower.startsWith("terminal length ")) {
    const length = numberAfter(command, "terminal length");
    if (!Number.isInteger(length) || length < 0 || length > 512) return result(device, session, "% Terminal length must be 0-512.");
    return result(device, { ...session, terminalLength: length }, "");
  }
  if (lower.startsWith("terminal width ")) {
    const width = numberAfter(command, "terminal width");
    if (!Number.isInteger(width) || width < 40 || width > 512) return result(device, session, "% Terminal width must be 40-512.");
    return result(device, { ...session, terminalWidth: width }, "");
  }
  if (lower === "terminal monitor") return result(device, { ...session, terminalMonitor: true }, "");
  if (lower === "terminal no monitor" || lower === "terminal no-monitor") return result(device, { ...session, terminalMonitor: false }, "");
  if (lower.startsWith("terminal ")) return result(device, session, "");
  if (lower === "write memory" || lower === "wr" || lower === "copy running-config startup-config") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    const startupConfig = configurationLines(device);
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
  if (lower === "show debugging") return result(device, session, debuggingStatus(session));
  if (lower.startsWith("debug ")) {
    if (session.mode !== "privileged") return result(device, session, "% Debug commands require privileged EXEC mode.");
    const flag = command.slice("debug ".length).trim() || "all";
    return result(device, { ...session, debugFlags: unique([...(session.debugFlags ?? []), flag]) }, `${flag} debugging is on`);
  }
  if (lower === "undebug all" || lower === "u all" || lower === "no debug all") {
    if (session.mode !== "privileged") return result(device, session, "% Debug commands require privileged EXEC mode.");
    return result(device, { ...session, debugFlags: [] }, "All possible debugging has been turned off");
  }
  if (lower.startsWith("test ")) {
    if (session.mode !== "privileged") return result(device, session, "% Test commands require privileged EXEC mode.");
    return testCommand(device, session, command, lower);
  }

  if (session.mode === "global") return globalCommand(device, session, command, lower);
  if (session.mode === "interface") return interfaceCommand(device, session, command, lower);
  if (session.mode === "vlan") return vlanCommand(device, session, command, lower);
  if (session.mode === "dhcp") return dhcpCommand(device, session, command, lower);
  if (session.mode === "line") return lineCommand(device, session, command, lower);
  if (session.mode === "router") return routerCommand(device, session, command, lower);
  if (session.mode === "acl") return aclCommand(device, session, command, lower);
  if (session.mode === "route-map") return routeMapCommand(device, session, command, lower);
  if (session.mode === "ip-sla") return ipSlaCommand(device, session, command, lower);

  if (lower.startsWith("show ")) {
    const showTarget = lower.split("|")[0].trim();
    if (session.mode === "exec" && privilegedShowCommands.some((item) => showTarget === item || showTarget.startsWith(`${item} `))) {
      return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    }
    return result(device, session, applyPipe(showCommand(device, showTarget, session), command));
  }
  if (lower.startsWith("clear ")) {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return clearCommand(device, session, lower);
  }
  if (lower === "dir" || lower === "dir flash:" || lower === "show flash" || lower === "show flash:") {
    if (session.mode !== "privileged") return result(device, session, "% Privileged EXEC 모드에서만 사용할 수 있습니다. enable을 입력하세요.");
    return result(device, session, flashDirectory(device));
  }

  return result(device, session, invalidInput(command));
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

function invalidInput(command: string, markerIndex = 0): string {
  const marker = `${" ".repeat(Math.max(0, markerIndex))}^`;
  return `${command}\n${marker}\n% Invalid input detected at '^' marker.`;
}

function commandCandidates(device: NetworkDevice, session: CliSession): string[] {
  if (!device.powerOn) return ["power on", "boot", "show version"];
  if (session.pendingAction === "enable-password" || session.pendingAction === "console-username" || session.pendingAction === "console-password") return [];
  if (session.pendingAction) return ["", "yes", "no"];
  const base = session.mode === "exec"
      ? ["enable", "setup", "show version", "show boot", "show inventory", "show platform", "show tech-support", "show clock", "show privilege", "show history", "show debugging", "show interfaces", "show ip interface brief", "show ip route", "show route", "show cdp", "show cdp neighbors", "show arp", "ping ", "traceroute ", "terminal length 0", "help"]
    : session.mode === "privileged"
      ? ["disable", "setup", "configure terminal", "conf t", "show running-config", "show running-config all", "show startup-config", "show version", "show boot", "show inventory", "show platform", "show module", "show environment", "show tech-support", "show clock", "clock set 12:34:56 Jun 19 2026", "show privilege", "show history", "show debugging", "show logging", "show service logs", "show service logs http", "show service logs ftp", "show service logs email", "show service logs tftp", "show service logs syslog", "show services", "show services enabled", "show services disabled", "show users", "show line", "show terminal", "show protocols", "show file systems", "show flash", "dir", "show processes cpu", "show memory", "show controllers", "show controllers serial", "show cable-diagnostics tdr", "show spanning-tree", "show standby", "show standby brief", "show vrrp", "show vrrp brief", "show interfaces", "show interfaces counters", "show interfaces description", "show interfaces status", "show interfaces trunk", "show interfaces switchport", "show ip interface", "show ip interface brief", "show ip ssh", "show ip route", "show ip route summary", "show ip route connected", "show ip route interface ", "show ip route gateway ", "show ip route local", "show ip route static", "show route", "show route-map", "show route-map ", "show ip prefix-list", "show ip prefix-list ", "show ip protocols", "show ip protocols ospf", "show ip protocols eigrp", "show ip protocols static", "show ip ospf", "show ip ospf neighbor", "show ip ospf interface brief", "show ip eigrp neighbors", "show ip rip database", "show ip nat translations", "show ip nat statistics", "show vlan brief", "show vlan summary", "show vlan id ", "show vlan name ", "show mac address-table", "show mac address-table address ", "show mac address-table dynamic", "show mac address-table interface ", "show cdp neighbors", "show cdp neighbors detail", "show arp", "show arp ", "show ip dhcp binding", "show ip dhcp binding ", "show ip dhcp conflict", "show ip dhcp pool", "show ip dhcp pool ", "show ip dhcp server statistics", "show hosts", "show hosts ", "show access-list", "show ip access-lists", "show nat", "test cable-diagnostics tdr interface ", "debug ip icmp", "debug ip packet", "debug ip dhcp server events", "debug spanning-tree events", "undebug all", "clear arp", "clear arp-cache", "clear arp 192.168.1.10", "clear logging", "clear service logs", "clear service logs http", "clear service logs ftp", "clear service logs email", "clear service logs tftp", "clear service logs syslog", "clear mac address-table", "clear mac address-table dynamic", "clear mac address-table dynamic interface ", "clear mac address-table vlan ", "clear ip dhcp binding", "clear ip dhcp binding *", "clear ip dhcp conflict *", "write memory", "wr", "copy running-config startup-config", "copy run start", "copy startup-config running-config", "copy start run", "reload", "reboot", "erase startup-config", "write erase", "terminal length 0", "power off", "power cycle", "ping ", "traceroute ", "help"]
      : session.mode === "global"
        ? ["hostname ", "enable secret ", "enable password ", "no enable secret", "banner motd #", "no banner motd", "username admin secret cisco", "no username ", "interface ", "int ", "interface range fa0/1 - 2", "default interface ", "vlan ", "no vlan ", "spanning-tree vlan 1 root primary", "no spanning-tree vlan 1 root primary", "line console 0", "line vty 0 4", "router rip", "router ospf 1", "router eigrp 1", "route-map PBR permit 10", "no route-map PBR", "ip prefix-list DST30 seq 5 permit 10.30.0.0/24", "no ip prefix-list DST30", "ip route ", "ip route 10.20.0.0 255.255.255.0 192.168.10.1 200", "no ip route ", "ip default-gateway ", "no ip default-gateway", "ip domain-name lab.local", "no ip domain-name", "ip name-server 8.8.8.8", "no ip name-server ", "ip ssh version 2", "ip domain-lookup", "no ip domain-lookup", "crypto key generate rsa modulus 1024", "crypto key zeroize rsa", "logging host 192.168.1.100", "logging trap warnings", "logging buffered", "no logging console", "ip dhcp excluded-address 192.168.1.1 192.168.1.20", "ip dhcp pool ", "no ip dhcp excluded-address ", "no ip dhcp pool ", "ip host ", "no ip host ", "ip nat inside source static 192.168.1.10 203.0.113.10", "ip nat inside source list 10 interface fa0/1 overload", "no ip nat inside source static ", "no ip nat inside source list 10 interface fa0/1 overload", "ip access-list standard ", "ip access-list extended ", "ip access-list resequence WEB-FILTER 10 10", "no ip access-list extended ", "access-list 101 remark campus edge", "access-list 101 permit ip any any", "access-list 10 permit 192.168.1.0 0.0.0.255", "no access-list ", "nat ", "no nat ", "service password-encryption", "no service password-encryption", "service dhcp", "no service dhcp", "service dns", "no service dns", "service http", "no service http", "service ftp", "no service ftp", "service email", "no service email", "service tftp", "no service tftp", "service syslog", "no service syslog", "do show ip route", "do show route-map", "do show ip prefix-list", "do show running-config", "do write memory", "end", "exit", "help"]
      : session.mode === "interface"
          ? ["description ", "desc ", "no description", "encapsulation dot1Q 10", "encapsulation dot1Q 10 native", "no encapsulation dot1Q", "ip address ", "ip address 192.168.20.1 255.255.255.0 secondary", "ip add ", "no ip address", "no ip address 192.168.20.1 255.255.255.0 secondary", "duplex auto", "duplex full", "duplex half", "no duplex", "speed auto", "speed 100", "no speed", "mtu 1500", "no mtu", "bandwidth 100000", "no bandwidth", "ip helper-address ", "no ip helper-address ", "ip policy route-map PBR", "no ip policy route-map", "ip nat inside", "ip nat outside", "no ip nat inside", "no ip nat outside", "ip access-group 101 in", "ip access-group 101 out", "no ip access-group 101 in", "standby 1 ip 192.168.10.254", "standby 1 priority 110", "standby 1 preempt", "standby 1 version 2", "standby 1 track fa0/2 decrement 20", "vrrp 1 ip 192.168.10.253", "vrrp 1 priority 120", "vrrp 1 preempt", "vrrp 1 version 3", "vrrp 1 timers advertise 2", "vrrp 1 track 1 decrement 20", "no standby 1", "no standby 1 preempt", "no vrrp 1", "no vrrp 1 preempt", "shutdown", "shut", "no shutdown", "no shut", "switchport mode access", "switchport mode trunk", "switchport access vlan ", "switchport trunk native vlan ", "switchport trunk allowed vlan ", "switchport nonegotiate", "no switchport nonegotiate", "no switchport", "spanning-tree portfast", "no spanning-tree portfast", "spanning-tree bpduguard enable", "spanning-tree bpduguard disable", "clock rate ", "no clock rate", "do show ip interface brief", "do show running-config interface ", "end", "exit", "help"]
          : session.mode === "vlan"
            ? ["name ", "end", "exit", "help"]
            : session.mode === "dhcp"
              ? ["network ", "default-router ", "dns-server ", "start-ip ", "max-leases ", "shutdown", "no shutdown", "end", "exit", "help"]
              : session.mode === "line"
                ? ["password ", "login", "login local", "no login", "transport input all", "transport input ssh", "transport input telnet", "transport input none", "exec-timeout 10 0", "logging synchronous", "no logging synchronous", "end", "exit", "help"]
                : session.mode === "router"
                  ? ["network ", "router-id 1.1.1.1", "version 2", "auto-summary", "no auto-summary", "passive-interface default", "no passive-interface default", "passive-interface ", "no passive-interface ", "default-information originate", "default-information originate always", "no default-information originate", "redistribute static", "no redistribute static", "end", "exit", "help"]
                  : session.mode === "ip-sla"
                    ? ["icmp-echo 8.8.8.8", "icmp-echo 8.8.8.8 source-interface fa0/0", "frequency 10", "timeout 1000", "threshold 1000", "shutdown", "no shutdown", "do show ip sla summary", "do show track", "end", "exit", "help"]
                    : session.mode === "route-map"
                      ? ["description policy routing for branch traffic", "match ip address 101", "match ip address prefix-list DST30", "no match ip address 101", "no match ip address prefix-list DST30", "set ip next-hop 192.168.1.2", "no set ip next-hop", "do show route-map", "end", "exit", "help"]
                  : session.aclType === "standard"
                    ? ["5 remark trusted sources", "10 permit any", "permit host ", "permit 192.168.1.0 0.0.0.255", "deny any", "deny host ", "no 10", "do show access-lists", "end", "exit", "help"]
                      : ["5 remark web access", "10 permit ip any any", "deny ip any any", "permit tcp any host 192.168.1.10 eq 80", "permit icmp any any", "no 10", "do show access-lists", "end", "exit", "help"];
  return unique([...base, ...featureCommandCandidates(device, session), ...device.ports.flatMap((port) => [`interface ${port.name}`, `int ${shortPortAlias(port.name)}`, `show interface ${port.name}`, `show interface ${port.name} counters`, `show interface ${port.name} status`, `show interface ${port.name} switchport`, `show cable-diagnostics tdr interface ${port.name}`, `test cable-diagnostics tdr interface ${port.name}`, `show cdp interface ${port.name}`, `show port-security interface ${port.name}`])]);
}

function featureCommandCandidates(device: NetworkDevice, session: CliSession): string[] {
  if (session.mode === "privileged") {
    return [
      "show cdp",
      "show cdp interface",
      "show cdp neighbors",
      "show cdp neighbors detail",
      "show lldp",
      "show lldp interface",
      "show lldp neighbors",
      "show lldp neighbors detail",
      "show ip dhcp snooping",
      "show ip dhcp snooping binding",
      "show vtp status",
      "show vtp counters",
      "show vtp password",
      "show standby",
      "show standby brief",
      "show vrrp",
      "show vrrp brief",
      "show route-map",
      "show route-map PBR",
      "show ip prefix-list",
      "show ip prefix-list DST30",
      "show ip sla summary",
      "show ip sla configuration",
      "show track",
      "show errdisable recovery",
      "show etherchannel summary",
      "show etherchannel port-channel",
      "show etherchannel 1 detail",
      "show port-security",
      "show port-security address",
      "show port-security interface "
    ];
  }
  if (session.mode === "global") {
    return [
      "cdp run",
      "no cdp run",
      "cdp timer 60",
      "cdp holdtime 180",
      "cdp advertise-v2",
      "no cdp advertise-v2",
      "lldp run",
      "no lldp run",
      "lldp timer 30",
      "lldp holdtime 120",
      "ip dhcp snooping",
      "no ip dhcp snooping",
      "ip dhcp snooping vlan 10,20",
      "ip dhcp snooping verify mac-address",
      "no ip dhcp snooping verify mac-address",
      "vtp domain LAB",
      "vtp mode server",
      "vtp mode client",
      "vtp mode transparent",
      "vtp version 2",
      "vtp pruning",
      "no vtp pruning",
      "vtp password cisco",
      "no vtp password",
      "spanning-tree mode rapid-pvst",
      "spanning-tree vlan 10 root secondary",
      "errdisable recovery cause bpduguard",
      "errdisable recovery interval 300",
      "route-map PBR permit 10",
      "no route-map PBR",
      "ip prefix-list DST30 seq 5 permit 10.30.0.0/24",
      "ip prefix-list BRANCH permit 10.0.0.0/8 le 24",
      "no ip prefix-list DST30",
      "ip sla 1",
      "ip sla schedule 1 life forever start-time now",
      "no ip sla 1",
      "track 1 ip sla 1 reachability",
      "track 2 interface fa0/1 line-protocol",
      "no track 1"
    ];
  }
  if (session.mode === "interface") {
    return [
      "cdp enable",
      "no cdp enable",
      "encapsulation dot1Q 10",
      "encapsulation dot1Q 10 native",
      "no encapsulation dot1Q",
      "ip address 192.168.20.1 255.255.255.0 secondary",
      "no ip address 192.168.20.1 255.255.255.0 secondary",
      "ip policy route-map PBR",
      "no ip policy route-map",
      "switchport voice vlan ",
      "no switchport voice vlan",
      "switchport port-security",
      "no switchport port-security",
      "switchport port-security maximum 2",
      "switchport port-security violation restrict",
      "switchport port-security mac-address sticky",
      "switchport port-security mac-address 0200.1111.2222",
      "channel-group 1 mode active",
      "channel-group 1 mode on",
      "no channel-group",
      "lldp transmit",
      "lldp receive",
      "no lldp transmit",
      "no lldp receive",
      "ip dhcp snooping trust",
      "no ip dhcp snooping trust",
      "ip dhcp snooping limit rate 15",
      "no ip dhcp snooping limit rate",
      "standby 1 ip 192.168.10.254",
      "standby 1 priority 110",
      "standby 1 preempt",
      "standby 1 version 2",
      "standby 1 track fa0/2 decrement 20",
      "vrrp 1 ip 192.168.10.253",
      "vrrp 1 priority 120",
      "vrrp 1 version 3",
      "vrrp 1 timers advertise 2",
      "vrrp 1 track 1 decrement 20",
      "no standby 1",
      "no standby 1 preempt",
      "no standby 1 track",
      "no vrrp 1",
      "no vrrp 1 preempt",
      "no vrrp 1 track",
      "spanning-tree cost 19",
      "spanning-tree port-priority 64",
      "no spanning-tree cost",
      "no spanning-tree port-priority"
    ];
  }
  return [];
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

  if (session.mode === "route-map" && isAbbrev(first, "match", 3)) return expandMatchCommand(rest);
  if (session.mode === "route-map" && isAbbrev(first, "set", 2)) return expandSetCommand(rest);
  if (session.mode === "ip-sla" && isAbbrev(first, "icmp-echo", 4)) return `icmp-echo ${rest.join(" ")}`;
  if (session.mode === "ip-sla" && isAbbrev(first, "frequency", 4)) return `frequency ${rest.join(" ")}`;
  if (session.mode === "ip-sla" && isAbbrev(first, "timeout", 4)) return `timeout ${rest.join(" ")}`;
  if (session.mode === "ip-sla" && isAbbrev(first, "threshold", 4)) return `threshold ${rest.join(" ")}`;
  if (session.mode === "exec" && isAbbrev(first, "enable", 2)) return "enable";
  if (session.mode === "global" && isAbbrev(first, "enable", 2)) return expandEnableCommand(rest);
  if (isAbbrev(first, "disable", 3)) return "disable";
  if (session.mode !== "exec" && isAbbrev(first, "end", 2)) return "end";
  if (isAbbrev(first, "exit", 2)) return "exit";
  if (isAbbrev(first, "configure", 3)) {
    if (isAbbrev(lowerRest[0], "terminal")) return "configure terminal";
  }
  if (isAbbrev(first, "terminal", 4)) return expandTerminalCommand(rest);
  if (session.mode !== "interface" && isAbbrev(first, "clock", 2)) {
    if (isAbbrev(lowerRest[0], "set", 1)) return `clock set ${rest.slice(1).join(" ")}`;
    return `clock ${rest.join(" ")}`;
  }
  if (isAbbrev(first, "debug", 3)) return `debug ${rest.join(" ")}`;
  if (first === "u" || isAbbrev(first, "undebug", 2)) return rest.length ? `undebug ${rest.join(" ")}` : "undebug all";
  if (isAbbrev(first, "setup", 3)) return "setup";
  if (first === "wr" || isAbbrev(first, "write", 2)) return expandWriteCommand(rest);
  if (isAbbrev(first, "erase", 2)) return expandEraseCommand(rest);
  if (isAbbrev(first, "copy", 2) && rest.length) return expandCopyCommand(rest);
  if (first === "dir") return rest.length ? `dir ${rest.join(" ")}` : "dir";
  if (isAbbrev(first, "show", 2) && rest.length) return expandShowCommand(rest);
  if (isAbbrev(first, "test", 2)) return expandTestCommand(rest);
  if (isAbbrev(first, "interface", 3) || first === "int") return `interface ${rest.join(" ")}`;
  if (isAbbrev(first, "hostname", 4)) return `hostname ${rest.join(" ")}`;
  if (isAbbrev(first, "username", 4)) return `username ${rest.join(" ")}`;
  if (isAbbrev(first, "crypto", 3)) return expandCryptoCommand(rest);
  if (isAbbrev(first, "logging", 3)) return `logging ${rest.join(" ")}`;
  if (isAbbrev(first, "errdisable", 3)) return expandErrdisableCommand(rest);
  if (isAbbrev(first, "default", 3)) return expandDefaultCommand(rest);
  if (isAbbrev(first, "banner", 3)) return expandBannerCommand(rest);
  if (isAbbrev(first, "line", 2)) return expandLineCommand(rest);
  if (isAbbrev(first, "router", 3)) return expandRouterCommand(rest);
  if (isAbbrev(first, "route-map", 5)) return expandRouteMapCommand(rest);
  if (isAbbrev(first, "track", 3)) return expandTrackCommand(rest);
  if (isAbbrev(first, "description", 4) || first === "desc") return `description ${rest.join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "duplex", 3)) return `duplex ${rest.join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "encapsulation", 3)) return expandEncapsulationCommand(rest);
  if (session.mode === "interface" && isAbbrev(first, "speed", 2)) return `speed ${rest.join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "mtu", 3)) return `mtu ${rest.join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "bandwidth", 4)) return `bandwidth ${rest.join(" ")}`;
  if ((session.mode === "acl") && (first === "permit" || first === "deny" || /^\d+$/.test(first))) return command;
  if (isAbbrev(first, "shutdown", 2)) return "shutdown";
  if (first === "no") return expandNoCommand(rest);
  if (first === "ip") return expandIpCommand(rest, session);
  if (isAbbrev(first, "switchport", 2)) return expandSwitchportCommand(tokens);
  if (isAbbrev(first, "spanning-tree", 2)) return expandSpanningTreeCommand(tokens);
  if (session.mode === "interface" && isAbbrev(first, "standby", 3)) return expandStandbyCommand(tokens);
  if (session.mode === "interface" && isAbbrev(first, "vrrp", 3)) return expandVrrpCommand(tokens);
  if (isAbbrev(first, "channel-group", 3)) return expandChannelGroupCommand(rest);
  if (isAbbrev(first, "cdp", 3)) return expandCdpCommand(rest);
  if (isAbbrev(first, "lldp", 3)) return expandLldpCommand(rest);
  if (isAbbrev(first, "vtp", 3)) return expandVtpCommand(rest);
  if (isAbbrev(first, "vlan", 1)) return `vlan ${rest.join(" ")}`;
  if (session.mode === "router" && isAbbrev(first, "passive-interface", 4)) return `passive-interface ${rest.join(" ")}`;
  if (session.mode === "router" && isAbbrev(first, "default-information", 3) && isAbbrev(lowerRest[0], "originate", 3)) return lowerRest[1]?.startsWith("al") ? "default-information originate always" : "default-information originate";
  if (session.mode === "router" && isAbbrev(first, "redistribute", 3)) return `redistribute ${rest.join(" ")}`;
  if (session.mode === "route-map" && isAbbrev(first, "match", 3)) return expandMatchCommand(rest);
  if (session.mode === "route-map" && isAbbrev(first, "set", 2)) return expandSetCommand(rest);
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

function expandTestCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "cable-diagnostics", 5) && isAbbrev(lowerRest[1], "tdr", 1) && (isAbbrev(lowerRest[2], "interface", 3) || lowerRest[2] === "int")) {
    return `test cable-diagnostics tdr interface ${rest.slice(3).join(" ")}`;
  }
  return `test ${rest.join(" ")}`;
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

function expandCryptoCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "key", 1) && isAbbrev(lowerRest[1], "generate", 3) && isAbbrev(lowerRest[2], "rsa", 2)) {
    const modulusIndex = lowerRest.findIndex((token) => isAbbrev(token, "modulus", 3));
    return `crypto key generate rsa modulus ${modulusIndex >= 0 ? rest[modulusIndex + 1] ?? "1024" : "1024"}`;
  }
  if (isAbbrev(lowerRest[0], "key", 1) && isAbbrev(lowerRest[1], "zeroize", 3) && isAbbrev(lowerRest[2], "rsa", 2)) return "crypto key zeroize rsa";
  return `crypto ${rest.join(" ")}`;
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

function expandRouteMapCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const name = rest[0] ?? "";
  const action = lowerRest[1] === "deny" || isAbbrev(lowerRest[1], "deny")
    ? "deny"
    : lowerRest[1] === "permit" || isAbbrev(lowerRest[1], "permit")
      ? "permit"
      : "";
  if (name && action) return `route-map ${name} ${action} ${rest[2] ?? "10"}`;
  return `route-map ${rest.join(" ")}`;
}

function expandTrackCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const id = rest[0] ?? "";
  if (isAbbrev(lowerRest[1], "ip", 1) && isAbbrev(lowerRest[2], "sla", 1)) return `track ${id} ip sla ${rest[3] ?? ""} reachability`.trim();
  if (isAbbrev(lowerRest[1], "interface", 3) || lowerRest[1] === "int") {
    const modeIndex = lowerRest.findIndex((token) => isAbbrev(token, "line-protocol", 4));
    const interfaceName = modeIndex >= 0 ? rest.slice(2, modeIndex).join(" ") : rest.slice(2).join(" ");
    return `track ${id} interface ${interfaceName} line-protocol`.trim();
  }
  return `track ${rest.join(" ")}`;
}

function expandMatchCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "ip", 1) && isAbbrev(lowerRest[1], "address", 3) && isAbbrev(lowerRest[2], "prefix-list", 4)) return `match ip address prefix-list ${rest.slice(3).join(" ")}`;
  if (isAbbrev(lowerRest[0], "ip", 1) && isAbbrev(lowerRest[1], "address", 3)) return `match ip address ${rest.slice(2).join(" ")}`;
  return `match ${rest.join(" ")}`;
}

function expandSetCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "ip", 1) && isAbbrev(lowerRest[1], "next-hop", 4)) return `set ip next-hop ${rest.slice(2).join(" ")}`;
  return `set ${rest.join(" ")}`;
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
  if (isAbbrev(first, "encapsulation", 3)) return "no encapsulation dot1Q";
  if (isAbbrev(first, "duplex", 3)) return "no duplex";
  if (isAbbrev(first, "speed", 2)) return "no speed";
  if (isAbbrev(first, "mtu", 3)) return "no mtu";
  if (isAbbrev(first, "bandwidth", 4)) return "no bandwidth";
  if (isAbbrev(first, "switchport", 2) && isAbbrev(lowerRest[1], "trunk", 2) && isAbbrev(lowerRest[2], "native", 3)) return "no switchport trunk native vlan";
  if (isAbbrev(first, "switchport", 2) && isAbbrev(lowerRest[1], "nonegotiate", 4)) return "no switchport nonegotiate";
  if (isAbbrev(first, "switchport", 2) && isAbbrev(lowerRest[1], "voice", 2)) return "no switchport voice vlan";
  if (isAbbrev(first, "switchport", 2) && isAbbrev(lowerRest[1], "port-security", 2)) return "no switchport port-security";
  if (isAbbrev(first, "switchport", 2)) return "no switchport";
  if (isAbbrev(first, "channel-group", 3)) return "no channel-group";
  if (isAbbrev(first, "standby", 3)) return expandNoStandbyCommand(rest.slice(1));
  if (isAbbrev(first, "vrrp", 3)) return expandNoVrrpCommand(rest.slice(1));
  if (isAbbrev(first, "spanning-tree", 2) && isAbbrev(lowerRest[1], "vlan") && lowerRest.includes("root") && (lowerRest.includes("primary") || lowerRest.includes("secondary"))) {
    const role = lowerRest.includes("secondary") ? "secondary" : "primary";
    return `no spanning-tree vlan ${rest.slice(2, rest.findIndex((token) => token.toLowerCase() === "root")).join(" ")} root ${role}`;
  }
  if (isAbbrev(first, "spanning-tree", 2) && isAbbrev(lowerRest[1], "portfast", 4)) return "no spanning-tree portfast";
  if (isAbbrev(first, "spanning-tree", 2) && isAbbrev(lowerRest[1], "cost", 2)) return "no spanning-tree cost";
  if (isAbbrev(first, "spanning-tree", 2) && isAbbrev(lowerRest[1], "port-priority", 6)) return "no spanning-tree port-priority";
  if (isAbbrev(first, "enable", 2)) {
    if (isAbbrev(lowerRest[1], "secret")) return "no enable secret";
    if (isAbbrev(lowerRest[1], "password")) return "no enable password";
  }
  if (isAbbrev(first, "username", 4)) return `no username ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "banner", 3) && isAbbrev(lowerRest[1], "motd")) return "no banner motd";
  if (first === "ip") {
    if (isAbbrev(lowerRest[1], "address")) return rest.length > 2 ? `no ip address ${rest.slice(2).join(" ")}` : "no ip address";
    if (isAbbrev(lowerRest[1], "helper-address", 4)) return `no ip helper-address ${rest.slice(2).join(" ")}`.trim();
    if (isAbbrev(lowerRest[1], "route")) return `no ip route ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "default-gateway", 3)) return "no ip default-gateway";
    if (isAbbrev(lowerRest[1], "domain-name", 3)) return "no ip domain-name";
    if (isAbbrev(lowerRest[1], "name-server", 3)) return `no ip name-server ${rest.slice(2).join(" ")}`.trim();
    if (isAbbrev(lowerRest[1], "domain-lookup", 3)) return "no ip domain-lookup";
    if (isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "excluded-address", 3)) return `no ip dhcp excluded-address ${rest.slice(3).join(" ")}`;
    if (isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "pool")) return `no ip dhcp pool ${rest.slice(3).join(" ")}`;
    if (isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "snooping", 3)) return expandNoIpDhcpSnoopingCommand(rest.slice(3));
    if (isAbbrev(lowerRest[1], "sla", 1)) return `no ip sla ${rest.slice(2).join(" ")}`.trim();
    if (isAbbrev(lowerRest[1], "host")) return `no ip host ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "access-group", 3)) return `no ip access-group ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "policy", 3) && isAbbrev(lowerRest[2], "route-map", 5)) return `no ip policy route-map ${rest.slice(3).join(" ")}`.trim();
    if (isAbbrev(lowerRest[1], "access-list", 3)) return `no ip access-list ${rest.slice(2).join(" ")}`;
    if (isAbbrev(lowerRest[1], "prefix-list", 4)) return `no ip prefix-list ${rest.slice(2).join(" ")}`.trim();
    if (isAbbrev(lowerRest[1], "nat", 2)) return `no ip nat ${rest.slice(2).join(" ")}`;
  }
  if (isAbbrev(first, "vlan")) return `no vlan ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "access-list", 3)) return `no access-list ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "track", 3)) return `no track ${rest.slice(1).join(" ")}`.trim();
  if (first === "nat") return `no nat ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "cdp", 3)) {
    if (isAbbrev(lowerRest[1], "run", 2)) return "no cdp run";
    if (isAbbrev(lowerRest[1], "advertise-v2", 3)) return "no cdp advertise-v2";
    if (isAbbrev(lowerRest[1], "enable", 2)) return "no cdp enable";
  }
  if (isAbbrev(first, "lldp", 3)) {
    if (isAbbrev(lowerRest[1], "run", 2)) return "no lldp run";
    if (isAbbrev(lowerRest[1], "transmit", 2)) return "no lldp transmit";
    if (isAbbrev(lowerRest[1], "receive", 2)) return "no lldp receive";
  }
  if (isAbbrev(first, "vtp", 3)) {
    if (isAbbrev(lowerRest[1], "pruning", 3)) return "no vtp pruning";
    if (isAbbrev(lowerRest[1], "password", 4)) return "no vtp password";
    if (isAbbrev(lowerRest[1], "domain", 3)) return "no vtp domain";
  }
  if (isAbbrev(first, "service", 3)) return `no service ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "errdisable", 3) && isAbbrev(lowerRest[1], "recovery", 3) && isAbbrev(lowerRest[2], "cause", 2) && isAbbrev(lowerRest[3], "bpduguard", 4)) return "no errdisable recovery cause bpduguard";
  if (isAbbrev(first, "clock")) return "no clock rate";
  if (isAbbrev(first, "passive-interface", 4)) return `no passive-interface ${rest.slice(1).join(" ")}`.trim();
  if (isAbbrev(first, "default-information", 3)) return "no default-information originate";
  if (isAbbrev(first, "route-map", 5)) return `no route-map ${rest.slice(1).join(" ")}`.trim();
  if (isAbbrev(first, "match", 3)) return `no ${expandMatchCommand(rest.slice(1))}`.trim();
  if (isAbbrev(first, "set", 2)) return `no ${expandSetCommand(rest.slice(1))}`.trim();
  return `no ${rest.join(" ")}`;
}

function expandIpCommand(rest: string[], session: CliSession): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  if (session.mode === "interface" && isAbbrev(first, "address")) return `ip address ${rest.slice(1).join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "helper-address", 4)) return `ip helper-address ${rest.slice(1).join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "access-group", 3)) return `ip access-group ${rest.slice(1).join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "policy", 3) && isAbbrev(lowerRest[1], "route-map", 5)) return `ip policy route-map ${rest.slice(2).join(" ")}`;
  if (session.mode === "interface" && isAbbrev(first, "dhcp") && isAbbrev(lowerRest[1], "snooping", 3)) return expandIpDhcpSnoopingCommand(rest.slice(1), true);
  if (isAbbrev(first, "route")) return `ip route ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "default-gateway", 3)) return `ip default-gateway ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "domain-name", 3)) return `ip domain-name ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "name-server", 3)) return `ip name-server ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "ssh", 2) && isAbbrev(lowerRest[1], "version", 3)) return `ip ssh version ${rest[2] ?? "2"}`;
  if (isAbbrev(first, "domain-lookup", 3)) return "ip domain-lookup";
  if (isAbbrev(first, "host")) return `ip host ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "dhcp") && isAbbrev(lowerRest[1], "excluded-address", 3)) return `ip dhcp excluded-address ${rest.slice(2).join(" ")}`;
  if (isAbbrev(first, "dhcp") && isAbbrev(lowerRest[1], "pool")) return `ip dhcp pool ${rest.slice(2).join(" ")}`;
  if (isAbbrev(first, "dhcp") && isAbbrev(lowerRest[1], "snooping", 3)) return expandIpDhcpSnoopingCommand(rest.slice(1), false);
  if (isAbbrev(first, "sla", 1)) return `ip sla ${rest.slice(1).join(" ")}`.trim();
  if (isAbbrev(first, "access-list", 3) && isAbbrev(lowerRest[1], "resequence", 3)) return `ip access-list resequence ${rest.slice(2).join(" ")}`;
  if (isAbbrev(first, "access-list", 3)) return `ip access-list ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "prefix-list", 4)) return `ip prefix-list ${rest.slice(1).join(" ")}`;
  if (isAbbrev(first, "nat", 2)) return `ip nat ${rest.slice(1).join(" ")}`;
  return `ip ${rest.join(" ")}`;
}

function expandClearCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const first = lowerRest[0] ?? "";
  if (isAbbrev(first, "arp") || (first === "ip" && isAbbrev(lowerRest[1], "arp"))) {
    const suffix = first === "ip" ? rest.slice(2) : rest.slice(1);
    return `clear arp ${suffix.join(" ")}`.trim();
  }
  if (isAbbrev(first, "mac") || first === "mac-address-table") {
    const suffix = first === "mac-address-table"
      ? rest.slice(1)
      : isAbbrev(lowerRest[1], "address-table", 1)
        ? rest.slice(2)
        : rest.slice(1);
    return `clear mac address-table ${suffix.join(" ")}`.trim();
  }
  if (first === "ip" && isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "binding")) return `clear ip dhcp binding ${rest.slice(3).join(" ")}`.trim();
  if (first === "ip" && isAbbrev(lowerRest[1], "dhcp") && isAbbrev(lowerRest[2], "conflict", 4)) return "clear ip dhcp conflict *";
  if (first === "ip" && isAbbrev(lowerRest[1], "nat") && (isAbbrev(lowerRest[2], "translation", 5) || isAbbrev(lowerRest[2], "translations", 5))) return `clear ip nat translation ${rest.slice(3).join(" ") || "*"}`.trim();
  if (isAbbrev(first, "service", 3) && isAbbrev(lowerRest[1], "logs", 3)) return `clear service logs ${rest.slice(2).join(" ")}`.trim();
  return `clear ${rest.join(" ")}`;
}

function expandPowerCommand(rest: string[]): string {
  const first = rest[0]?.toLowerCase();
  if (isAbbrev(first, "on")) return "power on";
  if (isAbbrev(first, "off")) return "power off";
  if (isAbbrev(first, "cycle")) return "power cycle";
  return `power ${rest.join(" ")}`;
}

function expandCdpCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "run", 2)) return "cdp run";
  if (isAbbrev(lowerRest[0], "enable", 2)) return "cdp enable";
  if (isAbbrev(lowerRest[0], "timer", 2)) return `cdp timer ${rest[1] ?? "60"}`;
  if (isAbbrev(lowerRest[0], "holdtime", 2)) return `cdp holdtime ${rest[1] ?? "180"}`;
  if (isAbbrev(lowerRest[0], "advertise-v2", 3)) return "cdp advertise-v2";
  return `cdp ${rest.join(" ")}`;
}

function expandLldpCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "run", 2)) return "lldp run";
  if (isAbbrev(lowerRest[0], "timer", 2)) return `lldp timer ${rest[1] ?? "30"}`;
  if (isAbbrev(lowerRest[0], "holdtime", 2)) return `lldp holdtime ${rest[1] ?? "120"}`;
  if (isAbbrev(lowerRest[0], "reinit", 2)) return `lldp reinit ${rest[1] ?? "2"}`;
  if (isAbbrev(lowerRest[0], "transmit", 2)) return "lldp transmit";
  if (isAbbrev(lowerRest[0], "receive", 2)) return "lldp receive";
  return `lldp ${rest.join(" ")}`;
}

function expandErrdisableCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "recovery", 3) && isAbbrev(lowerRest[1], "cause", 2) && isAbbrev(lowerRest[2], "bpduguard", 4)) return "errdisable recovery cause bpduguard";
  if (isAbbrev(lowerRest[0], "recovery", 3) && isAbbrev(lowerRest[1], "interval", 3)) return `errdisable recovery interval ${rest[2] ?? ""}`.trim();
  return `errdisable ${rest.join(" ")}`;
}

function expandVtpCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "domain", 3)) return `vtp domain ${rest.slice(1).join(" ")}`;
  if (isAbbrev(lowerRest[0], "mode", 2)) return `vtp mode ${rest[1] ?? ""}`.trim();
  if (isAbbrev(lowerRest[0], "version", 3)) return `vtp version ${rest[1] ?? ""}`.trim();
  if (isAbbrev(lowerRest[0], "pruning", 3)) return "vtp pruning";
  if (isAbbrev(lowerRest[0], "password", 4)) return `vtp password ${rest.slice(1).join(" ")}`.trim();
  return `vtp ${rest.join(" ")}`;
}

function expandIpDhcpSnoopingCommand(rest: string[], interfaceMode: boolean): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (interfaceMode) {
    if (isAbbrev(lowerRest[1], "trust", 2)) return "ip dhcp snooping trust";
    if (isAbbrev(lowerRest[1], "limit", 2) && isAbbrev(lowerRest[2], "rate", 1)) return `ip dhcp snooping limit rate ${rest[3] ?? ""}`.trim();
    return `ip dhcp snooping ${rest.slice(1).join(" ")}`.trim();
  }
  if (!lowerRest[1]) return "ip dhcp snooping";
  if (isAbbrev(lowerRest[1], "vlan", 1)) return `ip dhcp snooping vlan ${rest.slice(2).join(" ")}`;
  if (isAbbrev(lowerRest[1], "verify", 3) && isAbbrev(lowerRest[2], "mac-address", 3)) return "ip dhcp snooping verify mac-address";
  return `ip dhcp snooping ${rest.slice(1).join(" ")}`.trim();
}

function expandNoIpDhcpSnoopingCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (!lowerRest[0]) return "no ip dhcp snooping";
  if (isAbbrev(lowerRest[0], "trust", 2)) return "no ip dhcp snooping trust";
  if (isAbbrev(lowerRest[0], "limit", 2) && isAbbrev(lowerRest[1], "rate", 1)) return "no ip dhcp snooping limit rate";
  if (isAbbrev(lowerRest[0], "vlan", 1)) return `no ip dhcp snooping vlan ${rest.slice(1).join(" ")}`;
  if (isAbbrev(lowerRest[0], "verify", 3) && isAbbrev(lowerRest[1], "mac-address", 3)) return "no ip dhcp snooping verify mac-address";
  return `no ip dhcp snooping ${rest.join(" ")}`.trim();
}

function expandChannelGroupCommand(rest: string[]): string {
  const groupId = rest[0] ?? "";
  const lowerRest = rest.map((token) => token.toLowerCase());
  const modeIndex = lowerRest.findIndex((token) => isAbbrev(token, "mode", 1));
  const mode = modeIndex >= 0 ? rest[modeIndex + 1] ?? "on" : "on";
  return `channel-group ${groupId} mode ${mode}`;
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
  if (isAbbrev(first, "debugging", 3)) return "show debugging";
  if (isAbbrev(first, "privilege", 3)) return "show privilege";
  if (isAbbrev(first, "startup-config", 3)) return "show startup-config";
  if (isAbbrev(first, "version", 3)) return "show version";
  if (isAbbrev(first, "boot", 2)) return "show boot";
  if (isAbbrev(first, "clock", 2)) return "show clock";
  if (isAbbrev(first, "inventory", 3)) return "show inventory";
  if (isAbbrev(first, "platform", 3)) return "show platform";
  if (isAbbrev(first, "module", 3)) return "show module";
  if (isAbbrev(first, "environment", 3) || isAbbrev(first, "env", 3)) return "show environment";
  if (isAbbrev(first, "errdisable", 3) && isAbbrev(second, "recovery", 3)) return "show errdisable recovery";
  if (isAbbrev(first, "logging", 3)) return "show logging";
  if (isAbbrev(first, "service", 4) && isAbbrev(second, "logs", 3)) return ["show service logs", ...rest.slice(2)].join(" ").trim();
  if (isAbbrev(first, "services", 4)) return ["show services", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "flash", 2)) return "show flash";
  if (isAbbrev(first, "file") && isAbbrev(second, "systems")) return "show file systems";
  if (isAbbrev(first, "processes", 3) && isAbbrev(second, "cpu")) return "show processes cpu";
  if (isAbbrev(first, "memory", 3)) return "show memory";
  if (isAbbrev(first, "controllers", 4)) return rest.length > 1 ? `show controllers ${rest.slice(1).join(" ")}` : "show controllers";
  if (isAbbrev(first, "cable-diagnostics", 5) && isAbbrev(second, "tdr", 1)) return ["show cable-diagnostics tdr", ...rest.slice(2)].join(" ").trim();
  if (isAbbrev(first, "spanning-tree", 2)) return ["show spanning-tree", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "standby", 3)) return ["show standby", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "vrrp", 3)) return ["show vrrp", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "users", 2)) return ["show users", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "line", 2)) return ["show line", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "terminal", 4)) return "show terminal";
  if (isAbbrev(first, "tech-support", 4) || (first === "tech" && isAbbrev(second, "support", 3))) return "show tech-support";
  if (isAbbrev(first, "protocols", 3)) return ["show protocols", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "track", 3)) return ["show track", ...rest.slice(1)].join(" ").trim();
  if (first === "route" || first === "ro") return "show ip route";
  if (first === "route-map" || first.startsWith("route-m")) return ["show route-map", ...rest.slice(1)].join(" ").trim();
  if (first === "arp") return ["show arp", ...rest.slice(1)].join(" ").trim();
  if (first === "host" || first === "hosts") return ["show hosts", ...rest.slice(1)].join(" ").trim();
  if (first === "nat") return "show nat";
  if (isAbbrev(first, "etherchannel", 5)) return ["show etherchannel", ...rest.slice(1)].join(" ").trim();
  if (isAbbrev(first, "port-security", 4)) return ["show port-security", ...rest.slice(1)].join(" ").trim();
  if (first === "vtp") return ["show vtp", ...rest.slice(1)].join(" ").trim() || "show vtp status";
  if (first === "lldp") {
    if (isAbbrev(second, "neighbors", 3)) return lowerRest[2]?.startsWith("det") ? "show lldp neighbors detail" : "show lldp neighbors";
    if (isAbbrev(second, "interface", 3)) return ["show lldp interface", ...rest.slice(2)].join(" ").trim();
    return "show lldp";
  }
  if (isAbbrev(first, "vlan")) {
    if (isAbbrev(second, "summary", 3)) return "show vlan summary";
    return lowerRest[1] ? `show vlan ${rest.slice(1).join(" ")}` : "show vlan brief";
  }
  if (isAbbrev(first, "mac")) return ["show mac address-table", ...rest.slice(1)].join(" ");
  if (isAbbrev(first, "access-list", 3) || first === "access-lists") return ["show access-list", ...rest.slice(1)].join(" ");
  if (first === "cdp") {
    if (isAbbrev(second, "neighbors", 3)) return lowerRest[2]?.startsWith("det") ? "show cdp neighbors detail" : "show cdp neighbors";
    if (isAbbrev(second, "interface", 3)) return ["show cdp interface", ...rest.slice(2)].join(" ").trim();
    return "show cdp";
  }
  if (first === "ip") {
    if (isAbbrev(second, "route", 2)) return ["show ip route", ...rest.slice(2)].join(" ");
    if (isAbbrev(second, "protocols", 3)) return ["show ip protocols", ...rest.slice(2)].join(" ").trim();
    if (isAbbrev(second, "ssh", 2)) return "show ip ssh";
    if (isAbbrev(second, "arp")) return ["show ip arp", ...rest.slice(2)].join(" ").trim();
    if (isAbbrev(second, "interface", 3)) {
      if (isAbbrev(lowerRest[2], "brief", 1)) return "show ip interface brief";
      if (rest.length > 2) return `show ip interface ${rest.slice(2).join(" ")}`;
      return "show ip interface";
    }
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "binding")) return ["show ip dhcp binding", ...rest.slice(3)].join(" ").trim();
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "conflict", 4)) return "show ip dhcp conflict";
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "pool")) return ["show ip dhcp pool", ...rest.slice(3)].join(" ").trim();
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "server") && isAbbrev(lowerRest[3], "statistics", 3)) return "show ip dhcp server statistics";
    if (isAbbrev(second, "dhcp") && isAbbrev(lowerRest[2], "snooping", 3)) return ["show ip dhcp snooping", ...rest.slice(3)].join(" ").trim();
    if (isAbbrev(second, "access-lists", 3) || isAbbrev(second, "access-list", 3)) return ["show access-list", ...rest.slice(2)].join(" ");
    if (isAbbrev(second, "prefix-list", 4)) return ["show ip prefix-list", ...rest.slice(2)].join(" ").trim();
    if (isAbbrev(second, "sla", 1)) return ["show ip sla", ...rest.slice(2)].join(" ").trim();
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
    if (isAbbrev(second, "counters", 4)) return "show interfaces counters";
    if (isAbbrev(lowerRest.at(-1), "counters", 4) && rest.length > 2) return `show interface ${rest.slice(1, -1).join(" ")} counters`;
    if (isAbbrev(lowerRest.at(-1), "status", 2) && rest.length > 2) return `show interface ${rest.slice(1, -1).join(" ")} status`;
    if (isAbbrev(lowerRest.at(-1), "switchport", 2) && rest.length > 2) return `show interface ${rest.slice(1, -1).join(" ")} switchport`;
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
  if (isAbbrev(lowerRest[0], "voice", 2)) {
    const vlanValues = isAbbrev(lowerRest[1], "vlan") ? rest.slice(2) : rest.slice(1);
    return `switchport voice vlan ${vlanValues.join(" ")}`;
  }
  if (isAbbrev(lowerRest[0], "trunk")) {
    if (isAbbrev(lowerRest[1], "native", 3)) {
      const vlanValues = isAbbrev(lowerRest[2], "vlan") ? rest.slice(3) : rest.slice(2);
      return `switchport trunk native vlan ${vlanValues.join(" ")}`;
    }
    const vlanValues = rest.slice(1).filter((_, index) => {
      const token = lowerRest[index + 1];
      return !isAbbrev(token, "allowed") && !isAbbrev(token, "vlan");
    });
    return `switchport trunk allowed vlan ${vlanValues.join(" ")}`;
  }
  if (isAbbrev(lowerRest[0], "port-security", 2)) {
    if (isAbbrev(lowerRest[1], "maximum", 3)) return `switchport port-security maximum ${rest[2] ?? ""}`.trim();
    if (isAbbrev(lowerRest[1], "violation", 3)) return `switchport port-security violation ${rest[2] ?? "shutdown"}`;
    if (isAbbrev(lowerRest[1], "mac-address", 3)) {
      if (isAbbrev(lowerRest[2], "sticky", 3)) return rest[3] ? `switchport port-security mac-address sticky ${rest.slice(3).join(" ")}` : "switchport port-security mac-address sticky";
      return `switchport port-security mac-address ${rest.slice(2).join(" ")}`;
    }
    return "switchport port-security";
  }
  return `switchport ${rest.join(" ")}`;
}

function expandSpanningTreeCommand(tokens: string[]): string {
  const rest = tokens.slice(1);
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "mode", 2)) return `spanning-tree mode ${rest[1] ?? "pvst"}`;
  if (isAbbrev(lowerRest[0], "vlan") && lowerRest.includes("root") && (lowerRest.includes("primary") || lowerRest.includes("secondary"))) {
    const rootIndex = lowerRest.findIndex((token) => token === "root");
    const role = lowerRest.includes("secondary") ? "secondary" : "primary";
    return `spanning-tree vlan ${rest.slice(1, rootIndex).join(" ")} root ${role}`;
  }
  if (isAbbrev(lowerRest[0], "portfast", 4)) return "spanning-tree portfast";
  if (isAbbrev(lowerRest[0], "cost", 2)) return `spanning-tree cost ${rest[1] ?? ""}`.trim();
  if (isAbbrev(lowerRest[0], "port-priority", 6)) return `spanning-tree port-priority ${rest[1] ?? ""}`.trim();
  if (isAbbrev(lowerRest[0], "bpduguard", 4)) {
    if (isAbbrev(lowerRest[1], "disable", 3)) return "spanning-tree bpduguard disable";
    return "spanning-tree bpduguard enable";
  }
  return `spanning-tree ${rest.join(" ")}`;
}

function expandStandbyCommand(tokens: string[]): string {
  const rest = tokens.slice(1);
  const lowerRest = rest.map((token) => token.toLowerCase());
  const group = rest[0] ?? "";
  if (isAbbrev(lowerRest[1], "ip", 2)) return `standby ${group} ip ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "priority", 3)) return `standby ${group} priority ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "preempt", 3)) return `standby ${group} preempt`;
  if (isAbbrev(lowerRest[1], "version", 3)) return `standby ${group} version ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "track", 2)) {
    const decrementIndex = lowerRest.findIndex((token) => isAbbrev(token, "decrement", 3));
    const trackName = decrementIndex >= 0 ? rest.slice(2, decrementIndex).join(" ") : rest.slice(2).join(" ");
    const decrement = decrementIndex >= 0 ? ` decrement ${rest[decrementIndex + 1] ?? ""}` : "";
    return `standby ${group} track ${trackName}${decrement}`.trim();
  }
  return `standby ${rest.join(" ")}`;
}

function expandVrrpCommand(tokens: string[]): string {
  const rest = tokens.slice(1);
  const lowerRest = rest.map((token) => token.toLowerCase());
  const group = rest[0] ?? "";
  if (isAbbrev(lowerRest[1], "ip", 2)) return `vrrp ${group} ip ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "priority", 3)) return `vrrp ${group} priority ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "preempt", 3)) return `vrrp ${group} preempt`;
  if (isAbbrev(lowerRest[1], "version", 3)) return `vrrp ${group} version ${rest[2] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "timers", 3) && isAbbrev(lowerRest[2], "advertise", 3)) return `vrrp ${group} timers advertise ${rest[3] ?? ""}`.trim();
  if (isAbbrev(lowerRest[1], "track", 2)) {
    const decrementIndex = lowerRest.findIndex((token) => isAbbrev(token, "decrement", 3));
    const trackObject = decrementIndex >= 0 ? rest.slice(2, decrementIndex).join(" ") : rest.slice(2).join(" ");
    const decrement = decrementIndex >= 0 ? ` decrement ${rest[decrementIndex + 1] ?? ""}` : "";
    return `vrrp ${group} track ${trackObject}${decrement}`.trim();
  }
  return `vrrp ${rest.join(" ")}`;
}

function expandEncapsulationCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  if (isAbbrev(lowerRest[0], "dot1q", 3) || isAbbrev(lowerRest[0], "dot", 3)) {
    const vlan = rest[1] ?? "";
    const native = lowerRest.some((token) => isAbbrev(token, "native", 3)) ? " native" : "";
    return `encapsulation dot1Q ${vlan}${native}`.trim();
  }
  return `encapsulation ${rest.join(" ")}`;
}

function expandNoStandbyCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const group = rest[0] ?? "";
  const action = lowerRest[1] ?? "";
  if (!action) return `no standby ${group}`.trim();
  if (isAbbrev(action, "preempt", 3)) return `no standby ${group} preempt`;
  if (isAbbrev(action, "track", 2)) return `no standby ${group} track`;
  if (isAbbrev(action, "ip", 2)) return `no standby ${group} ip`;
  if (isAbbrev(action, "priority", 3)) return `no standby ${group} priority`;
  if (isAbbrev(action, "version", 3)) return `no standby ${group} version`;
  return `no standby ${rest.join(" ")}`;
}

function expandNoVrrpCommand(rest: string[]): string {
  const lowerRest = rest.map((token) => token.toLowerCase());
  const group = rest[0] ?? "";
  const action = lowerRest[1] ?? "";
  if (!action) return `no vrrp ${group}`.trim();
  if (isAbbrev(action, "preempt", 3)) return `no vrrp ${group} preempt`;
  if (isAbbrev(action, "track", 2)) return `no vrrp ${group} track`;
  if (isAbbrev(action, "ip", 2)) return `no vrrp ${group} ip`;
  if (isAbbrev(action, "priority", 3)) return `no vrrp ${group} priority`;
  if (isAbbrev(action, "version", 3)) return `no vrrp ${group} version`;
  if (isAbbrev(action, "timers", 3)) return `no vrrp ${group} timers advertise`;
  return `no vrrp ${rest.join(" ")}`;
}

const privilegedShowCommands = [
  "show running-config",
  "show run",
  "show startup-config",
  "show access-list",
  "show access-lists",
  "show cable-diagnostics",
  "show route-map",
  "show ip prefix-list",
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
  if (session.pendingAction === "console-username") {
    if (!raw) return result(device, session, "Username:");
    return result(device, { mode: "exec", pendingAction: "console-password", authUsername: raw }, "Password:");
  }
  if (session.pendingAction === "console-password") {
    const auth = consoleLineAuth(device);
    if (auth?.loginLocal) {
      const user = localUsers(device).find((item) => item.name.toLowerCase() === (session.authUsername ?? "").toLowerCase());
      const expected = user?.secret || user?.password || "";
      if (expected && raw === expected) return result(device, { mode: "exec" }, device.config.motdBanner ? `${device.config.motdBanner}` : "");
      return result(device, { mode: "exec", pendingAction: "console-username" }, "% Login invalid\n\nUsername:");
    }
    if (auth?.password && raw === auth.password) return result(device, { mode: "exec" }, device.config.motdBanner ? `${device.config.motdBanner}` : "");
    return result(device, { mode: "exec", pendingAction: "console-password" }, "% Bad passwords\n\nPassword:");
  }
  if (session.pendingAction === "initial-config") {
    if (lower === "y" || lower === "yes") {
      return result(device, { mode: "exec" }, [
        "At any point you may enter a question mark '?' for help.",
        "% Initial configuration dialog is simulated here; use 'enable' and 'configure terminal' for manual setup.",
        "Press RETURN to get started!"
      ].join("\n"));
    }
    if (!lower || lower === "n" || lower === "no") return result(device, { mode: "exec" }, "Press RETURN to get started!");
    return result(device, session, "Please answer 'yes' or 'no'.");
  }
  if (lower === "n" || lower === "no") {
    return result(device, withoutPending(session), "Action cancelled.");
  }
  if (lower && lower !== "y" && lower !== "yes") return result(device, session, "Press Enter to confirm, or type no to cancel.");
  if (session.pendingAction === "reload") {
    const booted = bootDevice({ ...device, powerOn: true });
    const nextSession = bootSession(booted);
    return result(booted, nextSession, appendConsoleAuthPrompt(bootBanner(device), nextSession));
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

function bootSession(device: NetworkDevice): CliSession {
  if (!device.config.startupConfig.length) return { mode: "exec", pendingAction: "initial-config" };
  return consoleAuthSession(device) ?? { mode: "exec" };
}

function appendConsoleAuthPrompt(output: string, session: CliSession): string {
  if (session.pendingAction === "console-username") return `${output}\n\nUser Access Verification\n\nUsername:`;
  if (session.pendingAction === "console-password") return `${output}\n\nUser Access Verification\n\nPassword:`;
  return output;
}

function consoleAuthSession(device: NetworkDevice): CliSession | null {
  const auth = consoleLineAuth(device);
  if (!auth?.login) return null;
  return auth.loginLocal
    ? { mode: "exec", pendingAction: "console-username" }
    : { mode: "exec", pendingAction: "console-password" };
}

function consoleLineAuth(device: NetworkDevice): LineConfig | undefined {
  return lineConfigs(device).find((line) => line.kind === "console" && line.range.trim().startsWith("0"));
}

export function bootBanner(device: NetworkDevice): string {
  const profile = hardwareProfile(device);
  const startupLines = device.config.startupConfig.length;
  return [
    `System Bootstrap, Version ${bootstrapVersion(device)}, RELEASE SOFTWARE`,
    "Copyright (c) Network Editor Web",
    "",
    `${device.model} platform with ${profile.processor}`,
    `${profile.dramKb}K bytes of main memory, ${profile.ioKb}K bytes of packet memory.`,
    `Processor board ID ${serialNumber(device)}`,
    `${profile.nvramKb}K bytes of non-volatile configuration memory.`,
    `${profile.flashKb}K bytes of ATA System CompactFlash (Read/Write)`,
    "",
    "Initializing flash filesystem...",
    "flashfs[0]: 0 orphaned files, 0 orphaned directories",
    "flashfs[0]: Initialization complete.",
    "POST: CPU self-test passed.",
    "POST: Interface controller self-test passed.",
    "POST: NVRAM checksum passed.",
    ...moduleBootLines(device),
    ...interfaceTypeCounts(device).map((line) => `${line.count} ${line.label}`),
    "",
    `program load complete, entry point: 0x80008000, size: ${profile.imageKb}KB`,
    `Self decompressing the image : ${"#".repeat(44)} [OK]`,
    "",
    `${device.model} Software (${softwareTrain(device)}), Version ${softwareVersion(device)}, RELEASE SOFTWARE`,
    `System image file is "flash:${imageName(device)}"`,
    "This product contains cryptographic features and is a simulated lab device.",
    "",
    "Loading startup-config from nvram...",
    startupLines ? `[OK] ${startupLines} configuration lines loaded.` : "% Non-volatile configuration memory is empty.",
    device.config.motdBanner ? `\n${device.config.motdBanner}` : "",
    ...(startupLines ? ["Press RETURN to get started!"] : initialConfigurationDialogLines())
  ].filter(Boolean).join("\n");
}

function initialConfigurationDialogLines(): string[] {
  return [
    "",
    "--- System Configuration Dialog ---",
    "Would you like to enter the initial configuration dialog? [yes/no]:"
  ];
}

export function bootDevice(device: NetworkDevice): NetworkDevice {
  const powered = { ...device, powerOn: true, runtime: { ...emptyRuntime(), clock: device.runtime.clock } };
  return applyStartupConfig(powered);
}

function showVersion(device: NetworkDevice): string {
  const profile = hardwareProfile(device);
  return [
    `${device.model} Software (${softwareTrain(device)}), Version ${softwareVersion(device)}, RELEASE SOFTWARE`,
    "Technical Support: simulated Packet Tracer-style IOS subset",
    "Compiled Mon 22-Jun-26 by ptweb",
    "",
    `ROM: Bootstrap program is ${bootstrapVersion(device)}`,
    `${device.config.hostname || device.label} uptime is ${device.powerOn ? "0 days, 0 hours, 0 minutes" : "not running; system is powered off"}`,
    `${device.powerOn ? "System returned to ROM by power-on" : "System is powered off"}`,
    `System image file is "flash:${imageName(device)}"`,
    `Last reload reason: ${device.powerOn ? "power-on" : "power removed"}`,
    "",
    `${device.model} (${profile.processor}) processor with ${profile.dramKb}K/${profile.ioKb}K bytes of memory.`,
    `Processor board ID ${serialNumber(device)}`,
    ...interfaceTypeCounts(device).map((line) => `${line.count} ${line.label}`),
    `${profile.nvramKb}K bytes of non-volatile configuration memory.`,
    `${profile.flashKb}K bytes of ATA System CompactFlash (Read/Write)`,
    "",
    "License Level: ipbase",
    "License Type: Permanent",
    "Configuration register is 0x2102"
  ].join("\n");
}

function bootStatus(device: NetworkDevice): string {
  const startupBytes = device.config.startupConfig.join("\n").length;
  return [
    `BOOT path-list      : flash:${imageName(device)}`,
    "Config file         : nvram:startup-config",
    `Private Config file : ${startupBytes ? "nvram:private-config" : "not present"}`,
    `Enable Break        : ${device.powerOn ? "no" : "not available while powered off"}`,
    "Manual Boot         : no",
    "Helper path-list    :",
    "Auto upgrade        : yes",
    `NVRAM config bytes  : ${startupBytes}`,
    `Startup config      : ${device.config.startupConfig.length ? "present" : "not saved"}`
  ].join("\n");
}

function platformStatus(device: NetworkDevice): string {
  const profile = hardwareProfile(device);
  const modules = device.modules.length
    ? device.modules.map((module, index) => `${String(index + 1).padEnd(5)}${module.moduleId.padEnd(18)}${module.slotId.padEnd(12)}ok`)
    : ["1    Built-in ports     chassis     ok"];
  return [
    `Chassis type: ${device.model}`,
    `Processor: ${profile.processor}`,
    `Main memory: ${profile.dramKb}K`,
    `Packet memory: ${profile.ioKb}K`,
    `Flash: ${profile.flashKb}K`,
    "",
    "Slot Module            Location    Status",
    ...modules,
    "",
    ...device.ports.map((port) => `${port.name.padEnd(22)}${port.kind.padEnd(18)}${(device.powerOn && port.adminUp ? "enabled" : "disabled").padEnd(10)}${port.linkId ? "link-up" : "no-link"}`)
  ].join("\n");
}

function inventoryStatus(device: NetworkDevice): string {
  return [
    `NAME: "${device.label}", DESCR: "${device.model}"`,
    `PID: ${device.modelId}, VID: PTWEB, SN: ${serialNumber(device)}`,
    ...device.modules.flatMap((module, index) => {
      const spec = getModuleSpec(module.moduleId);
      return [
        "",
        `NAME: "${module.slotId}", DESCR: "${spec?.description ?? module.moduleId}"`,
        `PID: ${module.moduleId}, VID: V0${index + 1}, SN: ${serialNumber({ ...device, id: `${device.id}${module.slotId}${module.moduleId}` })}`
      ];
    })
  ].join("\n");
}

function environmentStatus(device: NetworkDevice): string {
  return [
    "SYSTEM POWER           : " + (device.powerOn ? "OK" : "OFF"),
    "Power Supply 1         : " + (device.powerOn ? "OK" : "not present"),
    "System Temperature     : OK, 31 Celsius",
    "CPU Temperature        : OK, 38 Celsius",
    "Fan 1                  : " + (device.kind === "pc" || device.kind === "server" ? "N/A" : device.powerOn ? "OK" : "stopped"),
    "Fan 2                  : " + (device.kind === "router" || device.kind === "switch" ? "OK" : "N/A"),
    "Voltage rails          : OK",
    "Interface LEDs         : " + device.ports.filter((port) => port.linkId && port.adminUp && device.powerOn).length + " active"
  ].join("\n");
}

function techSupport(device: NetworkDevice): string {
  const sections = [
    ["show clock", currentClock(device)],
    ["show version", showVersion(device)],
    ["show boot", bootStatus(device)],
    ["show environment", environmentStatus(device)],
    ["show running-config", runningConfig(device)],
    ["show ip interface brief", showCommand(device, "show ip interface brief")],
    ["show interfaces status", showCommand(device, "show interfaces status")],
    ["show interfaces counters", interfaceCounters(device)],
    ["show ip route", routeTable(device)],
    ["show logging", loggingStatus(device)]
  ];
  return sections.map(([title, body]) => [
    "------------------ " + title + " ------------------",
    body
  ].join("\n")).join("\n\n");
}

function debuggingStatus(session: CliSession): string {
  const flags = session.debugFlags ?? [];
  if (!flags.length) return "No debugging has been turned on";
  return [
    "Generic IP:",
    ...flags.map((flag) => `  ${flag} debugging is on`)
  ].join("\n");
}

function hardwareProfile(device: NetworkDevice): { processor: string; dramKb: number; ioKb: number; nvramKb: number; flashKb: number; imageKb: number } {
  if (device.modelId.includes("2911")) return { processor: "CISCO2911/K9", dramKb: 524288, ioKb: 131072, nvramKb: 512, flashKb: 262144, imageKb: 48264 };
  if (device.modelId.includes("2901")) return { processor: "CISCO2901/K9", dramKb: 262144, ioKb: 65536, nvramKb: 512, flashKb: 131072, imageKb: 42112 };
  if (device.modelId.includes("2811")) return { processor: "MPC860", dramKb: 249856, ioKb: 12288, nvramKb: 239, flashKb: 62720, imageKb: 30896 };
  if (device.modelId.includes("1941")) return { processor: "CISCO1941/K9", dramKb: 262144, ioKb: 65536, nvramKb: 255, flashKb: 262144, imageKb: 44128 };
  if (device.modelId.includes("1841")) return { processor: "MPC860", dramKb: 114688, ioKb: 16384, nvramKb: 191, flashKb: 62720, imageKb: 28672 };
  if (device.kind === "switch") return { processor: device.modelId.includes("3560") ? "PowerPC405" : "PowerPC", dramKb: 131072, ioKb: 16384, nvramKb: 64, flashKb: 32512, imageKb: 16896 };
  if (device.kind === "firewall") return { processor: "Geode", dramKb: 262144, ioKb: 32768, nvramKb: 64, flashKb: 131072, imageKb: 24576 };
  return { processor: "PTWEB-CPU", dramKb: 65536, ioKb: 8192, nvramKb: 32, flashKb: 16384, imageKb: 8192 };
}

function bootstrapVersion(device: NetworkDevice): string {
  if (device.kind === "switch") return "12.2(55)SE";
  if (device.kind === "firewall") return "8.4(PTWEB)";
  return "15.1(4)M4";
}

function softwareVersion(device: NetworkDevice): string {
  const model = deviceModelMeta(device);
  if (model?.softwareVersion) return model.softwareVersion;
  if (device.kind === "switch") return "15.0(2)SE4";
  if (device.kind === "firewall") return "9.1(PTWEB)";
  return "15.2(4)M6";
}

function softwareTrain(device: NetworkDevice): string {
  const model = deviceModelMeta(device);
  if (model?.softwareTrain) return model.softwareTrain;
  if (device.kind === "switch") return "C2960-LANBASEK9-M";
  if (device.kind === "firewall") return "ASA";
  return "C1900-UNIVERSALK9-M";
}

function imageName(device: NetworkDevice): string {
  const model = deviceModelMeta(device);
  if (model?.iosImage) return model.iosImage;
  if (device.kind === "switch") return `c2960-lanbasek9-mz.${softwareVersion(device)}.bin`;
  if (device.kind === "firewall") return `asa${softwareVersion(device).replace(/\D/g, "") || "91"}.bin`;
  return `${device.modelId}-universalk9-mz.${softwareVersion(device)}.bin`;
}

function deviceModelMeta(device: NetworkDevice) {
  try {
    return getDeviceModel(device.modelId);
  } catch {
    return undefined;
  }
}

function serialNumber(device: NetworkDevice): string {
  return device.id.replace(/[^a-zA-Z0-9]/g, "").slice(-11).toUpperCase().padStart(11, "0");
}

function moduleBootLines(device: NetworkDevice): string[] {
  if (!device.modules.length) return ["No removable network modules detected."];
  return device.modules.map((module) => `Smart Init: ${module.moduleId} detected in ${module.slotId} [OK]`);
}

function interfaceTypeCounts(device: NetworkDevice): Array<{ count: number; label: string }> {
  const labels: Record<NetworkPort["kind"], string> = {
    ethernet: "Ethernet interfaces",
    "fast-ethernet": "FastEthernet interfaces",
    "gigabit-ethernet": "GigabitEthernet interfaces",
    serial: "Serial interfaces",
    console: "terminal line(s)",
    fiber: "Fiber interfaces",
    wireless: "Wireless radio interfaces"
  };
  const counts = device.ports.reduce<Record<string, number>>((items, port) => {
    items[port.kind] = (items[port.kind] ?? 0) + 1;
    return items;
  }, {});
  return Object.entries(counts).map(([kind, count]) => ({ count, label: labels[kind as NetworkPort["kind"]] ?? `${kind} interfaces` }));
}

function applyStartupConfig(device: NetworkDevice): NetworkDevice {
  const startupConfig = [...device.config.startupConfig];
  let next: NetworkDevice = {
    ...device,
    config: { ...defaultConfig(device.label, device.kind), startupConfig },
    ports: device.ports.map((port) => resetPortForBoot(device, port))
  };
  let context: { mode: "global" } | { mode: "interface"; portId: string } | { mode: "vlan"; vlanId: number } | { mode: "dhcp"; poolId: string } | { mode: "line"; lineId: string } | { mode: "router"; routingId: string } | { mode: "acl"; name: string; aclType: "standard" | "extended" } | { mode: "route-map"; routeMapId: string } | { mode: "ip-sla"; ipSlaId: string } = { mode: "global" };

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
          const subinterface = createSubinterface(next, name);
          if (subinterface) {
            next = subinterface.device;
            context = { mode: "interface", portId: subinterface.port.id };
          } else {
            context = { mode: "global" };
          }
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

    if (/^ip sla \d+$/i.test(command)) {
      const operationId = numberAfter(command, "ip sla");
      const ensured = ensureIpSlaOperation(next, operationId);
      next = ensured.device;
      context = { mode: "ip-sla", ipSlaId: ensured.operation.id };
      continue;
    }

    if (lower.startsWith("ip access-list ")) {
      const acl = parseAccessListTarget(command);
      if (acl) context = { mode: "acl", name: acl.name, aclType: acl.type };
      continue;
    }

    if (lower.startsWith("route-map ")) {
      const target = parseRouteMapTarget(command);
      if (target) {
        const ensured = ensureRouteMapEntry(next, target.name, target.action, target.sequence);
        next = ensured.device;
        context = { mode: "route-map", routeMapId: ensured.routeMap.id };
      }
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
    if (context.mode === "route-map") {
      next = applyStartupRouteMapLine(next, context.routeMapId, command, lower);
      continue;
    }
    if (context.mode === "ip-sla") {
      next = applyStartupIpSlaLine(next, context.ipSlaId, command, lower);
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
    lower.startsWith("ip domain-name ") ||
    lower === "no ip domain-name" ||
    lower.startsWith("ip name-server ") ||
    lower.startsWith("no ip name-server") ||
    lower.startsWith("ip ssh version ") ||
    lower.startsWith("crypto key generate rsa") ||
    lower === "crypto key zeroize rsa" ||
    lower.startsWith("logging ") ||
    lower.startsWith("no logging ") ||
    lower === "ip domain-lookup" ||
    lower === "no ip domain-lookup" ||
    lower.startsWith("username ") ||
    lower.startsWith("no username ") ||
    lower.startsWith("spanning-tree vlan ") ||
    lower.startsWith("no spanning-tree vlan ") ||
    lower.startsWith("spanning-tree mode ") ||
    lower.startsWith("errdisable recovery ") ||
    lower.startsWith("no errdisable recovery ") ||
    lower === "cdp run" ||
    lower === "no cdp run" ||
    lower.startsWith("cdp timer ") ||
    lower.startsWith("cdp holdtime ") ||
    lower === "cdp advertise-v2" ||
    lower === "no cdp advertise-v2" ||
    lower === "lldp run" ||
    lower === "no lldp run" ||
    lower.startsWith("lldp timer ") ||
    lower.startsWith("lldp holdtime ") ||
    lower.startsWith("lldp reinit ") ||
    lower.startsWith("vtp ") ||
    lower.startsWith("no vtp ") ||
    lower === "ip dhcp snooping" ||
    lower === "no ip dhcp snooping" ||
    lower.startsWith("ip dhcp snooping vlan ") ||
    lower.startsWith("no ip dhcp snooping vlan ") ||
    lower === "ip dhcp snooping verify mac-address" ||
    lower === "no ip dhcp snooping verify mac-address" ||
    lower.startsWith("ip access-list ") ||
    lower.startsWith("no ip access-list ") ||
    lower.startsWith("ip prefix-list ") ||
    lower.startsWith("no ip prefix-list ") ||
    lower.startsWith("ip sla schedule ") ||
    lower.startsWith("no ip sla ") ||
    lower.startsWith("track ") ||
    lower.startsWith("no track ") ||
    lower.startsWith("ip nat inside source static ") ||
    lower.startsWith("no ip nat inside source static ") ||
    lower.startsWith("ip nat inside source list ") ||
    lower.startsWith("no ip nat inside source list ") ||
    lower.startsWith("ip dhcp excluded-address ") ||
    lower.startsWith("no ip dhcp excluded-address ") ||
    lower.startsWith("access-list ") ||
    lower.startsWith("no route-map ") ||
    lower.startsWith("nat ") ||
    lower.startsWith("service ") ||
    lower.startsWith("no service ");
}

function resetPortForBoot(device: NetworkDevice, port: NetworkPort): NetworkPort {
  const isVirtualInterface = port.name.toLowerCase().startsWith("vlan");
  const subinterfaceVlan = subinterfaceVlanFromName(port.name);
  const isSubinterface = Boolean(port.parentPortId || subinterfaceVlan);
  const defaultMode = port.kind === "console"
    ? port.mode
    : isVirtualInterface || isSubinterface || device.kind === "router" || device.kind === "firewall" || port.kind === "serial"
      ? "routed"
      : "access";
  const defaultVlan = vlanFromInterfaceName(port.name) ?? subinterfaceVlan ?? 1;
  return {
    ...port,
    description: "",
    ipAddress: "",
    subnetMask: "",
    secondaryIpAddresses: [],
    subinterfaceVlan: undefined,
    encapsulationDot1qNative: false,
    gateway: "",
    dnsServer: "",
    mode: defaultMode,
    vlan: defaultVlan,
    allowedVlans: isSubinterface ? [] : [1],
    nativeVlan: 1,
    adminUp: true,
    stpCost: undefined,
    stpPriority: undefined,
    cdpEnabled: true,
    lldpTransmit: false,
    lldpReceive: false,
    dhcpSnoopingTrusted: false,
    dhcpSnoopingRateLimit: undefined,
    voiceVlan: undefined,
    portSecurity: defaultPortSecurity(),
    channelGroup: undefined,
    accessGroupIn: "",
    accessGroupOut: "",
    policyRouteMap: "",
    helperAddresses: [],
    natRole: undefined,
    hsrpGroups: [],
    vrrpGroups: [],
    switchportNonegotiate: false,
    clockRate: undefined,
    duplex: "auto",
    speed: "auto",
    mtu: 1500,
    bandwidth: undefined
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
  if (lower.startsWith("ip domain-name ")) return { ...device, config: { ...device.config, domainName: command.slice("ip domain-name ".length).trim() || undefined } };
  if (lower === "no ip domain-name") return { ...device, config: { ...device.config, domainName: undefined } };
  if (lower.startsWith("ip name-server ")) {
    const servers = parseNameServers(command.slice("ip name-server ".length));
    return servers.length
      ? { ...device, config: { ...device.config, services: { ...device.config.services, dns: true }, nameServers: unique([...(device.config.nameServers ?? []), ...servers]) } }
      : device;
  }
  if (lower.startsWith("no ip name-server")) {
    const servers = parseNameServers(command.slice("no ip name-server".length));
    return { ...device, config: { ...device.config, nameServers: servers.length ? (device.config.nameServers ?? []).filter((server) => !servers.includes(server)) : [] } };
  }
  if (lower.startsWith("ip ssh version ")) {
    const version = command.split(/\s+/).at(-1);
    return version === "1" || version === "2" ? { ...device, config: { ...device.config, sshVersion: version } } : device;
  }
  if (lower.startsWith("crypto key generate rsa")) return { ...device, config: { ...device.config, rsaKeyGenerated: true } };
  if (lower === "crypto key zeroize rsa") return { ...device, config: { ...device.config, rsaKeyGenerated: false } };
  if (lower.startsWith("logging ") || lower.startsWith("no logging ")) return applyLoggingCommand(device, command, lower);
  if (lower === "ip domain-lookup") return { ...device, config: { ...device.config, domainLookup: true } };
  if (lower === "no ip domain-lookup") return { ...device, config: { ...device.config, domainLookup: false } };
  if (lower.startsWith("username ")) {
    const user = parseLocalUser(command);
    return user ? upsertLocalUser(device, user) : device;
  }
  if (lower.startsWith("no username ")) return removeLocalUser(device, command.slice("no username ".length).trim().split(/\s+/)[0] ?? "");
  if (lower.startsWith("spanning-tree vlan ") && lower.endsWith(" root primary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return vlans.length ? applyStpRoot(device, vlans, "primary", true) : device;
  }
  if (lower.startsWith("no spanning-tree vlan ") && lower.endsWith(" root primary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return applyStpRoot(device, vlans, "primary", false);
  }
  if (lower.startsWith("spanning-tree vlan ") && lower.endsWith(" root secondary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return vlans.length ? applyStpRoot(device, vlans, "secondary", true) : device;
  }
  if (lower.startsWith("no spanning-tree vlan ") && lower.endsWith(" root secondary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return applyStpRoot(device, vlans, "secondary", false);
  }
  if (lower.startsWith("spanning-tree mode ")) {
    const mode = command.split(/\s+/)[2];
    return mode === "pvst" || mode === "rapid-pvst" ? { ...device, config: { ...device.config, stpMode: mode } } : device;
  }
  if (lower === "errdisable recovery cause bpduguard") return { ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), bpduguard: true } } };
  if (lower === "no errdisable recovery cause bpduguard") return { ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), bpduguard: false } } };
  if (lower.startsWith("errdisable recovery interval ")) {
    const interval = numberAfter(command, "errdisable recovery interval");
    return Number.isInteger(interval) && interval >= 30 && interval <= 86400
      ? { ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), interval } } }
      : device;
  }
  if (lower.startsWith("cdp ") || lower.startsWith("no cdp ")) return applyCdpGlobalCommand(device, command, lower);
  if (lower.startsWith("lldp ") || lower.startsWith("no lldp ")) return applyLldpGlobalCommand(device, command, lower);
  if (lower.startsWith("vtp ") || lower.startsWith("no vtp ")) return applyVtpGlobalCommand(device, command, lower);
  if (lower.startsWith("ip dhcp snooping") || lower.startsWith("no ip dhcp snooping")) return applyDhcpSnoopingGlobalCommand(device, command, lower);
  if (lower.startsWith("ip route ")) {
    const route = parseStaticRouteCommand(command);
    return route ? { ...device, config: { ...device.config, staticRoutes: [...device.config.staticRoutes, route] } } : device;
  }
  if (lower.startsWith("ip sla schedule ")) {
    const operationId = parseIpSlaSchedule(command);
    return operationId ? scheduleIpSlaOperation(device, operationId, true) : device;
  }
  if (lower.startsWith("no ip sla ")) {
    const operationId = numberAfter(command, "no ip sla");
    return Number.isInteger(operationId) ? removeIpSlaOperation(device, operationId) : device;
  }
  if (lower.startsWith("track ")) {
    const track = parseTrackCommand(command, device);
    return track ? upsertTrackObject(device, track) : device;
  }
  if (lower.startsWith("no track ")) {
    const trackId = numberAfter(command, "no track");
    return Number.isInteger(trackId) ? removeTrackObject(device, trackId) : device;
  }
  if (lower.startsWith("ip host ")) {
    const [, , name, value] = command.split(/\s+/);
    return name && value
      ? { ...device, config: { ...device.config, services: { ...device.config.services, dns: true }, dnsRecords: [...device.config.dnsRecords.filter((record) => record.name.toLowerCase() !== name.toLowerCase()), { id: createId("dns"), name, value }] } }
      : device;
  }
  if (lower.startsWith("ip dhcp excluded-address ")) {
    const range = parseDhcpExcludedRange(command);
    return range ? upsertDhcpExcludedRange(device, range) : device;
  }
  if (lower.startsWith("no ip dhcp excluded-address ")) {
    const range = parseDhcpExcludedRange(command.slice(3));
    return range ? removeDhcpExcludedRange(device, range.startIp, range.endIp) : device;
  }
  if (lower.startsWith("access-list ")) {
    const rule = parseAccessList(command);
    return rule ? addAccessRule(device, rule) : device;
  }
  if (lower.startsWith("ip prefix-list ")) {
    const entry = parsePrefixList(command);
    return entry ? addPrefixListEntry(device, entry) : device;
  }
  if (lower.startsWith("no ip prefix-list ")) {
    const target = parseNoPrefixList(command);
    return target ? removePrefixList(device, target.name, target.sequence) : device;
  }
  if (lower.startsWith("no route-map ")) {
    const target = parseNoRouteMapTarget(command);
    return target ? removeRouteMap(device, target.name, target.action, target.sequence) : device;
  }
  if (lower.startsWith("no ip access-list ")) {
    const acl = parseAccessListTarget(command.slice(3));
    return acl ? removeAccessList(device, acl.name) : device;
  }
  if (lower.startsWith("ip nat inside source static ")) {
    const nat = parseStaticNat(command, device);
    return nat ? upsertNatRule(device, nat) : device;
  }
  if (lower.startsWith("no ip nat inside source static ")) {
    const nat = parseStaticNat(command.slice(3), device);
    return nat ? removeStaticNat(device, nat.insideLocal, nat.insideGlobal) : device;
  }
  if (lower.startsWith("ip nat inside source list ")) {
    const nat = parseOverloadNat(command, device);
    return nat ? upsertNatRule(device, nat) : device;
  }
  if (lower.startsWith("no ip nat inside source list ")) {
    const nat = parseOverloadNat(command.slice(3), device);
    return nat?.aclName ? removeOverloadNat(device, nat.aclName, nat.interfaceName ?? nat.outsideInterface) : device;
  }
  if (lower.startsWith("nat ")) {
    const [, insideLocal, insideGlobal, outsideInterface] = command.split(/\s+/);
    return insideLocal && insideGlobal && outsideInterface
      ? { ...device, config: { ...device.config, natRules: [...device.config.natRules, { id: createId("nat"), insideLocal, insideGlobal, outsideInterface, hits: 0 }] } }
      : device;
  }
  if (lower === "service password-encryption") return { ...device, config: { ...device.config, passwordEncryption: true } };
  if (lower === "no service password-encryption") return { ...device, config: { ...device.config, passwordEncryption: false } };
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
    if (!ipAddress || !isSubnetMask(subnetMask) || maskToPrefix(subnetMask) === 0) return device;
    if (isSecondaryIpCommand(command)) return updatePort(device, port.id, { mode: "routed", secondaryIpAddresses: upsertSecondaryIp(port, ipAddress, subnetMask) });
    return updatePort(device, port.id, { ipAddress, subnetMask, mode: "routed" });
  }
  if (lower.startsWith("encapsulation dot1q ")) {
    const dot1q = parseDot1qEncapsulation(command);
    return dot1q ? applyDot1qEncapsulation(device, port.id, dot1q.vlan, dot1q.native) : device;
  }
  if (lower === "no encapsulation dot1q" || lower === "no encapsulation") return clearDot1qEncapsulation(device, port.id);
  if (lower.startsWith("no ip address ") && lower.endsWith(" secondary")) {
    const [, , , ipAddress, subnetMask] = command.split(/\s+/);
    return ipAddress && subnetMask ? updatePort(device, port.id, { secondaryIpAddresses: removeSecondaryIp(port, ipAddress, subnetMask) }) : device;
  }
  if (lower.startsWith("duplex ")) {
    const duplex = command.split(/\s+/)[1] as NetworkPort["duplex"];
    return duplex === "auto" || duplex === "full" || duplex === "half" ? updatePort(device, port.id, { duplex }) : device;
  }
  if (lower === "no duplex") return updatePort(device, port.id, { duplex: "auto" });
  if (lower.startsWith("speed ")) {
    const speed = command.split(/\s+/)[1] ?? "";
    return speed === "auto" || /^\d+$/.test(speed) ? updatePort(device, port.id, { speed }) : device;
  }
  if (lower === "no speed") return updatePort(device, port.id, { speed: "auto" });
  if (lower.startsWith("mtu ")) {
    const mtu = numberAfter(command, "mtu");
    return Number.isInteger(mtu) && mtu >= 576 && mtu <= 9216 ? updatePort(device, port.id, { mtu }) : device;
  }
  if (lower === "no mtu") return updatePort(device, port.id, { mtu: 1500 });
  if (lower.startsWith("bandwidth ")) {
    const bandwidth = numberAfter(command, "bandwidth");
    return Number.isInteger(bandwidth) && bandwidth > 0 ? updatePort(device, port.id, { bandwidth }) : device;
  }
  if (lower === "no bandwidth") return updatePort(device, port.id, { bandwidth: undefined });
  if (lower === "switchport mode access") return updatePort(device, port.id, layer2ModePatch("access"));
  if (lower === "switchport mode trunk") return updatePort(device, port.id, { ...layer2ModePatch("trunk"), allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1] });
  if (lower === "no switchport") return updatePort(device, port.id, { mode: "routed", ipCapable: true, voiceVlan: undefined, portSecurity: defaultPortSecurity(), channelGroup: undefined });
  if (lower.startsWith("channel-group ")) {
    const channel = parseChannelGroup(command);
    return channel ? updatePort(device, port.id, { channelGroup: channel }) : device;
  }
  if (lower === "no channel-group") return updatePort(device, port.id, { channelGroup: undefined });
  if (lower === "cdp enable") return updatePort(device, port.id, { cdpEnabled: true });
  if (lower === "no cdp enable") return updatePort(device, port.id, { cdpEnabled: false });
  if (lower === "lldp transmit") return updatePort(device, port.id, { lldpTransmit: true });
  if (lower === "no lldp transmit") return updatePort(device, port.id, { lldpTransmit: false });
  if (lower === "lldp receive") return updatePort(device, port.id, { lldpReceive: true });
  if (lower === "no lldp receive") return updatePort(device, port.id, { lldpReceive: false });
  if (lower === "ip dhcp snooping trust") return updatePort(device, port.id, { dhcpSnoopingTrusted: true });
  if (lower === "no ip dhcp snooping trust") return updatePort(device, port.id, { dhcpSnoopingTrusted: false });
  if (lower.startsWith("ip dhcp snooping limit rate ")) {
    const rate = numberAfter(command, "ip dhcp snooping limit rate");
    return Number.isInteger(rate) && rate >= 1 && rate <= 2048 ? updatePort(device, port.id, { dhcpSnoopingRateLimit: rate }) : device;
  }
  if (lower === "no ip dhcp snooping limit rate") return updatePort(device, port.id, { dhcpSnoopingRateLimit: undefined });
  if (lower.startsWith("standby ") || lower.startsWith("no standby ")) return applyStandbyStartupLine(device, port.id, command);
  if (lower.startsWith("vrrp ") || lower.startsWith("no vrrp ")) return applyVrrpStartupLine(device, port.id, command);
  if (lower === "spanning-tree portfast") return updatePort(device, port.id, { stpPortfast: true });
  if (lower === "no spanning-tree portfast") return updatePort(device, port.id, { stpPortfast: false });
  if (lower === "spanning-tree bpduguard enable") return updatePort(device, port.id, { bpduGuard: true });
  if (lower === "spanning-tree bpduguard disable") return updatePort(device, port.id, { bpduGuard: false });
  if (lower.startsWith("spanning-tree cost ")) {
    const stpCost = numberAfter(command, "spanning-tree cost");
    return Number.isInteger(stpCost) && stpCost >= 1 && stpCost <= 200000000 ? updatePort(device, port.id, { stpCost }) : device;
  }
  if (lower === "no spanning-tree cost") return updatePort(device, port.id, { stpCost: undefined });
  if (lower.startsWith("spanning-tree port-priority ")) {
    const stpPriority = numberAfter(command, "spanning-tree port-priority");
    return Number.isInteger(stpPriority) && stpPriority >= 0 && stpPriority <= 240 && stpPriority % 16 === 0 ? updatePort(device, port.id, { stpPriority }) : device;
  }
  if (lower === "no spanning-tree port-priority") return updatePort(device, port.id, { stpPriority: undefined });
  if (lower === "ip nat inside") return updatePort(device, port.id, { natRole: "inside" });
  if (lower === "ip nat outside") return updatePort(device, port.id, { natRole: "outside" });
  if (lower === "no ip nat inside" || lower === "no ip nat outside") return updatePort(device, port.id, { natRole: undefined });
  if (lower.startsWith("ip helper-address ")) {
    const helper = command.split(/\s+/)[2] ?? "";
    return isIpv4(helper) ? updatePort(device, port.id, { helperAddresses: unique([...(port.helperAddresses ?? []), helper]) }) : device;
  }
  if (lower.startsWith("no ip helper-address")) {
    const helper = command.split(/\s+/)[3];
    return updatePort(device, port.id, { helperAddresses: helper ? (port.helperAddresses ?? []).filter((item) => item !== helper) : [] });
  }
  if (lower.startsWith("ip access-group ")) {
    const acl = parseAccessGroup(command);
    return acl ? updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: acl.name } : { accessGroupOut: acl.name }) : device;
  }
  if (lower.startsWith("ip policy route-map ")) {
    const name = command.slice("ip policy route-map ".length).trim().split(/\s+/)[0] ?? "";
    return name ? updatePort(device, port.id, { policyRouteMap: name }) : device;
  }
  if (lower === "no ip policy route-map" || lower.startsWith("no ip policy route-map ")) return updatePort(device, port.id, { policyRouteMap: "" });
  if (lower.startsWith("no ip access-group ")) {
    const acl = parseAccessGroup(command.slice(3));
    if (!acl) return device;
    return updatePort(device, port.id, acl.direction === "in" ? { accessGroupIn: "" } : { accessGroupOut: "" });
  }
  if (lower.startsWith("switchport access vlan ")) {
    const vlan = numberAfter(command, "switchport access vlan");
    return validVlan(vlan) ? ensureVlan(updatePort(device, port.id, { ...layer2ModePatch("access"), vlan }), vlan) : device;
  }
  if (lower.startsWith("switchport voice vlan ")) {
    const voiceVlan = numberAfter(command, "switchport voice vlan");
    return validVlan(voiceVlan) ? ensureVlan(updatePort(device, port.id, { voiceVlan }), voiceVlan) : device;
  }
  if (lower === "no switchport voice vlan") return updatePort(device, port.id, { voiceVlan: undefined });
  if (lower.startsWith("switchport trunk native vlan ")) {
    const nativeVlan = numberAfter(command, "switchport trunk native vlan");
    return validVlan(nativeVlan) ? ensureVlan(updatePort(device, port.id, { ...layer2ModePatch("trunk"), allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1], nativeVlan }), nativeVlan) : device;
  }
  if (lower.startsWith("switchport trunk allowed vlan ")) {
    const allowedVlans = parseVlans(command.slice("switchport trunk allowed vlan ".length));
    let next = allowedVlans.length ? updatePort(device, port.id, { ...layer2ModePatch("trunk"), allowedVlans }) : device;
    for (const vlan of allowedVlans) next = ensureVlan(next, vlan);
    return next;
  }
  if (lower === "switchport nonegotiate") return updatePort(device, port.id, { switchportNonegotiate: true });
  if (lower === "no switchport nonegotiate") return updatePort(device, port.id, { switchportNonegotiate: false });
  if (lower === "switchport port-security") return updatePort(device, port.id, { portSecurity: { ...portSecurity(port), enabled: true } });
  if (lower === "no switchport port-security") return updatePort(device, port.id, { portSecurity: defaultPortSecurity() });
  if (lower.startsWith("switchport port-security maximum ")) {
    const maximum = numberAfter(command, "switchport port-security maximum");
    return Number.isInteger(maximum) && maximum >= 1 && maximum <= 132 ? updatePort(device, port.id, { portSecurity: { ...portSecurity(port), enabled: true, maximum } }) : device;
  }
  if (lower.startsWith("switchport port-security violation ")) {
    const violation = command.split(/\s+/).at(-1)?.toLowerCase();
    return isPortSecurityViolation(violation) ? updatePort(device, port.id, { portSecurity: { ...portSecurity(port), enabled: true, violation } }) : device;
  }
  if (lower === "switchport port-security mac-address sticky") return updatePort(device, port.id, { portSecurity: { ...portSecurity(port), enabled: true, sticky: true } });
  if (lower.startsWith("switchport port-security mac-address sticky ")) {
    const macAddress = normalizeSecureMacAddress(command.slice("switchport port-security mac-address sticky ".length));
    return macAddress ? updatePort(device, port.id, { portSecurity: addSecureMac({ ...portSecurity(port), enabled: true, sticky: true }, macAddress) }) : device;
  }
  if (lower.startsWith("switchport port-security mac-address ")) {
    const macAddress = normalizeSecureMacAddress(command.slice("switchport port-security mac-address ".length));
    return macAddress ? updatePort(device, port.id, { portSecurity: addSecureMac({ ...portSecurity(port), enabled: true }, macAddress) }) : device;
  }
  if (lower.startsWith("clock rate ")) return updatePort(device, port.id, { clockRate: numberAfter(command, "clock rate") });
  if (lower === "shutdown") return updatePort(device, port.id, { adminUp: false });
  if (lower === "no shutdown") return updatePort(device, port.id, { adminUp: true });
  return device;
}

function applyStartupDhcpLine(device: NetworkDevice, poolId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("network ")) {
    const [, network, mask] = command.split(/\s+/);
    if ((network && !isIpv4(network)) || (mask && (!isSubnetMask(mask) || maskToPrefix(mask) === 0))) return device;
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
  if (lower === "login local") return updateLineConfig(device, lineId, { login: true, loginLocal: true });
  if (lower === "login") return updateLineConfig(device, lineId, { login: true });
  if (lower === "no login") return updateLineConfig(device, lineId, { login: false, loginLocal: false });
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
  if (lower.startsWith("router-id ")) {
    const id = command.split(/\s+/)[1] ?? "";
    return isIpv4(id) ? updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, routerId: id })) : device;
  }
  if (lower === "auto-summary") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, autoSummary: true }));
  if (lower === "no auto-summary") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, autoSummary: false }));
  if (lower === "passive-interface default") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, passiveInterfaceDefault: true, passiveInterfaceExceptions: [] }));
  if (lower === "no passive-interface default") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, passiveInterfaceDefault: false, passiveInterfaceExceptions: [] }));
  if (lower.startsWith("passive-interface ")) {
    const name = command.slice("passive-interface ".length).trim();
    return name ? updateRoutingProtocol(device, routingId, (protocol) => protocol.passiveInterfaceDefault
      ? { ...protocol, passiveInterfaceExceptions: (protocol.passiveInterfaceExceptions ?? []).filter((item) => item.toLowerCase() !== name.toLowerCase()) }
      : { ...protocol, passiveInterfaces: unique([...protocol.passiveInterfaces, name]) }) : device;
  }
  if (lower.startsWith("no passive-interface ")) {
    const name = command.slice("no passive-interface ".length).trim().toLowerCase();
    return updateRoutingProtocol(device, routingId, (protocol) => protocol.passiveInterfaceDefault
      ? { ...protocol, passiveInterfaceExceptions: unique([...(protocol.passiveInterfaceExceptions ?? []), command.slice("no passive-interface ".length).trim()]) }
      : { ...protocol, passiveInterfaces: protocol.passiveInterfaces.filter((item) => item.toLowerCase() !== name) });
  }
  if (lower === "redistribute static") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, redistributeStatic: true }));
  if (lower === "no redistribute static") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, redistributeStatic: false }));
  if (lower === "default-information originate" || lower === "default-information originate always") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, defaultInformationOriginate: true, defaultInformationAlways: lower.endsWith("always") }));
  if (lower === "no default-information originate") return updateRoutingProtocol(device, routingId, (protocol) => ({ ...protocol, defaultInformationOriginate: false, defaultInformationAlways: false }));
  return device;
}

function applyStartupAclLine(device: NetworkDevice, aclName: string, aclType: "standard" | "extended", command: string, lower: string): NetworkDevice {
  if (lower.startsWith("permit ") || lower.startsWith("deny ") || lower.startsWith("remark ") || /^\d+\s+(permit|deny|remark)\s+/i.test(command)) {
    const rule = parseAclSubmodeRule(aclName, aclType, command);
    return rule ? addAccessRule(device, rule) : device;
  }
  return device;
}

function applyStartupRouteMapLine(device: NetworkDevice, routeMapId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("description ")) return updateRouteMapEntry(device, routeMapId, { description: command.slice("description ".length).trim().slice(0, 100) });
  if (lower === "no description") return updateRouteMapEntry(device, routeMapId, { description: undefined });
  if (lower.startsWith("match ip address prefix-list ")) {
    const names = parseRouteMapPrefixList(command);
    return names.length ? updateRouteMapEntry(device, routeMapId, (entry) => ({ matchPrefixLists: unique([...(entry.matchPrefixLists ?? []), ...names]) })) : device;
  }
  if (lower === "no match ip address prefix-list" || lower.startsWith("no match ip address prefix-list ")) {
    const names = parseRouteMapPrefixList(command.slice(3));
    return updateRouteMapEntry(device, routeMapId, (entry) => ({ matchPrefixLists: names.length ? (entry.matchPrefixLists ?? []).filter((name) => !names.some((target) => target.toLowerCase() === name.toLowerCase())) : [] }));
  }
  if (lower.startsWith("match ip address ")) {
    const names = parseRouteMapAclList(command);
    return names.length ? updateRouteMapEntry(device, routeMapId, (entry) => ({ matchAccessLists: unique([...entry.matchAccessLists, ...names]) })) : device;
  }
  if (lower === "no match ip address" || lower.startsWith("no match ip address ")) {
    const names = parseRouteMapAclList(command.slice(3));
    return updateRouteMapEntry(device, routeMapId, (entry) => ({ matchAccessLists: names.length ? entry.matchAccessLists.filter((name) => !names.some((target) => target.toLowerCase() === name.toLowerCase())) : [] }));
  }
  if (lower.startsWith("set ip next-hop ")) {
    const nextHop = command.split(/\s+/)[3] ?? "";
    return isIpv4(nextHop) ? updateRouteMapEntry(device, routeMapId, { setNextHop: nextHop }) : device;
  }
  if (lower === "no set ip next-hop" || lower.startsWith("no set ip next-hop ")) return updateRouteMapEntry(device, routeMapId, { setNextHop: undefined });
  return device;
}

function applyStartupIpSlaLine(device: NetworkDevice, ipSlaId: string, command: string, lower: string): NetworkDevice {
  if (lower.startsWith("icmp-echo ")) {
    const echo = parseIpSlaIcmpEcho(command, device);
    return echo ? updateIpSlaOperation(device, ipSlaId, echo) : device;
  }
  if (lower.startsWith("frequency ")) {
    const frequency = numberAfter(command, "frequency");
    return Number.isInteger(frequency) && frequency >= 1 && frequency <= 604800 ? updateIpSlaOperation(device, ipSlaId, { frequency }) : device;
  }
  if (lower.startsWith("timeout ")) {
    const timeout = numberAfter(command, "timeout");
    return Number.isInteger(timeout) && timeout >= 1 && timeout <= 60000 ? updateIpSlaOperation(device, ipSlaId, { timeout }) : device;
  }
  if (lower.startsWith("threshold ")) {
    const threshold = numberAfter(command, "threshold");
    return Number.isInteger(threshold) && threshold >= 1 && threshold <= 60000 ? updateIpSlaOperation(device, ipSlaId, { threshold }) : device;
  }
  if (lower === "shutdown") return updateIpSlaOperation(device, ipSlaId, { enabled: false });
  if (lower === "no shutdown") return updateIpSlaOperation(device, ipSlaId, { enabled: true });
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

  if (lower.startsWith("interface range ")) {
    const ports = parseInterfaceRange(device, command.slice("interface range ".length));
    if (!ports.length) return result(device, session, "% Interface range not found.");
    return result(device, { mode: "interface", interfaceId: ports[0].id, interfaceIds: ports.map((port) => port.id) }, "");
  }

  if (lower.startsWith("interface ")) {
    const name = command.slice(command.indexOf(" ") + 1);
    const existing = findPort(device, name);
    if (existing) return result(device, { mode: "interface", interfaceId: existing.id }, "");
    const svi = createSviInterface(device, name);
    if (svi) return result(svi.device, { mode: "interface", interfaceId: svi.port.id }, "");
    const subinterface = createSubinterface(device, name);
    if (subinterface) return result(subinterface.device, { mode: "interface", interfaceId: subinterface.port.id }, "");
    return result(device, session, `% Interface ${name} not found.`);
  }

  if (lower.startsWith("vlan ")) {
    if (!canEditVlanDatabase(device)) return result(device, session, "% VLAN configuration is not allowed in VTP client mode.");
    const id = numberAfter(command, "vlan");
    if (!validVlan(id)) return result(device, session, "% VLAN id must be 1-4094.");
    const next = ensureVlan(device, id);
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

  if (lower.startsWith("route-map ")) {
    const target = parseRouteMapTarget(command);
    if (!target) return result(device, session, "% Usage: route-map <name> permit|deny <sequence>");
    const ensured = ensureRouteMapEntry(device, target.name, target.action, target.sequence);
    return result(ensured.device, { mode: "route-map", routeMapId: ensured.routeMap.id }, "");
  }

  if (lower.startsWith("no route-map ")) {
    const target = parseNoRouteMapTarget(command);
    if (!target) return result(device, session, "% Usage: no route-map <name> [permit|deny <sequence>]");
    return result(removeRouteMap(device, target.name, target.action, target.sequence), session, "");
  }

  if (lower.startsWith("default interface ")) {
    const name = command.slice("default interface ".length).trim();
    const port = findPort(device, name);
    if (!port) return result(device, session, `% Interface ${name} not found.`);
    return result({ ...device, ports: device.ports.map((item) => item.id === port.id ? resetPortForBoot(device, item) : item) }, session, "");
  }

  if (lower.startsWith("no vlan ")) {
    if (!canEditVlanDatabase(device)) return result(device, session, "% VLAN configuration is not allowed in VTP client mode.");
    const id = numberAfter(command, "no vlan");
    if (id === 1) return result(device, session, "% VLAN 1 cannot be removed.");
    const exists = device.config.vlans.some((vlan) => vlan.id === id);
    const next = {
      ...device,
      config: { ...device.config, vlans: device.config.vlans.filter((vlan) => vlan.id !== id) },
      ports: device.ports.map((port) => port.vlan === id ? { ...port, vlan: 1, allowedVlans: port.allowedVlans.filter((vlan) => vlan !== id) } : port)
    };
    return result(exists ? bumpVtpRevision(next) : next, session, "");
  }

  if (lower.startsWith("ip access-list resequence ")) {
    const resequence = parseAclResequence(command);
    if (!resequence) return result(device, session, "% Usage: ip access-list resequence <name> <start-seq> <increment>");
    return result(resequenceAccessList(device, resequence.name, resequence.start, resequence.increment), session, "");
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

  if (lower.startsWith("ip prefix-list ")) {
    const entry = parsePrefixList(command);
    if (!entry) return result(device, session, "% Usage: ip prefix-list <name> [seq <n>] permit|deny <prefix>/<length> [ge <length>] [le <length>]");
    return result(addPrefixListEntry(device, entry), session, "");
  }

  if (lower.startsWith("no ip prefix-list ")) {
    const target = parseNoPrefixList(command);
    if (!target) return result(device, session, "% Usage: no ip prefix-list <name> [seq <n>]");
    return result(removePrefixList(device, target.name, target.sequence), session, "");
  }

  if (lower.startsWith("ip nat inside source static ")) {
    const nat = parseStaticNat(command, device);
    if (!nat) return result(device, session, "% Usage: ip nat inside source static <inside-local> <inside-global>");
    return result(upsertNatRule(device, nat), session, "");
  }

  if (lower.startsWith("no ip nat inside source static ")) {
    const nat = parseStaticNat(command.slice(3), device);
    if (!nat) return result(device, session, "% Usage: no ip nat inside source static <inside-local> <inside-global>");
    return result(removeStaticNat(device, nat.insideLocal, nat.insideGlobal), session, "");
  }

  if (lower.startsWith("ip nat inside source list ")) {
    const nat = parseOverloadNat(command, device);
    if (!nat) return result(device, session, "% Usage: ip nat inside source list <acl> interface <outside-interface> overload");
    return result(upsertNatRule(device, nat), session, "");
  }

  if (lower.startsWith("no ip nat inside source list ")) {
    const nat = parseOverloadNat(command.slice(3), device);
    if (!nat?.aclName) return result(device, session, "% Usage: no ip nat inside source list <acl> interface <outside-interface> overload");
    return result(removeOverloadNat(device, nat.aclName, nat.interfaceName ?? nat.outsideInterface), session, "");
  }

  if (lower.startsWith("ip route ")) {
    const parsedTokens = parseStaticRouteTokens(command);
    const { network, mask, nextHop, distanceText, trackId } = parsedTokens;
    if (!network || !mask || !nextHop) return result(device, session, "% Usage: ip route <network> <mask> <next-hop> [1-255]");
    if (!isIpv4(network) || !isSubnetMask(mask) || !isIpv4(nextHop)) return result(device, session, "% Invalid IP address or mask.");
    const distance = distanceText === undefined ? undefined : Number(distanceText);
    if (distanceText !== undefined && (typeof distance !== "number" || !Number.isInteger(distance) || distance < 1 || distance > 255)) return result(device, session, "% Administrative distance must be 1-255.");
    if (trackId !== undefined && !trackObjects(device).some((track) => track.trackId === trackId)) return result(device, session, `% Track object ${trackId} is not configured.`);
    const route = parseStaticRouteCommand(command);
    if (!route) return result(device, session, "% Usage: ip route <network> <mask> <next-hop> [1-255]");
    return result({ ...device, config: { ...device.config, staticRoutes: [...device.config.staticRoutes, route] } }, session, "");
  }

  if (/^ip sla \d+$/i.test(command)) {
    const operationId = numberAfter(command, "ip sla");
    const ensured = ensureIpSlaOperation(device, operationId);
    return result(ensured.device, { mode: "ip-sla", ipSlaId: ensured.operation.id }, "");
  }

  if (lower.startsWith("ip sla schedule ")) {
    const operationId = parseIpSlaSchedule(command);
    if (!operationId) return result(device, session, "% Usage: ip sla schedule <operation-id> life forever start-time now");
    if (!ipSlaOperations(device).some((operation) => operation.operationId === operationId)) return result(device, session, `% IP SLA operation ${operationId} is not configured.`);
    return result(scheduleIpSlaOperation(device, operationId, true), session, "");
  }

  if (lower.startsWith("no ip sla ")) {
    const operationId = numberAfter(command, "no ip sla");
    if (!Number.isInteger(operationId)) return result(device, session, "% Usage: no ip sla <operation-id>");
    return result(removeIpSlaOperation(device, operationId), session, "");
  }

  if (lower.startsWith("track ")) {
    const track = parseTrackCommand(command, device);
    if (!track) return result(device, session, "% Usage: track <id> ip sla <operation-id> reachability | track <id> interface <name> line-protocol");
    return result(upsertTrackObject(device, track), session, "");
  }

  if (lower.startsWith("no track ")) {
    const trackId = numberAfter(command, "no track");
    if (!Number.isInteger(trackId)) return result(device, session, "% Usage: no track <id>");
    return result(removeTrackObject(device, trackId), session, "");
  }

  if (lower.startsWith("ip default-gateway ")) {
    const gateway = command.split(/\s+/)[2] ?? "";
    if (!isIpv4(gateway)) return result(device, session, "% Invalid default gateway address.");
    return result({ ...device, config: { ...device.config, defaultGateway: gateway } }, session, "");
  }
  if (lower === "no ip default-gateway") return result({ ...device, config: { ...device.config, defaultGateway: undefined } }, session, "");
  if (lower.startsWith("ip domain-name ")) {
    const domainName = command.slice("ip domain-name ".length).trim().replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!domainName) return result(device, session, "% Invalid domain name.");
    return result({ ...device, config: { ...device.config, domainName } }, session, "");
  }
  if (lower === "no ip domain-name") return result({ ...device, config: { ...device.config, domainName: undefined } }, session, "");
  if (lower.startsWith("ip name-server ")) {
    const rawServers = command.slice("ip name-server ".length).trim().split(/\s+/).filter(Boolean);
    if (!rawServers.length || rawServers.some((server) => !isIpv4(server))) return result(device, session, "% Usage: ip name-server <address> [address...]");
    return result({
      ...device,
      config: {
        ...device.config,
        services: { ...device.config.services, dns: true },
        nameServers: unique([...(device.config.nameServers ?? []), ...rawServers])
      }
    }, session, "");
  }
  if (lower.startsWith("no ip name-server")) {
    const rawServers = command.slice("no ip name-server".length).trim().split(/\s+/).filter(Boolean);
    if (rawServers.some((server) => !isIpv4(server))) return result(device, session, "% Usage: no ip name-server [address...]");
    return result({ ...device, config: { ...device.config, nameServers: rawServers.length ? (device.config.nameServers ?? []).filter((server) => !rawServers.includes(server)) : [] } }, session, "");
  }
  if (lower.startsWith("ip ssh version ")) {
    const version = command.split(/\s+/).at(-1);
    if (version !== "1" && version !== "2") return result(device, session, "% SSH version must be 1 or 2.");
    return result({ ...device, config: { ...device.config, sshVersion: version } }, session, "");
  }
  if (lower.startsWith("crypto key generate rsa")) {
    const modulus = Number(command.split(/\s+/).at(-1));
    if (!Number.isInteger(modulus) || modulus < 360) return result(device, session, "% Invalid modulus size.");
    return result({ ...device, config: { ...device.config, rsaKeyGenerated: true, sshVersion: device.config.sshVersion ?? "2" } }, session, `The name for the keys will be: ${device.config.hostname}.${device.config.domainName || "local"}\n% The key modulus size is ${modulus} bits\n% Generating ${modulus} bit RSA keys, keys will be non-exportable...[OK]`);
  }
  if (lower === "crypto key zeroize rsa") return result({ ...device, config: { ...device.config, rsaKeyGenerated: false } }, session, "% All RSA keys zeroized.");
  if (lower.startsWith("logging ") || lower.startsWith("no logging ")) {
    const next = applyLoggingCommand(device, command, lower);
    return next === device ? result(device, session, "% Unsupported logging command.") : result(next, session, "");
  }
  if (lower === "ip domain-lookup") return result({ ...device, config: { ...device.config, domainLookup: true } }, session, "");
  if (lower === "no ip domain-lookup") return result({ ...device, config: { ...device.config, domainLookup: false } }, session, "");

  if (lower.startsWith("username ")) {
    const user = parseLocalUser(command);
    if (!user) return result(device, session, "% Usage: username <name> [privilege <level>] secret|password <value>");
    return result(upsertLocalUser(device, user), session, "");
  }

  if (lower.startsWith("no username ")) {
    const name = command.slice("no username ".length).trim().split(/\s+/)[0] ?? "";
    if (!name) return result(device, session, "% Usage: no username <name>");
    return result(removeLocalUser(device, name), session, "");
  }

  if (lower.startsWith("spanning-tree vlan ") && lower.endsWith(" root primary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    if (!vlans.length) return result(device, session, "% Usage: spanning-tree vlan <id[,id]> root primary");
    let next = applyStpRoot(device, vlans, "primary", true);
    for (const vlan of vlans) next = ensureVlan(next, vlan);
    return result(next, session, "");
  }

  if (lower.startsWith("no spanning-tree vlan ") && lower.endsWith(" root primary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return result(applyStpRoot(device, vlans, "primary", false), session, "");
  }

  if (lower.startsWith("spanning-tree vlan ") && lower.endsWith(" root secondary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    if (!vlans.length) return result(device, session, "% Usage: spanning-tree vlan <id[,id]> root secondary");
    let next = applyStpRoot(device, vlans, "secondary", true);
    for (const vlan of vlans) next = ensureVlan(next, vlan);
    return result(next, session, "");
  }

  if (lower.startsWith("no spanning-tree vlan ") && lower.endsWith(" root secondary")) {
    const vlans = parseSpanningTreeRootVlans(command);
    return result(applyStpRoot(device, vlans, "secondary", false), session, "");
  }

  if (lower.startsWith("spanning-tree mode ")) {
    const mode = command.split(/\s+/)[2];
    if (mode !== "pvst" && mode !== "rapid-pvst") return result(device, session, "% Usage: spanning-tree mode pvst|rapid-pvst");
    return result({ ...device, config: { ...device.config, stpMode: mode } }, session, "");
  }

  if (lower === "errdisable recovery cause bpduguard") return result({ ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), bpduguard: true } } }, session, "");
  if (lower === "no errdisable recovery cause bpduguard") return result({ ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), bpduguard: false } } }, session, "");
  if (lower.startsWith("errdisable recovery interval ")) {
    const interval = numberAfter(command, "errdisable recovery interval");
    if (!Number.isInteger(interval) || interval < 30 || interval > 86400) return result(device, session, "% Errdisable recovery interval must be 30-86400 seconds.");
    return result({ ...device, config: { ...device.config, errdisableRecovery: { ...errdisableRecovery(device), interval } } }, session, "");
  }

  if (lower.startsWith("cdp ") || lower.startsWith("no cdp ")) {
    const next = applyCdpGlobalCommand(device, command, lower);
    return next === device ? result(device, session, "% Usage: cdp run | no cdp run | cdp timer <5-254> | cdp holdtime <10-255> | cdp advertise-v2") : result(next, session, "");
  }

  if (lower.startsWith("lldp ") || lower.startsWith("no lldp ")) {
    const next = applyLldpGlobalCommand(device, command, lower);
    return next === device ? result(device, session, "% Usage: lldp run | no lldp run | lldp timer <5-65534> | lldp holdtime <10-65535> | lldp reinit <1-10>") : result(next, session, "");
  }

  if (lower.startsWith("vtp ") || lower.startsWith("no vtp ")) {
    const next = applyVtpGlobalCommand(device, command, lower);
    return next === device ? result(device, session, "% Usage: vtp domain <name> | vtp mode server|client|transparent|off | vtp version <1-3> | vtp pruning | vtp password <value>") : result(next, session, "");
  }

  if (lower.startsWith("ip dhcp snooping") || lower.startsWith("no ip dhcp snooping")) {
    const next = applyDhcpSnoopingGlobalCommand(device, command, lower);
    return next === device ? result(device, session, "% Usage: ip dhcp snooping | ip dhcp snooping vlan <list> | ip dhcp snooping verify mac-address") : result(next, session, "");
  }

  if (lower.startsWith("no ip route ")) {
    const { network, mask, nextHop, distanceText, trackId } = parseStaticRouteTokens(command.replace(/^no\s+/i, ""));
    const distance = Number(distanceText);
    return result({
      ...device,
      config: {
        ...device.config,
        staticRoutes: device.config.staticRoutes.filter((route) => !(route.network === network &&
          route.mask === mask &&
          (!nextHop || route.nextHop === nextHop) &&
          (!Number.isInteger(distance) || staticRouteDistance(route) === distance) &&
          (trackId === undefined || route.trackId === trackId)))
      }
    }, session, "");
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

  if (lower.startsWith("ip dhcp excluded-address ")) {
    const range = parseDhcpExcludedRange(command);
    if (!range) return result(device, session, "% Usage: ip dhcp excluded-address <start-ip> [end-ip]");
    return result(upsertDhcpExcludedRange(device, range), session, "");
  }

  if (lower.startsWith("no ip dhcp excluded-address ")) {
    const range = parseDhcpExcludedRange(command.slice(3));
    if (!range) return result(device, session, "% Usage: no ip dhcp excluded-address <start-ip> [end-ip]");
    return result(removeDhcpExcludedRange(device, range.startIp, range.endIp), session, "");
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
    return result(addAccessRule(device, rule), session, "");
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

  if (lower === "service password-encryption") return result({ ...device, config: { ...device.config, passwordEncryption: true } }, session, "");
  if (lower === "no service password-encryption") return result({ ...device, config: { ...device.config, passwordEncryption: false } }, session, "");
  if (lower.startsWith("service ") || lower.startsWith("no service ")) {
    const disable = lower.startsWith("no ");
    const service = command.split(/\s+/).at(-1) as keyof NetworkDevice["config"]["services"] | undefined;
    if (!service || !(service in device.config.services)) return result(device, session, "% Unknown service.");
    return result({ ...device, config: { ...device.config, services: { ...device.config.services, [service]: !disable } } }, session, "");
  }

  return result(device, session, "% Unsupported global configuration command.");
}

function interfaceCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const selectedPorts = selectedInterfacePorts(device, session);
  const port = selectedPorts[0];
  if (!port) return result(device, { mode: "global" }, "% Interface context is missing.");

  if (lower.startsWith("ip address ")) {
    if (selectedPorts.length > 1) return result(device, session, "% IP address cannot be applied to an interface range.");
    const [, , ipAddress, subnetMask] = command.split(/\s+/);
    if (!ipAddress || !subnetMask) return result(device, session, "% Usage: ip address <ip> <mask> [secondary]");
    if (!isIpv4(ipAddress) || !isSubnetMask(subnetMask) || maskToPrefix(subnetMask) === 0) return result(device, session, "% Invalid IP address or mask.");
    if (!port.ipCapable && port.mode !== "routed") return result(device, session, "% IP address is not supported on this layer-2 interface.");
    if (isSecondaryIpCommand(command)) {
      if (!port.ipAddress) return result(device, session, "% Configure a primary IP address before adding secondary addresses.");
      return result(updateSelectedPorts(device, selectedPorts, { mode: "routed", secondaryIpAddresses: upsertSecondaryIp(port, ipAddress, subnetMask) }), session, "");
    }
    return result(updateSelectedPorts(device, selectedPorts, { ipAddress, subnetMask, mode: "routed" }), session, "");
  }
  if (lower.startsWith("encapsulation dot1q ")) {
    if (selectedPorts.length > 1) return result(device, session, "% Encapsulation cannot be applied to an interface range.");
    if (!isSubinterfacePort(port)) return result(device, session, "% Encapsulation dot1Q is supported on subinterfaces only.");
    const dot1q = parseDot1qEncapsulation(command);
    if (!dot1q) return result(device, session, "% Usage: encapsulation dot1Q <1-4094> [native]");
    return result(applyDot1qEncapsulation(device, port.id, dot1q.vlan, dot1q.native), session, "");
  }
  if (lower === "no encapsulation dot1q" || lower === "no encapsulation") {
    if (selectedPorts.length > 1) return result(device, session, "% Encapsulation cannot be removed from an interface range.");
    if (!isSubinterfacePort(port)) return result(device, session, "% Encapsulation dot1Q is supported on subinterfaces only.");
    return result(clearDot1qEncapsulation(device, port.id), session, "");
  }
  if (lower.startsWith("no ip address ") && lower.endsWith(" secondary")) {
    if (selectedPorts.length > 1) return result(device, session, "% Secondary IP removal cannot be applied to an interface range.");
    const [, , , ipAddress, subnetMask] = command.split(/\s+/);
    if (!ipAddress || !subnetMask) return result(device, session, "% Usage: no ip address <ip> <mask> secondary");
    return result(updateSelectedPorts(device, selectedPorts, { secondaryIpAddresses: removeSecondaryIp(port, ipAddress, subnetMask) }), session, "");
  }
  if (lower === "no ip address") return result(updateSelectedPorts(device, selectedPorts, { ipAddress: "", subnetMask: "", secondaryIpAddresses: [], gateway: "", dnsServer: "" }), session, "");
  if (lower.startsWith("duplex ")) {
    const duplex = command.split(/\s+/)[1] as NetworkPort["duplex"];
    if (duplex !== "auto" && duplex !== "full" && duplex !== "half") return result(device, session, "% Duplex must be auto, full, or half.");
    return result(updateSelectedPorts(device, selectedPorts, { duplex }), session, "");
  }
  if (lower === "no duplex") return result(updateSelectedPorts(device, selectedPorts, { duplex: "auto" }), session, "");
  if (lower.startsWith("speed ")) {
    const speed = command.split(/\s+/)[1] ?? "";
    if (speed !== "auto" && !/^\d+$/.test(speed)) return result(device, session, "% Speed must be auto or a numeric Mbps value.");
    return result(updateSelectedPorts(device, selectedPorts, { speed }), session, "");
  }
  if (lower === "no speed") return result(updateSelectedPorts(device, selectedPorts, { speed: "auto" }), session, "");
  if (lower.startsWith("mtu ")) {
    const mtu = numberAfter(command, "mtu");
    if (!Number.isInteger(mtu) || mtu < 576 || mtu > 9216) return result(device, session, "% MTU must be between 576 and 9216.");
    return result(updateSelectedPorts(device, selectedPorts, { mtu }), session, "");
  }
  if (lower === "no mtu") return result(updateSelectedPorts(device, selectedPorts, { mtu: 1500 }), session, "");
  if (lower.startsWith("bandwidth ")) {
    const bandwidth = numberAfter(command, "bandwidth");
    if (!Number.isInteger(bandwidth) || bandwidth <= 0) return result(device, session, "% Bandwidth must be a positive Kbit value.");
    return result(updateSelectedPorts(device, selectedPorts, { bandwidth }), session, "");
  }
  if (lower === "no bandwidth") return result(updateSelectedPorts(device, selectedPorts, { bandwidth: undefined }), session, "");
  if (lower === "shutdown") return result(updateSelectedPorts(device, selectedPorts, { adminUp: false }), session, "");
  if (lower === "no shutdown") return result(updateSelectedPorts(device, selectedPorts, { adminUp: true }), session, "");
  if (lower === "switchport mode access") return result(updateSelectedPorts(device, selectedPorts, layer2ModePatch("access")), session, "");
  if (lower === "switchport mode trunk") return result(updateSelectedPorts(device, selectedPorts, { ...layer2ModePatch("trunk"), allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1] }), session, "");
  if (lower === "no switchport") return result(updateSelectedPorts(device, selectedPorts, { mode: "routed", ipCapable: true, voiceVlan: undefined, portSecurity: defaultPortSecurity(), channelGroup: undefined }), session, "");
  if (lower.startsWith("channel-group ")) {
    const channel = parseChannelGroup(command);
    if (!channel) return result(device, session, "% Usage: channel-group <1-48> mode <on|active|passive|desirable|auto>");
    return result(updateSelectedPorts(device, selectedPorts, { channelGroup: channel }), session, "");
  }
  if (lower === "no channel-group") return result(updateSelectedPorts(device, selectedPorts, { channelGroup: undefined }), session, "");
  if (lower === "cdp enable") return result(updateSelectedPorts(device, selectedPorts, { cdpEnabled: true }), session, "");
  if (lower === "no cdp enable") return result(updateSelectedPorts(device, selectedPorts, { cdpEnabled: false }), session, "");
  if (lower === "lldp transmit") return result(updateSelectedPorts(device, selectedPorts, { lldpTransmit: true }), session, "");
  if (lower === "no lldp transmit") return result(updateSelectedPorts(device, selectedPorts, { lldpTransmit: false }), session, "");
  if (lower === "lldp receive") return result(updateSelectedPorts(device, selectedPorts, { lldpReceive: true }), session, "");
  if (lower === "no lldp receive") return result(updateSelectedPorts(device, selectedPorts, { lldpReceive: false }), session, "");
  if (lower === "ip dhcp snooping trust") return result(updateSelectedPorts(device, selectedPorts, { dhcpSnoopingTrusted: true }), session, "");
  if (lower === "no ip dhcp snooping trust") return result(updateSelectedPorts(device, selectedPorts, { dhcpSnoopingTrusted: false }), session, "");
  if (lower.startsWith("ip dhcp snooping limit rate ")) {
    const rate = numberAfter(command, "ip dhcp snooping limit rate");
    if (!Number.isInteger(rate) || rate < 1 || rate > 2048) return result(device, session, "% DHCP snooping rate limit must be 1-2048 packets per second.");
    return result(updateSelectedPorts(device, selectedPorts, { dhcpSnoopingRateLimit: rate }), session, "");
  }
  if (lower === "no ip dhcp snooping limit rate") return result(updateSelectedPorts(device, selectedPorts, { dhcpSnoopingRateLimit: undefined }), session, "");
  if (lower.startsWith("standby ") || lower.startsWith("no standby ")) {
    if (selectedPorts.length > 1) return result(device, session, "% HSRP standby cannot be applied to an interface range.");
    return applyStandbyInterfaceCommand(device, port, session, command);
  }
  if (lower.startsWith("vrrp ") || lower.startsWith("no vrrp ")) {
    if (selectedPorts.length > 1) return result(device, session, "% VRRP cannot be applied to an interface range.");
    return applyVrrpInterfaceCommand(device, port, session, command);
  }
  if (lower === "spanning-tree portfast") return result(updateSelectedPorts(device, selectedPorts, { stpPortfast: true }), session, "");
  if (lower === "no spanning-tree portfast") return result(updateSelectedPorts(device, selectedPorts, { stpPortfast: false }), session, "");
  if (lower === "spanning-tree bpduguard enable") return result(updateSelectedPorts(device, selectedPorts, { bpduGuard: true }), session, "");
  if (lower === "spanning-tree bpduguard disable") return result(updateSelectedPorts(device, selectedPorts, { bpduGuard: false }), session, "");
  if (lower.startsWith("spanning-tree cost ")) {
    const stpCost = numberAfter(command, "spanning-tree cost");
    if (!Number.isInteger(stpCost) || stpCost < 1 || stpCost > 200000000) return result(device, session, "% STP cost must be 1-200000000.");
    return result(updateSelectedPorts(device, selectedPorts, { stpCost }), session, "");
  }
  if (lower === "no spanning-tree cost") return result(updateSelectedPorts(device, selectedPorts, { stpCost: undefined }), session, "");
  if (lower.startsWith("spanning-tree port-priority ")) {
    const stpPriority = numberAfter(command, "spanning-tree port-priority");
    if (!Number.isInteger(stpPriority) || stpPriority < 0 || stpPriority > 240 || stpPriority % 16 !== 0) return result(device, session, "% STP port-priority must be 0-240 in increments of 16.");
    return result(updateSelectedPorts(device, selectedPorts, { stpPriority }), session, "");
  }
  if (lower === "no spanning-tree port-priority") return result(updateSelectedPorts(device, selectedPorts, { stpPriority: undefined }), session, "");
  if (lower === "ip nat inside") return result(updateSelectedPorts(device, selectedPorts, { natRole: "inside" }), session, "");
  if (lower === "ip nat outside") return result(updateSelectedPorts(device, selectedPorts, { natRole: "outside" }), session, "");
  if (lower === "no ip nat inside" || lower === "no ip nat outside") return result(updateSelectedPorts(device, selectedPorts, { natRole: undefined }), session, "");
  if (lower.startsWith("ip helper-address ")) {
    const helper = command.split(/\s+/)[2] ?? "";
    if (!isIpv4(helper)) return result(device, session, "% Usage: ip helper-address <address>");
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ helperAddresses: unique([...(selected.helperAddresses ?? []), helper]) })), session, "");
  }
  if (lower.startsWith("no ip helper-address")) {
    const helper = command.split(/\s+/)[3];
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ helperAddresses: helper ? (selected.helperAddresses ?? []).filter((item) => item !== helper) : [] })), session, "");
  }
  if (lower.startsWith("ip access-group ")) {
    const acl = parseAccessGroup(command);
    if (!acl) return result(device, session, "% Usage: ip access-group <list> in|out");
    return result(updateSelectedPorts(device, selectedPorts, acl.direction === "in" ? { accessGroupIn: acl.name } : { accessGroupOut: acl.name }), session, "");
  }
  if (lower.startsWith("ip policy route-map ")) {
    const name = command.slice("ip policy route-map ".length).trim().split(/\s+/)[0] ?? "";
    if (!name) return result(device, session, "% Usage: ip policy route-map <name>");
    if (selectedPorts.some((selected) => !selected.ipCapable && selected.mode !== "routed")) return result(device, session, "% Policy routing is supported on routed interfaces.");
    return result(updateSelectedPorts(device, selectedPorts, { policyRouteMap: name }), session, "");
  }
  if (lower === "no ip policy route-map" || lower.startsWith("no ip policy route-map ")) return result(updateSelectedPorts(device, selectedPorts, { policyRouteMap: "" }), session, "");
  if (lower.startsWith("no ip access-group ")) {
    const acl = parseAccessGroup(command.slice(3));
    if (!acl) return result(device, session, "% Usage: no ip access-group <list> in|out");
    return result(updateSelectedPorts(device, selectedPorts, acl.direction === "in" ? { accessGroupIn: "" } : { accessGroupOut: "" }), session, "");
  }
  if (lower.startsWith("description ")) return result(updateSelectedPorts(device, selectedPorts, { description: command.slice("description ".length).trim().slice(0, 80) }), session, "");
  if (lower === "no description") return result(updateSelectedPorts(device, selectedPorts, { description: "" }), session, "");
  if (lower.startsWith("switchport access vlan ")) {
    const vlan = numberAfter(command, "switchport access vlan");
    if (!validVlan(vlan)) return result(device, session, "% VLAN id must be 1-4094.");
    if (!device.config.vlans.some((item) => item.id === vlan) && !canEditVlanDatabase(device)) return result(device, session, `% VLAN ${vlan} does not exist. VTP client mode cannot create VLANs.`);
    return result(ensureVlan(updateSelectedPorts(device, selectedPorts, { ...layer2ModePatch("access"), vlan }), vlan), session, "");
  }
  if (lower.startsWith("switchport voice vlan ")) {
    const voiceVlan = numberAfter(command, "switchport voice vlan");
    if (!validVlan(voiceVlan)) return result(device, session, "% VLAN id must be 1-4094.");
    if (!device.config.vlans.some((item) => item.id === voiceVlan) && !canEditVlanDatabase(device)) return result(device, session, `% VLAN ${voiceVlan} does not exist. VTP client mode cannot create VLANs.`);
    return result(ensureVlan(updateSelectedPorts(device, selectedPorts, { voiceVlan }), voiceVlan), session, "");
  }
  if (lower === "no switchport voice vlan") return result(updateSelectedPorts(device, selectedPorts, { voiceVlan: undefined }), session, "");
  if (lower.startsWith("switchport trunk native vlan ")) {
    const nativeVlan = numberAfter(command, "switchport trunk native vlan");
    if (!validVlan(nativeVlan)) return result(device, session, "% VLAN id must be 1-4094.");
    if (!device.config.vlans.some((item) => item.id === nativeVlan) && !canEditVlanDatabase(device)) return result(device, session, `% VLAN ${nativeVlan} does not exist. VTP client mode cannot create VLANs.`);
    return result(ensureVlan(updateSelectedPorts(device, selectedPorts, { ...layer2ModePatch("trunk"), allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1], nativeVlan }), nativeVlan), session, "");
  }
  if (lower === "no switchport trunk native vlan") return result(updateSelectedPorts(device, selectedPorts, { nativeVlan: 1 }), session, "");
  if (lower.startsWith("switchport trunk allowed vlan ")) {
    const allowedVlans = parseVlans(command.slice("switchport trunk allowed vlan ".length));
    if (allowedVlans.length === 0) return result(device, session, "% Provide at least one VLAN.");
    const missingVlans = allowedVlans.filter((vlan) => !device.config.vlans.some((item) => item.id === vlan));
    if (missingVlans.length && !canEditVlanDatabase(device)) return result(device, session, `% VLAN ${missingVlans.join(",")} does not exist. VTP client mode cannot create VLANs.`);
    let next = updateSelectedPorts(device, selectedPorts, { ...layer2ModePatch("trunk"), allowedVlans });
    for (const vlan of allowedVlans) next = ensureVlan(next, vlan);
    return result(next, session, "");
  }
  if (lower === "switchport nonegotiate") return result(updateSelectedPorts(device, selectedPorts, { switchportNonegotiate: true }), session, "");
  if (lower === "no switchport nonegotiate") return result(updateSelectedPorts(device, selectedPorts, { switchportNonegotiate: false }), session, "");
  if (lower === "switchport port-security") return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: { ...portSecurity(selected), enabled: true } })), session, "");
  if (lower === "no switchport port-security") return result(updateSelectedPorts(device, selectedPorts, { portSecurity: defaultPortSecurity() }), session, "");
  if (lower.startsWith("switchport port-security maximum ")) {
    const maximum = numberAfter(command, "switchport port-security maximum");
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 132) return result(device, session, "% Port-security maximum must be 1-132.");
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: { ...portSecurity(selected), enabled: true, maximum } })), session, "");
  }
  if (lower.startsWith("switchport port-security violation ")) {
    const violation = command.split(/\s+/).at(-1)?.toLowerCase();
    if (!isPortSecurityViolation(violation)) return result(device, session, "% Violation mode must be protect, restrict, or shutdown.");
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: { ...portSecurity(selected), enabled: true, violation } })), session, "");
  }
  if (lower === "switchport port-security mac-address sticky") {
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: { ...portSecurity(selected), enabled: true, sticky: true } })), session, "");
  }
  if (lower.startsWith("switchport port-security mac-address sticky ")) {
    const macAddress = normalizeSecureMacAddress(command.slice("switchport port-security mac-address sticky ".length));
    if (!macAddress) return result(device, session, "% Invalid secure MAC address.");
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: addSecureMac({ ...portSecurity(selected), enabled: true, sticky: true }, macAddress) })), session, "");
  }
  if (lower.startsWith("switchport port-security mac-address ")) {
    const macAddress = normalizeSecureMacAddress(command.slice("switchport port-security mac-address ".length));
    if (!macAddress) return result(device, session, "% Invalid secure MAC address.");
    return result(updatePortsWith(device, selectedPorts, (selected) => ({ portSecurity: addSecureMac({ ...portSecurity(selected), enabled: true }, macAddress) })), session, "");
  }
  if (lower.startsWith("clock rate ")) {
    const clockRate = numberAfter(command, "clock rate");
    if (port.kind !== "serial") return result(device, session, "% Clock rate applies to serial interfaces only.");
    return result(updateSelectedPorts(device, selectedPorts, { clockRate }), session, "");
  }
  if (lower === "no clock rate") return result(updateSelectedPorts(device, selectedPorts, { clockRate: undefined }), session, "");
  return result(device, session, "% Unsupported interface command.");
}

function vlanCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const vlanId = session.vlanId;
  if (!vlanId) return result(device, { mode: "global" }, "% VLAN context is missing.");
  if (lower.startsWith("name ")) {
    if (!canEditVlanDatabase(device)) return result(device, session, "% VLAN configuration is not allowed in VTP client mode.");
    const name = command.slice(5).trim().slice(0, 32) || `VLAN${vlanId}`;
    const current = device.config.vlans.find((vlan) => vlan.id === vlanId);
    const next = { ...device, config: { ...device.config, vlans: device.config.vlans.map((vlan) => vlan.id === vlanId ? { ...vlan, name } : vlan) } };
    return result(current && current.name !== name ? bumpVtpRevision(next) : next, session, "");
  }
  return result(device, session, "% Unsupported VLAN command.");
}

function dhcpCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const pool = device.config.dhcpPools.find((item) => item.id === session.dhcpPoolId);
  if (!pool) return result(device, { mode: "global" }, "% DHCP 풀 컨텍스트가 없습니다.");
  if (lower.startsWith("network ")) {
    const [, network, mask] = command.split(/\s+/);
    if ((network && !isIpv4(network)) || (mask && (!isSubnetMask(mask) || maskToPrefix(mask) === 0))) return result(device, session, "% Invalid DHCP network or mask.");
    return result(updatePool(device, pool.id, { network: network ?? "", mask: mask ?? "" }), session, "");
  }
  if (lower.startsWith("default-router ")) {
    const gateway = command.split(/\s+/)[1] ?? "";
    if (!isIpv4(gateway)) return result(device, session, "% Invalid default-router address.");
    if (poolSubnetReady(pool) && !ipInSubnet(gateway, pool.network, pool.mask)) return result(device, session, "% default-router must be within the DHCP network.");
    return result(updatePool(device, pool.id, { defaultGateway: gateway }), session, "");
  }
  if (lower.startsWith("dns-server ")) {
    const dnsServer = command.split(/\s+/)[1] ?? "";
    return isIpv4(dnsServer) ? result(updatePool(device, pool.id, { dnsServer }), session, "") : result(device, session, "% Invalid dns-server address.");
  }
  if (lower.startsWith("start-ip ")) {
    const startIp = command.split(/\s+/)[1] ?? "";
    if (!isIpv4(startIp)) return result(device, session, "% Invalid start-ip address.");
    if (poolSubnetReady(pool) && !ipInSubnet(startIp, pool.network, pool.mask)) return result(device, session, "% start-ip must be within the DHCP network.");
    return result(updatePool(device, pool.id, { startIp }), session, "");
  }
  if (lower.startsWith("max-leases ")) return result(updatePool(device, pool.id, { maxLeases: Math.max(1, numberAfter(command, "max-leases")) }), session, "");
  if (lower === "shutdown") return result(updatePool(device, pool.id, { enabled: false }), session, "");
  if (lower === "no shutdown") return result(updatePool(device, pool.id, { enabled: true }), session, "");
  return result(device, session, "% 지원하지 않는 DHCP 풀 명령입니다.");
}

function poolSubnetReady(pool: DhcpPool): boolean {
  return poolNetworkConfigured(pool) && isIpv4(pool.network) && isSubnetMask(pool.mask) && maskToPrefix(pool.mask) > 0;
}

function poolNetworkConfigured(pool: DhcpPool): boolean {
  return pool.network !== "192.168.1.0" || pool.mask !== "255.255.255.0";
}

function lineCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const line = lineConfigs(device).find((item) => item.id === session.lineId);
  if (!line) return result(device, { mode: "global" }, "% Line context is missing.");
  if (lower.startsWith("password ")) return result(updateLineConfig(device, line.id, { password: command.slice("password ".length).trim() }), session, "");
  if (lower === "login local") return result(updateLineConfig(device, line.id, { login: true, loginLocal: true }), session, "");
  if (lower === "login") return result(updateLineConfig(device, line.id, { login: true }), session, "");
  if (lower === "no login") return result(updateLineConfig(device, line.id, { login: false, loginLocal: false }), session, "");
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
  if (lower.startsWith("router-id ")) {
    const id = command.split(/\s+/)[1] ?? "";
    if (!isIpv4(id)) return result(device, session, "% Invalid router-id.");
    return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, routerId: id })), session, "");
  }
  if (lower === "auto-summary") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, autoSummary: true })), session, "");
  if (lower === "no auto-summary") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, autoSummary: false })), session, "");
  if (lower === "passive-interface default") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, passiveInterfaceDefault: true, passiveInterfaceExceptions: [] })), session, "");
  if (lower === "no passive-interface default") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, passiveInterfaceDefault: false, passiveInterfaceExceptions: [] })), session, "");
  if (lower.startsWith("passive-interface ")) {
    const name = command.slice("passive-interface ".length).trim();
    if (!name) return result(device, session, "% Usage: passive-interface <interface>");
    return result(updateRoutingProtocol(device, routing.id, (protocol) => protocol.passiveInterfaceDefault
      ? { ...protocol, passiveInterfaceExceptions: (protocol.passiveInterfaceExceptions ?? []).filter((item) => item.toLowerCase() !== name.toLowerCase()) }
      : { ...protocol, passiveInterfaces: unique([...protocol.passiveInterfaces, name]) }), session, "");
  }
  if (lower.startsWith("no passive-interface ")) {
    const rawName = command.slice("no passive-interface ".length).trim();
    const name = rawName.toLowerCase();
    return result(updateRoutingProtocol(device, routing.id, (protocol) => protocol.passiveInterfaceDefault
      ? { ...protocol, passiveInterfaceExceptions: unique([...(protocol.passiveInterfaceExceptions ?? []), rawName]) }
      : { ...protocol, passiveInterfaces: protocol.passiveInterfaces.filter((item) => item.toLowerCase() !== name) }), session, "");
  }
  if (lower === "redistribute static") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, redistributeStatic: true })), session, "");
  if (lower === "no redistribute static") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, redistributeStatic: false })), session, "");
  if (lower === "default-information originate" || lower === "default-information originate always") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, defaultInformationOriginate: true, defaultInformationAlways: lower.endsWith("always") })), session, "");
  if (lower === "no default-information originate") return result(updateRoutingProtocol(device, routing.id, (protocol) => ({ ...protocol, defaultInformationOriginate: false, defaultInformationAlways: false })), session, "");
  return result(device, session, "% Unsupported router configuration command.");
}

function aclCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const aclName = session.aclName;
  const aclType = session.aclType ?? "extended";
  if (!aclName) return result(device, { mode: "global" }, "% ACL context is missing.");
  if (lower.startsWith("permit ") || lower.startsWith("deny ") || lower.startsWith("remark ") || /^\d+\s+(permit|deny|remark)\s+/i.test(command)) {
    const rule = parseAclSubmodeRule(aclName, aclType, command);
    if (!rule) return result(device, session, aclType === "standard" ? "% Usage: permit|deny <source> [wildcard]" : "% Usage: permit|deny <protocol> <source> <destination>");
    return result(addAccessRule(device, rule), session, "");
  }
  if (/^no\s+\d+$/i.test(command)) {
    const sequence = Number(command.split(/\s+/)[1]);
    return result(removeAccessListSequence(device, aclName, sequence), session, "");
  }
  if (lower.startsWith("no permit ") || lower.startsWith("no deny ")) {
    const rule = parseAclSubmodeRule(aclName, aclType, command.slice(3));
    return result(rule ? removeAccessRule(device, rule) : device, session, "");
  }
  return result(device, session, "% Unsupported access-list configuration command.");
}

function routeMapCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const routeMap = routeMaps(device).find((entry) => entry.id === session.routeMapId);
  if (!routeMap) return result(device, { mode: "global" }, "% Route-map context is missing.");
  if (lower.startsWith("description ")) {
    return result(updateRouteMapEntry(device, routeMap.id, { description: command.slice("description ".length).trim().slice(0, 100) }), session, "");
  }
  if (lower === "no description") return result(updateRouteMapEntry(device, routeMap.id, { description: undefined }), session, "");
  if (lower.startsWith("match ip address prefix-list ")) {
    const names = parseRouteMapPrefixList(command);
    if (!names.length) return result(device, session, "% Usage: match ip address prefix-list <prefix-list-name> [name...]");
    return result(updateRouteMapEntry(device, routeMap.id, (entry) => ({ matchPrefixLists: unique([...(entry.matchPrefixLists ?? []), ...names]) })), session, "");
  }
  if (lower === "no match ip address prefix-list" || lower.startsWith("no match ip address prefix-list ")) {
    const names = parseRouteMapPrefixList(command.slice(3));
    return result(updateRouteMapEntry(device, routeMap.id, (entry) => ({ matchPrefixLists: names.length ? (entry.matchPrefixLists ?? []).filter((name) => !names.some((target) => target.toLowerCase() === name.toLowerCase())) : [] })), session, "");
  }
  if (lower.startsWith("match ip address ")) {
    const names = parseRouteMapAclList(command);
    if (!names.length) return result(device, session, "% Usage: match ip address <acl-name-or-number> [acl...]");
    return result(updateRouteMapEntry(device, routeMap.id, (entry) => ({ matchAccessLists: unique([...entry.matchAccessLists, ...names]) })), session, "");
  }
  if (lower === "no match ip address" || lower.startsWith("no match ip address ")) {
    const names = parseRouteMapAclList(command.slice(3));
    return result(updateRouteMapEntry(device, routeMap.id, (entry) => ({ matchAccessLists: names.length ? entry.matchAccessLists.filter((name) => !names.some((target) => target.toLowerCase() === name.toLowerCase())) : [] })), session, "");
  }
  if (lower.startsWith("set ip next-hop ")) {
    const nextHop = command.split(/\s+/)[3] ?? "";
    if (!isIpv4(nextHop)) return result(device, session, "% Usage: set ip next-hop <address>");
    return result(updateRouteMapEntry(device, routeMap.id, { setNextHop: nextHop }), session, "");
  }
  if (lower === "no set ip next-hop" || lower.startsWith("no set ip next-hop ")) return result(updateRouteMapEntry(device, routeMap.id, { setNextHop: undefined }), session, "");
  return result(device, session, "% Unsupported route-map configuration command.");
}

function ipSlaCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  const operation = ipSlaOperations(device).find((item) => item.id === session.ipSlaId);
  if (!operation) return result(device, { mode: "global" }, "% IP SLA context is missing.");
  if (lower.startsWith("icmp-echo ")) {
    const echo = parseIpSlaIcmpEcho(command, device);
    if (!echo) return result(device, session, "% Usage: icmp-echo <target-ip> [source-interface <interface>]");
    return result(updateIpSlaOperation(device, operation.id, echo), session, "");
  }
  if (lower.startsWith("frequency ")) {
    const frequency = numberAfter(command, "frequency");
    if (!Number.isInteger(frequency) || frequency < 1 || frequency > 604800) return result(device, session, "% IP SLA frequency must be 1-604800 seconds.");
    return result(updateIpSlaOperation(device, operation.id, { frequency }), session, "");
  }
  if (lower.startsWith("timeout ")) {
    const timeout = numberAfter(command, "timeout");
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) return result(device, session, "% IP SLA timeout must be 1-60000 milliseconds.");
    return result(updateIpSlaOperation(device, operation.id, { timeout }), session, "");
  }
  if (lower.startsWith("threshold ")) {
    const threshold = numberAfter(command, "threshold");
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 60000) return result(device, session, "% IP SLA threshold must be 1-60000 milliseconds.");
    return result(updateIpSlaOperation(device, operation.id, { threshold }), session, "");
  }
  if (lower === "shutdown") return result(updateIpSlaOperation(device, operation.id, { enabled: false }), session, "");
  if (lower === "no shutdown") return result(updateIpSlaOperation(device, operation.id, { enabled: true }), session, "");
  return result(device, session, "% Unsupported IP SLA configuration command.");
}

function showCommand(device: NetworkDevice, lower: string, session?: CliSession): string {
  if (lower.startsWith("show running-config interface ")) {
    const name = lower.slice("show running-config interface ".length);
    const port = findPort(device, name);
    return port ? interfaceConfig(port).join("\n") : `% Interface ${name} not found.`;
  }
  if (lower === "show run" || lower === "show running-config" || lower === "show running-config all" || lower === "show running-config brief") return runningConfig(device);
  if (lower === "show version") return showVersion(device);
  if (lower === "show boot") return bootStatus(device);
  if (lower === "show clock") return currentClock(device);
  if (lower === "show inventory") return inventoryStatus(device);
  if (lower === "show platform" || lower === "show module") return platformStatus(device);
  if (lower === "show environment") return environmentStatus(device);
  if (lower === "show errdisable recovery") return errdisableRecoveryStatus(device);
  if (lower === "show logging") return loggingStatus(device);
  if (lower === "show service logs" || lower.startsWith("show service logs ")) return serviceLogStatus(device, lower.slice("show service logs".length).trim());
  if (lower === "show services" || lower.startsWith("show services ")) return servicesStatus(device, lower.slice("show services".length).trim());
  if (lower === "show flash" || lower === "show flash:") return flashDirectory(device);
  if (lower === "show file systems") return fileSystems(device);
  if (lower === "show processes cpu") return "CPU utilization for five seconds: 1%/0%; one minute: 1%; five minutes: 1%";
  if (lower === "show memory") return "Processor Pool Total: 262144 Used: 98304 Free: 163840\nI/O Pool Total: 65536 Used: 8192 Free: 57344";
  if (lower === "show controllers" || lower.startsWith("show controllers ")) return controllersStatus(device, lower.slice("show controllers".length).trim());
  if (lower === "show cable-diagnostics tdr" || lower.startsWith("show cable-diagnostics tdr ")) return cableDiagnosticsTdr(device, lower.slice("show cable-diagnostics tdr".length).trim());
  if (lower === "show users" || lower === "show users all") return showUsers(device, session);
  if (lower === "show line" || lower.startsWith("show line ")) return lineStatus(device, lower.slice("show line".length).trim());
  if (lower === "show terminal") return [
    "Line 0, Location: local",
    `Length: ${session?.terminalLength ?? 24} lines, Width: ${session?.terminalWidth ?? 80} columns`,
    `Monitor logging: ${session?.terminalMonitor === false ? "disabled" : "enabled"}`,
    "History is enabled, history size is 80",
    "Editing is enabled. Completion is enabled."
  ].join("\n");
  if (lower === "show tech-support") return techSupport(device);
  if (lower === "show protocols" || lower.startsWith("show protocols ")) return protocolsStatus(device, lower.slice("show protocols".length).trim());
  if (lower === "show spanning-tree" || lower.startsWith("show spanning-tree ")) return spanningTreeStatus(device, lower.slice("show spanning-tree".length).trim());
  if (lower === "show standby" || lower.startsWith("show standby ")) return standbyStatus(device, lower.slice("show standby".length).trim());
  if (lower === "show vrrp" || lower.startsWith("show vrrp ")) return vrrpStatus(device, lower.slice("show vrrp".length).trim());
  if (lower === "show etherchannel" || lower.startsWith("show etherchannel ")) return etherChannelStatus(device, lower.slice("show etherchannel".length).trim());
  if (lower === "show cdp" || lower.startsWith("show cdp ")) return cdpStatus(device, lower.slice("show cdp".length).trim());
  if (lower === "show lldp" || lower.startsWith("show lldp ")) return lldpStatus(device, lower.slice("show lldp".length).trim());
  if (lower === "show vtp" || lower.startsWith("show vtp ")) return vtpStatus(device, lower.slice("show vtp".length).trim());
  if (lower === "show startup-config") return startupConfigDisplay(device);
  if (lower === "show ip interface brief") {
    return [
      "Interface              IP-Address      OK? Method Status                Protocol",
      ...device.ports.map((port) => {
        const status = device.powerOn && port.adminUp ? "up" : "administratively down";
        const protocol = interfaceOperational(device, port) ? "up" : "down";
        return `${port.name.padEnd(22)}${(port.ipAddress || "unassigned").padEnd(16)}YES manual ${status.padEnd(22)}${protocol}`;
      })
    ].join("\n");
  }
  if (lower === "show ip interface") return ipInterfaceStatus(device);
  if (lower.startsWith("show ip interface ")) {
    const name = lower.slice("show ip interface ".length);
    const port = findPort(device, name);
    return port ? ipInterfaceStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show interfaces") return device.ports.map((port) => interfaceStatus(device, port)).join("\n\n");
  if (lower === "show interfaces description") return interfaceDescriptions(device);
  if (lower === "show interfaces counters") return interfaceCounters(device);
  if (lower.startsWith("show interface ") && lower.endsWith(" counters")) {
    const name = lower.slice("show interface ".length, lower.length - " counters".length).trim();
    const port = findPort(device, name);
    return port ? interfaceCounters(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show interfaces switchport") return switchportStatus(device);
  if (lower.startsWith("show interface ") && lower.endsWith(" switchport")) {
    const name = lower.slice("show interface ".length, lower.length - " switchport".length).trim();
    const port = findPort(device, name);
    return port ? switchportStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show interfaces trunk") return trunkStatus(device);
  if (lower === "show interfaces status") return interfacesStatus(device);
  if (lower.startsWith("show interface ") && lower.endsWith(" status")) {
    const name = lower.slice("show interface ".length, lower.length - " status".length).trim();
    const port = findPort(device, name);
    return port ? interfacesStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower.startsWith("show interface ")) {
    const name = lower.slice("show interface ".length);
    const port = findPort(device, name);
    return port ? interfaceStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (lower === "show vlan brief") return vlanBrief(device);
  if (lower === "show vlan summary") return vlanSummary(device);
  if (lower.startsWith("show vlan ")) return vlanDetail(device, lower.slice("show vlan ".length).trim());
  if (lower === "show mac address-table" || lower.startsWith("show mac address-table ")) return macAddressTable(device, lower);
  if (lower === "show port-security" || lower.startsWith("show port-security ")) return portSecurityStatus(device, lower.slice("show port-security".length).trim());
  if (lower === "show arp" || lower.startsWith("show arp ") || lower === "show ip arp" || lower.startsWith("show ip arp ")) {
    const filter = lower.startsWith("show ip arp") ? lower.slice("show ip arp".length).trim() : lower.slice("show arp".length).trim();
    return arpTableStatus(device, filter);
  }
  if (lower === "show route-map" || lower.startsWith("show route-map ")) return routeMapStatus(device, lower.slice("show route-map".length).trim());
  if (lower === "show track" || lower.startsWith("show track ")) return trackStatus(device, lower.slice("show track".length).trim());
  if (lower === "show ip route") return routeTable(device);
  if (lower === "show ip route summary") return routeSummary(device);
  if (lower.startsWith("show ip route ")) return routeTable(device, lower.slice("show ip route ".length).trim());
  if (lower === "show ip prefix-list" || lower.startsWith("show ip prefix-list ")) return prefixListStatus(device, lower.slice("show ip prefix-list".length).trim());
  if (lower === "show ip sla" || lower.startsWith("show ip sla ")) return ipSlaStatus(device, lower.slice("show ip sla".length).trim());
  if (lower === "show ip protocols" || lower.startsWith("show ip protocols ")) return ipProtocols(device, lower.slice("show ip protocols".length).trim());
  if (lower === "show ip ssh") return ipSshStatus(device);
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
  if (lower === "show ip dhcp binding" || lower.startsWith("show ip dhcp binding ")) return dhcpBindingStatus(device, lower.slice("show ip dhcp binding".length).trim());
  if (lower === "show ip dhcp snooping" || lower.startsWith("show ip dhcp snooping ")) return dhcpSnoopingStatus(device, lower.slice("show ip dhcp snooping".length).trim());
  if (lower === "show ip dhcp conflict") return "No DHCP conflicts.";
  if (lower === "show ip dhcp pool" || lower.startsWith("show ip dhcp pool ")) return dhcpPoolStatus(device, lower.slice("show ip dhcp pool".length).trim());
  if (lower === "show ip dhcp server statistics") return dhcpServerStatistics(device);
  if (lower === "show hosts" || lower.startsWith("show hosts ")) return hostsStatus(device, lower.slice("show hosts".length).trim());
  if (lower === "show access-list" || lower === "show access-lists") return accessListStatus(device);
  if (lower.startsWith("show access-list ")) return accessListStatus(device, lower.slice("show access-list ".length).trim());
  if (lower === "show nat") return natTranslations(device);
  return "% Unsupported show command.";
}

function testCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  if (lower.startsWith("test cable-diagnostics tdr interface ")) {
    const name = command.slice("test cable-diagnostics tdr interface ".length).trim();
    return result(device, session, cableDiagnosticsTest(device, name));
  }
  return result(device, session, invalidInput(command));
}

function clearCommand(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  if (lower === "clear arp-cache" || lower === "clear arp" || lower.startsWith("clear arp ")) return clearArpTable(device, session, lower);
  if (lower === "clear logging") return result({ ...device, runtime: { ...device.runtime, logs: [] } }, session, "");
  if (lower === "clear service logs" || lower.startsWith("clear service logs ")) return clearServiceLogs(device, session, lower);
  if (lower === "clear mac address-table" || lower.startsWith("clear mac address-table ")) return clearMacAddressTable(device, session, lower);
  if (lower === "clear ip dhcp binding" || lower.startsWith("clear ip dhcp binding ")) return clearDhcpBindings(device, session, lower);
  if (lower === "clear ip dhcp conflict *" || lower === "clear ip dhcp conflict") return result(device, session, "");
  if (lower === "clear ip nat translation" || lower.startsWith("clear ip nat translation ")) return clearNatTranslations(device, session, lower);
  return result(device, session, "% Unsupported clear command.");
}

function clearNatTranslations(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  const target = lower.slice("clear ip nat translation".length).trim();
  if (!target || target === "*" || target === "all") return result({ ...device, runtime: { ...device.runtime, natTranslations: [] } }, session, "");
  return result({
    ...device,
    runtime: {
      ...device.runtime,
      natTranslations: (device.runtime.natTranslations ?? []).filter((entry) => entry.insideLocal !== target && entry.insideGlobal !== target)
    }
  }, session, "");
}

function clearArpTable(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  const targetIp = lower.slice("clear arp".length).trim();
  if (!targetIp || targetIp === "*") return result({ ...device, runtime: { ...device.runtime, arpTable: [] } }, session, "");
  if (!isIpv4(targetIp)) return result(device, session, "% Usage: clear arp [<ip-address>|*]");
  return result({ ...device, runtime: { ...device.runtime, arpTable: device.runtime.arpTable.filter((entry) => entry.ipAddress !== targetIp) } }, session, "");
}

function clearDhcpBindings(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  const targetIp = lower.slice("clear ip dhcp binding".length).trim();
  if (!targetIp || targetIp === "*") return result({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } }, session, "");
  if (!isIpv4(targetIp)) return result(device, session, "% Usage: clear ip dhcp binding [<ip-address>|*]");
  return result({ ...device, runtime: { ...device.runtime, dhcpLeases: device.runtime.dhcpLeases.filter((lease) => lease.ipAddress !== targetIp) } }, session, "");
}

function clearServiceLogs(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  const service = lower.slice("clear service logs".length).trim().toLowerCase();
  if (!service || service === "*" || service === "all" || service === "syslog") return result({ ...device, runtime: { ...device.runtime, logs: [] } }, session, "");
  const prefixes: Record<string, string> = { http: "HTTP", ftp: "FTP", email: "EMAIL", tftp: "TFTP" };
  const prefix = prefixes[service];
  if (!prefix) return result(device, session, "% Usage: clear service logs [all|http|ftp|email|tftp|syslog]");
  return result({ ...device, runtime: { ...device.runtime, logs: device.runtime.logs.filter((log) => !log.message.startsWith(prefix)) } }, session, "");
}

function clearMacAddressTable(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  const tokens = lower.slice("clear mac address-table".length).trim().split(/\s+/).filter(Boolean);
  let type: "dynamic" | "static" | undefined;
  let vlan: number | undefined;
  let portName = "";
  let macAddress = "";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "dynamic" || token === "static") {
      type = token;
      continue;
    }
    if (token === "vlan") {
      vlan = Number(tokens[index + 1]);
      index += 1;
      if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return result(device, session, "% Usage: clear mac address-table [dynamic|static] [vlan <1-4094>] [interface <name>] [address <mac>]");
      continue;
    }
    if (token === "interface") {
      const port = findPort(device, tokens[index + 1] ?? "");
      if (!port) return result(device, session, `% Interface ${tokens[index + 1] ?? ""} not found.`);
      portName = port.name;
      index += 1;
      continue;
    }
    if (token === "address") {
      macAddress = tokens[index + 1] ?? "";
      index += 1;
      if (!macAddress) return result(device, session, "% Usage: clear mac address-table [dynamic|static] [vlan <1-4094>] [interface <name>] [address <mac>]");
      continue;
    }
    return result(device, session, "% Usage: clear mac address-table [dynamic|static] [vlan <1-4094>] [interface <name>] [address <mac>]");
  }

  return result({
    ...device,
    runtime: {
      ...device.runtime,
      macTable: device.runtime.macTable.filter((entry) => {
        const matchesType = !type || entry.type === type;
        const matchesVlan = vlan === undefined || entry.vlan === vlan;
        const matchesPort = !portName || entry.portName === portName;
        const matchesMac = !macAddress || entry.macAddress.toLowerCase() === macAddress;
        return !(matchesType && matchesVlan && matchesPort && matchesMac);
      })
    }
  }, session, "");
}

function hostsStatus(device: NetworkDevice, filter = ""): string {
  const nameServers = device.config.nameServers ?? [];
  const query = filter.trim().toLowerCase();
  const hostRecords = query
    ? device.config.dnsRecords.filter((record) => record.name.toLowerCase().includes(query) || record.value === query)
    : device.config.dnsRecords;
  if (query && !hostRecords.length) return `% Host ${filter} not found.`;
  if (!nameServers.length && !hostRecords.length) return "Default domain is not set\nName/address lookup uses static mappings only.\nNo host records configured.";
  return [
    `Default domain is ${device.config.domainName ?? "not set"}`,
    `Name servers are ${nameServers.length ? nameServers.join(", ") : "not configured"}`,
    "",
    "Host                     Address",
    ...hostRecords.map((record) => `${record.name.padEnd(25)}${record.value}`)
  ].join("\n");
}

function currentClock(device: NetworkDevice): string {
  return device.runtime.clock || new Date().toLocaleString("ko-KR", { hour12: false });
}

function flashDirectory(device: NetworkDevice): string {
  const startupBytes = device.config.startupConfig.join("\n").length;
  const imageBytes = 8192 + device.ports.length * 256;
  return [
    "Directory of flash:/",
    "",
    `    1  -rw-       ${String(imageBytes).padStart(8)}  ${imageName(device)}`,
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

function loggingConfig(device: NetworkDevice): string[] {
  const logging = device.config.logging ?? { console: true, buffered: true, hosts: [], trap: "informational" };
  return [
    logging.console ? "logging console" : "no logging console",
    ...(logging.buffered ? ["logging buffered"] : []),
    ...(logging.trap ? [`logging trap ${logging.trap}`] : []),
    ...logging.hosts.map((host) => `logging host ${host}`)
  ];
}

function loggingStatus(device: NetworkDevice): string {
  const logging = device.config.logging ?? { console: true, buffered: true, hosts: [], trap: "informational" };
  return [
    `Syslog logging: ${logging.console || logging.buffered || logging.hosts.length ? "enabled" : "disabled"}`,
    `    Console logging: ${logging.console ? "enabled" : "disabled"}`,
    `    Buffer logging: ${logging.buffered ? "enabled" : "disabled"}`,
    `    Trap logging: level ${logging.trap}`,
    `    Logging to hosts: ${logging.hosts.join(", ") || "none"}`,
    ...runtimeLogLines(device.runtime.logs)
  ].join("\n");
}

function serviceLogStatus(device: NetworkDevice, service = ""): string {
  const normalized = service.trim().toLowerCase();
  const services: Record<string, string> = { http: "HTTP", ftp: "FTP", email: "EMAIL", tftp: "TFTP" };
  if (!normalized || normalized === "all" || normalized === "*" || normalized === "syslog") {
    return [`Service log: ${normalized ? normalized.toUpperCase() : "ALL"}`, ...runtimeLogLines(device.runtime.logs)].join("\n");
  }
  const prefix = services[normalized];
  if (!prefix) return "% Usage: show service logs [all|http|ftp|email|tftp|syslog]";
  return [`Service log: ${prefix}`, ...runtimeLogLines(device.runtime.logs.filter((log) => log.message.startsWith(prefix)))].join("\n");
}

function runtimeLogLines(logs: NetworkDevice["runtime"]["logs"]): string[] {
  return logs.length
    ? logs.map((log) => `${new Date(log.createdAt).toLocaleString("ko-KR", { hour12: false })} ${log.level.toUpperCase()}: ${log.message}`)
    : ["No logging messages."];
}

function servicesStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  const services = Object.entries(device.config.services).filter(([name, enabled]) => {
    if (!normalized) return true;
    if (normalized === "enabled") return enabled;
    if (normalized === "disabled") return !enabled;
    return name.toLowerCase().includes(normalized);
  });
  if (!services.length) return `% No service matches ${filter}.`;
  return [
    "Service          State      Detail",
    ...services.map(([name, enabled]) => `${name.toUpperCase().padEnd(16)}${(enabled ? "enabled" : "disabled").padEnd(11)}${serviceDetail(device, name)}`)
  ].join("\n");
}

function serviceDetail(device: NetworkDevice, service: string): string {
  if (service === "dhcp") return `${device.config.dhcpPools.filter((pool) => pool.enabled).length}/${device.config.dhcpPools.length} pools, ${dhcpExcludedRanges(device).length} excluded ranges`;
  if (service === "dns") return `${device.config.dnsRecords.length} host records, ${(device.config.nameServers ?? []).length} name servers`;
  if (service === "http") return `${device.ports.filter((port) => port.adminUp && port.ipAddress).length} listening interfaces, ${serviceLogCount(device, "HTTP")} logs`;
  if (service === "ftp") return `anonymous read-only, readme.txt, running-config.txt, network-backup.ptweb, ${serviceLogCount(device, "FTP")} logs`;
  if (service === "email") return `SMTP/POP3 mailboxes: admin, user, ${serviceLogCount(device, "EMAIL")} logs`;
  if (service === "syslog") return `${device.runtime.logs.length} buffered messages`;
  if (service === "tftp") return `running-config.txt, startup-config, network-backup.ptweb, ${serviceLogCount(device, "TFTP")} logs`;
  return "";
}

function serviceLogCount(device: NetworkDevice, prefix: string): number {
  return device.runtime.logs.filter((log) => log.message.startsWith(prefix)).length;
}

function dhcpBindingStatus(device: NetworkDevice, filter = ""): string {
  const query = filter.trim().toLowerCase();
  const leases = query
    ? device.runtime.dhcpLeases.filter((lease) => lease.ipAddress === query || lease.deviceId.toLowerCase().includes(query) || lease.macAddress.toLowerCase() === query)
    : device.runtime.dhcpLeases;
  if (!leases.length) return query ? `% DHCP binding ${filter} not found.` : "No DHCP bindings.";
  return [
    "Bindings from all pools not associated with VRF:",
    "IP address       Client-ID/              Lease expiration         Type",
    "                 Hardware address/",
    "                 User name",
    ...leases.map((lease) => {
      const expires = new Date(lease.expiresAt).toLocaleString("ko-KR", { hour12: false });
      return `${lease.ipAddress.padEnd(17)}${lease.macAddress.padEnd(24)}${expires.padEnd(25)}Automatic (${lease.deviceId})`;
    })
  ].join("\n");
}

function dhcpServerStatistics(device: NetworkDevice): string {
  const activeLeases = device.runtime.dhcpLeases.filter((lease) => lease.expiresAt > Date.now());
  const configuredPools = device.config.dhcpPools.length;
  const activePools = device.config.dhcpPools.filter((pool) => pool.enabled).length;
  const excludedRanges = dhcpExcludedRanges(device).length;
  return [
    "Memory usage         0",
    `Address pools        ${configuredPools}`,
    "Database agents      0",
    `Automatic bindings   ${activeLeases.length}`,
    "Manual bindings      0",
    "Expired bindings     0",
    "Malformed messages   0",
    "Secure arp entries   0",
    "",
    "Message              Received",
    `BOOTREQUEST          ${activeLeases.length}`,
    `DHCPDISCOVER         ${activeLeases.length}`,
    `DHCPREQUEST          ${activeLeases.length}`,
    "DHCPDECLINE          0",
    "DHCPRELEASE          0",
    "DHCPINFORM           0",
    "",
    "Message              Sent",
    `BOOTREPLY            ${activeLeases.length}`,
    `DHCPOFFER            ${activeLeases.length}`,
    `DHCPACK              ${activeLeases.length}`,
    "DHCPNAK              0",
    "",
    `DHCP service         ${device.config.services.dhcp ? "enabled" : "disabled"}`,
    `Active pools         ${activePools}`,
    `Excluded ranges      ${excludedRanges}`
  ].join("\n");
}

function dhcpPoolStatus(device: NetworkDevice, filter = ""): string {
  if (!device.config.dhcpPools.length) return "No DHCP pools.";
  const query = filter.trim().toLowerCase();
  const pools = query ? device.config.dhcpPools.filter((pool) => pool.name.toLowerCase() === query || pool.name.toLowerCase().includes(query)) : device.config.dhcpPools;
  if (!pools.length) return `% DHCP pool ${filter} not found.`;
  return pools.map((pool) => {
    const leases = device.runtime.dhcpLeases.filter((lease) => poolSubnetReady(pool) && ipInSubnet(lease.ipAddress, pool.network, pool.mask));
    const excluded = dhcpExcludedRanges(device).filter((range) => poolSubnetReady(pool) && ipInSubnet(range.startIp, pool.network, pool.mask)).length;
    return [
      `Pool ${pool.name} :`,
      ` Utilization mark (high/low)    : 100 / 0`,
      ` Subnet size (first/next)       : ${pool.maxLeases} / 0`,
      ` Total addresses                : ${pool.maxLeases}`,
      ` Leased addresses               : ${leases.length}`,
      ` Excluded addresses             : ${excluded}`,
      ` Pending event                  : none`,
      ` 1 subnet is currently in the pool :`,
      ` Current index        IP address range                    Leased/Excluded/Total`,
      ` ${pool.startIp.padEnd(20)}${`${pool.startIp} - ${pool.network}/${maskToPrefix(pool.mask)}`.padEnd(36)}${leases.length} / ${excluded} / ${pool.maxLeases}`,
      ` Default router                 : ${pool.defaultGateway || "not set"}`,
      ` DNS server                     : ${pool.dnsServer || "not set"}`,
      ` State                          : ${pool.enabled ? "active" : "disabled"}`
    ].join("\n");
  }).join("\n\n");
}

function applyLoggingCommand(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  const logging = device.config.logging ?? { console: true, buffered: true, hosts: [], trap: "informational" };
  if (lower === "logging console") return { ...device, config: { ...device.config, logging: { ...logging, console: true } } };
  if (lower === "no logging console") return { ...device, config: { ...device.config, logging: { ...logging, console: false } } };
  if (lower === "logging buffered") return { ...device, config: { ...device.config, logging: { ...logging, buffered: true } } };
  if (lower === "no logging buffered") return { ...device, config: { ...device.config, logging: { ...logging, buffered: false } } };
  if (lower.startsWith("logging trap ")) return { ...device, config: { ...device.config, logging: { ...logging, trap: command.slice("logging trap ".length).trim() || logging.trap } } };
  if (lower.startsWith("logging host ")) {
    const host = command.slice("logging host ".length).trim();
    return isIpv4(host) ? { ...device, config: { ...device.config, logging: { ...logging, hosts: unique([...logging.hosts, host]) } } } : device;
  }
  if (lower.startsWith("no logging host ")) {
    const host = command.slice("no logging host ".length).trim();
    return { ...device, config: { ...device.config, logging: { ...logging, hosts: logging.hosts.filter((item) => item !== host) } } };
  }
  return device;
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

function cableDiagnosticsTest(device: NetworkDevice, name: string): string {
  const port = findPort(device, name);
  if (!port) return `% Interface ${name || "<missing>"} not found.`;
  if (!tdrCapable(port)) return `% TDR is not supported on ${port.name}.`;
  return [
    `TDR test started on ${port.name}.`,
    "A cable diagnostic test can take a few seconds to complete.",
    `Use 'show cable-diagnostics tdr interface ${port.name}' to display the result.`,
    "",
    cableDiagnosticsTdr(device, `interface ${port.name}`)
  ].join("\n");
}

function cableDiagnosticsTdr(device: NetworkDevice, filter = ""): string {
  const target = filter.replace(/^(interface|int)\s+/i, "").trim();
  const selectedPort = target ? findPort(device, target) : undefined;
  if (target && !selectedPort) return `% Interface ${target} not found.`;
  const ports = selectedPort ? [selectedPort] : device.ports.filter((port) => port.kind !== "console");
  if (!ports.length) return "% No interfaces found.";
  return [
    "Interface              Speed    Local pair Pair length        Remote pair Pair status",
    ...ports.map((port) => cableDiagnosticsRow(device, port))
  ].join("\n");
}

function cableDiagnosticsRow(device: NetworkDevice, port: NetworkPort): string {
  const result = tdrResult(device, port);
  return `${port.name.padEnd(22)}${result.speed.padEnd(9)}${result.localPair.padEnd(11)}${result.length.padEnd(19)}${result.remotePair.padEnd(12)}${result.status}`;
}

function tdrResult(device: NetworkDevice, port: NetworkPort): { speed: string; localPair: string; length: string; remotePair: string; status: string } {
  if (!tdrCapable(port)) return { speed: "-", localPair: "-", length: "-", remotePair: "-", status: "Not supported" };
  const speed = port.speed && port.speed !== "auto" ? `${port.speed}M` : port.kind === "gigabit-ethernet" ? "1000M" : "100M";
  if (!device.powerOn || !port.adminUp) return { speed, localPair: "Pair A", length: "N/A", remotePair: "Pair B", status: "Not completed" };
  if (!port.linkId) return { speed, localPair: "Pair A", length: "0 m", remotePair: "Pair B", status: "Open" };
  return { speed, localPair: "Pair A", length: "5 +/- 2 m", remotePair: "Pair B", status: "Normal" };
}

function tdrCapable(port: NetworkPort): boolean {
  return port.kind === "ethernet" || port.kind === "fast-ethernet" || port.kind === "gigabit-ethernet";
}

export function runningConfig(device: NetworkDevice): string {
  const lines = configurationLines(device);
  return [
    "Building configuration...",
    "",
    `Current configuration : ${lines.join("\n").length} bytes`,
    ...lines
  ].join("\n");
}

function startupConfigDisplay(device: NetworkDevice): string {
  const lines = device.config.startupConfig;
  if (!lines.length) return "% Startup config is not saved.";
  return [
    `Using ${lines.join("\n").length} out of 65536 bytes`,
    ...lines
  ].join("\n");
}

function configurationLines(device: NetworkDevice): string[] {
  return compactConfigLines([
    "!",
    `version ${softwareVersion(device)}`,
    "service timestamps debug datetime msec",
    "service timestamps log datetime msec",
    ...(device.config.passwordEncryption ? ["service password-encryption"] : ["no service password-encryption"]),
    "!",
    `hostname ${device.config.hostname}`,
    "!",
    ...(device.config.enableSecret ? [`enable secret ${device.config.enableSecret}`] : []),
    ...(device.config.enablePassword ? [`enable password ${device.config.enablePassword}`] : []),
    ...loggingConfig(device),
    "!",
    ...(device.config.domainLookup === false ? ["no ip domain-lookup"] : []),
    ...(device.config.domainName ? [`ip domain-name ${device.config.domainName}`] : []),
    ...(device.config.sshVersion ? [`ip ssh version ${device.config.sshVersion}`] : []),
    ...(device.config.rsaKeyGenerated ? ["crypto key generate rsa modulus 1024"] : []),
    ...(device.config.defaultGateway ? [`ip default-gateway ${device.config.defaultGateway}`] : []),
    ...(device.config.motdBanner ? [`banner motd #${device.config.motdBanner}#`] : []),
    ...(device.config.nameServers ?? []).map((server) => `ip name-server ${server}`),
    ...localUsers(device).map(localUserConfig),
    "!",
    ...device.config.vlans.flatMap((vlan) => [`vlan ${vlan.id}`, ` name ${vlan.name}`, "!"]),
    ...vtpConfigLines(device),
    ...(vtpConfigLines(device).length ? ["!"] : []),
    ...stpConfigLines(device),
    ...(stpConfigLines(device).length ? ["!"] : []),
    ...cdpConfigLines(device),
    ...(cdpConfigLines(device).length ? ["!"] : []),
    ...lldpConfigLines(device),
    ...(lldpConfigLines(device).length ? ["!"] : []),
    ...dhcpSnoopingConfigLines(device),
    ...(dhcpSnoopingConfigLines(device).length ? ["!"] : []),
    ...device.ports.flatMap((port) => [...interfaceConfig(port), "!"]),
    ...device.config.staticRoutes.map(staticRouteConfig),
    ...device.config.dnsRecords.map((record) => `ip host ${record.name} ${record.value}`),
    "!",
    ...ipSlaConfigLines(device),
    ...(ipSlaConfigLines(device).length ? ["!"] : []),
    ...trackConfigLines(device),
    ...(trackConfigLines(device).length ? ["!"] : []),
    ...accessRulesConfig(device.config.accessRules),
    "!",
    ...prefixListConfigLines(device),
    ...(prefixListConfigLines(device).length ? ["!"] : []),
    ...routeMapConfigLines(device),
    ...(routeMapConfigLines(device).length ? ["!"] : []),
    ...device.config.natRules.map(natRuleConfig),
    ...Object.entries(device.config.services).map(([name, enabled]) => `${enabled ? "" : "no "}service ${name}`),
    ...dhcpExcludedRanges(device).map((range) => `ip dhcp excluded-address ${range.startIp}${range.endIp ? ` ${range.endIp}` : ""}`),
    ...device.config.dhcpPools.flatMap((pool) => [
      `ip dhcp pool ${pool.name}`,
      ` network ${pool.network} ${pool.mask}`,
      ` default-router ${pool.defaultGateway}`,
      ` dns-server ${pool.dnsServer}`,
      ` start-ip ${pool.startIp}`,
      ` max-leases ${pool.maxLeases}`,
      pool.enabled ? " no shutdown" : " shutdown"
    ]),
    "!",
    ...lineConfigs(device).flatMap((line) => [...lineConfig(line), "!"]),
    ...routingProtocols(device).flatMap((protocol) => [...routingProtocolConfig(protocol), "!"]),
    "end"
  ]);
}

function compactConfigLines(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line === "!" && output.at(-1) === "!") continue;
    output.push(line);
  }
  if (output.at(-2) === "!") output.splice(output.length - 2, 1);
  return output;
}

function lineConfig(line: LineConfig): string[] {
  return [
    `line ${line.kind} ${line.range}`,
    ...(line.password ? [` password ${line.password}`] : []),
    line.loginLocal ? " login local" : line.login ? " login" : " no login",
    ...(line.transportInput ? [` transport input ${line.transportInput}`] : []),
    ...(line.execTimeout ? [` exec-timeout ${line.execTimeout}`] : []),
    line.loggingSynchronous ? " logging synchronous" : " no logging synchronous"
  ];
}

function localUserConfig(user: LocalUser): string {
  const privilege = Number.isInteger(user.privilege) ? ` privilege ${user.privilege}` : "";
  return user.secret
    ? `username ${user.name}${privilege} secret ${user.secret}`
    : `username ${user.name}${privilege} password ${user.password ?? ""}`;
}

function routingProtocolConfig(protocol: RoutingProtocol): string[] {
  return [
    `router ${protocol.protocol}${protocol.processId ? ` ${protocol.processId}` : ""}`,
    ...(protocol.routerId ? [` router-id ${protocol.routerId}`] : []),
    ...(protocol.version ? [` version ${protocol.version}`] : []),
    ...protocol.networks.map((network) => ` network ${network}`),
    protocol.autoSummary ? " auto-summary" : " no auto-summary",
    ...(protocol.passiveInterfaceDefault ? [" passive-interface default"] : []),
    ...protocol.passiveInterfaces.map((name) => ` passive-interface ${name}`),
    ...(protocol.passiveInterfaceExceptions ?? []).map((name) => ` no passive-interface ${name}`),
    ...(protocol.redistributeStatic ? [" redistribute static"] : []),
    ...(protocol.defaultInformationOriginate ? [` default-information originate${protocol.defaultInformationAlways ? " always" : ""}`] : [])
  ];
}

function interfaceConfig(port: NetworkPort): string[] {
  const lines = [`interface ${port.name}`];
  if (port.description) lines.push(` description ${port.description}`);
  if (isSubinterfacePort(port) && port.subinterfaceVlan) lines.push(` encapsulation dot1Q ${port.subinterfaceVlan}${port.encapsulationDot1qNative ? " native" : ""}`);
  if (port.mode === "routed" && port.ipAddress) lines.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
  if (port.mode === "routed") {
    for (const secondary of secondaryIpAddresses(port)) lines.push(` ip address ${secondary.ipAddress} ${secondary.subnetMask} secondary`);
  }
  if (port.mode === "access") lines.push(" switchport mode access", ` switchport access vlan ${port.vlan}`);
  if (port.mode === "trunk") lines.push(" switchport mode trunk", ...(port.nativeVlan && port.nativeVlan !== 1 ? [` switchport trunk native vlan ${port.nativeVlan}`] : []), ` switchport trunk allowed vlan ${port.allowedVlans.join(",")}`);
  if (port.voiceVlan) lines.push(` switchport voice vlan ${port.voiceVlan}`);
  if (port.cdpEnabled === false) lines.push(" no cdp enable");
  if (port.lldpTransmit) lines.push(" lldp transmit");
  if (port.lldpReceive) lines.push(" lldp receive");
  if (port.dhcpSnoopingTrusted) lines.push(" ip dhcp snooping trust");
  if (port.dhcpSnoopingRateLimit) lines.push(` ip dhcp snooping limit rate ${port.dhcpSnoopingRateLimit}`);
  if (port.channelGroup) lines.push(` channel-group ${port.channelGroup.id} mode ${port.channelGroup.mode}`);
  if (port.natRole) lines.push(` ip nat ${port.natRole}`);
  for (const helper of port.helperAddresses ?? []) lines.push(` ip helper-address ${helper}`);
  if (port.accessGroupIn) lines.push(` ip access-group ${port.accessGroupIn} in`);
  if (port.accessGroupOut) lines.push(` ip access-group ${port.accessGroupOut} out`);
  if (port.policyRouteMap) lines.push(` ip policy route-map ${port.policyRouteMap}`);
  for (const line of hsrpConfigLines(port)) lines.push(line);
  for (const line of vrrpConfigLines(port)) lines.push(line);
  if (port.stpPortfast) lines.push(" spanning-tree portfast");
  if (port.bpduGuard) lines.push(" spanning-tree bpduguard enable");
  if (port.stpCost) lines.push(` spanning-tree cost ${port.stpCost}`);
  if (port.stpPriority !== undefined) lines.push(` spanning-tree port-priority ${port.stpPriority}`);
  if (port.switchportNonegotiate) lines.push(" switchport nonegotiate");
  lines.push(...portSecurityConfig(port));
  if (port.duplex && port.duplex !== "auto") lines.push(` duplex ${port.duplex}`);
  if (port.speed && port.speed !== "auto") lines.push(` speed ${port.speed}`);
  if (port.mtu && port.mtu !== 1500) lines.push(` mtu ${port.mtu}`);
  if (port.bandwidth) lines.push(` bandwidth ${port.bandwidth}`);
  if (port.kind === "serial" && port.clockRate) lines.push(` clock rate ${port.clockRate}`);
  lines.push(port.adminUp ? " no shutdown" : " shutdown");
  return lines;
}

function defaultBandwidth(port: NetworkPort): number {
  if (port.kind === "gigabit-ethernet" || /gigabit/i.test(port.name)) return 1_000_000;
  if (port.kind === "fast-ethernet" || /fast/i.test(port.name)) return 100_000;
  if (port.kind === "serial") return 1_544;
  return 10_000;
}

function interfaceStatus(device: NetworkDevice, port: NetworkPort): string {
  const operational = interfaceOperational(device, port);
  return [
    `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${operational ? "up" : "down"}`,
    ...(port.description ? [`  Description: ${port.description}`] : []),
    `  Hardware is ${port.kind}, address is ${port.macAddress}`,
    `  Internet address is ${port.ipAddress ? `${port.ipAddress} ${port.subnetMask}` : "unassigned"}`,
    ...(secondaryIpAddresses(port).length ? [`  Secondary Internet addresses: ${secondaryIpAddresses(port).map((address) => `${address.ipAddress} ${address.subnetMask}`).join(", ")}`] : []),
    ...(isSubinterfacePort(port) ? [`  Encapsulation 802.1Q Virtual LAN, Vlan ID ${port.subinterfaceVlan ?? "not set"}${port.encapsulationDot1qNative ? " native" : ""}`] : []),
    `  MTU ${port.mtu ?? 1500} bytes, BW ${port.bandwidth ?? defaultBandwidth(port)} Kbit/sec`,
    `  Full-duplex setting is ${port.duplex ?? "auto"}, media speed is ${port.speed ?? "auto"}`,
    `  Mode ${port.mode}${port.mode === "access" ? `, access VLAN ${port.vlan}` : ""}${port.mode === "trunk" ? `, allowed VLANs ${port.allowedVlans.join(",")}` : ""}`,
    ...(port.voiceVlan ? [`  Voice VLAN ${port.voiceVlan}`] : []),
    ...(port.channelGroup ? [`  Member of channel-group ${port.channelGroup.id}, mode ${port.channelGroup.mode}`] : []),
    ...(portSecurity(port).enabled ? [`  Port security enabled, maximum ${portSecurity(port).maximum}, violation ${portSecurity(port).violation}`] : []),
    ...(port.kind === "serial" ? [`  Clock rate ${port.clockRate ?? "not set"}`] : []),
    `  ${port.linkId ? "Connected" : "Not connected"}`
  ].join("\n");
}

function interfaceDescriptions(device: NetworkDevice): string {
  return [
    "Interface                      Status         Protocol Description",
    ...device.ports.map((port) => {
      const status = device.powerOn && port.adminUp ? "up" : "admin down";
      const protocol = interfaceOperational(device, port) ? "up" : "down";
      return `${port.name.padEnd(30)}${status.padEnd(15)}${protocol.padEnd(9)}${port.description || ""}`;
    })
  ].join("\n");
}

function interfacesStatus(device: NetworkDevice, selectedPort?: NetworkPort): string {
  return ["Port                  Name               Status       Vlan  Duplex Speed Type", ...(selectedPort ? [selectedPort] : device.ports)
    .filter((port) => port.kind !== "console")
    .map((port) => {
      const status = interfaceOperational(device, port) ? "connected" : port.adminUp ? "notconnect" : "disabled";
      const vlan = port.mode === "trunk" ? "trunk" : port.mode === "routed" ? "routed" : String(port.vlan);
      return `${port.name.padEnd(22)}${(port.description || "").slice(0, 16).padEnd(19)}${status.padEnd(13)}${vlan.padEnd(6)}${(port.duplex ?? "auto").padEnd(7)}${(port.speed ?? "auto").padEnd(6)}${port.kind}`;
    })].join("\n");
}

function interfaceCounters(device: NetworkDevice, selectedPort?: NetworkPort): string {
  return [
    "Port                  InOctets     InUcastPkts  InMcastPkts  OutOctets    OutUcastPkts OutMcastPkts",
    ...(selectedPort ? [selectedPort] : device.ports)
      .filter((port) => port.kind !== "console")
      .map((port, index) => {
        const learnedMacs = device.runtime.macTable.filter((entry) => entry.portName === port.name).length;
        const learnedArps = device.runtime.arpTable.filter((entry) => entry.portName === port.name).length;
        const active = interfaceOperational(device, port);
        const base = active ? (index + 1) * 128 : 0;
        const inOctets = base + learnedMacs * 64 + learnedArps * 84;
        const outOctets = active ? base + 96 : 0;
        return `${port.name.padEnd(22)}${String(inOctets).padEnd(13)}${String(learnedMacs + learnedArps).padEnd(13)}${String(active ? 1 : 0).padEnd(13)}${String(outOctets).padEnd(13)}${String(active ? 1 : 0).padEnd(13)}${active ? 1 : 0}`;
      })
  ].join("\n");
}

function ipInterfaceStatus(device: NetworkDevice, selectedPort?: NetworkPort): string {
  const ports = selectedPort ? [selectedPort] : device.ports.filter((port) => port.kind !== "console");
  return ports.map((port) => {
    const operational = interfaceOperational(device, port);
    const ipLine = port.ipAddress
      ? `  Internet address is ${port.ipAddress}/${maskToPrefix(port.subnetMask)}`
      : "  Internet protocol processing disabled";
    return [
      `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${operational ? "up" : "down"}`,
      ipLine,
      ...secondaryIpAddresses(port).map((address) => `  Secondary address ${address.ipAddress}/${maskToPrefix(address.subnetMask)}`),
      ...(isSubinterfacePort(port) ? [`  802.1Q VLAN ID is ${port.subinterfaceVlan ?? "not configured"}${port.encapsulationDot1qNative ? " native" : ""}`] : []),
      `  Broadcast address is 255.255.255.255`,
      `  Address determined by ${port.ipAddress ? "manual configuration" : "unset"}`,
      `  MTU is 1500 bytes`,
      `  Helper address is ${(port.helperAddresses ?? []).join(", ") || "not set"}`,
      `  HSRP groups are ${hsrpGroups(port).length ? hsrpGroups(port).map((group) => `${group.group}:${group.virtualIp || "no-ip"}`).join(", ") : "not configured"}`,
      `  Directed broadcast forwarding is disabled`,
      `  Outgoing access list is ${port.accessGroupOut || "not set"}`,
      `  Inbound access list is ${port.accessGroupIn || "not set"}`,
      `  Policy route-map is ${port.policyRouteMap || "not set"}`,
      `  Proxy ARP is enabled`,
      `  ICMP redirects are always sent`
    ].join("\n");
  }).join("\n\n");
}

function switchportStatus(device: NetworkDevice, selectedPort?: NetworkPort): string {
  return (selectedPort ? [selectedPort] : device.ports)
    .filter((port) => port.kind !== "console")
    .map((port) => [
      `Name: ${port.name}`,
      `Switchport: ${port.mode === "routed" ? "Disabled" : "Enabled"}`,
      `Administrative Mode: ${port.mode}`,
      `Operational Mode: ${port.mode}`,
      `Access Mode VLAN: ${port.vlan}`,
      `Trunking VLANs Enabled: ${port.mode === "trunk" ? port.allowedVlans.join(",") : "none"}`,
      `Native VLAN: ${port.nativeVlan ?? 1}`,
      `Negotiation of Trunking: ${port.switchportNonegotiate ? "Off" : "On"}`,
      `Voice VLAN: ${port.voiceVlan ?? "none"}`,
      `Channel-group: ${port.channelGroup ? `${port.channelGroup.id} mode ${port.channelGroup.mode}` : "none"}`,
      `Port Security: ${portSecurity(port).enabled ? "Enabled" : "Disabled"}`
    ].join("\n"))
    .join("\n\n") || "% No switchport interfaces.";
}

function vlanBrief(device: NetworkDevice): string {
  return ["VLAN  Name", ...device.config.vlans.map((vlan) => `${vlan.id.toString().padEnd(6)}${vlan.name}`)].join("\n");
}

function vlanSummary(device: NetworkDevice): string {
  const activeVlans = device.config.vlans.length;
  const accessPorts = device.ports.filter((port) => port.mode === "access").length;
  const trunkPorts = device.ports.filter((port) => port.mode === "trunk").length;
  return [
    "Number of existing VLANs                : " + activeVlans,
    "Number of existing VTP VLANs            : " + activeVlans,
    "Number of active VLANs                  : " + activeVlans,
    "Number of access ports                  : " + accessPorts,
    "Number of trunk ports                   : " + trunkPorts
  ].join("\n");
}

function vlanDetail(device: NetworkDevice, filter: string): string {
  const tokens = filter.split(/\s+/);
  const id = tokens[0] === "id" ? Number(tokens[1]) : Number(tokens[0]);
  const name = tokens[0] === "name" ? tokens.slice(1).join(" ").toLowerCase() : "";
  const vlan = Number.isInteger(id)
    ? device.config.vlans.find((item) => item.id === id)
    : device.config.vlans.find((item) => item.name.toLowerCase() === name);
  if (!vlan) return "% VLAN not found.";
  const accessPorts = device.ports.filter((port) => port.mode === "access" && port.vlan === vlan.id).map((port) => port.name);
  const trunkPorts = device.ports.filter((port) => port.mode === "trunk" && port.allowedVlans.includes(vlan.id)).map((port) => port.name);
  return [
    "VLAN  Name                             Status    Ports",
    `${String(vlan.id).padEnd(6)}${vlan.name.padEnd(33)}active    ${accessPorts.join(", ") || "-"}`,
    "",
    `Trunk ports allowing VLAN ${vlan.id}: ${trunkPorts.join(", ") || "none"}`
  ].join("\n");
}

function arpTableStatus(device: NetworkDevice, filter = ""): string {
  const query = filter.trim().toLowerCase();
  const entries = query
    ? device.runtime.arpTable.filter((entry) =>
      entry.ipAddress === query ||
      normalizeMacAddress(entry.macAddress) === normalizeMacAddress(query) ||
      entry.portName.toLowerCase().includes(query)
    )
    : device.runtime.arpTable;
  if (!entries.length) return query ? `% ARP entry ${filter} not found.` : "No ARP entries.";
  return [
    "Protocol  Address         Hardware Addr       Interface",
    ...entries.map((entry) => `Internet  ${entry.ipAddress.padEnd(16)}${entry.macAddress.padEnd(20)}${entry.portName}`)
  ].join("\n");
}

function macAddressTable(device: NetworkDevice, lower: string): string {
  let entries = [...device.runtime.macTable];
  const vlanMatch = lower.match(/\bvlan\s+(\d+)/);
  const interfaceMatch = lower.match(/\binterface\s+(.+)$/);
  const addressMatch = lower.match(/\baddress\s+([0-9a-f:.:-]+)/);
  if (lower.includes(" dynamic")) entries = entries.filter((entry) => entry.type === "dynamic");
  if (lower.includes(" static")) entries = entries.filter((entry) => entry.type === "static");
  if (vlanMatch) entries = entries.filter((entry) => entry.vlan === Number(vlanMatch[1]));
  if (addressMatch) entries = entries.filter((entry) => normalizeMacAddress(entry.macAddress) === normalizeMacAddress(addressMatch[1]));
  if (interfaceMatch) {
    const port = findPort(device, interfaceMatch[1]);
    entries = entries.filter((entry) => port ? entry.portName === port.name : entry.portName.toLowerCase() === interfaceMatch[1].toLowerCase());
  }
  return entries.length
    ? ["Vlan  Mac Address         Type      Ports", ...entries.map((entry) => `${String(entry.vlan).padEnd(6)}${entry.macAddress.padEnd(20)}${entry.type.padEnd(10)}${entry.portName}`)].join("\n")
    : "No entries learned.";
}

function normalizeMacAddress(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-f]/g, "");
}

function trunkStatus(device: NetworkDevice): string {
  const trunks = device.ports.filter((port) => port.mode === "trunk");
  if (trunks.length === 0) return "No trunking interfaces.";
  return [
    "Port                  Mode         Status        Native vlan",
    ...trunks.map((port) => `${port.name.padEnd(22)}on           ${(device.powerOn && port.adminUp ? "trunking" : "disabled").padEnd(14)}${port.nativeVlan ?? 1}`),
    "",
    "Port                  Vlans allowed on trunk",
    ...trunks.map((port) => `${port.name.padEnd(22)}${port.allowedVlans.join(",") || "none"}`)
  ].join("\n");
}

function etherChannelStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  const groups = etherChannelGroups(device);
  if (!groups.length) return "No EtherChannel groups configured.";
  if (normalized === "summary" || !normalized) return etherChannelSummary(device, groups);
  if (normalized === "port-channel") return etherChannelPortChannelStatus(device, groups);
  const detailMatch = normalized.match(/^(\d+)\s+detail$/);
  if (detailMatch) {
    const id = Number(detailMatch[1]);
    const group = groups.find((item) => item.id === id);
    return group ? etherChannelDetail(device, group) : `% EtherChannel group ${id} not found.`;
  }
  return "% Usage: show etherchannel [summary|port-channel|<group> detail]";
}

function etherChannelSummary(device: NetworkDevice, groups: Array<{ id: number; ports: NetworkPort[] }>): string {
  return [
    "Flags:  D - down        P - bundled in port-channel",
    "        I - stand-alone s - suspended",
    "        R - Layer3      S - Layer2",
    "        U - in use",
    "",
    "Group  Port-channel  Protocol    Ports",
    ...groups.map((group) => {
      const mode = group.ports[0]?.channelGroup?.mode ?? "on";
      const protocol = mode === "active" || mode === "passive" ? "LACP" : mode === "desirable" || mode === "auto" ? "PAgP" : "-";
      const flags = group.ports.some((port) => device.powerOn && port.adminUp) ? "SU" : "SD";
      const portFlags = group.ports.map((port) => `${shortPortAlias(port.name)}(${device.powerOn && port.adminUp ? "P" : "D"})`).join(" ");
      return `${String(group.id).padEnd(7)}Po${String(group.id).padEnd(12)}${flags.padEnd(4)}${protocol.padEnd(12)}${portFlags}`;
    })
  ].join("\n");
}

function etherChannelPortChannelStatus(device: NetworkDevice, groups: Array<{ id: number; ports: NetworkPort[] }>): string {
  return groups.map((group) => [
    `Port-channel: Po${group.id}`,
    `------------`,
    `Age of the Port-channel   = simulated`,
    `Logical slot/port          = ${group.id}/0`,
    `Number of ports           = ${group.ports.length}`,
    `HotStandBy port           = null`,
    `Port state                = ${group.ports.some((port) => device.powerOn && port.adminUp) ? "Port-channel Ag-Inuse" : "Port-channel Ag-Not-Inuse"}`,
    `Protocol                  = ${etherChannelProtocol(group.ports[0])}`
  ].join("\n")).join("\n\n");
}

function etherChannelDetail(device: NetworkDevice, group: { id: number; ports: NetworkPort[] }): string {
  return [
    `Group state = ${group.ports.some((port) => device.powerOn && port.adminUp) ? "L2" : "Down"}`,
    `Ports: ${group.ports.length}   Maxports = 16`,
    `Port-channels: 1 Max Port-channels = 1`,
    `Protocol: ${etherChannelProtocol(group.ports[0])}`,
    "",
    `                Ports in the group:`,
    ...group.ports.map((port) => `                ${port.name}     ${device.powerOn && port.adminUp ? "Active" : "Down"}   mode ${port.channelGroup?.mode ?? "on"}`)
  ].join("\n");
}

function etherChannelGroups(device: NetworkDevice): Array<{ id: number; ports: NetworkPort[] }> {
  const byId = new Map<number, NetworkPort[]>();
  for (const port of device.ports.filter((item) => item.channelGroup)) {
    const id = port.channelGroup!.id;
    byId.set(id, [...(byId.get(id) ?? []), port]);
  }
  return [...byId.entries()].map(([id, ports]) => ({ id, ports })).sort((left, right) => left.id - right.id);
}

function etherChannelProtocol(port: NetworkPort | undefined): string {
  const mode = port?.channelGroup?.mode ?? "on";
  if (mode === "active" || mode === "passive") return "LACP";
  if (mode === "desirable" || mode === "auto") return "PAgP";
  return "-";
}

function errdisableRecoveryStatus(device: NetworkDevice): string {
  const recovery = errdisableRecovery(device);
  const candidates = device.ports.filter((port) => port.bpduGuard && port.stpPortfast).map((port) => `  ${port.name}`);
  return [
    "ErrDisable Reason            Timer Status",
    `bpduguard                    ${recovery.bpduguard ? "Enabled" : "Disabled"}`,
    "",
    `Timer interval: ${recovery.interval} seconds`,
    "Interfaces that will be enabled at the next timeout:",
    candidates.length ? candidates.join("\n") : "  none"
  ].join("\n");
}

function cdpStatus(device: NetworkDevice, filter = ""): string {
  const cdp = cdpConfig(device);
  const normalized = filter.trim().toLowerCase();
  if (normalized.startsWith("interface")) {
    const name = filter.trim().slice("interface".length).trim();
    return cdpInterfaceStatus(device, name);
  }
  if (normalized.startsWith("neighbors")) {
    if (!cdp.enabled) return "% CDP is not enabled";
    return [
      "Capability Codes: R - Router, S - Switch, H - Host, I - IGMP, r - Repeater",
      "% CDP neighbor topology is resolved by the editor workspace. Use the device CLI window to view live project neighbors."
    ].join("\n");
  }
  if (normalized && normalized !== "run") return "% Usage: show cdp [interface [name]|neighbors [detail]]";
  return [
    "Global CDP information:",
    `    Sending CDP packets every ${cdp.timer} seconds`,
    `    Sending a holdtime value of ${cdp.holdtime} seconds`,
    `    Sending CDPv${cdp.version} advertisements is ${cdp.version === "2" ? "enabled" : "disabled"}`,
    `    CDP is ${cdp.enabled ? "enabled" : "not enabled"} globally`,
    `    CDP enabled interfaces: ${device.ports.filter((port) => port.kind !== "console" && port.cdpEnabled !== false).length}`
  ].join("\n");
}

function cdpInterfaceStatus(device: NetworkDevice, name = ""): string {
  const cdp = cdpConfig(device);
  const ports = name ? [findPort(device, name)].filter((port): port is NetworkPort => Boolean(port)) : device.ports.filter((port) => port.kind !== "console");
  if (name && !ports.length) return `% Interface ${name} not found.`;
  return [
    "Interface              CDP state     Timer  Holdtime Encapsulation",
    ...ports.map((port) => `${port.name.padEnd(23)}${(cdp.enabled && port.cdpEnabled !== false ? "enabled" : "disabled").padEnd(14)}${String(cdp.timer).padEnd(7)}${String(cdp.holdtime).padEnd(9)}${port.kind === "serial" ? "HDLC" : "ARPA"}`)
  ].join("\n");
}

function lldpStatus(device: NetworkDevice, filter = ""): string {
  const lldp = lldpConfig(device);
  const normalized = filter.trim().toLowerCase();
  if (normalized.startsWith("interface")) {
    const name = filter.trim().slice("interface".length).trim();
    return lldpInterfaceStatus(device, name);
  }
  if (normalized.startsWith("neighbors")) {
    if (!lldp.enabled) return "% LLDP is not enabled";
    return [
      "Capability codes:",
      "    (R) Router, (B) Bridge, (W) WLAN Access Point, (H) Host",
      "% LLDP neighbor topology is resolved by the editor workspace. Use the device CLI window to view live project neighbors."
    ].join("\n");
  }
  if (normalized) return "% Usage: show lldp [interface [name]|neighbors [detail]]";
  return [
    "Global LLDP information:",
    `    LLDP is ${lldp.enabled ? "enabled" : "not enabled"}`,
    `    Transmission timer: ${lldp.timer} seconds`,
    `    Holdtime: ${lldp.holdtime} seconds`,
    `    Reinitialization delay: ${lldp.reinitDelay} seconds`,
    `    LLDP TX interfaces: ${device.ports.filter((port) => port.kind !== "console" && port.lldpTransmit).length}`,
    `    LLDP RX interfaces: ${device.ports.filter((port) => port.kind !== "console" && port.lldpReceive).length}`
  ].join("\n");
}

function lldpInterfaceStatus(device: NetworkDevice, name = ""): string {
  const lldp = lldpConfig(device);
  const ports = name ? [findPort(device, name)].filter((port): port is NetworkPort => Boolean(port)) : device.ports.filter((port) => port.kind !== "console");
  if (name && !ports.length) return `% Interface ${name} not found.`;
  return [
    "Interface              Tx        Rx        State",
    ...ports.map((port) => {
      const txConfigured = Boolean(port.lldpTransmit);
      const rxConfigured = Boolean(port.lldpReceive);
      const operational = lldp.enabled && (txConfigured || rxConfigured);
      return `${port.name.padEnd(23)}${(txConfigured ? "enabled" : "disabled").padEnd(10)}${(rxConfigured ? "enabled" : "disabled").padEnd(10)}${operational ? "active" : "inactive"}`;
    })
  ].join("\n");
}

function dhcpSnoopingStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  if (normalized === "binding" || normalized.startsWith("binding ")) {
    const query = filter.trim().slice("binding".length).trim();
    return dhcpSnoopingBindingStatus(device, query);
  }
  if (normalized && normalized !== "vlan") return "% Usage: show ip dhcp snooping [binding]";
  const snooping = dhcpSnoopingConfig(device);
  const enabledVlans = snooping.vlans.length ? snooping.vlans.join(",") : "none";
  return [
    `Switch DHCP snooping is ${snooping.enabled ? "enabled" : "disabled"}`,
    `DHCP snooping is configured on following VLANs: ${enabledVlans}`,
    `DHCP snooping is operational on following VLANs: ${snooping.enabled ? enabledVlans : "none"}`,
    `DHCP snooping verify mac-address is ${snooping.verifyMacAddress ? "enabled" : "disabled"}`,
    "",
    "Interface              Trusted    Rate limit (pps)",
    ...device.ports
      .filter((port) => port.kind !== "console")
      .map((port) => `${port.name.padEnd(23)}${(port.dhcpSnoopingTrusted ? "yes" : "no").padEnd(11)}${port.dhcpSnoopingRateLimit ?? "unlimited"}`)
  ].join("\n");
}

function vtpStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  const vtp = vtpConfig(device);
  const domain = vtp.domain || "(not configured)";
  const trunkCount = device.ports.filter((port) => port.mode === "trunk").length;
  if (!normalized || normalized === "status") {
    return [
      `VTP Version                     : ${vtp.version}`,
      `Configuration Revision          : ${vtp.mode === "transparent" || vtp.mode === "off" ? 0 : vtp.revision}`,
      "Maximum VLANs supported locally : 1005",
      `Number of existing VLANs        : ${device.config.vlans.length}`,
      `VTP Operating Mode              : ${capitalize(vtp.mode)}`,
      `VTP Domain Name                 : ${domain}`,
      `VTP Pruning Mode                : ${vtp.pruning ? "Enabled" : "Disabled"}`,
      `VTP V2 Mode                     : ${vtp.version === "2" ? "Enabled" : "Disabled"}`,
      `VTP Traps Generation            : Disabled`,
      `MD5 digest                      : ${vtp.password ? vtpDigest(device) : "0x00000000000000000000000000000000"}`
    ].join("\n");
  }
  if (normalized === "counters") {
    return [
      "VTP statistics:",
      `Summary advertisements received : ${trunkCount}`,
      `Subset advertisements received  : ${Math.max(0, device.config.vlans.length - 1)}`,
      `Request advertisements received : 0`,
      `Summary advertisements transmitted : ${vtp.mode === "client" || vtp.mode === "off" ? 0 : trunkCount}`,
      `Subset advertisements transmitted  : ${vtp.mode === "client" || vtp.mode === "off" ? 0 : Math.max(0, device.config.vlans.length - 1)}`,
      `Config revision errors          : 0`,
      `Config digest errors            : 0`
    ].join("\n");
  }
  if (normalized === "password") {
    return vtp.password ? `VTP Password: ${vtp.password}` : "The VTP password is not configured.";
  }
  return "% Usage: show vtp [status|counters|password]";
}

function dhcpSnoopingBindingStatus(device: NetworkDevice, filter = ""): string {
  const query = filter.trim().toLowerCase();
  const entries = device.runtime.dhcpLeases
    .filter((lease) => !query || lease.ipAddress === query || normalizeMacAddress(lease.macAddress) === normalizeMacAddress(query) || lease.deviceId.toLowerCase().includes(query));
  if (!entries.length) return query ? `% DHCP snooping binding ${filter} not found.` : "MacAddress          IpAddress        Lease(sec) Type           VLAN Interface";
  return [
    "MacAddress          IpAddress        Lease(sec) Type           VLAN Interface",
    ...entries.map((lease) => {
      const port = device.ports.find((item) => item.macAddress === lease.macAddress || item.name === lease.deviceId);
      return `${lease.macAddress.padEnd(20)}${lease.ipAddress.padEnd(17)}${String(Math.max(0, Math.round((lease.expiresAt - Date.now()) / 1000))).padEnd(11)}dhcp-snooping  1    ${port?.name ?? lease.deviceId}`;
    })
  ].join("\n");
}

function portSecurityStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  if (normalized.startsWith("interface ")) {
    const name = filter.trim().slice("interface ".length);
    const port = findPort(device, name);
    return port ? portSecurityInterfaceStatus(device, port) : `% Interface ${name} not found.`;
  }
  if (normalized === "address" || normalized.startsWith("address ")) return portSecurityAddressStatus(device, filter.trim().slice("address".length).trim());
  const ports = device.ports.filter((port) => port.kind !== "console" && portSecurity(port).enabled);
  if (!ports.length) return "No secure ports configured.";
  return [
    "Secure Port          MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action",
    ...ports.map((port) => {
      const security = portSecurity(port);
      return `${port.name.padEnd(21)}${String(security.maximum).padEnd(15)}${String(secureAddressCount(device, port)).padEnd(13)}${String(0).padEnd(19)}${security.violation}`;
    })
  ].join("\n");
}

function portSecurityInterfaceStatus(device: NetworkDevice, port: NetworkPort): string {
  const security = portSecurity(port);
  const learned = device.runtime.macTable.filter((entry) => entry.portName === port.name).map((entry) => normalizeSecureMacAddress(entry.macAddress)).filter((value): value is string => Boolean(value));
  const configured = security.secureMacAddresses;
  const active = unique([...configured, ...(security.sticky ? learned : [])]).slice(0, security.maximum);
  return [
    `Port Security              : ${security.enabled ? "Enabled" : "Disabled"}`,
    `Port Status                : ${device.powerOn && port.adminUp ? "Secure-up" : "Secure-down"}`,
    `Violation Mode             : ${security.violation}`,
    `Aging Time                 : 0 mins`,
    `Maximum MAC Addresses      : ${security.maximum}`,
    `Total MAC Addresses        : ${active.length}`,
    `Configured MAC Addresses   : ${configured.length}`,
    `Sticky MAC Addresses       : ${security.sticky ? active.length : 0}`,
    `Last Source Address:Vlan   : ${active[0] ?? "0000.0000.0000"}:${port.vlan}`,
    `Security Violation Count   : 0`
  ].join("\n");
}

function portSecurityAddressStatus(device: NetworkDevice, filter = ""): string {
  const query = normalizeSecureMacAddress(filter);
  const rows = device.ports
    .filter((port) => port.kind !== "console" && portSecurity(port).enabled)
    .flatMap((port) => {
      const security = portSecurity(port);
      const configuredRows = security.secureMacAddresses.map((macAddress) => ({ port, macAddress, type: security.sticky ? "SecureSticky" : "SecureConfigured" }));
      const stickyRows = security.sticky
        ? device.runtime.macTable
          .filter((entry) => entry.portName === port.name)
          .map((entry) => normalizeSecureMacAddress(entry.macAddress))
          .filter((macAddress): macAddress is string => Boolean(macAddress) && !security.secureMacAddresses.includes(macAddress))
          .map((macAddress) => ({ port, macAddress, type: "SecureSticky" }))
        : [];
      return [...configuredRows, ...stickyRows];
    })
    .filter((row) => !query || row.macAddress === query);
  if (!rows.length) return query ? `% Secure MAC ${filter} not found.` : "No secure MAC addresses configured.";
  return [
    "Secure Mac Address   Type              Ports",
    ...rows.map((row) => `${row.macAddress.padEnd(21)}${row.type.padEnd(18)}${row.port.name}`)
  ].join("\n");
}

function showUsers(device: NetworkDevice, session?: CliSession): string {
  const vtyLines = lineConfigs(device).filter((line) => line.kind === "vty");
  return [
    "Line       User       Host(s)              Idle       Location",
    `* 0 con 0  ${(session?.authUsername ?? "console").padEnd(10)}idle                 00:00:00   local`,
    ...vtyLines.map((line, index) => {
      const user = line.loginLocal ? "<local>" : line.login ? "<password>" : "-";
      return `  ${String(index + 1).padStart(1)} vty ${line.range.padEnd(5)}${user.padEnd(11)}not connected        -          transport ${line.transportInput || "none"}`;
    })
  ].join("\n");
}

function lineStatus(device: NetworkDevice, filter = ""): string {
  const configuredLines = lineConfigs(device);
  const consoleLine = configuredLines.find((line) => line.kind === "console" && line.range === "0") ?? defaultLineConfig("console", "0");
  const configs = [
    consoleLine,
    ...configuredLines.filter((line) => !(line.kind === consoleLine.kind && line.range === consoleLine.range))
  ].filter((line, index, lines) => lines.findIndex((item) => item.kind === line.kind && item.range === line.range) === index)
    .filter((line) => lineMatchesFilter(line, filter));
  if (!configs.length) return "% No matching line configuration.";
  return [
    "Line(s)                 Type     Login        Transport       Exec-timeout   Logging",
    ...configs.map((line) => [
      lineDisplayName(line).padEnd(24),
      (line.kind === "console" ? "CTY" : "VTY").padEnd(9),
      lineAuthMode(line).padEnd(13),
      (line.transportInput || "none").padEnd(16),
      (line.execTimeout || "10 0").padEnd(14),
      line.loggingSynchronous ? "synchronous" : "standard"
    ].join(""))
  ].join("\n");
}

function lineMatchesFilter(line: LineConfig, filter: string): boolean {
  if (!filter) return true;
  const normalized = filter.toLowerCase();
  return line.kind.includes(normalized) || lineDisplayName(line).toLowerCase().includes(normalized) || line.range.toLowerCase().includes(normalized);
}

function lineDisplayName(line: LineConfig): string {
  return `${line.kind} ${line.range}`;
}

function lineAuthMode(line: LineConfig): string {
  if (line.loginLocal) return "login local";
  if (line.login) return "login";
  return "no login";
}

function protocolsStatus(device: NetworkDevice, filter = ""): string {
  const selectedPort = filter ? findPort(device, filter) : undefined;
  const ports = selectedPort ? [selectedPort] : filter ? [] : device.ports;
  if (filter && !selectedPort) return `% Interface ${filter} not found.`;
  return ports
    .filter((port) => port.kind !== "console")
    .map((port) => `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${interfaceOperational(device, port) ? "up" : "down"}${port.ipAddress ? `\n  Internet address is ${port.ipAddress}/${maskToPrefix(port.subnetMask)}` : ""}`)
    .join("\n\n") || "No protocol interfaces.";
}

function spanningTreeStatus(device: NetworkDevice, filter = ""): string {
  const requestedVlans = filter.startsWith("vlan ") ? parseVlans(filter.slice("vlan ".length)) : [];
  const roots = new Set(device.config.stpRootPrimaryVlans ?? []);
  const secondaryRoots = new Set(device.config.stpRootSecondaryVlans ?? []);
  const vlans = (device.config.vlans.length ? device.config.vlans : [{ id: 1, name: "default" }])
    .filter((vlan) => !requestedVlans.length || requestedVlans.includes(vlan.id));
  if (!vlans.length) return "% VLAN not found.";
  return vlans.map((vlan) => [
    `VLAN${String(vlan.id).padStart(4, "0")}`,
    `  Spanning tree enabled protocol ${device.config.stpMode === "rapid-pvst" ? "rstp" : "ieee"}`,
    `  Root ID    Priority    ${(roots.has(vlan.id) ? 24576 : secondaryRoots.has(vlan.id) ? 28672 : 32768) + vlan.id}`,
    `             Address     ${device.ports[0]?.macAddress ?? "02:00:00:00:00:00"}`,
    roots.has(vlan.id) ? "             This bridge is the root" : secondaryRoots.has(vlan.id) ? "             This bridge is the secondary root" : "             Root bridge priority is default",
    "",
    "  Interface              Role Sts Cost      Prio.Nbr Type",
    ...device.ports
      .filter((port) => port.kind !== "console" && (port.mode === "access" ? port.vlan === vlan.id : port.mode === "trunk" ? port.allowedVlans.includes(vlan.id) : false))
      .map((port, index) => {
        const cost = port.stpCost ?? (port.kind.includes("gigabit") || port.kind === "fiber" ? 4 : 19);
        const priority = port.stpPriority ?? 128;
        return `${port.name.padEnd(23)}Desg ${port.adminUp && device.powerOn ? "FWD" : "BLK"} ${String(cost).padEnd(9)}${priority}.${String(index + 1).padEnd(4)}${port.stpPortfast ? "P2p Edge" : "P2p"}${port.bpduGuard ? " BPDU Guard" : ""}`;
      })
  ].join("\n")).join("\n\n");
}

function standbyStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  const brief = normalized === "brief";
  const interfaceFilter = brief ? "" : normalized.replace(/^interface\s+/i, "").trim();
  const rows = device.ports
    .filter((port) => !interfaceFilter || portNameMatches(port.name, interfaceFilter))
    .flatMap((port) => hsrpGroups(port).map((group) => ({ port, group })));
  if (interfaceFilter && !device.ports.some((port) => portNameMatches(port.name, interfaceFilter))) return `% Interface ${filter} not found.`;
  if (!rows.length) return "No HSRP groups configured.";
  if (brief) {
    return [
      "Interface              Grp  Pri P State   Active          Standby         Virtual IP",
      ...rows.map(({ port, group }) => {
        const priority = hsrpEffectivePriority(device, group);
        const state = hsrpState(device, port, group);
        return `${port.name.padEnd(23)}${String(group.group).padEnd(5)}${String(priority).padEnd(4)}${(group.preempt ? "P" : " ").padEnd(2)}${state.padEnd(8)}${"local".padEnd(16)}${"unknown".padEnd(16)}${group.virtualIp || "not set"}`;
      })
    ].join("\n");
  }
  return rows.map(({ port, group }) => {
    const priority = hsrpEffectivePriority(device, group);
    const trackedPort = group.trackInterface ? findPort(device, group.trackInterface) : undefined;
    const trackedObject = group.trackObject ? trackObjects(device).find((track) => track.trackId === group.trackObject) : undefined;
    const state = hsrpState(device, port, group);
    return [
      `${port.name} - Group ${group.group} (HSRP-V${group.version})`,
      `  State is ${state}`,
      `  Virtual IP address is ${group.virtualIp || "not configured"}`,
      `  Active virtual MAC address is ${hsrpVirtualMac(group)}`,
      `  Local virtual MAC address is ${hsrpVirtualMac(group)}`,
      `  Hellotime 3 sec, holdtime 10 sec`,
      `  Preemption ${group.preempt ? "enabled" : "disabled"}`,
      `  Active router is local`,
      `  Standby router is unknown`,
      `  Priority ${group.priority} (effective ${priority})`,
      ...(group.trackInterface ? [`  Track interface ${group.trackInterface} ${trackedPort && device.powerOn && trackedPort.adminUp ? "up" : "down"}, decrement ${group.trackDecrement ?? 10}`] : []),
      ...(group.trackObject ? [`  Track object ${group.trackObject} ${trackedObject && trackObjectCliUp(device, trackedObject) ? "up" : "down"}, decrement ${group.trackDecrement ?? 10}`] : []),
      `  Group name is hsrp-${group.group}`
    ].join("\n");
  }).join("\n\n");
}

function hsrpConfigLines(port: NetworkPort): string[] {
  return hsrpGroups(port).flatMap((group) => [
    ...(group.version !== "1" ? [` standby ${group.group} version ${group.version}`] : []),
    ...(group.virtualIp ? [` standby ${group.group} ip ${group.virtualIp}`] : []),
    ...(group.priority !== 100 ? [` standby ${group.group} priority ${group.priority}`] : []),
    ...(group.preempt ? [` standby ${group.group} preempt`] : []),
    ...(group.trackInterface ? [` standby ${group.group} track ${group.trackInterface}${group.trackDecrement ? ` decrement ${group.trackDecrement}` : ""}`] : []),
    ...(group.trackObject ? [` standby ${group.group} track ${group.trackObject}${group.trackDecrement ? ` decrement ${group.trackDecrement}` : ""}`] : [])
  ]);
}

function applyStandbyInterfaceCommand(device: NetworkDevice, port: NetworkPort, session: CliSession, command: string): CliResult {
  if (port.mode !== "routed" && !port.ipCapable) return result(device, session, "% HSRP is supported on routed or IP-capable interfaces only.");
  const parsed = parseStandbyCommand(command);
  if (!parsed) return result(device, session, "% Usage: standby <group> ip|priority|preempt|version|track ...");
  if (parsed.kind === "remove-group") return result(updatePort(device, port.id, { hsrpGroups: hsrpGroups(port).filter((group) => group.group !== parsed.group) }), session, "");
  if (parsed.kind === "ip") {
    if (!isIpv4(parsed.virtualIp)) return result(device, session, "% Usage: standby <group> ip <address>");
    if (port.ipAddress && port.subnetMask && !ipInSubnet(parsed.virtualIp, port.ipAddress, port.subnetMask)) return result(device, session, "% HSRP virtual IP must be within the interface subnet.");
  }
  if (parsed.kind === "priority" && (parsed.priority < 0 || parsed.priority > 255)) return result(device, session, "% HSRP priority must be 0-255.");
  if (parsed.kind === "version" && parsed.version !== "1" && parsed.version !== "2") return result(device, session, "% HSRP version must be 1 or 2.");
  if (parsed.kind === "track") {
    if (!parsed.trackInterface && !parsed.trackObject) return result(device, session, "% Usage: standby <group> track <interface|object-number> [decrement <1-255>]");
    if (parsed.trackInterface && !findPort(device, parsed.trackInterface)) return result(device, session, `% Interface ${parsed.trackInterface} not found.`);
    if (parsed.trackObject && !trackObjects(device).some((track) => track.trackId === parsed.trackObject)) return result(device, session, `% Track object ${parsed.trackObject} is not configured.`);
    if (parsed.trackDecrement !== undefined && (parsed.trackDecrement < 1 || parsed.trackDecrement > 255)) return result(device, session, "% HSRP track decrement must be 1-255.");
  }
  const nextGroups = applyStandbyToGroups(hsrpGroups(port), parsed);
  return result(updatePort(device, port.id, { hsrpGroups: nextGroups }), session, "");
}

function applyStandbyStartupLine(device: NetworkDevice, portId: string, command: string): NetworkDevice {
  const port = device.ports.find((item) => item.id === portId);
  if (!port) return device;
  const parsed = parseStandbyCommand(command);
  if (!parsed) return device;
  if (parsed.kind === "ip" && !isIpv4(parsed.virtualIp)) return device;
  if (parsed.kind === "priority" && (parsed.priority < 0 || parsed.priority > 255)) return device;
  if (parsed.kind === "version" && parsed.version !== "1" && parsed.version !== "2") return device;
  if (parsed.kind === "track" && (!parsed.trackInterface && !parsed.trackObject || (parsed.trackDecrement !== undefined && (parsed.trackDecrement < 1 || parsed.trackDecrement > 255)))) return device;
  return updatePort(device, port.id, { hsrpGroups: applyStandbyToGroups(hsrpGroups(port), parsed) });
}

type ParsedStandbyCommand =
  | { kind: "remove-group"; group: number }
  | { kind: "ip"; group: number; virtualIp: string }
  | { kind: "priority"; group: number; priority: number }
  | { kind: "preempt"; group: number; enabled: boolean }
  | { kind: "version"; group: number; version: string }
  | { kind: "track"; group: number; trackInterface?: string; trackObject?: number; trackDecrement?: number }
  | { kind: "clear-ip"; group: number }
  | { kind: "clear-priority"; group: number }
  | { kind: "clear-version"; group: number };

function parseStandbyCommand(command: string): ParsedStandbyCommand | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const no = tokens[0]?.toLowerCase() === "no";
  const offset = no ? 1 : 0;
  if (tokens[offset]?.toLowerCase() !== "standby") return null;
  const group = Number(tokens[offset + 1]);
  if (!Number.isInteger(group) || group < 0 || group > 4095) return null;
  const action = tokens[offset + 2]?.toLowerCase();
  if (no && !action) return { kind: "remove-group", group };
  if (no && action === "ip") return { kind: "clear-ip", group };
  if (no && action === "priority") return { kind: "clear-priority", group };
  if (no && action === "version") return { kind: "clear-version", group };
  if (no && action === "preempt") return { kind: "preempt", group, enabled: false };
  if (no && action === "track") return { kind: "track", group };
  if (action === "ip") return { kind: "ip", group, virtualIp: tokens[offset + 3] ?? "" };
  if (action === "priority") return { kind: "priority", group, priority: Number(tokens[offset + 3]) };
  if (action === "preempt") return { kind: "preempt", group, enabled: true };
  if (action === "version") return { kind: "version", group, version: tokens[offset + 3] ?? "" };
  if (action === "track") {
    const decrementIndex = tokens.findIndex((token, index) => index > offset + 2 && token.toLowerCase() === "decrement");
    const trackTarget = (decrementIndex >= 0 ? tokens.slice(offset + 3, decrementIndex) : tokens.slice(offset + 3)).join(" ");
    const trackObject = Number(trackTarget);
    const trackInterface = Number.isInteger(trackObject) ? undefined : trackTarget;
    const trackDecrement = decrementIndex >= 0 ? Number(tokens[decrementIndex + 1]) : undefined;
    return { kind: "track", group, trackInterface, trackObject: Number.isInteger(trackObject) ? trackObject : undefined, trackDecrement };
  }
  return null;
}

function applyStandbyToGroups(groups: HsrpGroup[], parsed: ParsedStandbyCommand): HsrpGroup[] {
  if (parsed.kind === "remove-group") return groups.filter((group) => group.group !== parsed.group);
  const current = groups.find((group) => group.group === parsed.group) ?? defaultHsrpGroup(parsed.group);
  const updated: HsrpGroup =
    parsed.kind === "ip" ? { ...current, virtualIp: parsed.virtualIp } :
    parsed.kind === "priority" ? { ...current, priority: parsed.priority } :
    parsed.kind === "preempt" ? { ...current, preempt: parsed.enabled } :
    parsed.kind === "version" ? { ...current, version: parsed.version === "2" ? "2" : "1" } :
    parsed.kind === "track" ? { ...current, trackInterface: parsed.trackInterface, trackObject: parsed.trackObject, trackDecrement: parsed.trackInterface || parsed.trackObject ? parsed.trackDecrement ?? 10 : undefined } :
    parsed.kind === "clear-ip" ? { ...current, virtualIp: "" } :
    parsed.kind === "clear-priority" ? { ...current, priority: 100 } :
    { ...current, version: "1" };
  return [...groups.filter((group) => group.group !== parsed.group), updated].sort((left, right) => left.group - right.group);
}

function hsrpGroups(port: NetworkPort): HsrpGroup[] {
  return [...(port.hsrpGroups ?? [])].sort((left, right) => left.group - right.group);
}

function defaultHsrpGroup(group: number): HsrpGroup {
  return { group, virtualIp: "", priority: 100, preempt: false, version: "1" };
}

function hsrpEffectivePriority(device: NetworkDevice, group: HsrpGroup): number {
  const interfaceDown = Boolean(group.trackInterface && isTrackedInterfaceDown(device, group.trackInterface));
  const trackObject = group.trackObject ? trackObjects(device).find((track) => track.trackId === group.trackObject) : undefined;
  const objectDown = Boolean(group.trackObject && (!trackObject || !trackObjectCliUp(device, trackObject)));
  const decrement = interfaceDown || objectDown ? group.trackDecrement ?? 10 : 0;
  return Math.max(0, group.priority - decrement);
}

function isTrackedInterfaceDown(device: NetworkDevice, name: string): boolean {
  const port = findPort(device, name);
  return !port || !device.powerOn || !port.adminUp;
}

function hsrpState(device: NetworkDevice, port: NetworkPort, group: HsrpGroup): string {
  if (!device.powerOn || !port.adminUp || !group.virtualIp) return "Init";
  return "Active";
}

function hsrpVirtualMac(group: HsrpGroup): string {
  const suffix = group.group.toString(16).padStart(2, "0").slice(-2);
  return group.version === "2" ? `0000.0c9f.f${group.group.toString(16).padStart(3, "0").slice(-3)}` : `0000.0c07.ac${suffix}`;
}

function vrrpStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  const brief = normalized === "brief";
  const interfaceFilter = brief ? "" : normalized.replace(/^interface\s+/i, "").trim();
  const rows = device.ports
    .filter((port) => !interfaceFilter || portNameMatches(port.name, interfaceFilter))
    .flatMap((port) => vrrpGroups(port).map((group) => ({ port, group })));
  if (interfaceFilter && !device.ports.some((port) => portNameMatches(port.name, interfaceFilter))) return `% Interface ${filter} not found.`;
  if (!rows.length) return "No VRRP groups configured.";
  if (brief) {
    return [
      "Interface              Grp  Pri P State     Master          Virtual IP",
      ...rows.map(({ port, group }) => {
        const priority = vrrpEffectivePriority(device, group);
        const state = vrrpState(device, port, group);
        return `${port.name.padEnd(23)}${String(group.group).padEnd(5)}${String(priority).padEnd(4)}${(group.preempt ? "P" : " ").padEnd(2)}${state.padEnd(10)}${"local".padEnd(16)}${group.virtualIp || "not set"}`;
      })
    ].join("\n");
  }
  return rows.map(({ port, group }) => {
    const priority = vrrpEffectivePriority(device, group);
    const trackedObject = group.trackObject ? trackObjects(device).find((track) => track.trackId === group.trackObject) : undefined;
    const state = vrrpState(device, port, group);
    return [
      `${port.name} - Group ${group.group} (VRRP-V${group.version})`,
      `  State is ${state}`,
      `  Virtual IP address is ${group.virtualIp || "not configured"}`,
      `  Master virtual MAC address is ${vrrpVirtualMac(group)}`,
      `  Advertisement interval is ${group.advertiseInterval} sec`,
      `  Preemption ${group.preempt ? "enabled" : "disabled"}`,
      `  Master router is local`,
      `  Priority ${group.priority} (effective ${priority})`,
      ...(group.trackObject ? [`  Track object ${group.trackObject} ${trackedObject && trackObjectCliUp(device, trackedObject) ? "up" : "down"}, decrement ${group.trackDecrement ?? 10}`] : []),
      `  Group name is vrrp-${group.group}`
    ].join("\n");
  }).join("\n\n");
}

function vrrpConfigLines(port: NetworkPort): string[] {
  return vrrpGroups(port).flatMap((group) => [
    ...(group.version !== "2" ? [` vrrp ${group.group} version ${group.version}`] : []),
    ...(group.virtualIp ? [` vrrp ${group.group} ip ${group.virtualIp}`] : []),
    ...(group.priority !== 100 ? [` vrrp ${group.group} priority ${group.priority}`] : []),
    ...(group.preempt ? [` vrrp ${group.group} preempt`] : [` no vrrp ${group.group} preempt`]),
    ...(group.advertiseInterval !== 1 ? [` vrrp ${group.group} timers advertise ${group.advertiseInterval}`] : []),
    ...(group.trackObject ? [` vrrp ${group.group} track ${group.trackObject}${group.trackDecrement ? ` decrement ${group.trackDecrement}` : ""}`] : [])
  ]);
}

function applyVrrpInterfaceCommand(device: NetworkDevice, port: NetworkPort, session: CliSession, command: string): CliResult {
  if (port.mode !== "routed" && !port.ipCapable) return result(device, session, "% VRRP is supported on routed or IP-capable interfaces only.");
  const parsed = parseVrrpCommand(command);
  if (!parsed) return result(device, session, "% Usage: vrrp <group> ip|priority|preempt|version|timers|track ...");
  if (parsed.kind === "remove-group") return result(updatePort(device, port.id, { vrrpGroups: vrrpGroups(port).filter((group) => group.group !== parsed.group) }), session, "");
  if (parsed.kind === "ip") {
    if (!isIpv4(parsed.virtualIp)) return result(device, session, "% Usage: vrrp <group> ip <address>");
    if (port.ipAddress && port.subnetMask && !ipInSubnet(parsed.virtualIp, port.ipAddress, port.subnetMask)) return result(device, session, "% VRRP virtual IP must be within the interface subnet.");
  }
  if (parsed.kind === "priority" && (parsed.priority < 1 || parsed.priority > 254)) return result(device, session, "% VRRP priority must be 1-254.");
  if (parsed.kind === "version" && parsed.version !== "2" && parsed.version !== "3") return result(device, session, "% VRRP version must be 2 or 3.");
  if (parsed.kind === "timers" && (parsed.advertiseInterval < 1 || parsed.advertiseInterval > 255)) return result(device, session, "% VRRP advertise interval must be 1-255 seconds.");
  if (parsed.kind === "track") {
    if (!parsed.trackObject) return result(device, session, "% Usage: vrrp <group> track <object-number> [decrement <1-255>]");
    if (!trackObjects(device).some((track) => track.trackId === parsed.trackObject)) return result(device, session, `% Track object ${parsed.trackObject} is not configured.`);
    if (parsed.trackDecrement !== undefined && (parsed.trackDecrement < 1 || parsed.trackDecrement > 255)) return result(device, session, "% VRRP track decrement must be 1-255.");
  }
  const nextGroups = applyVrrpToGroups(vrrpGroups(port), parsed);
  return result(updatePort(device, port.id, { vrrpGroups: nextGroups }), session, "");
}

function applyVrrpStartupLine(device: NetworkDevice, portId: string, command: string): NetworkDevice {
  const port = device.ports.find((item) => item.id === portId);
  if (!port) return device;
  const parsed = parseVrrpCommand(command);
  if (!parsed) return device;
  if (parsed.kind === "ip" && !isIpv4(parsed.virtualIp)) return device;
  if (parsed.kind === "priority" && (parsed.priority < 1 || parsed.priority > 254)) return device;
  if (parsed.kind === "version" && parsed.version !== "2" && parsed.version !== "3") return device;
  if (parsed.kind === "timers" && (parsed.advertiseInterval < 1 || parsed.advertiseInterval > 255)) return device;
  if (parsed.kind === "track" && (!parsed.trackObject || (parsed.trackDecrement !== undefined && (parsed.trackDecrement < 1 || parsed.trackDecrement > 255)))) return device;
  return updatePort(device, port.id, { vrrpGroups: applyVrrpToGroups(vrrpGroups(port), parsed) });
}

type ParsedVrrpCommand =
  | { kind: "remove-group"; group: number }
  | { kind: "ip"; group: number; virtualIp: string }
  | { kind: "priority"; group: number; priority: number }
  | { kind: "preempt"; group: number; enabled: boolean }
  | { kind: "version"; group: number; version: string }
  | { kind: "timers"; group: number; advertiseInterval: number }
  | { kind: "track"; group: number; trackObject?: number; trackDecrement?: number }
  | { kind: "clear-ip"; group: number }
  | { kind: "clear-priority"; group: number }
  | { kind: "clear-version"; group: number }
  | { kind: "clear-track"; group: number }
  | { kind: "clear-timers"; group: number };

function parseVrrpCommand(command: string): ParsedVrrpCommand | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const no = tokens[0]?.toLowerCase() === "no";
  const offset = no ? 1 : 0;
  if (tokens[offset]?.toLowerCase() !== "vrrp") return null;
  const group = Number(tokens[offset + 1]);
  if (!Number.isInteger(group) || group < 1 || group > 255) return null;
  const action = tokens[offset + 2]?.toLowerCase();
  if (no && !action) return { kind: "remove-group", group };
  if (no && action === "ip") return { kind: "clear-ip", group };
  if (no && action === "priority") return { kind: "clear-priority", group };
  if (no && action === "version") return { kind: "clear-version", group };
  if (no && action === "preempt") return { kind: "preempt", group, enabled: false };
  if (no && action === "track") return { kind: "clear-track", group };
  if (no && action === "timers") return { kind: "clear-timers", group };
  if (action === "ip") return { kind: "ip", group, virtualIp: tokens[offset + 3] ?? "" };
  if (action === "priority") return { kind: "priority", group, priority: Number(tokens[offset + 3]) };
  if (action === "preempt") return { kind: "preempt", group, enabled: true };
  if (action === "version") return { kind: "version", group, version: tokens[offset + 3] ?? "" };
  if (action === "timers" && tokens[offset + 3]?.toLowerCase() === "advertise") return { kind: "timers", group, advertiseInterval: Number(tokens[offset + 4]) };
  if (action === "track") {
    const decrementIndex = tokens.findIndex((token, index) => index > offset + 2 && token.toLowerCase() === "decrement");
    const trackObject = Number(decrementIndex >= 0 ? tokens[offset + 3] : tokens.slice(offset + 3).join(""));
    const trackDecrement = decrementIndex >= 0 ? Number(tokens[decrementIndex + 1]) : undefined;
    return { kind: "track", group, trackObject: Number.isInteger(trackObject) ? trackObject : undefined, trackDecrement };
  }
  return null;
}

function applyVrrpToGroups(groups: VrrpGroup[], parsed: ParsedVrrpCommand): VrrpGroup[] {
  if (parsed.kind === "remove-group") return groups.filter((group) => group.group !== parsed.group);
  const current = groups.find((group) => group.group === parsed.group) ?? defaultVrrpGroup(parsed.group);
  const updated: VrrpGroup =
    parsed.kind === "ip" ? { ...current, virtualIp: parsed.virtualIp } :
    parsed.kind === "priority" ? { ...current, priority: parsed.priority } :
    parsed.kind === "preempt" ? { ...current, preempt: parsed.enabled } :
    parsed.kind === "version" ? { ...current, version: parsed.version === "3" ? "3" : "2" } :
    parsed.kind === "timers" ? { ...current, advertiseInterval: parsed.advertiseInterval } :
    parsed.kind === "track" ? { ...current, trackObject: parsed.trackObject, trackDecrement: parsed.trackObject ? parsed.trackDecrement ?? 10 : undefined } :
    parsed.kind === "clear-ip" ? { ...current, virtualIp: "" } :
    parsed.kind === "clear-priority" ? { ...current, priority: 100 } :
    parsed.kind === "clear-version" ? { ...current, version: "2" } :
    parsed.kind === "clear-track" ? { ...current, trackObject: undefined, trackDecrement: undefined } :
    { ...current, advertiseInterval: 1 };
  return [...groups.filter((group) => group.group !== parsed.group), updated].sort((left, right) => left.group - right.group);
}

function vrrpGroups(port: NetworkPort): VrrpGroup[] {
  return [...(port.vrrpGroups ?? [])].sort((left, right) => left.group - right.group);
}

function defaultVrrpGroup(group: number): VrrpGroup {
  return { group, virtualIp: "", priority: 100, preempt: true, version: "2", advertiseInterval: 1 };
}

function vrrpEffectivePriority(device: NetworkDevice, group: VrrpGroup): number {
  const trackObject = group.trackObject ? trackObjects(device).find((track) => track.trackId === group.trackObject) : undefined;
  const decrement = group.trackObject && (!trackObject || !trackObjectCliUp(device, trackObject)) ? group.trackDecrement ?? 10 : 0;
  return Math.max(0, group.priority - decrement);
}

function vrrpState(device: NetworkDevice, port: NetworkPort, group: VrrpGroup): string {
  if (!device.powerOn || !port.adminUp || !group.virtualIp) return "Initialize";
  return "Master";
}

function vrrpVirtualMac(group: VrrpGroup): string {
  return `0000.5e00.01${group.group.toString(16).padStart(2, "0").slice(-2)}`;
}

function routeTable(device: NetworkDevice, filter = ""): string {
  const connected = connectedIpEntries(device).flatMap((entry) => [
    `C    ${entry.network}/${entry.prefix} is directly connected, ${entry.portName}${entry.secondary ? " secondary" : ""}`,
    `L    ${entry.ipAddress}/32 is directly connected, ${entry.portName}${entry.secondary ? " secondary" : ""}`
  ]);
  const staticRoutes = device.config.staticRoutes.map((route) => {
    const prefix = isIpv4(route.mask) ? maskToPrefix(route.mask) : route.mask;
    const code = route.network === "0.0.0.0" && route.mask === "0.0.0.0" ? "S*" : "S ";
    const track = route.trackId ? trackObjects(device).find((item) => item.trackId === route.trackId) : undefined;
    const trackSuffix = route.trackId ? ` track ${route.trackId} ${track && trackObjectCliUp(device, track) ? "up" : "down"}` : "";
    return `${code}   ${route.network}/${prefix} [${staticRouteDistance(route)}/0] via ${route.nextHop}${trackSuffix}`;
  });
  const defaultRoute = [...device.config.staticRoutes]
    .filter((route) => route.network === "0.0.0.0" && route.mask === "0.0.0.0")
    .sort((left, right) => staticRouteDistance(left) - staticRouteDistance(right))[0];
  const gatewayLine = defaultRoute ? `Gateway of last resort is ${defaultRoute.nextHop} to network 0.0.0.0` : device.config.defaultGateway ? `Gateway of last resort is ${device.config.defaultGateway}` : "Gateway of last resort is not set";
  const body = filterRouteLines([...connected, ...staticRoutes].filter((line, index, list) => list.indexOf(line) === index), filter);
  return [
    "Codes: L - local, C - connected, S - static, R - RIP, O - OSPF, D - EIGRP",
    "       * - candidate default",
    gatewayLine,
    "",
    ...(body.length ? body : ["No routes installed."])
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
  if (filter === "local") return lines.filter((line) => line.startsWith("L"));
  if (filter === "static") return lines.filter((line) => line.startsWith("S"));
  if (filter.startsWith("gateway ") || filter.startsWith("via ")) {
    const nextHop = filter.replace(/^(gateway|via)\s+/, "").trim();
    return lines.filter((line) => line.toLowerCase().includes(`via ${nextHop.toLowerCase()}`));
  }
  if (filter.startsWith("interface ")) {
    const name = filter.slice("interface ".length).trim().toLowerCase();
    const compactName = name.replace(/\s+/g, "");
    return lines.filter((line) => {
      const lowerLine = line.toLowerCase();
      return lowerLine.includes(`, ${name}`) || lowerLine.replace(/\s+/g, "").includes(`,${compactName}`);
    });
  }
  if (isIpv4(filter)) return lines.filter((line) => line.includes(filter));
  return lines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
}

function ipProtocols(device: NetworkDevice, filter = ""): string {
  const protocols = routingProtocols(device);
  const blocks: string[][] = [];
  if (device.config.staticRoutes.length) {
    blocks.push([`Routing Protocol is "static"`, `  Static routes configured: ${device.config.staticRoutes.length}`, ...device.config.staticRoutes.map((route) => `  ${route.network} ${route.mask} via ${route.nextHop} distance ${staticRouteDistance(route)}${route.trackId ? ` track ${route.trackId}` : ""}`)]);
  }
  for (const protocol of protocols) {
    blocks.push([
      `Routing Protocol is "${protocol.protocol}${protocol.processId ? ` ${protocol.processId}` : ""}"`,
      `  Outgoing update filter list for all interfaces is not set`,
      `  Incoming update filter list for all interfaces is not set`,
      `  Automatic network summarization is ${protocol.autoSummary ? "in effect" : "not in effect"}`,
      ...(protocol.version ? [`  Sending updates version ${protocol.version}`] : []),
      ...(protocol.networks.length ? ["  Routing for Networks:", ...protocol.networks.map((network) => `    ${network}`)] : ["  No networks configured."]),
      ...(protocol.passiveInterfaceDefault ? ["  Passive Interface(s):", "    default"] : []),
      ...(protocol.passiveInterfaces.length ? ["  Passive Interface(s):", ...protocol.passiveInterfaces.map((name) => `    ${name}`)] : []),
      ...((protocol.passiveInterfaceExceptions ?? []).length ? ["  Non-passive Interface(s):", ...(protocol.passiveInterfaceExceptions ?? []).map((name) => `    ${name}`)] : []),
      ...(protocol.redistributeStatic ? ["  Redistributing: static"] : []),
      ...(protocol.defaultInformationOriginate ? [`  Default information originate${protocol.defaultInformationAlways ? " always" : ""}`] : [])
    ]);
  }
  const query = filter.trim().toLowerCase();
  const selected = query ? blocks.filter((block) => block[0].toLowerCase().includes(query)) : blocks;
  if (query && !selected.length) return `% Routing protocol ${filter} not found.`;
  return selected.length ? selected.map((block) => block.join("\n")).join("\n\n") : "No routing protocols configured.";
}

function ipSshStatus(device: NetworkDevice): string {
  const users = localUsers(device);
  const sshLines = lineConfigs(device).filter((line) => line.kind === "vty" && line.loginLocal && lineAllowsTransport(line, "ssh"));
  const enabled = Boolean(device.config.domainName && device.config.rsaKeyGenerated && users.length && sshLines.length);
  return [
    `SSH ${enabled ? "Enabled" : "Disabled"} - version ${device.config.sshVersion ?? "2"}.0`,
    `Authentication methods: ${users.length ? "publickey,keyboard-interactive,password" : "none configured"}`,
    `Authentication Publickey Algorithms: ssh-rsa`,
    `Hostkey Algorithms: ssh-rsa`,
    `Authentication timeout: 120 secs; Authentication retries: 3`,
    `Minimum expected Diffie Hellman key size: 1024 bits`,
    `Domain name: ${device.config.domainName || "not set"}`,
    `RSA key: ${device.config.rsaKeyGenerated ? "generated" : "not generated"}`,
    `Local usernames: ${users.length ? users.map((user) => `${user.name}(priv ${user.privilege ?? 1})`).join(", ") : "none"}`,
    `VTY lines permitting SSH: ${sshLines.length ? sshLines.map(lineDisplayName).join(", ") : "none"}`
  ].join("\n");
}

function lineAllowsTransport(line: LineConfig, protocol: "ssh" | "telnet"): boolean {
  const tokens = line.transportInput.toLowerCase().split(/[,\s]+/).filter(Boolean);
  return tokens.includes("all") || tokens.includes(protocol);
}

function ospfProcessStatus(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "ospf");
  if (!protocols.length) return "%OSPF: Router process not configured";
  return protocols.map((protocol) => [
    ` Routing Process "ospf ${protocol.processId ?? "1"}" with ID ${protocol.routerId ?? routerId(device)}`,
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
    `${port.name} is up, line protocol is ${interfaceOperational(device, port) ? "up" : "down"}`,
    `  Internet Address ${port.ipAddress}/${maskToPrefix(port.subnetMask)}, Area 0`,
    `  Process ID ${protocols[0].processId ?? "1"}, Router ID ${protocols[0].routerId ?? routerId(device)}, Network Type BROADCAST, Cost: 1`,
    "  Timer intervals configured, Hello 10, Dead 40, Wait 40, Retransmit 5",
    "  Neighbor Count is 0, Adjacent neighbor count is 0"
  ].join("\n")).join("\n\n") || "No OSPF-enabled interfaces.";
}

function eigrpStatus(device: NetworkDevice): string {
  const protocols = routingProtocols(device).filter((protocol) => protocol.protocol === "eigrp");
  if (!protocols.length) return "%DUAL-5-NBRCHANGE: EIGRP is not configured";
  return protocols.map((protocol) => [
    `IP-EIGRP AS(${protocol.processId ?? "1"}) is running`,
    `  Router-ID: ${protocol.routerId ?? routerId(device)}`,
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
    `EIGRP-IPv4 Topology Table for AS(${protocols[0].processId ?? "1"})/ID(${protocols[0].routerId ?? routerId(device)})`,
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
  const staticRules = device.config.natRules.filter((rule) => rule.type !== "overload");
  const dynamicTranslations = device.runtime.natTranslations ?? [];
  if (!staticRules.length && !dynamicTranslations.length) return "Pro  Inside global      Inside local       Outside local      Outside global";
  return [
    "Pro  Inside global      Inside local       Outside local      Outside global",
    ...staticRules.map((rule) => `---  ${rule.insideGlobal.padEnd(18)}${rule.insideLocal.padEnd(18)}---                ---`),
    ...dynamicTranslations.map((entry) => `${entry.protocol.padEnd(5)}${entry.insideGlobal.padEnd(18)}${entry.insideLocal.padEnd(18)}${entry.outsideLocal.padEnd(19)}${entry.outsideGlobal}`)
  ].join("\n");
}

function natStatistics(device: NetworkDevice): string {
  const inside = device.ports.filter((port) => port.natRole === "inside").map((port) => port.name).join(", ") || "none";
  const outside = device.ports.filter((port) => port.natRole === "outside").map((port) => port.name).join(", ") || "none";
  const hits = device.config.natRules.reduce((total, rule) => total + rule.hits, 0);
  const staticRules = device.config.natRules.filter((rule) => rule.type !== "overload");
  const dynamicRules = device.config.natRules.filter((rule) => rule.type === "overload");
  const dynamicTranslations = device.runtime.natTranslations ?? [];
  return [
    `Total active translations: ${staticRules.length + dynamicTranslations.length} (static ${staticRules.length}, dynamic ${dynamicTranslations.length})`,
    `Outside interfaces: ${outside}`,
    `Inside interfaces: ${inside}`,
    `Hits: ${hits}  Misses: 0`,
    "Expired translations: 0",
    dynamicRules.length
      ? `Dynamic mappings: ${dynamicRules.map((rule) => `list ${rule.aclName} interface ${rule.interfaceName ?? rule.outsideInterface} overload`).join("; ")}`
      : "Dynamic mappings: none"
  ].join("\n");
}

function connectedNetworks(device: NetworkDevice): Array<{ network: string; prefix: number; portName: string }> {
  return connectedIpEntries(device).map((entry) => ({ network: entry.network, prefix: entry.prefix, portName: entry.portName }));
}

function connectedIpEntries(device: NetworkDevice): Array<{ network: string; prefix: number; ipAddress: string; portName: string; secondary: boolean }> {
  return device.ports
    .filter((port) => port.adminUp && (!isSubinterfacePort(port) || Boolean(port.subinterfaceVlan)))
    .flatMap((port) => [
      ...(port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask)
        ? [{ ipAddress: port.ipAddress, subnetMask: port.subnetMask, portName: port.name, secondary: false }]
        : []),
      ...secondaryIpAddresses(port)
        .filter((address) => isIpv4(address.ipAddress) && isSubnetMask(address.subnetMask))
        .map((address) => ({ ipAddress: address.ipAddress, subnetMask: address.subnetMask, portName: port.name, secondary: true }))
    ])
    .map((entry) => ({ network: networkAddress(entry.ipAddress, entry.subnetMask), prefix: maskToPrefix(entry.subnetMask), ipAddress: entry.ipAddress, portName: entry.portName, secondary: entry.secondary }));
}

function routerId(device: NetworkDevice): string {
  return device.ports.find((port) => port.ipAddress)?.ipAddress || "0.0.0.0";
}

function help(mode: CliMode): string {
  if (mode === "global") return "hostname <name>, username <name> secret <value>, interface <name>, vlan <id>, route-map <name> permit|deny <seq>, ip prefix-list <name> [seq <n>] permit|deny <prefix>, ip domain-name <name>, ip name-server <address>, ip route <network> <mask> <next-hop> [distance], ip nat inside source static <local> <global>, ip nat inside source list <acl> interface <outside> overload, ip dhcp pool <name>, ip host <name> <address>, access-list <list> permit|deny|remark ..., nat <local> <global> <outside>, service <name>, show ..., end";
  if (mode === "interface") return "description <text>, encapsulation dot1Q <vlan> [native], ip address <ip> <mask> [secondary], duplex auto|full|half, speed auto|<mbps>, mtu <bytes>, bandwidth <kbit>, ip policy route-map <name>, ip nat inside|outside, ip access-group <list> in|out, standby <group> ip|priority|preempt|version|track ..., switchport mode access|trunk, switchport access vlan <id>, switchport voice vlan <id>, switchport trunk allowed vlan <list>, switchport port-security, channel-group <id> mode <mode>, cdp enable, clock rate <value>, shutdown, no shutdown, exit";
  if (mode === "vlan") return "name <vlan-name>, exit, end";
  if (mode === "dhcp") return "network <network> <mask>, default-router <ip>, dns-server <ip>, start-ip <ip>, max-leases <n>, shutdown, no shutdown, exit";
  if (mode === "line") return "password <value>, login, login local, no login, transport input <all|ssh|telnet|none>, exec-timeout <min> <sec>, logging synchronous, exit";
  if (mode === "router") return "network <network> [wildcard-mask], version <n>, auto-summary, no auto-summary, passive-interface default|<name>, no passive-interface default|<name>, default-information originate [always], redistribute static, exit";
  if (mode === "acl") return "[sequence] permit|deny <protocol> <source> <destination>, [sequence] permit|deny <source> [wildcard], [sequence] remark <text>, no <sequence>, exit";
  if (mode === "route-map") return "description <text>, match ip address <acl...>, match ip address prefix-list <name...>, set ip next-hop <address>, no match ip address [acl...], no set ip next-hop, exit";
  if (mode === "ip-sla") return "icmp-echo <target-ip> [source-interface <name>], frequency <seconds>, timeout <ms>, threshold <ms>, shutdown, no shutdown, exit";
  return "enable, setup, configure terminal, clock set, show clock, show run, show version, show boot, show platform, show environment, show tech-support, show services, show interfaces, show interfaces counters, show interfaces description, show interfaces switchport, show interfaces trunk, show etherchannel summary, show standby, show port-security, show cdp, show cable-diagnostics tdr, test cable-diagnostics tdr interface <name>, show ip interface, show ip interface brief, show interfaces status, show vlan brief, show ip route, show ip route summary, show ip protocols, show ip ospf neighbor, show ip eigrp neighbors, show ip rip database, show ip dhcp pool, show hosts, show access-list, show nat, show cdp neighbors, show arp, show ip dhcp binding, clear arp, clear mac address-table, clear ip dhcp binding, write memory, reload, write erase";
}

function searchHelp(term: string): string {
  const query = term.trim().toLowerCase();
  const commands = [
    "show running-config | include <text>",
    "show running-config | begin <text>",
    "show running-config | exclude <text>",
    "show running-config | count <text>",
    "show running-config interface <name>",
    "show running-config all",
    "clock set <hh:mm:ss> <month> <day> <year>",
    "show clock",
    "show version",
    "show boot",
    "show platform",
    "show module",
    "show environment",
    "show tech-support",
    "setup",
    "show privilege",
    "show history",
    "show services",
    "show ip interface",
    "show ip interface brief",
    "show ip ssh",
    "show interfaces",
    "show interfaces description",
    "show interfaces switchport",
    "show interfaces trunk",
    "show interface <name>",
    "show interfaces status",
    "show interfaces counters",
    "show vlan brief",
    "show mac address-table dynamic",
    "show etherchannel summary",
    "show etherchannel port-channel",
    "show etherchannel <group> detail",
    "show port-security",
    "show port-security interface <name>",
    "show port-security address",
    "show cdp",
    "show cdp interface",
    "show ip route",
    "show ip route summary",
    "show route-map",
    "show ip prefix-list",
    "show ip sla summary",
    "show track",
    "show controllers",
    "show cable-diagnostics tdr",
    "show cable-diagnostics tdr interface <name>",
    "test cable-diagnostics tdr interface <name>",
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
    "ip name-server <address> [address...]",
    "duplex auto|full|half",
    "speed auto|<mbps>",
    "mtu <bytes>",
    "bandwidth <kbit>",
    "show access-list",
    "ip access-list resequence <name> <start> <increment>",
    "show nat",
    "show cdp neighbors",
    "reload",
    "write erase",
    "ping <ip-or-host>",
    "traceroute <ip-or-host>",
    "tracert <ip-or-host>",
    "clear arp [<ip>|*]",
    "clear mac address-table [dynamic|static] [vlan <id>] [interface <name>]",
    "clear ip dhcp binding [<ip>|*]",
    "configure terminal",
    "username admin secret cisco",
    "interface <name>",
    "default interface <name>",
    "ip domain-name lab.local",
    "service password-encryption",
    "ip address <ip> <mask>",
    "description <text>",
    "switchport mode access",
    "switchport mode trunk",
    "switchport voice vlan <id>",
    "switchport port-security",
    "switchport port-security maximum <1-132>",
    "switchport port-security violation protect|restrict|shutdown",
    "switchport port-security mac-address sticky [mac]",
    "channel-group <1-48> mode on|active|passive|desirable|auto",
    "cdp run",
    "cdp timer <seconds>",
    "cdp holdtime <seconds>",
    "route-map <name> permit|deny <sequence>",
    "match ip address <acl-name-or-number>",
    "match ip address prefix-list <name>",
    "set ip next-hop <address>",
    "ip prefix-list <name> [seq <n>] permit|deny <prefix>/<length> [ge <n>] [le <n>]",
    "ip policy route-map <name>",
    "ip sla <operation-id>",
    "ip sla schedule <operation-id> life forever start-time now",
    "track <id> ip sla <operation-id> reachability",
    "track <id> interface <name> line-protocol",
    "ip route <network> <mask> <next-hop> [distance] [track <id>]",
    "ip route <network> <mask> <next-hop>",
    "ip nat inside source static <inside-local> <inside-global>",
    "ip nat inside source list <acl> interface <outside-interface> overload",
    "ip nat inside",
    "ip nat outside",
    "access-list 101 permit ip any any",
    "ip access-group 101 in",
    "ip dhcp excluded-address <start-ip> [end-ip]",
    "ip dhcp pool <name>",
    "ip host <name> <address>"
  ];
  return commands.filter((command) => command.toLowerCase().includes(query)).join("\n") || "No matching commands.";
}

function applyPipe(output: string, rawCommand: string): string {
  const match = rawCommand.match(/\|\s*(i|inc|include|e|exc|exclude|b|beg|begin|s|sec|section|c|cou|count)\s+(.+)$/i);
  if (!match) return output;
  const token = match[1].toLowerCase();
  const mode = token.startsWith("i") ? "include" : token.startsWith("e") ? "exclude" : token.startsWith("s") ? "section" : token.startsWith("c") ? "count" : "begin";
  const term = match[2].trim().toLowerCase();
  const lines = output.split("\n");
  if (mode === "include") return lines.filter((line) => line.toLowerCase().includes(term)).join("\n") || "% No matching lines.";
  if (mode === "exclude") return lines.filter((line) => !line.toLowerCase().includes(term)).join("\n") || "% No lines remain.";
  if (mode === "count") return `Number of lines which match regexp = ${lines.filter((line) => line.toLowerCase().includes(term)).length}`;
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

function parseAccessList(command: string, forcedType?: "standard" | "extended", sequence?: number): AccessRule | null {
  const tokens = command.trim().split(/\s+/);
  const listName = tokens[1] ?? "";
  if (!listName) return null;
  if (tokens[2]?.toLowerCase() === "remark") {
    const remark = tokens.slice(3).join(" ").trim().slice(0, 100);
    if (!remark) return null;
    return {
      id: createId("acl"),
      listName,
      listType: forcedType ?? (isStandardAcl(listName) ? "standard" : "extended"),
      interfaceName: listName,
      action: "permit",
      protocol: "ip",
      source: "any",
      destination: "any",
      sequence,
      remark,
      hits: 0
    };
  }
  const action = tokens[2]?.toLowerCase();
  if (!listName || !isAction(action)) return null;

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
      sequence,
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
    sequence,
    hits: 0
  };
}

function parseAclSubmodeRule(aclName: string, aclType: "standard" | "extended", command: string): AccessRule | null {
  const trimmed = command.trim();
  const match = trimmed.match(/^(\d+)\s+(.+)$/);
  const sequence = match ? Number(match[1]) : undefined;
  const body = match ? match[2] : trimmed;
  return parseAccessList(`access-list ${aclName} ${body}`, aclType, sequence);
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

function parseChannelGroup(command: string): NetworkPort["channelGroup"] | null {
  const match = command.match(/^channel-group\s+(\d+)(?:\s+mode\s+(\S+))?$/i);
  const id = Number(match?.[1]);
  const mode = (match?.[2] ?? "on").toLowerCase();
  if (!Number.isInteger(id) || id < 1 || id > 48 || !isChannelGroupMode(mode)) return null;
  return { id, mode };
}

function isChannelGroupMode(value: string): value is NonNullable<NetworkPort["channelGroup"]>["mode"] {
  return value === "on" || value === "active" || value === "passive" || value === "desirable" || value === "auto";
}

function isVtpMode(value: string | undefined): value is NonNullable<DeviceConfig["vtp"]>["mode"] {
  return value === "server" || value === "client" || value === "transparent" || value === "off";
}

function applyCdpGlobalCommand(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  const current = cdpConfig(device);
  if (lower === "cdp run") return { ...device, config: { ...device.config, cdp: { ...current, enabled: true } } };
  if (lower === "no cdp run") return { ...device, config: { ...device.config, cdp: { ...current, enabled: false } } };
  if (lower.startsWith("cdp timer ")) {
    const timer = numberAfter(command, "cdp timer");
    return Number.isInteger(timer) && timer >= 5 && timer <= 254
      ? { ...device, config: { ...device.config, cdp: { ...current, timer } } }
      : device;
  }
  if (lower.startsWith("cdp holdtime ")) {
    const holdtime = numberAfter(command, "cdp holdtime");
    return Number.isInteger(holdtime) && holdtime >= 10 && holdtime <= 255
      ? { ...device, config: { ...device.config, cdp: { ...current, holdtime } } }
      : device;
  }
  if (lower === "cdp advertise-v2") return { ...device, config: { ...device.config, cdp: { ...current, version: "2" } } };
  if (lower === "no cdp advertise-v2") return { ...device, config: { ...device.config, cdp: { ...current, version: "1" } } };
  return device;
}

function applyLldpGlobalCommand(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  const current = lldpConfig(device);
  if (lower === "lldp run") return { ...device, config: { ...device.config, lldp: { ...current, enabled: true } } };
  if (lower === "no lldp run") return { ...device, config: { ...device.config, lldp: { ...current, enabled: false } } };
  if (lower.startsWith("lldp timer ")) {
    const timer = numberAfter(command, "lldp timer");
    return Number.isInteger(timer) && timer >= 5 && timer <= 65534
      ? { ...device, config: { ...device.config, lldp: { ...current, timer } } }
      : device;
  }
  if (lower.startsWith("lldp holdtime ")) {
    const holdtime = numberAfter(command, "lldp holdtime");
    return Number.isInteger(holdtime) && holdtime >= 10 && holdtime <= 65535
      ? { ...device, config: { ...device.config, lldp: { ...current, holdtime } } }
      : device;
  }
  if (lower.startsWith("lldp reinit ")) {
    const reinitDelay = numberAfter(command, "lldp reinit");
    return Number.isInteger(reinitDelay) && reinitDelay >= 1 && reinitDelay <= 10
      ? { ...device, config: { ...device.config, lldp: { ...current, reinitDelay } } }
      : device;
  }
  return device;
}

function applyVtpGlobalCommand(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  const current = vtpConfig(device);
  if (lower.startsWith("vtp domain ")) {
    const domain = command.slice("vtp domain ".length).trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32);
    return domain ? { ...device, config: { ...device.config, vtp: { ...current, domain } } } : device;
  }
  if (lower === "no vtp domain") return { ...device, config: { ...device.config, vtp: { ...current, domain: "" } } };
  if (lower.startsWith("vtp mode ")) {
    const mode = command.split(/\s+/)[2]?.toLowerCase();
    return isVtpMode(mode) ? { ...device, config: { ...device.config, vtp: { ...current, mode } } } : device;
  }
  if (lower.startsWith("vtp version ")) {
    const version = command.split(/\s+/)[2];
    return version === "1" || version === "2" || version === "3"
      ? { ...device, config: { ...device.config, vtp: { ...current, version } } }
      : device;
  }
  if (lower === "vtp pruning") return { ...device, config: { ...device.config, vtp: { ...current, pruning: true } } };
  if (lower === "no vtp pruning") return { ...device, config: { ...device.config, vtp: { ...current, pruning: false } } };
  if (lower.startsWith("vtp password ")) {
    const password = command.slice("vtp password ".length).trim().slice(0, 64);
    return password ? { ...device, config: { ...device.config, vtp: { ...current, password } } } : device;
  }
  if (lower === "no vtp password") return { ...device, config: { ...device.config, vtp: { ...current, password: undefined } } };
  return device;
}

function applyDhcpSnoopingGlobalCommand(device: NetworkDevice, command: string, lower: string): NetworkDevice {
  const current = dhcpSnoopingConfig(device);
  if (lower === "ip dhcp snooping") return { ...device, config: { ...device.config, dhcpSnooping: { ...current, enabled: true } } };
  if (lower === "no ip dhcp snooping") return { ...device, config: { ...device.config, dhcpSnooping: { ...current, enabled: false } } };
  if (lower.startsWith("ip dhcp snooping vlan ")) {
    const vlans = parseVlans(command.slice("ip dhcp snooping vlan ".length));
    return vlans.length ? { ...device, config: { ...device.config, dhcpSnooping: { ...current, vlans: uniqueNumbers([...current.vlans, ...vlans]) } } } : device;
  }
  if (lower.startsWith("no ip dhcp snooping vlan ")) {
    const vlans = parseVlans(command.slice("no ip dhcp snooping vlan ".length));
    return { ...device, config: { ...device.config, dhcpSnooping: { ...current, vlans: vlans.length ? current.vlans.filter((vlan) => !vlans.includes(vlan)) : [] } } };
  }
  if (lower === "ip dhcp snooping verify mac-address") return { ...device, config: { ...device.config, dhcpSnooping: { ...current, verifyMacAddress: true } } };
  if (lower === "no ip dhcp snooping verify mac-address") return { ...device, config: { ...device.config, dhcpSnooping: { ...current, verifyMacAddress: false } } };
  return device;
}

function parseStaticRouteCommand(command: string): StaticRouteConfig | null {
  const { network, mask, nextHop, distanceText, trackId } = parseStaticRouteTokens(command);
  if (!network || !mask || !nextHop || !isIpv4(network) || !isSubnetMask(mask) || !isIpv4(nextHop)) return null;
  const distance = distanceText === undefined ? undefined : Number(distanceText);
  if (distanceText !== undefined && (typeof distance !== "number" || !Number.isInteger(distance) || distance < 1 || distance > 255)) return null;
  if (trackId !== undefined && (!Number.isInteger(trackId) || trackId < 1 || trackId > 1000)) return null;
  return { id: createId("route"), network, mask, nextHop, distance, trackId };
}

function parseStaticRouteTokens(command: string): { network?: string; mask?: string; nextHop?: string; distanceText?: string; trackId?: number } {
  const [, , network, mask, nextHop, ...rest] = command.split(/\s+/);
  let distanceText: string | undefined;
  let trackId: number | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]?.toLowerCase();
    if (token === "track") {
      trackId = Number(rest[index + 1]);
      index += 1;
      continue;
    }
    if (distanceText === undefined) {
      distanceText = rest[index];
      continue;
    }
    return {};
  }
  return { network, mask, nextHop, distanceText, trackId };
}

function staticRouteDistance(route: StaticRouteConfig): number {
  return Number.isInteger(route.distance) && route.distance! >= 1 && route.distance! <= 255 ? route.distance! : 1;
}

function staticRouteConfig(route: StaticRouteConfig): string {
  const distance = staticRouteDistance(route);
  return `ip route ${route.network} ${route.mask} ${route.nextHop}${distance !== 1 ? ` ${distance}` : ""}${route.trackId ? ` track ${route.trackId}` : ""}`;
}

function ipSlaOperations(device: NetworkDevice): IpSlaConfig[] {
  return device.config.ipSlaOperations ?? [];
}

function trackObjects(device: NetworkDevice): TrackConfig[] {
  return device.config.trackObjects ?? [];
}

function ensureIpSlaOperation(device: NetworkDevice, operationId: number): { device: NetworkDevice; operation: IpSlaConfig } {
  const existing = ipSlaOperations(device).find((operation) => operation.operationId === operationId);
  if (existing) return { device, operation: existing };
  const operation: IpSlaConfig = {
    id: createId("sla"),
    operationId,
    type: "icmp-echo",
    targetIp: "",
    frequency: 60,
    timeout: 5000,
    threshold: 5000,
    enabled: false
  };
  return { device: { ...device, config: { ...device.config, ipSlaOperations: [...ipSlaOperations(device), operation] } }, operation };
}

function updateIpSlaOperation(device: NetworkDevice, id: string, patch: Partial<IpSlaConfig>): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      ipSlaOperations: ipSlaOperations(device).map((operation) => operation.id === id ? { ...operation, ...patch } : operation)
    }
  };
}

function scheduleIpSlaOperation(device: NetworkDevice, operationId: number, enabled: boolean): NetworkDevice {
  const operation = ipSlaOperations(device).find((item) => item.operationId === operationId);
  return operation ? updateIpSlaOperation(device, operation.id, { enabled }) : device;
}

function removeIpSlaOperation(device: NetworkDevice, operationId: number): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      ipSlaOperations: ipSlaOperations(device).filter((operation) => operation.operationId !== operationId),
      trackObjects: trackObjects(device).filter((track) => !(track.type === "ip-sla" && track.ipSlaOperationId === operationId))
    }
  };
}

function parseIpSlaIcmpEcho(command: string, device: NetworkDevice): Partial<IpSlaConfig> | null {
  const tokens = command.trim().split(/\s+/);
  const targetIp = tokens[1] ?? "";
  if (!isIpv4(targetIp)) return null;
  let sourceInterface: string | undefined;
  const sourceIndex = tokens.findIndex((token) => token.toLowerCase() === "source-interface");
  if (sourceIndex >= 0) {
    const rawName = tokens.slice(sourceIndex + 1).join(" ");
    const port = findPort(device, rawName);
    if (!port) return null;
    sourceInterface = port.name;
  }
  return { type: "icmp-echo", targetIp, sourceInterface };
}

function parseIpSlaSchedule(command: string): number | null {
  const match = command.match(/^ip sla schedule\s+(\d+)(?:\s+life\s+forever)?(?:\s+start-time\s+now)?$/i);
  const operationId = Number(match?.[1]);
  return Number.isInteger(operationId) && operationId >= 1 ? operationId : null;
}

function parseTrackCommand(command: string, device: NetworkDevice): TrackConfig | null {
  const matchSla = command.match(/^track\s+(\d+)\s+ip\s+sla\s+(\d+)\s+reachability$/i);
  if (matchSla) {
    const trackId = Number(matchSla[1]);
    const operationId = Number(matchSla[2]);
    if (!validTrackId(trackId) || !Number.isInteger(operationId) || operationId < 1 || !ipSlaOperations(device).some((operation) => operation.operationId === operationId)) return null;
    return { id: createId("track"), trackId, type: "ip-sla", ipSlaOperationId: operationId, mode: "reachability" };
  }
  const matchInterface = command.match(/^track\s+(\d+)\s+interface\s+(.+)\s+line-protocol$/i);
  if (matchInterface) {
    const trackId = Number(matchInterface[1]);
    const port = findPort(device, matchInterface[2].trim());
    if (!validTrackId(trackId) || !port) return null;
    return { id: createId("track"), trackId, type: "interface", interfaceName: port.name, mode: "line-protocol" };
  }
  return null;
}

function validTrackId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1000;
}

function upsertTrackObject(device: NetworkDevice, track: TrackConfig): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      trackObjects: [...trackObjects(device).filter((item) => item.trackId !== track.trackId), track]
    }
  };
}

function removeTrackObject(device: NetworkDevice, trackId: number): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      trackObjects: trackObjects(device).filter((track) => track.trackId !== trackId),
      staticRoutes: device.config.staticRoutes.map((route) => route.trackId === trackId ? { ...route, trackId: undefined } : route)
    },
    ports: device.ports.map((port) => ({
      ...port,
      hsrpGroups: (port.hsrpGroups ?? []).map((group) => group.trackObject === trackId ? { ...group, trackObject: undefined } : group),
      vrrpGroups: (port.vrrpGroups ?? []).map((group) => group.trackObject === trackId ? { ...group, trackObject: undefined, trackDecrement: undefined } : group)
    }))
  };
}

function ipSlaConfigLines(device: NetworkDevice): string[] {
  return ipSlaOperations(device)
    .sort((left, right) => left.operationId - right.operationId)
    .flatMap((operation) => [
      `ip sla ${operation.operationId}`,
      ...(operation.targetIp ? [` icmp-echo ${operation.targetIp}${operation.sourceInterface ? ` source-interface ${operation.sourceInterface}` : ""}`] : []),
      ` frequency ${operation.frequency}`,
      ` timeout ${operation.timeout}`,
      ` threshold ${operation.threshold}`,
      operation.enabled ? " no shutdown" : " shutdown",
      "!",
      ...(operation.enabled ? [`ip sla schedule ${operation.operationId} life forever start-time now`] : [])
    ]);
}

function trackConfigLines(device: NetworkDevice): string[] {
  return trackObjects(device)
    .sort((left, right) => left.trackId - right.trackId)
    .map((track) => track.type === "ip-sla"
      ? `track ${track.trackId} ip sla ${track.ipSlaOperationId} reachability`
      : `track ${track.trackId} interface ${track.interfaceName} line-protocol`);
}

function ipSlaStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim().toLowerCase();
  if (normalized === "configuration" || normalized.startsWith("configuration")) return ipSlaConfigurationStatus(device, filter.trim().slice("configuration".length).trim());
  if (normalized && normalized !== "summary") return "% Usage: show ip sla [summary|configuration [operation-id]]";
  const operations = ipSlaOperations(device).sort((left, right) => left.operationId - right.operationId);
  if (!operations.length) return "No IP SLA operations configured.";
  return [
    "ID    Type       Destination      Frequency  Timeout  State",
    ...operations.map((operation) => `${String(operation.operationId).padEnd(6)}icmp-echo  ${(operation.targetIp || "not set").padEnd(17)}${String(operation.frequency).padEnd(11)}${String(operation.timeout).padEnd(9)}${operation.enabled ? "scheduled" : "not scheduled"}`)
  ].join("\n");
}

function ipSlaConfigurationStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim();
  const operationId = normalized ? Number(normalized) : NaN;
  if (normalized && !Number.isInteger(operationId)) return "% Usage: show ip sla configuration [operation-id]";
  const operations = normalized
    ? ipSlaOperations(device).filter((operation) => operation.operationId === operationId)
    : ipSlaOperations(device);
  if (!operations.length) return normalized ? `% IP SLA operation ${operationId} not found.` : "No IP SLA operations configured.";
  return operations.map((operation) => [
    `IP SLAs Infrastructure Engine-III`,
    `Entry number: ${operation.operationId}`,
    `Operation type: icmp-echo`,
    `Target address: ${operation.targetIp || "not configured"}`,
    `Source interface: ${operation.sourceInterface || "not configured"}`,
    `Frequency: ${operation.frequency} seconds`,
    `Timeout: ${operation.timeout} ms`,
    `Threshold: ${operation.threshold} ms`,
    `Schedule: ${operation.enabled ? "life forever, start-time now" : "not scheduled"}`
  ].join("\n")).join("\n\n");
}

function trackStatus(device: NetworkDevice, filter = ""): string {
  const normalized = filter.trim();
  const trackId = normalized ? Number(normalized) : NaN;
  if (normalized && !Number.isInteger(trackId)) return "% Usage: show track [object-id]";
  const tracks = normalized
    ? trackObjects(device).filter((track) => track.trackId === trackId)
    : trackObjects(device).sort((left, right) => left.trackId - right.trackId);
  if (!tracks.length) return normalized ? `% Track object ${trackId} not found.` : "No tracked objects configured.";
  return tracks.map((track) => {
    const up = trackObjectCliUp(device, track);
    return [
      `Track ${track.trackId}`,
      `  ${track.type === "ip-sla" ? `IP SLA ${track.ipSlaOperationId} reachability` : `Interface ${track.interfaceName} line-protocol`}`,
      `  State is ${up ? "Up" : "Down"}`,
      `  Clients: ${trackClients(device, track.trackId).join(", ") || "none"}`
    ].join("\n");
  }).join("\n\n");
}

function trackObjectCliUp(device: NetworkDevice, track: TrackConfig): boolean {
  if (track.type === "interface") {
    const port = track.interfaceName ? findPort(device, track.interfaceName) : undefined;
    return Boolean(port && device.powerOn && port.adminUp && port.linkId);
  }
  const operation = ipSlaOperations(device).find((item) => item.operationId === track.ipSlaOperationId);
  return Boolean(operation?.enabled && operation.targetIp);
}

function trackClients(device: NetworkDevice, trackId: number): string[] {
  return [
    ...device.config.staticRoutes.filter((route) => route.trackId === trackId).map((route) => `static ${route.network}/${maskToPrefix(route.mask)}`),
    ...device.ports.flatMap((port) => (port.hsrpGroups ?? []).filter((group) => group.trackObject === trackId).map((group) => `HSRP ${port.name} group ${group.group}`)),
    ...device.ports.flatMap((port) => (port.vrrpGroups ?? []).filter((group) => group.trackObject === trackId).map((group) => `VRRP ${port.name} group ${group.group}`))
  ];
}

function parseStaticNat(command: string, device: NetworkDevice): NatRule | null {
  const [, , , , , insideLocal, insideGlobal] = command.split(/\s+/);
  if (!insideLocal || !insideGlobal || !isIpv4(insideLocal) || !isIpv4(insideGlobal)) return null;
  const outsideInterface = device.ports.find((port) => port.natRole === "outside")?.name || "outside";
  return { id: createId("nat"), insideLocal, insideGlobal, outsideInterface, type: "static", hits: 0 };
}

function parseOverloadNat(command: string, device: NetworkDevice): NatRule | null {
  const match = command.match(/^ip nat inside source list\s+(\S+)\s+interface\s+(.+?)\s+overload$/i);
  const aclName = match?.[1] ?? "";
  const rawInterface = match?.[2]?.trim() ?? "";
  if (!aclName || !rawInterface) return null;
  const port = findPort(device, rawInterface);
  const interfaceName = port?.name ?? rawInterface;
  return {
    id: createId("nat"),
    insideLocal: `list ${aclName}`,
    insideGlobal: `interface ${interfaceName}`,
    outsideInterface: interfaceName,
    type: "overload",
    aclName,
    interfaceName,
    overload: true,
    hits: 0
  };
}

function upsertNatRule(device: NetworkDevice, nat: NatRule): NetworkDevice {
  const nextRules = device.config.natRules.filter((rule) => {
    if (nat.type === "overload") return !(rule.type === "overload" && rule.aclName === nat.aclName && (rule.interfaceName ?? rule.outsideInterface) === (nat.interfaceName ?? nat.outsideInterface));
    return !(rule.type !== "overload" && rule.insideLocal === nat.insideLocal && rule.insideGlobal === nat.insideGlobal);
  });
  return { ...device, config: { ...device.config, natRules: [...nextRules, nat] } };
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

function removeOverloadNat(device: NetworkDevice, aclName: string, interfaceName: string): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      natRules: device.config.natRules.filter((rule) => !(rule.type === "overload" && rule.aclName === aclName && (rule.interfaceName ?? rule.outsideInterface) === interfaceName))
    },
    runtime: {
      ...device.runtime,
      natTranslations: (device.runtime.natTranslations ?? []).filter((entry) => entry.interfaceName !== interfaceName)
    }
  };
}

function natRuleConfig(rule: NatRule): string {
  if (rule.type === "overload" && rule.aclName && (rule.interfaceName || rule.outsideInterface)) {
    return `ip nat inside source list ${rule.aclName} interface ${rule.interfaceName ?? rule.outsideInterface} overload`;
  }
  return `ip nat inside source static ${rule.insideLocal} ${rule.insideGlobal}`;
}

function parsePrefixList(command: string): PrefixListConfig | null {
  const tokens = command.trim().split(/\s+/);
  const name = tokens[2] ?? "";
  let index = 3;
  let sequence = 5;
  if (tokens[index]?.toLowerCase() === "seq") {
    sequence = Number(tokens[index + 1]);
    index += 2;
  }
  const action = tokens[index]?.toLowerCase();
  const prefix = tokens[index + 1] ?? "";
  if (!name || (action !== "permit" && action !== "deny") || !validPrefix(prefix) || !Number.isInteger(sequence) || sequence < 1) return null;
  index += 2;
  let ge: number | undefined;
  let le: number | undefined;
  while (index < tokens.length) {
    const token = tokens[index]?.toLowerCase();
    const value = Number(tokens[index + 1]);
    if ((token !== "ge" && token !== "le") || !Number.isInteger(value) || value < 0 || value > 32) return null;
    if (token === "ge") ge = value;
    if (token === "le") le = value;
    index += 2;
  }
  const prefixLength = prefixLengthOf(prefix);
  if ((ge !== undefined && ge < prefixLength) || (le !== undefined && le < prefixLength) || (ge !== undefined && le !== undefined && ge > le)) return null;
  return { id: createId("plist"), name, sequence, action, prefix, ge, le, hits: 0 };
}

function parseNoPrefixList(command: string): { name: string; sequence?: number } | null {
  const match = command.match(/^no ip prefix-list\s+(\S+)(?:\s+seq\s+(\d+))?$/i);
  const name = match?.[1] ?? "";
  const sequence = match?.[2] === undefined ? undefined : Number(match[2]);
  if (!name || (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 1))) return null;
  return { name, sequence };
}

function prefixLists(device: NetworkDevice): PrefixListConfig[] {
  return device.config.prefixLists ?? [];
}

function orderedPrefixLists(device: NetworkDevice, name = ""): PrefixListConfig[] {
  const query = name.trim().toLowerCase();
  return prefixLists(device)
    .filter((entry) => !query || entry.name.toLowerCase() === query)
    .sort((left, right) => left.name.localeCompare(right.name) || left.sequence - right.sequence);
}

function addPrefixListEntry(device: NetworkDevice, entry: PrefixListConfig): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      prefixLists: [...prefixLists(device).filter((item) => !(item.name.toLowerCase() === entry.name.toLowerCase() && item.sequence === entry.sequence)), entry]
    }
  };
}

function removePrefixList(device: NetworkDevice, name: string, sequence?: number): NetworkDevice {
  const targetName = name.toLowerCase();
  return {
    ...device,
    config: {
      ...device.config,
      prefixLists: prefixLists(device).filter((entry) => entry.name.toLowerCase() !== targetName || (sequence !== undefined && entry.sequence !== sequence))
    }
  };
}

function prefixListConfigLines(device: NetworkDevice): string[] {
  return orderedPrefixLists(device).map((entry) => `ip prefix-list ${entry.name} seq ${entry.sequence} ${entry.action} ${entry.prefix}${entry.ge !== undefined ? ` ge ${entry.ge}` : ""}${entry.le !== undefined ? ` le ${entry.le}` : ""}`);
}

function prefixListStatus(device: NetworkDevice, filter = ""): string {
  const entries = orderedPrefixLists(device, filter);
  if (!entries.length) return filter ? `% Prefix-list ${filter} not found.` : "No IP prefix lists configured.";
  const grouped = new Map<string, PrefixListConfig[]>();
  for (const entry of entries) grouped.set(entry.name, [...(grouped.get(entry.name) ?? []), entry]);
  return [...grouped.entries()].flatMap(([name, group]) => [
    `ip prefix-list ${name}: ${group.length} entries`,
    ...group.map((entry) => `   seq ${entry.sequence} ${entry.action} ${entry.prefix}${entry.ge !== undefined ? ` ge ${entry.ge}` : ""}${entry.le !== undefined ? ` le ${entry.le}` : ""} (${entry.hits} matches)`)
  ]).join("\n");
}

function validPrefix(value: string): boolean {
  return prefixLengthOf(value) >= 0;
}

function prefixLengthOf(value: string): number {
  const [network, prefixText] = value.split("/");
  const prefix = Number(prefixText);
  return isIpv4(network) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 ? prefix : -1;
}

function parseRouteMapTarget(command: string): { name: string; action: RouteMapEntry["action"]; sequence: number } | null {
  const match = command.match(/^route-map\s+(\S+)\s+(permit|deny)(?:\s+(\d+))?$/i);
  const name = match?.[1]?.trim() ?? "";
  const rawAction = match?.[2]?.toLowerCase();
  const action = rawAction === "permit" || rawAction === "deny" ? rawAction : undefined;
  const sequence = Number(match?.[3] ?? "10");
  if (!name || (action !== "permit" && action !== "deny") || !Number.isInteger(sequence) || sequence < 1 || sequence > 65535) return null;
  return { name, action, sequence };
}

function parseNoRouteMapTarget(command: string): { name: string; action?: RouteMapEntry["action"]; sequence?: number } | null {
  const match = command.match(/^no route-map\s+(\S+)(?:\s+(permit|deny)(?:\s+(\d+))?)?$/i);
  const name = match?.[1]?.trim() ?? "";
  const rawAction = match?.[2]?.toLowerCase();
  const action = rawAction === "permit" || rawAction === "deny" ? rawAction : undefined;
  const sequence = match?.[3] === undefined ? undefined : Number(match[3]);
  if (!name) return null;
  if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 1 || sequence > 65535)) return null;
  return { name, action, sequence };
}

function parseRouteMapAclList(command: string): string[] {
  const match = command.match(/^match ip address\s+(.+)$/i);
  return unique((match?.[1] ?? "").split(/\s+/).map((name) => name.trim()).filter(Boolean));
}

function parseRouteMapPrefixList(command: string): string[] {
  const match = command.match(/^match ip address prefix-list\s+(.+)$/i);
  return unique((match?.[1] ?? "").split(/\s+/).map((name) => name.trim()).filter(Boolean));
}

function routeMaps(device: NetworkDevice): RouteMapConfig[] {
  return device.config.routeMaps ?? [];
}

function orderedRouteMaps(device: NetworkDevice, name = ""): RouteMapConfig[] {
  const query = name.trim().toLowerCase();
  return routeMaps(device)
    .filter((entry) => !query || entry.name.toLowerCase() === query)
    .sort((left, right) => left.name.localeCompare(right.name) || left.sequence - right.sequence);
}

function ensureRouteMapEntry(device: NetworkDevice, name: string, action: RouteMapEntry["action"], sequence: number): { device: NetworkDevice; routeMap: RouteMapConfig } {
  const existing = routeMaps(device).find((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.sequence === sequence);
  if (existing) {
    const updated = existing.action === action ? device : updateRouteMapEntry(device, existing.id, { action });
    return { device: updated, routeMap: { ...existing, action } };
  }
  const routeMap: RouteMapConfig = { id: createId("rmap"), name, sequence, action, matchAccessLists: [], matchPrefixLists: [], hits: 0 };
  return { device: { ...device, config: { ...device.config, routeMaps: [...routeMaps(device), routeMap] } }, routeMap };
}

function updateRouteMapEntry(device: NetworkDevice, id: string, patch: Partial<RouteMapConfig> | ((entry: RouteMapConfig) => Partial<RouteMapConfig>)): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      routeMaps: routeMaps(device).map((entry) => entry.id === id ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry)
    }
  };
}

function removeRouteMap(device: NetworkDevice, name: string, action?: RouteMapEntry["action"], sequence?: number): NetworkDevice {
  const targetName = name.toLowerCase();
  return {
    ...device,
    config: {
      ...device.config,
      routeMaps: routeMaps(device).filter((entry) => {
        if (entry.name.toLowerCase() !== targetName) return true;
        if (action && entry.action !== action) return true;
        if (sequence !== undefined && entry.sequence !== sequence) return true;
        return false;
      })
    },
    ports: device.ports.map((port) => port.policyRouteMap?.toLowerCase() === targetName && !routeMaps(device).some((entry) => entry.name.toLowerCase() === targetName && (action && entry.action !== action || sequence !== undefined && entry.sequence !== sequence))
      ? { ...port, policyRouteMap: "" }
      : port)
  };
}

function routeMapConfigLines(device: NetworkDevice): string[] {
  return orderedRouteMaps(device).flatMap((entry) => [
    `route-map ${entry.name} ${entry.action} ${entry.sequence}`,
    ...(entry.description ? [` description ${entry.description}`] : []),
    ...(entry.matchAccessLists.length ? [` match ip address ${entry.matchAccessLists.join(" ")}`] : []),
    ...((entry.matchPrefixLists ?? []).length ? [` match ip address prefix-list ${(entry.matchPrefixLists ?? []).join(" ")}`] : []),
    ...(entry.setNextHop ? [` set ip next-hop ${entry.setNextHop}`] : [])
  ]);
}

function routeMapStatus(device: NetworkDevice, filter = ""): string {
  const maps = orderedRouteMaps(device, filter);
  if (!maps.length) return filter ? `% Route-map ${filter} not found.` : "No route maps configured.";
  return maps.map((entry) => [
    `route-map ${entry.name}, ${entry.action}, sequence ${entry.sequence}`,
    ...(entry.description ? [`  Description: ${entry.description}`] : []),
    `  Match clauses:`,
    `    ip address ${entry.matchAccessLists.join(" ") || "not set"}`,
    `    ip address prefix-list ${(entry.matchPrefixLists ?? []).join(" ") || "not set"}`,
    `  Set clauses:`,
    `    ip next-hop ${entry.setNextHop || "not set"}`,
    `  Policy routing matches: ${entry.hits}`
  ].join("\n")).join("\n\n");
}

function aclUsage(): string {
  return "% Usage: access-list <list> permit|deny|remark ...";
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
    ...orderedAccessRules(rules).map((rule, index) => `    ${String(accessRuleSequence(rule, index)).padEnd(4)} ${accessRuleBody(rule)}${rule.remark ? "" : ` (${rule.hits} matches)`}`)
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
    ...orderedAccessRules(numbered).map((rule) => `access-list ${aclListName(rule)} ${accessRuleBody(rule)}`),
    ...[...named.entries()].flatMap(([name, group]) => [
      `ip access-list ${group.every(isStandardAccessRule) ? "standard" : "extended"} ${name}`,
      ...orderedAccessRules(group).map((rule, index) => ` ${accessRuleSequence(rule, index)} ${accessRuleBody(rule)}`)
    ])
  ];
}

function accessRuleBody(rule: AccessRule): string {
  if (rule.remark) return `remark ${rule.remark}`;
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

function accessRuleSequence(rule: AccessRule, index: number): number {
  return Number.isInteger(rule.sequence) && rule.sequence! > 0 ? rule.sequence! : (index + 1) * 10;
}

function orderedAccessRules(rules: AccessRule[]): AccessRule[] {
  return [...rules].sort((a, b) => {
    const aSequence = a.sequence ?? Number.MAX_SAFE_INTEGER;
    const bSequence = b.sequence ?? Number.MAX_SAFE_INTEGER;
    if (aSequence !== bSequence) return aSequence - bSequence;
    return rules.indexOf(a) - rules.indexOf(b);
  });
}

function addAccessRule(device: NetworkDevice, rule: AccessRule): NetworkDevice {
  const listName = aclListName(rule).toLowerCase();
  const accessRules = Number.isInteger(rule.sequence)
    ? device.config.accessRules.filter((item) => !(aclListName(item).toLowerCase() === listName && item.sequence === rule.sequence))
    : device.config.accessRules;
  return { ...device, config: { ...device.config, accessRules: [...accessRules, rule] } };
}

function parseAclResequence(command: string): { name: string; start: number; increment: number } | null {
  const [, , , name, startText, incrementText] = command.split(/\s+/);
  const start = Number(startText);
  const increment = Number(incrementText);
  if (!name || !Number.isInteger(start) || !Number.isInteger(increment) || start < 1 || increment < 1) return null;
  return { name, start, increment };
}

function resequenceAccessList(device: NetworkDevice, listName: string, start: number, increment: number): NetworkDevice {
  let sequence = start;
  const targetName = listName.toLowerCase();
  const sequenceById = new Map<string, number>();
  for (const rule of orderedAccessRules(device.config.accessRules.filter((item) => aclListName(item).toLowerCase() === targetName))) {
    sequenceById.set(rule.id, sequence);
    sequence += increment;
  }
  return {
    ...device,
    config: {
      ...device.config,
      accessRules: device.config.accessRules.map((rule) => {
        if (aclListName(rule).toLowerCase() !== targetName) return rule;
        return { ...rule, sequence: sequenceById.get(rule.id) ?? rule.sequence };
      })
    }
  };
}

function removeAccessList(device: NetworkDevice, listName: string): NetworkDevice {
  return {
    ...device,
    config: { ...device.config, accessRules: device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() !== listName.toLowerCase()) }
  };
}

function removeAccessListSequence(device: NetworkDevice, listName: string, sequence: number): NetworkDevice {
  if (!Number.isInteger(sequence) || sequence <= 0) return device;
  const orderedIds = new Set(
    orderedAccessRules(device.config.accessRules.filter((rule) => aclListName(rule).toLowerCase() === listName.toLowerCase()))
      .filter((rule, index) => accessRuleSequence(rule, index) === sequence)
      .map((rule) => rule.id)
  );
  return {
    ...device,
    config: {
      ...device.config,
      accessRules: device.config.accessRules.filter((rule) => !orderedIds.has(rule.id))
    }
  };
}

function removeAccessRule(device: NetworkDevice, target: AccessRule): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      accessRules: device.config.accessRules.filter((rule) =>
        !(!rule.remark && !target.remark &&
          aclListName(rule).toLowerCase() === aclListName(target).toLowerCase() &&
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

function isSecondaryIpCommand(command: string): boolean {
  return command.trim().toLowerCase().split(/\s+/).includes("secondary");
}

function secondaryIpAddresses(port: NetworkPort): NonNullable<NetworkPort["secondaryIpAddresses"]> {
  return port.secondaryIpAddresses ?? [];
}

function upsertSecondaryIp(port: NetworkPort, ipAddress: string, subnetMask: string): NonNullable<NetworkPort["secondaryIpAddresses"]> {
  return [
    ...secondaryIpAddresses(port).filter((address) => address.ipAddress !== ipAddress),
    { ipAddress, subnetMask }
  ];
}

function removeSecondaryIp(port: NetworkPort, ipAddress: string, subnetMask?: string): NonNullable<NetworkPort["secondaryIpAddresses"]> {
  return secondaryIpAddresses(port).filter((address) => !(address.ipAddress === ipAddress && (!subnetMask || address.subnetMask === subnetMask)));
}

function layer2ModePatch(mode: NetworkPort["mode"]): Partial<NetworkPort> {
  return { mode, ipAddress: "", subnetMask: "", secondaryIpAddresses: [], gateway: "", dnsServer: "", helperAddresses: [], natRole: undefined, hsrpGroups: [], accessGroupIn: "", accessGroupOut: "", policyRouteMap: "" };
}

function defaultPortSecurity(): NonNullable<NetworkPort["portSecurity"]> {
  return { enabled: false, maximum: 1, violation: "shutdown", sticky: false, secureMacAddresses: [] };
}

function portSecurity(port: NetworkPort): NonNullable<NetworkPort["portSecurity"]> {
  return { ...defaultPortSecurity(), ...(port.portSecurity ?? {}) };
}

function isPortSecurityViolation(value: string | undefined): value is NonNullable<NetworkPort["portSecurity"]>["violation"] {
  return value === "protect" || value === "restrict" || value === "shutdown";
}

function normalizeSecureMacAddress(value: string): string {
  const compact = value.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (!/^[0-9a-f]{12}$/.test(compact)) return "";
  return `${compact.slice(0, 4)}.${compact.slice(4, 8)}.${compact.slice(8, 12)}`;
}

function addSecureMac(security: NonNullable<NetworkPort["portSecurity"]>, macAddress: string): NonNullable<NetworkPort["portSecurity"]> {
  return {
    ...security,
    secureMacAddresses: unique([...security.secureMacAddresses, macAddress]).slice(0, security.maximum)
  };
}

function secureAddressCount(device: NetworkDevice, port: NetworkPort): number {
  const security = portSecurity(port);
  const learned = security.sticky
    ? device.runtime.macTable.filter((entry) => entry.portName === port.name).map((entry) => normalizeSecureMacAddress(entry.macAddress)).filter(Boolean)
    : [];
  return unique([...security.secureMacAddresses, ...learned]).slice(0, security.maximum).length;
}

function cdpConfig(device: NetworkDevice): NonNullable<DeviceConfig["cdp"]> {
  return { enabled: true, timer: 60, holdtime: 180, version: "2", ...(device.config.cdp ?? {}) };
}

function cdpConfigLines(device: NetworkDevice): string[] {
  const cdp = cdpConfig(device);
  return [
    ...(cdp.enabled ? [] : ["no cdp run"]),
    ...(cdp.timer !== 60 ? [`cdp timer ${cdp.timer}`] : []),
    ...(cdp.holdtime !== 180 ? [`cdp holdtime ${cdp.holdtime}`] : []),
    ...(cdp.version === "2" ? [] : ["no cdp advertise-v2"])
  ];
}

function lldpConfig(device: NetworkDevice): NonNullable<DeviceConfig["lldp"]> {
  return { enabled: false, timer: 30, holdtime: 120, reinitDelay: 2, ...(device.config.lldp ?? {}) };
}

function lldpConfigLines(device: NetworkDevice): string[] {
  const lldp = lldpConfig(device);
  return [
    ...(lldp.enabled ? ["lldp run"] : []),
    ...(lldp.timer !== 30 ? [`lldp timer ${lldp.timer}`] : []),
    ...(lldp.holdtime !== 120 ? [`lldp holdtime ${lldp.holdtime}`] : []),
    ...(lldp.reinitDelay !== 2 ? [`lldp reinit ${lldp.reinitDelay}`] : [])
  ];
}

function dhcpSnoopingConfig(device: NetworkDevice): NonNullable<DeviceConfig["dhcpSnooping"]> {
  return { enabled: false, vlans: [], verifyMacAddress: true, ...(device.config.dhcpSnooping ?? {}) };
}

function dhcpSnoopingConfigLines(device: NetworkDevice): string[] {
  const snooping = dhcpSnoopingConfig(device);
  return [
    ...(snooping.enabled ? ["ip dhcp snooping"] : []),
    ...(snooping.vlans.length ? [`ip dhcp snooping vlan ${snooping.vlans.join(",")}`] : []),
    ...(snooping.verifyMacAddress ? [] : ["no ip dhcp snooping verify mac-address"])
  ];
}

function stpConfigLines(device: NetworkDevice): string[] {
  const recovery = errdisableRecovery(device);
  return [
    ...(device.config.stpMode && device.config.stpMode !== "pvst" ? [`spanning-tree mode ${device.config.stpMode}`] : []),
    ...(device.config.stpRootPrimaryVlans ?? []).map((vlan) => `spanning-tree vlan ${vlan} root primary`),
    ...(device.config.stpRootSecondaryVlans ?? []).map((vlan) => `spanning-tree vlan ${vlan} root secondary`),
    ...(recovery.bpduguard ? ["errdisable recovery cause bpduguard"] : []),
    ...(recovery.interval !== 300 ? [`errdisable recovery interval ${recovery.interval}`] : [])
  ];
}

function errdisableRecovery(device: NetworkDevice): NonNullable<DeviceConfig["errdisableRecovery"]> {
  return { bpduguard: false, interval: 300, ...(device.config.errdisableRecovery ?? {}) };
}

function vtpConfig(device: NetworkDevice): NonNullable<DeviceConfig["vtp"]> {
  return { mode: "server", domain: "", version: "2", pruning: false, revision: 0, ...(device.config.vtp ?? {}) };
}

function vtpConfigLines(device: NetworkDevice): string[] {
  const vtp = vtpConfig(device);
  return [
    ...(vtp.domain ? [`vtp domain ${vtp.domain}`] : []),
    ...(vtp.mode !== "server" ? [`vtp mode ${vtp.mode}`] : []),
    ...(vtp.version !== "2" ? [`vtp version ${vtp.version}`] : []),
    ...(vtp.pruning ? ["vtp pruning"] : []),
    ...(vtp.password ? [`vtp password ${vtp.password}`] : [])
  ];
}

function vtpDigest(device: NetworkDevice): string {
  const vtp = vtpConfig(device);
  const seed = `${vtp.domain}|${vtp.password ?? ""}|${vtp.revision}|${device.config.vlans.map((vlan) => `${vlan.id}:${vlan.name}`).join(",")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const words = Array.from({ length: 4 }, (_, index) => ((hash + Math.imul(index + 1, 0x9e3779b9)) >>> 0).toString(16).padStart(8, "0"));
  return `0x${words.join("")}`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function portSecurityConfig(port: NetworkPort): string[] {
  const security = portSecurity(port);
  if (!security.enabled) return [];
  return [
    " switchport port-security",
    ...(security.maximum !== 1 ? [` switchport port-security maximum ${security.maximum}`] : []),
    ...(security.violation !== "shutdown" ? [` switchport port-security violation ${security.violation}`] : []),
    ...(security.sticky ? [" switchport port-security mac-address sticky"] : []),
    ...security.secureMacAddresses.map((macAddress) => ` switchport port-security mac-address ${security.sticky ? "sticky " : ""}${macAddress}`)
  ];
}

function updatePort(device: NetworkDevice, portId: string, patch: Partial<NetworkPort>): NetworkDevice {
  return { ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) };
}

function updateSelectedPorts(device: NetworkDevice, ports: NetworkPort[], patch: Partial<NetworkPort>): NetworkDevice {
  const selectedIds = new Set(ports.map((port) => port.id));
  return { ...device, ports: device.ports.map((port) => selectedIds.has(port.id) ? { ...port, ...patch } : port) };
}

function updatePortsWith(device: NetworkDevice, ports: NetworkPort[], patcher: (port: NetworkPort) => Partial<NetworkPort>): NetworkDevice {
  const selectedIds = new Set(ports.map((port) => port.id));
  return { ...device, ports: device.ports.map((port) => selectedIds.has(port.id) ? { ...port, ...patcher(port) } : port) };
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

function localUsers(device: NetworkDevice): LocalUser[] {
  return device.config.localUsers ?? [];
}

function dhcpExcludedRanges(device: NetworkDevice): DhcpExcludedRange[] {
  return device.config.dhcpExcludedRanges ?? [];
}

function parseDhcpExcludedRange(command: string): DhcpExcludedRange | null {
  const [, , , startIp, endIp] = command.split(/\s+/);
  if (!isIpv4(startIp) || (endIp && !isIpv4(endIp))) return null;
  return { id: createId("dhcp_exclude"), startIp, endIp };
}

function upsertDhcpExcludedRange(device: NetworkDevice, range: DhcpExcludedRange): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      dhcpExcludedRanges: [...dhcpExcludedRanges(device).filter((item) => item.startIp !== range.startIp), range]
    }
  };
}

function removeDhcpExcludedRange(device: NetworkDevice, startIp: string, endIp?: string): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      dhcpExcludedRanges: dhcpExcludedRanges(device).filter((range) => !(range.startIp === startIp && (!endIp || range.endIp === endIp)))
    }
  };
}

function parseLocalUser(command: string): LocalUser | null {
  const tokens = command.split(/\s+/);
  const name = tokens[1]?.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!name) return null;
  const privilegeIndex = tokens.findIndex((token) => token.toLowerCase() === "privilege");
  const privilege = privilegeIndex >= 0 ? Number(tokens[privilegeIndex + 1]) : undefined;
  const secretIndex = tokens.findIndex((token) => token.toLowerCase() === "secret");
  const passwordIndex = tokens.findIndex((token) => token.toLowerCase() === "password");
  const credentialIndex = secretIndex >= 0 ? secretIndex : passwordIndex;
  const credential = credentialIndex >= 0 ? tokens.slice(credentialIndex + 1).join(" ") : "";
  if (!credential) return null;
  const normalizedPrivilege = Number.isInteger(privilege) && privilege !== undefined && privilege >= 0 && privilege <= 15 ? privilege : undefined;
  return {
    id: createId("user"),
    name,
    privilege: normalizedPrivilege,
    secret: secretIndex >= 0 ? credential : undefined,
    password: passwordIndex >= 0 && secretIndex < 0 ? credential : undefined
  };
}

function upsertLocalUser(device: NetworkDevice, user: LocalUser): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      localUsers: [...localUsers(device).filter((item) => item.name.toLowerCase() !== user.name.toLowerCase()), user]
    }
  };
}

function removeLocalUser(device: NetworkDevice, name: string): NetworkDevice {
  return { ...device, config: { ...device.config, localUsers: localUsers(device).filter((user) => user.name.toLowerCase() !== name.toLowerCase()) } };
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
  return { id: createId("line"), kind, range, password: "", login: false, loginLocal: false, transportInput: kind === "vty" ? "all" : "", execTimeout: "10 0", loggingSynchronous: false };
}

function defaultRoutingProtocol(protocol: RoutingProtocol["protocol"], processId?: string): RoutingProtocol {
  return { id: createId("routing"), protocol, processId, networks: [], version: protocol === "rip" ? "2" : undefined, routerId: undefined, autoSummary: false, passiveInterfaces: [], passiveInterfaceDefault: false, passiveInterfaceExceptions: [], redistributeStatic: false, defaultInformationOriginate: false, defaultInformationAlways: false };
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

function uniqueNumbers(values: number[]): number[] {
  return values.filter((value, index, list) => Number.isInteger(value) && list.indexOf(value) === index);
}

function parseNameServers(value: string): string[] {
  return value.trim().split(/\s+/).filter(isIpv4);
}

function parseSpanningTreeRootVlans(command: string): number[] {
  const match = command.match(/\bvlan\s+(.+?)\s+root\s+primary$/i);
  const secondaryMatch = command.match(/\bvlan\s+(.+?)\s+root\s+secondary$/i);
  return match ? parseVlans(match[1]) : secondaryMatch ? parseVlans(secondaryMatch[1]) : [];
}

function applyStpRoot(device: NetworkDevice, vlans: number[], role: "primary" | "secondary", enable: boolean): NetworkDevice {
  const currentPrimary = device.config.stpRootPrimaryVlans ?? [];
  const currentSecondary = device.config.stpRootSecondaryVlans ?? [];
  const primary = role === "primary"
    ? enable ? uniqueNumbers([...currentPrimary, ...vlans]) : currentPrimary.filter((vlan) => !vlans.includes(vlan))
    : enable ? currentPrimary.filter((vlan) => !vlans.includes(vlan)) : currentPrimary;
  const secondary = role === "secondary"
    ? enable ? uniqueNumbers([...currentSecondary, ...vlans]) : currentSecondary.filter((vlan) => !vlans.includes(vlan))
    : enable ? currentSecondary.filter((vlan) => !vlans.includes(vlan)) : currentSecondary;
  return { ...device, config: { ...device.config, stpRootPrimaryVlans: primary, stpRootSecondaryVlans: secondary } };
}

function ensureVlan(device: NetworkDevice, id: number): NetworkDevice {
  if (device.config.vlans.some((vlan) => vlan.id === id)) return device;
  return bumpVtpRevision({ ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: `VLAN${id}` }].sort((a, b) => a.id - b.id) } });
}

function canEditVlanDatabase(device: NetworkDevice): boolean {
  return vtpConfig(device).mode !== "client";
}

function bumpVtpRevision(device: NetworkDevice): NetworkDevice {
  const vtp = vtpConfig(device);
  if (vtp.mode !== "server") return device;
  return { ...device, config: { ...device.config, vtp: { ...vtp, revision: Math.min(999999, vtp.revision + 1) } } };
}

function createSubinterface(device: NetworkDevice, name: string): { device: NetworkDevice; port: NetworkPort } | null {
  const match = name.trim().match(/^(.+)\.(\d+)$/);
  if (!match) return null;
  const parent = findPort(device, match[1].trim());
  const vlan = Number(match[2]);
  if (!parent || parent.kind === "console" || !validVlan(vlan)) return null;
  const existing = findPort(device, `${parent.name}.${vlan}`);
  if (existing) return { device, port: existing };
  const port: NetworkPort = {
    id: createId("port"),
    name: `${parent.name}.${vlan}`,
    kind: parent.kind,
    description: "",
    macAddress: parent.macAddress,
    mode: "routed",
    vlan,
    allowedVlans: [],
    nativeVlan: vlan,
    ipAddress: "",
    subnetMask: "",
    secondaryIpAddresses: [],
    parentPortId: parent.id,
    subinterfaceVlan: undefined,
    encapsulationDot1qNative: false,
    gateway: "",
    dnsServer: "",
    adminUp: true,
    ipCapable: true,
    accessGroupIn: "",
    accessGroupOut: "",
    helperAddresses: [],
    natRole: undefined,
    hsrpGroups: [],
    duplex: parent.duplex,
    speed: parent.speed,
    mtu: parent.mtu,
    bandwidth: parent.bandwidth
  };
  return { device: { ...device, ports: [...device.ports, port] }, port };
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
    secondaryIpAddresses: [],
    gateway: "",
    dnsServer: "",
    adminUp: true,
    ipCapable: true,
    accessGroupIn: "",
    accessGroupOut: "",
    natRole: undefined,
    hsrpGroups: []
  };
  const next = ensureVlan({ ...device, ports: [...device.ports, port] }, vlan);
  return { device: next, port };
}

function parseDot1qEncapsulation(command: string): { vlan: number; native: boolean } | null {
  const tokens = command.trim().split(/\s+/);
  const vlan = Number(tokens[2]);
  if (!validVlan(vlan)) return null;
  return { vlan, native: tokens.slice(3).some((token) => token.toLowerCase() === "native") };
}

function applyDot1qEncapsulation(device: NetworkDevice, portId: string, vlan: number, native: boolean): NetworkDevice {
  const port = device.ports.find((item) => item.id === portId);
  if (!port || !isSubinterfacePort(port)) return device;
  const parent = parentPort(device, port);
  const next = updatePort(device, port.id, {
    mode: "routed",
    ipCapable: true,
    vlan,
    allowedVlans: [vlan],
    nativeVlan: vlan,
    subinterfaceVlan: vlan,
    encapsulationDot1qNative: native
  });
  if (!parent) return next;
  return updatePort(next, parent.id, { allowedVlans: uniqueNumbers([...(parent.allowedVlans ?? []), vlan]) });
}

function clearDot1qEncapsulation(device: NetworkDevice, portId: string): NetworkDevice {
  const port = device.ports.find((item) => item.id === portId);
  if (!port || !isSubinterfacePort(port)) return device;
  const parent = parentPort(device, port);
  const vlan = port.subinterfaceVlan;
  let next = updatePort(device, port.id, {
    vlan: subinterfaceVlanFromName(port.name) ?? 1,
    allowedVlans: [],
    subinterfaceVlan: undefined,
    encapsulationDot1qNative: false
  });
  if (!parent || !vlan) return next;
  const stillUsed = next.ports.some((candidate) => candidate.id !== port.id && candidate.parentPortId === parent.id && candidate.subinterfaceVlan === vlan);
  if (!stillUsed) next = updatePort(next, parent.id, { allowedVlans: (parent.allowedVlans ?? []).filter((item) => item !== vlan) });
  return next;
}

function isSubinterfacePort(port: NetworkPort): boolean {
  return Boolean(port.parentPortId || subinterfaceVlanFromName(port.name));
}

function parentPort(device: NetworkDevice, port: NetworkPort): NetworkPort | undefined {
  if (port.parentPortId) return device.ports.find((candidate) => candidate.id === port.parentPortId);
  const match = port.name.match(/^(.+)\.\d+$/);
  return match ? findPort(device, match[1]) : undefined;
}

function subinterfaceVlanFromName(name: string): number | undefined {
  const match = name.match(/\.(\d+)$/);
  const vlan = Number(match?.[1]);
  return validVlan(vlan) ? vlan : undefined;
}

function interfaceOperational(device: NetworkDevice, port: NetworkPort): boolean {
  if (!device.powerOn || !port.adminUp) return false;
  const parent = parentPort(device, port);
  if (!parent) return Boolean(port.linkId);
  return parent.adminUp && Boolean(parent.linkId);
}

function virtualMac(index: number): string {
  const value = Math.max(0, index).toString(16).padStart(6, "0").slice(-6);
  return `02:00:00:${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
}

function findPort(device: NetworkDevice, name: string): NetworkPort | undefined {
  return device.ports.find((port) => portNameMatches(port.name, name));
}

function portNameMatches(portName: string, query: string): boolean {
  const wanted = normalizePortName(query);
  return normalizePortName(portName) === wanted || compactAlias(portName) === wanted;
}

function selectedInterfacePorts(device: NetworkDevice, session: CliSession): NetworkPort[] {
  const ids = session.interfaceIds?.length ? session.interfaceIds : session.interfaceId ? [session.interfaceId] : [];
  return ids.map((id) => device.ports.find((port) => port.id === id)).filter((port): port is NetworkPort => Boolean(port));
}

function parseInterfaceRange(device: NetworkDevice, value: string): NetworkPort[] {
  const normalized = value.replace(/\s*,\s*/g, ",").replace(/\s*-\s*/g, "-").trim();
  const names = normalized.split(",").flatMap(expandInterfaceRangeToken);
  return names
    .map((name) => findPort(device, name))
    .filter((port): port is NetworkPort => Boolean(port))
    .filter((port, index, list) => list.findIndex((item) => item.id === port.id) === index);
}

function expandInterfaceRangeToken(token: string): string[] {
  const range = token.match(/^([a-zA-Z]+)(\d+(?:\/\d+)*\/)(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/);
  if (!range) return [token.trim()].filter(Boolean);
  const [, prefix, slotPath, startText, startSuffix, endText, endSuffix] = range;
  if ((startSuffix || endSuffix) && startSuffix !== endSuffix) return [token];
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [token];
  const suffix = startSuffix ? `:${startSuffix}` : "";
  return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${slotPath}${start + index}${suffix}`);
}

function normalizePortName(name: string): string {
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.startsWith("fastethernet")) return compact;
  if (compact.startsWith("gigabitethernet")) return compact;
  if (compact.startsWith("tengigabitethernet")) return compact;
  if (compact.startsWith("serial")) return compact;
  if (compact.startsWith("vlan")) return compact;
  if (compact.startsWith("fa")) return compact.replace(/^fa/, "fastethernet");
  if (compact.startsWith("f")) return compact.replace(/^f/, "fastethernet");
  if (compact.startsWith("gi")) return compact.replace(/^gi/, "gigabitethernet");
  if (compact.startsWith("g")) return compact.replace(/^g/, "gigabitethernet");
  if (compact.startsWith("te")) return compact.replace(/^te/, "tengigabitethernet");
  if (compact.startsWith("ten")) return compact.replace(/^ten/, "tengigabitethernet");
  if (compact.startsWith("se")) return compact.replace(/^se/, "serial");
  if (compact.startsWith("s")) return compact.replace(/^s/, "serial");
  return compact;
}

function compactAlias(name: string): string {
  return normalizePortName(name).replace("fastethernet", "f").replace("tengigabitethernet", "te").replace("gigabitethernet", "g").replace("serial", "s");
}

function shortPortAlias(name: string): string {
  return name
    .replace(/^TenGigabitEthernet/i, "te")
    .replace(/^FastEthernet/i, "fa")
    .replace(/^GigabitEthernet/i, "gi")
    .replace(/^Serial/i, "se")
    .replace(/^Ethernet/i, "e");
}

function parseVlans(value: string): number[] {
  return value.split(",").flatMap((item) => {
    const token = item.trim();
    const range = token.match(/^(\d+)-(\d+)$/);
    if (!range) return [Number(token)];
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (!validVlan(start) || !validVlan(end) || end < start || end - start > 512) return [];
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }).filter(validVlan).filter((item, index, list) => list.indexOf(item) === index);
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
  return { arpTable: [], macTable: [], dhcpLeases: [], natTranslations: [], logs: [] };
}

function isAction(value: string | undefined): value is "permit" | "deny" {
  return value === "permit" || value === "deny";
}

function isProtocol(value: string | undefined): value is "ip" | "icmp" | "tcp" | "udp" | "http" | "ftp" | "dns" | "dhcp" {
  return value === "ip" || value === "icmp" || value === "tcp" || value === "udp" || value === "http" || value === "ftp" || value === "dns" || value === "dhcp";
}

function exitSession(session: CliSession): CliSession {
  if (session.mode === "global") return { mode: "privileged" };
  if (session.mode === "interface" || session.mode === "vlan" || session.mode === "dhcp" || session.mode === "line" || session.mode === "router" || session.mode === "acl" || session.mode === "route-map" || session.mode === "ip-sla") return { mode: "global" };
  return { mode: "exec" };
}

function result(device: NetworkDevice, session: CliSession, output: string): CliResult {
  return { device, session, output };
}
