import { isIpv4, networkAddress } from "./ip";
import type { NetworkDevice, NetworkProject } from "../types/network";

type ServiceName = keyof NetworkDevice["config"]["services"];

interface ListeningService {
  service: ServiceName;
  label: string;
  protocol: "TCP" | "UDP";
  port: number;
  pid: string;
}

const listeningServices: ListeningService[] = [
  { service: "http", label: "HTTP", protocol: "TCP", port: 80, pid: "4080" },
  { service: "ftp", label: "FTP", protocol: "TCP", port: 21, pid: "4021" },
  { service: "email", label: "EMAIL", protocol: "TCP", port: 25, pid: "4025" },
  { service: "dhcp", label: "DHCP", protocol: "UDP", port: 67, pid: "4067" },
  { service: "dns", label: "DNS", protocol: "UDP", port: 53, pid: "4053" },
  { service: "tftp", label: "TFTP", protocol: "UDP", port: 69, pid: "4069" },
  { service: "syslog", label: "SYSLOG", protocol: "UDP", port: 514, pid: "4514" }
];

export interface DesktopNetstatRow {
  service: string;
  protocol: "TCP" | "UDP";
  localAddress: string;
  foreignAddress: string;
  state: string;
  pid: string;
}

export function desktopHostname(device: NetworkDevice): string {
  return device.config.hostname || device.label;
}

export function desktopGetmacTable(device: NetworkDevice, options: { verbose?: boolean } = {}): string {
  const ports = device.ports.filter((port) => port.kind !== "console");
  if (!ports.length) return "No network adapters found.";
  if (options.verbose) {
    return [
      "Connection Name      Network Adapter      Physical Address    Transport Name",
      "==================== ==================== =================== ==========================================================",
      ...ports.map((port) => `${port.name.padEnd(20)} ${port.kind.padEnd(20)} ${port.macAddress.padEnd(19)} \\Device\\Tcpip_${port.name.replace(/[^a-zA-Z0-9]/g, "_")}`)
    ].join("\n");
  }
  return [
    "Physical Address    Transport Name",
    "=================== ==========================================================",
    ...ports.map((port) => `${port.macAddress.padEnd(19)}\\Device\\Tcpip_${port.name.replace(/[^a-zA-Z0-9]/g, "_")}`)
  ].join("\n");
}

export function desktopIpconfigAll(device: NetworkDevice): string {
  const ports = device.ports.filter((port) => port.kind !== "console");
  if (!ports.length) return "네트워크 어댑터가 없습니다.";
  return ports
    .map((port) => {
      const lease = device.runtime.dhcpLeases.find((item) => item.macAddress === port.macAddress);
      return [
        `${port.name}:`,
        `  물리적 주소 . . . . . . . . . : ${port.macAddress}`,
        `  DHCP 사용 . . . . . . . . . . : ${lease ? "예" : "아니오"}`,
        ...(lease ? [`  DHCP 임대 만료 . . . . . . . : ${new Date(lease.expiresAt).toLocaleString("ko-KR", { hour12: false })}`] : []),
        `  IPv4 주소 . . . . . . . . . . . : ${port.ipAddress || "0.0.0.0"}`,
        `  서브넷 마스크 . . . . . . . . . : ${port.subnetMask || "0.0.0.0"}`,
        `  기본 게이트웨이 . . . . . . . . : ${port.gateway || "0.0.0.0"}`,
        `  DNS 서버 . . . . . . . . . . . . : ${port.dnsServer || "0.0.0.0"}`
      ].join("\n");
    })
    .join("\n");
}

export function desktopNetshInterfaceConfig(device: NetworkDevice): string {
  const ports = device.ports.filter((port) => port.kind !== "console");
  if (!ports.length) return "There are no interfaces on the system.";
  return ports.map((port) => {
    const lease = device.runtime.dhcpLeases.find((item) => item.macAddress === port.macAddress);
    const dnsMode = lease ? "DNS servers configured through DHCP" : "Statically Configured DNS Servers";
    return [
      `Configuration for interface "${port.name}"`,
      `    DHCP enabled:                         ${lease ? "Yes" : "No"}`,
      `    IP Address:                           ${port.ipAddress || "0.0.0.0"}`,
      `    Subnet Prefix:                        ${port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask) ? `${networkAddress(port.ipAddress, port.subnetMask)} (${port.subnetMask})` : "0.0.0.0 (0.0.0.0)"}`,
      `    Default Gateway:                      ${port.gateway || "0.0.0.0"}`,
      `    Gateway Metric:                       0`,
      `    InterfaceMetric:                      25`,
      `    ${dnsMode}:        ${port.dnsServer || "0.0.0.0"}`
    ].join("\n");
  }).join("\n\n");
}

export function desktopDnsCache(project: NetworkProject, device: NetworkDevice): string {
  const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
  if (!dnsServerIp) return "DNS 확인자 캐시에 표시할 서버가 없습니다.";
  const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
  if (!server) return `DNS 서버 ${dnsServerIp}을(를) 찾을 수 없습니다.`;
  return [
    "Windows IP Configuration",
    "",
    "DNS Resolver Cache",
    `Server: ${server.label} (${dnsServerIp})`,
    "",
    ...(server.config.dnsRecords.length ? server.config.dnsRecords.flatMap((record) => [
      ...dnsCacheRecordLines(record.name, "1", "4", "A (Host) Record", record.value),
      ...dnsCacheRecordLines(reverseDnsName(record.value), "12", String(record.name.length), "PTR Record", record.name)
    ]) : ["캐시된 DNS 레코드가 없습니다."])
  ].join("\n").trimEnd();
}

export function clearDesktopArpEntries(device: NetworkDevice, target = "*"): { device: NetworkDevice; removed: number; message: string } {
  const normalized = target.trim();
  if (!normalized || normalized === "*") {
    const removed = device.runtime.arpTable.length;
    return {
      device: { ...device, runtime: { ...device.runtime, arpTable: [] } },
      removed,
      message: removed ? `Deleted ${removed} ARP entries.` : "No ARP entries to delete."
    };
  }
  if (!isIpv4(normalized)) return { device, removed: 0, message: "Usage: arp -d <ip-address|*>" };
  const remaining = device.runtime.arpTable.filter((entry) => entry.ipAddress !== normalized);
  const removed = device.runtime.arpTable.length - remaining.length;
  return {
    device: removed ? { ...device, runtime: { ...device.runtime, arpTable: remaining } } : device,
    removed,
    message: removed ? `Deleted ARP entry ${normalized}.` : `ARP entry ${normalized} not found.`
  };
}

function dnsCacheRecordLines(name: string, type: string, dataLength: string, dataLabel: string, value: string): string[] {
  return [
    `Record Name . . . . . : ${name}`,
    `Record Type . . . . . : ${type}`,
    "Time To Live  . . . . : 1200",
    `Data Length . . . . . : ${dataLength}`,
    "Section . . . . . . . : Answer",
    `${dataLabel} . . . : ${value}`,
    ""
  ];
}

function reverseDnsName(ipAddress: string): string {
  if (!isIpv4(ipAddress)) return ipAddress;
  return `${ipAddress.split(".").reverse().join(".")}.in-addr.arpa`;
}

export function desktopArpTable(device: NetworkDevice): string {
  if (!device.runtime.arpTable.length) return "ARP 항목이 없습니다.";
  const portsByName = new Map(device.ports.map((port) => [port.name, port]));
  const groups = new Map<string, typeof device.runtime.arpTable>();
  device.runtime.arpTable.forEach((entry) => {
    const key = entry.portName || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  return [...groups.entries()].flatMap(([portName, entries]) => {
    const port = portsByName.get(portName);
    return [
      `Interface: ${port?.ipAddress || "0.0.0.0"} --- ${portName}`,
      "  Internet Address      Physical Address      Type",
      ...entries.map((entry) => `  ${entry.ipAddress.padEnd(22)}${entry.macAddress.padEnd(22)}dynamic`)
    ];
  }).join("\n\n");
}

export function desktopRoutePrint(device: NetworkDevice): string {
  const routedPorts = device.ports.filter((port) => port.kind !== "console" && port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask));
  if (!routedPorts.length) return "설치된 라우트가 없습니다.";
  const interfaceRows = routedPorts.map((port, index) => ` ${String(index + 1).padStart(2)}...${port.macAddress.padEnd(17)} ...... ${port.name}`);
  const activeRows = routedPorts.flatMap((port) => [
    ...(port.gateway ? [routePrintRow("0.0.0.0", "0.0.0.0", port.gateway, port.ipAddress, "25")] : []),
    routePrintRow(networkAddress(port.ipAddress, port.subnetMask), port.subnetMask, "On-link", port.ipAddress, "25"),
    routePrintRow(port.ipAddress, "255.255.255.255", "On-link", port.ipAddress, "25")
  ]);
  return [
    "Interface List",
    ...interfaceRows,
    "",
    "IPv4 Route Table",
    "Active Routes:",
    "Network Destination        Netmask          Gateway         Interface       Metric",
    ...activeRows,
    "",
    "Persistent Routes:",
    "  None"
  ].join("\n");
}

function routePrintRow(destination: string, netmask: string, gateway: string, iface: string, metric: string): string {
  return `${destination.padEnd(27)}${netmask.padEnd(17)}${gateway.padEnd(16)}${iface.padEnd(16)}${metric}`;
}

export function desktopNetstatListening(device: NetworkDevice, options: { includePid?: boolean } = {}): string {
  const rows = desktopNetstatListeningRows(device);
  const includePid = options.includePid ?? false;
  if (!rows.length) return "Active Connections\n\n  No listening services.";
  return [
    "Active Connections",
    "",
    includePid
      ? "  Proto  Local Address          Foreign Address        State           PID"
      : "  Proto  Local Address          Foreign Address        State",
    ...rows.map((row) => includePid
      ? `  ${row.protocol.padEnd(5)}  ${row.localAddress.padEnd(21)}${row.foreignAddress.padEnd(23)}${row.state.padEnd(16)}${row.pid}`
      : `  ${row.protocol.padEnd(5)}  ${row.localAddress.padEnd(21)}${row.foreignAddress.padEnd(23)}${row.state}`)
  ].join("\n");
}

export function desktopNetstatListeningRows(device: NetworkDevice): DesktopNetstatRow[] {
  const boundAddresses = device.ports
    .filter((port) => port.kind !== "console" && port.adminUp && port.ipAddress)
    .map((port) => port.ipAddress);
  const addresses = boundAddresses.length ? boundAddresses : ["0.0.0.0"];
  return listeningServices
    .filter((service) => device.config.services[service.service])
    .flatMap((service) => addresses.map((ipAddress) => ({
      service: service.label,
      protocol: service.protocol,
      localAddress: `${ipAddress}:${service.port}`,
      foreignAddress: service.protocol === "TCP" ? "0.0.0.0:0" : "*:*",
      state: service.protocol === "TCP" ? "LISTENING" : "",
      pid: service.pid
    })));
}

export function parseDesktopArpCommand(command: string): { action: "show" | "delete" | "none"; target: string } {
  const tokens = normalizedDesktopTokens(command);
  if (tokens[0] !== "arp") return { action: "none", target: "" };
  if (tokens.slice(1).some((token) => token === "-a")) return { action: "show", target: "" };
  const deleteIndex = tokens.slice(1).findIndex((token) => token === "-d");
  if (deleteIndex >= 0) {
    return { action: "delete", target: tokens[deleteIndex + 2] ?? "*" };
  }
  return { action: "none", target: "" };
}

export function isDesktopRoutePrintCommand(command: string): boolean {
  const tokens = normalizedDesktopTokens(command);
  return tokens[0] === "route" && tokens[1] === "print" && tokens.slice(2).every((token) => token === "-4");
}

export function parseDesktopNetstatCommand(command: string): { kind: "routes" | "listening" | "none"; includePid: boolean } {
  const tokens = normalizedDesktopTokens(command);
  if (tokens[0] !== "netstat") return { kind: "none", includePid: false };
  const flags = new Set(tokens.slice(1).flatMap(expandDesktopOptionToken));
  if (flags.has("r")) return { kind: "routes", includePid: false };
  if (flags.size === 0 || flags.has("a") || flags.has("n") || flags.has("o")) {
    return { kind: "listening", includePid: flags.has("o") };
  }
  return { kind: "none", includePid: false };
}

export function isDesktopNetshInterfaceConfigCommand(command: string): boolean {
  const tokens = normalizedDesktopTokens(command);
  return tokens[0] === "netsh" &&
    (tokens[1] === "interface" || tokens[1] === "int") &&
    (tokens[2] === "ip" || tokens[2] === "ipv4") &&
    tokens[3] === "show" &&
    (tokens[4] === "config" || tokens[4] === "configuration");
}

export function parseDesktopRemoteAccessCommand(command: string): { protocol: "ssh" | "telnet" | ""; targetText: string; username: string; port: string } {
  const tokens = command.trim().split(/\s+/);
  const protocol = tokens.shift()?.toLowerCase();
  if (protocol !== "ssh" && protocol !== "telnet") return { protocol: "", targetText: "", username: "", port: "" };
  let username = "";
  let port = "";
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (protocol === "ssh" && (lower === "-l" || lower === "/l") && tokens[index + 1]) {
      username = tokens[index + 1];
      index += 1;
    } else if ((lower === "-p" || lower === "/p") && tokens[index + 1]) {
      port = tokens[index + 1];
      index += 1;
    } else if (protocol === "ssh" && lower.startsWith("-p") && lower.length > 2) {
      port = token.slice(2);
    } else {
      positional.push(token);
    }
  }
  let targetText = positional[0] ?? "";
  if (protocol === "ssh" && targetText.includes("@")) {
    const [user, host] = targetText.split("@");
    username = username || user;
    targetText = host || targetText;
  }
  if (protocol === "telnet" && positional[1] && /^\d+$/.test(positional[1])) {
    port = positional[1];
  }
  return { protocol, targetText, username, port };
}

export function parseDesktopNslookupCommand(command: string): { name: string; serverText: string; queryType: string } {
  const tokens = command.trim().split(/\s+/);
  const args = tokens[0]?.toLowerCase() === "nslookup" ? tokens.slice(1) : [...tokens];
  let queryType = "";
  while (args[0]?.startsWith("-")) {
    const option = args[0].toLowerCase();
    if (option.startsWith("-type=") || option.startsWith("-querytype=") || option.startsWith("-q=")) {
      queryType = args.shift()?.split("=")[1]?.toUpperCase() ?? "";
    } else if (option === "-type" || option === "-querytype" || option === "-q") {
      args.shift();
      queryType = (args.shift() ?? "").toUpperCase();
    } else if (option === "-debug" || option === "-nodebug") {
      args.shift();
    } else if (option === "-timeout" || option === "-retry") {
      args.shift();
      if (args[0] && !args[0].startsWith("-")) args.shift();
    } else if (option.startsWith("-timeout=") || option.startsWith("-retry=")) {
      args.shift();
    } else {
      break;
    }
  }
  return { name: args[0] ?? "", serverText: args[1] ?? "", queryType };
}

export function parseDesktopPingCommand(command: string): { count: number; targetText: string } {
  const tokens = command.trim().split(/\s+/);
  const args = tokens[0]?.toLowerCase() === "ping" ? tokens.slice(1) : tokens;
  let count = 4;
  while (args[0]?.startsWith("-")) {
    const option = args.shift()?.toLowerCase() ?? "";
    if (option === "-n") {
      count = boundedDesktopNumber(args.shift() ?? "4", 1, 10);
    } else if (option.startsWith("-n") && option.length > 2) {
      count = boundedDesktopNumber(option.slice(2), 1, 10);
    } else if (["-l", "-w", "-i"].includes(option) && args.length) {
      args.shift();
    }
  }
  return { count, targetText: args.join(" ") };
}

export function parseDesktopTraceCommand(command: string): { targetText: string; numericOnly: boolean } {
  const tokens = command.trim().split(/\s+/);
  const args = ["tracert", "traceroute", "pathping"].includes(tokens[0]?.toLowerCase()) ? tokens.slice(1) : [...tokens];
  let numericOnly = false;
  while (args[0]?.startsWith("-")) {
    const option = args.shift()?.toLowerCase() ?? "";
    if (option === "-d" || option === "-n") numericOnly = true;
    if (["-h", "-w", "-q", "-p", "-g", "-j"].includes(option) && args.length) args.shift();
  }
  return { targetText: args.join(" "), numericOnly };
}

function boundedDesktopNumber(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizedDesktopTokens(command: string): string[] {
  return command.trim().toLowerCase().split(/\s+/).filter(Boolean).map((token) => token.startsWith("/") ? `-${token.slice(1)}` : token);
}

function expandDesktopOptionToken(token: string): string[] {
  if (!token.startsWith("-")) return [];
  return token.slice(1).split("");
}
