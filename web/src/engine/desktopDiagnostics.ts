import { isIpv4, maskToPrefix, networkAddress } from "./ip";
import type { NetworkDevice, NetworkPort, NetworkProject, PortKind } from "../types/network";

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

export interface DesktopTasklistRow {
  imageName: string;
  pid: string;
  sessionName: string;
  sessionNumber: string;
  memUsage: string;
  services: string[];
}

export interface DesktopResolveDnsNameRecord {
  queryName: string;
  queryType: "A" | "PTR";
  recordValue: string;
  dnsServerIp: string;
  serverLabel: string;
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
  const ports = desktopNetworkPorts(device);
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

export function desktopGetNetAdapter(device: NetworkDevice, options: { nameFilter?: string } = {}): string {
  const rows = filterDesktopPortsByName(desktopNetworkPorts(device), options.nameFilter);
  if (!rows.length) return "Get-NetAdapter : No matching MSFT_NetAdapter objects found.";
  return [
    "Name                      InterfaceDescription              ifIndex Status       MacAddress          LinkSpeed",
    "----                      --------------------              ------- ------       ----------          ---------",
    ...rows.map((port) => `${port.name.padEnd(25)} ${desktopAdapterDescription(port.kind).padEnd(33)} ${desktopIfIndex(device, port).padStart(7)} ${desktopAdapterStatus(port).padEnd(12)} ${windowsMacAddress(port.macAddress).padEnd(19)} ${desktopLinkSpeed(port)}`)
  ].join("\n");
}

export function desktopGetNetIpConfiguration(device: NetworkDevice, options: { all?: boolean; nameFilter?: string } = {}): string {
  const rows = filterDesktopPortsByName(desktopNetworkPorts(device), options.nameFilter);
  if (!rows.length) return "Get-NetIPConfiguration : No matching MSFT_NetIPConfiguration objects found.";
  return rows.map((port) => {
    const lease = device.runtime.dhcpLeases.find((item) => item.macAddress === port.macAddress);
    return [
      `InterfaceAlias       : ${port.name}`,
      `InterfaceIndex       : ${desktopIfIndex(device, port)}`,
      `InterfaceDescription : ${desktopAdapterDescription(port.kind)}`,
      `NetProfile.Name      : PTWeb Lab`,
      `IPv4Address          : ${port.ipAddress || "0.0.0.0"}`,
      `IPv4DefaultGateway   : ${port.gateway || "0.0.0.0"}`,
      `DNSServer            : ${port.dnsServer || "0.0.0.0"}`,
      ...(options.all ? [
        `MacAddress           : ${windowsMacAddress(port.macAddress)}`,
        `Dhcp                 : ${lease ? "Enabled" : "Disabled"}`,
        `NetAdapter.Status    : ${desktopAdapterStatus(port)}`
      ] : [])
    ].join("\n");
  }).join("\n\n");
}

export function desktopGetDnsClientServerAddress(device: NetworkDevice, options: { addressFamily?: string; nameFilter?: string } = {}): string {
  const family = (options.addressFamily ?? "IPv4").trim().toLowerCase();
  if (family && family !== "ipv4" && family !== "2") return "Get-DnsClientServerAddress : No matching DNS client server addresses found.";
  const rows = filterDesktopPortsByName(desktopNetworkPorts(device), options.nameFilter);
  if (!rows.length) return "Get-DnsClientServerAddress : No matching DNS client server addresses found.";
  return [
    "InterfaceAlias               Interface Address ServerAddresses",
    "                             Index     Family",
    "--------------               --------- ------- ---------------",
    ...rows.map((port) => `${port.name.padEnd(28)} ${desktopIfIndex(device, port).padStart(9)} IPv4    {${port.dnsServer || "0.0.0.0"}}`)
  ].join("\n");
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

export function desktopResolveDnsNameOutput(record: DesktopResolveDnsNameRecord): string {
  const valueHeader = record.queryType === "PTR" ? "NameHost" : "IPAddress";
  const displayName = record.queryType === "PTR" ? reverseDnsName(record.queryName) : record.queryName;
  return [
    `Server       : ${record.serverLabel}`,
    `Address      : ${record.dnsServerIp}`,
    "",
    `Name                                           Type   TTL   Section    ${valueHeader}`,
    `----                                           ----   ---   -------    ${"-".repeat(valueHeader.length)}`,
    `${displayName.padEnd(46)} ${record.queryType.padEnd(5)} ${"1200".padEnd(5)} ${"Answer".padEnd(10)} ${record.recordValue}`
  ].join("\n");
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

export function desktopGetNetRoute(device: NetworkDevice, options: { addressFamily?: string; destinationPrefix?: string } = {}): string {
  const family = (options.addressFamily ?? "IPv4").trim().toLowerCase();
  if (family && family !== "ipv4" && family !== "2") return "Get-NetRoute : No matching MSFT_NetRoute objects found.";
  const destinationFilter = (options.destinationPrefix ?? "").trim().toLowerCase();
  const rows = desktopNetRouteRows(device).filter((row) => !destinationFilter || row.destinationPrefix.toLowerCase().includes(destinationFilter));
  if (!rows.length) return "Get-NetRoute : No matching MSFT_NetRoute objects found.";
  return [
    "ifIndex DestinationPrefix             NextHop          RouteMetric ifMetric PolicyStore",
    "------- -----------------             -------          ----------- -------- -----------",
    ...rows.map((row) => `${row.ifIndex.padStart(7)} ${row.destinationPrefix.padEnd(29)} ${row.nextHop.padEnd(16)} ${row.routeMetric.padStart(11)} ${row.ifMetric.padStart(8)} ${row.policyStore}`)
  ].join("\n");
}

export function desktopGetNetNeighbor(device: NetworkDevice, options: { addressFamily?: string; ipAddress?: string } = {}): string {
  const family = (options.addressFamily ?? "IPv4").trim().toLowerCase();
  if (family && family !== "ipv4" && family !== "2") return "Get-NetNeighbor : No matching MSFT_NetNeighbor objects found.";
  const ipFilter = (options.ipAddress ?? "").trim();
  const rows = device.runtime.arpTable
    .filter((entry) => !ipFilter || entry.ipAddress === ipFilter)
    .map((entry) => {
      const port = device.ports.find((item) => item.name === entry.portName);
      return {
        ifIndex: port ? desktopIfIndex(device, port) : "0",
        ipAddress: entry.ipAddress,
        linkLayerAddress: windowsMacAddress(entry.macAddress),
        state: "Reachable",
        policyStore: "ActiveStore"
      };
    });
  if (!rows.length) return "Get-NetNeighbor : No matching MSFT_NetNeighbor objects found.";
  return [
    "ifIndex IPAddress        LinkLayerAddress  State       PolicyStore",
    "------- ---------        ----------------  -----       -----------",
    ...rows.map((row) => `${row.ifIndex.padStart(7)} ${row.ipAddress.padEnd(16)} ${row.linkLayerAddress.padEnd(17)} ${row.state.padEnd(11)} ${row.policyStore}`)
  ].join("\n");
}

export function desktopNetstatListening(device: NetworkDevice, options: { includePid?: boolean; includeProcess?: boolean } = {}): string {
  const rows = desktopNetstatListeningRows(device);
  const includePid = options.includePid ?? false;
  const includeProcess = options.includeProcess ?? false;
  const tasksByPid = includeProcess ? new Map(desktopTasklistRows(device).map((task) => [task.pid, task])) : new Map<string, DesktopTasklistRow>();
  if (!rows.length) return "Active Connections\n\n  No listening services.";
  return [
    "Active Connections",
    "",
    netstatHeader(includePid, includeProcess),
    ...rows.map((row) => netstatRow(row, includePid, includeProcess, tasksByPid.get(row.pid)?.imageName ?? "-"))
  ].join("\n");
}

function netstatHeader(includePid: boolean, includeProcess: boolean): string {
  return [
    "  Proto  Local Address          Foreign Address        State",
    includePid ? "          PID" : "",
    includeProcess ? " Process" : ""
  ].join("");
}

function netstatRow(row: DesktopNetstatRow, includePid: boolean, includeProcess: boolean, processName: string): string {
  return [
    `  ${row.protocol.padEnd(5)}  ${row.localAddress.padEnd(21)}${row.foreignAddress.padEnd(23)}${row.state.padEnd(16)}`,
    includePid ? row.pid.padStart(11) : "",
    includeProcess ? ` ${processName}` : ""
  ].join("");
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

export function desktopTasklist(device: NetworkDevice, options: { showServices?: boolean; pidFilter?: string } = {}): string {
  const rows = desktopTasklistRows(device).filter((row) => !options.pidFilter || row.pid === options.pidFilter);
  if (!rows.length) return "INFO: No tasks are running which match the specified criteria.";
  if (options.showServices) {
    return [
      "Image Name                     PID Services",
      "========================= ======== ============================================",
      ...rows.map((row) => `${row.imageName.padEnd(25)} ${row.pid.padStart(8)} ${row.services.join(", ")}`)
    ].join("\n");
  }
  return [
    "Image Name                     PID Session Name        Session#    Mem Usage",
    "========================= ======== ================ =========== ============",
    ...rows.map((row) => `${row.imageName.padEnd(25)} ${row.pid.padStart(8)} ${row.sessionName.padEnd(16)} ${row.sessionNumber.padStart(11)} ${row.memUsage.padStart(12)}`)
  ].join("\n");
}

export function desktopGetNetTcpConnection(device: NetworkDevice, options: { state?: string; localPort?: string } = {}): string {
  const stateFilter = normalizeDesktopTcpState(options.state ?? "");
  const localPortFilter = (options.localPort ?? "").trim();
  const rows = desktopNetstatListeningRows(device)
    .filter((row) => row.protocol === "TCP")
    .filter((row) => !stateFilter || row.state === stateFilter)
    .filter((row) => !localPortFilter || splitDesktopEndpoint(row.localAddress).port === localPortFilter);
  if (!rows.length) return "Get-NetTCPConnection : No matching MSFT_NetTCPConnection objects found.";
  return [
    "LocalAddress                        LocalPort RemoteAddress                       RemotePort State       AppliedSetting OwningProcess",
    "------------                        --------- -------------                       ---------- -----       -------------- -------------",
    ...rows.map((row) => {
      const local = splitDesktopEndpoint(row.localAddress);
      const remote = splitDesktopEndpoint(row.foreignAddress);
      return `${local.address.padEnd(35)} ${local.port.padStart(9)} ${remote.address.padEnd(35)} ${remote.port.padStart(10)} ${desktopTcpStateLabel(row.state).padEnd(11)} ${"Internet".padEnd(14)} ${row.pid}`;
    })
  ].join("\n");
}

export function desktopGetProcess(device: NetworkDevice, options: { pidFilter?: string; nameFilter?: string } = {}): string {
  const nameFilter = (options.nameFilter ?? "").toLowerCase().replace(/\.exe$/, "");
  const rows = desktopTasklistRows(device)
    .filter((row) => !options.pidFilter || row.pid === options.pidFilter)
    .filter((row) => !nameFilter || desktopProcessName(row.imageName).toLowerCase().includes(nameFilter));
  if (!rows.length) return "Get-Process : Cannot find a process with the specified process identifier or process name.";
  return [
    "Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  SI ProcessName",
    "-------  ------    -----      -----     ------     --  -- -----------",
    ...rows.map((row) => {
      const pidNumber = Number(row.pid);
      const handles = String(80 + (Number.isFinite(pidNumber) ? pidNumber % 47 : 0));
      const npm = String(6 + (Number.isFinite(pidNumber) ? pidNumber % 9 : 0));
      const pm = String(4096 + (Number.isFinite(pidNumber) ? pidNumber % 2048 : 0));
      const ws = String(8192 + (Number.isFinite(pidNumber) ? pidNumber % 4096 : 0));
      const cpu = (Number.isFinite(pidNumber) ? (pidNumber % 120) / 10 : 0).toFixed(2);
      return `${handles.padStart(7)} ${npm.padStart(7)} ${pm.padStart(8)} ${ws.padStart(10)} ${cpu.padStart(10)} ${row.pid.padStart(6)} ${row.sessionNumber.padStart(3)} ${desktopProcessName(row.imageName)}`;
    })
  ].join("\n");
}

export function desktopGetService(device: NetworkDevice, options: { nameFilter?: string } = {}): string {
  const filter = (options.nameFilter ?? "").trim().toLowerCase();
  const rows = listeningServices
    .filter((service) => !filter || service.service.includes(filter) || service.label.toLowerCase().includes(filter) || `ptweb ${service.label.toLowerCase()} service`.includes(filter))
    .map((service) => ({
      status: device.config.services[service.service] ? "Running" : "Stopped",
      name: service.service,
      displayName: `PTWeb ${service.label} Service`
    }));
  if (!rows.length) return "Get-Service : Cannot find any service with service name matching the specified filter.";
  return [
    "Status   Name               DisplayName",
    "------   ----               -----------",
    ...rows.map((row) => `${row.status.padEnd(8)} ${row.name.padEnd(18)} ${row.displayName}`)
  ].join("\n");
}

export function desktopScQuery(device: NetworkDevice, options: { extended?: boolean; serviceName?: string } = {}): string {
  const query = options.serviceName?.trim().toLowerCase() ?? "";
  const services = listeningServices.filter((service) => !query || service.service === query || service.label.toLowerCase() === query);
  if (!services.length) return `[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.`;
  return services.map((service) => {
    const running = Boolean(device.config.services[service.service]);
    return [
      `SERVICE_NAME: ${service.service}`,
      `DISPLAY_NAME: PTWeb ${service.label} Service`,
      "        TYPE               : 10  WIN32_OWN_PROCESS",
      `        STATE              : ${running ? "4  RUNNING" : "1  STOPPED"}`,
      "                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)",
      "        WIN32_EXIT_CODE    : 0  (0x0)",
      "        SERVICE_EXIT_CODE  : 0  (0x0)",
      "        CHECKPOINT         : 0x0",
      "        WAIT_HINT          : 0x0",
      ...(options.extended ? [`        PID                : ${running ? service.pid : "0"}`, "        FLAGS              :"] : [])
    ].join("\n");
  }).join("\n\n");
}

export function desktopTasklistRows(device: NetworkDevice): DesktopTasklistRow[] {
  const tasks = new Map<string, DesktopTasklistRow>();
  desktopNetstatListeningRows(device).forEach((row) => {
    const current = tasks.get(row.pid);
    if (current) {
      if (!current.services.includes(row.service)) current.services.push(row.service);
      return;
    }
    tasks.set(row.pid, {
      imageName: `ptweb-${row.service.toLowerCase()}.exe`,
      pid: row.pid,
      sessionName: "Services",
      sessionNumber: "0",
      memUsage: `${(4096 + (Number(row.pid) % 2048)).toLocaleString("en-US")} K`,
      services: [row.service]
    });
  });
  return [...tasks.values()].sort((left, right) => Number(left.pid) - Number(right.pid));
}

export function parseDesktopGetNetTcpConnectionCommand(command: string): { valid: boolean; state: string; localPort: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-nettcpconnection") return { valid: false, state: "", localPort: "" };
  let state = "";
  let localPort = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower === "-state" && tokens[index + 1]) {
      state = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-state:")) {
      state = token.slice(token.indexOf(":") + 1);
    } else if (lower === "-localport" && tokens[index + 1]) {
      localPort = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-localport:")) {
      localPort = token.slice(token.indexOf(":") + 1);
    }
  }
  return { valid: true, state, localPort };
}

export function parseDesktopGetProcessCommand(command: string): { valid: boolean; pidFilter: string; nameFilter: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (!["get-process", "gps", "ps"].includes(commandName ?? "")) return { valid: false, pidFilter: "", nameFilter: "" };
  let pidFilter = "";
  let nameFilter = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (["-id", "-pid", "-processid"].includes(lower) && tokens[index + 1]) {
      pidFilter = cleanDesktopPid(tokens[index + 1]);
      index += 1;
    } else if (lower.startsWith("-id:") || lower.startsWith("-pid:") || lower.startsWith("-processid:")) {
      pidFilter = cleanDesktopPid(token.slice(token.indexOf(":") + 1));
    } else if (lower === "-name" && tokens[index + 1]) {
      nameFilter = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-name:")) {
      nameFilter = token.slice(token.indexOf(":") + 1);
    } else if (!lower.startsWith("-") && !pidFilter && /^\d+$/.test(token)) {
      pidFilter = token;
    } else if (!lower.startsWith("-") && !nameFilter) {
      nameFilter = token;
    }
  }
  return { valid: true, pidFilter, nameFilter };
}

export function parseDesktopGetServiceCommand(command: string): { valid: boolean; nameFilter: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (!["get-service", "gsv"].includes(commandName ?? "")) return { valid: false, nameFilter: "" };
  return {
    valid: true,
    nameFilter: parseDesktopPowerShellOption(tokens, ["-name", "-displayname"]) || tokens.find((token) => !token.startsWith("-")) || ""
  };
}

export function parseDesktopGetNetAdapterCommand(command: string): { valid: boolean; nameFilter: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-netadapter") return { valid: false, nameFilter: "" };
  return { valid: true, nameFilter: parseDesktopPowerShellOption(tokens, ["-name", "-interfacealias"]) };
}

export function parseDesktopGetNetRouteCommand(command: string): { valid: boolean; addressFamily: string; destinationPrefix: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-netroute") return { valid: false, addressFamily: "", destinationPrefix: "" };
  return {
    valid: true,
    addressFamily: parseDesktopPowerShellOption(tokens, ["-addressfamily"]),
    destinationPrefix: parseDesktopPowerShellOption(tokens, ["-destinationprefix"])
  };
}

export function parseDesktopGetNetNeighborCommand(command: string): { valid: boolean; addressFamily: string; ipAddress: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-netneighbor") return { valid: false, addressFamily: "", ipAddress: "" };
  return {
    valid: true,
    addressFamily: parseDesktopPowerShellOption(tokens, ["-addressfamily"]),
    ipAddress: parseDesktopPowerShellOption(tokens, ["-ipaddress"])
  };
}

export function parseDesktopGetNetIpConfigurationCommand(command: string): { valid: boolean; all: boolean; nameFilter: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-netipconfiguration") return { valid: false, all: false, nameFilter: "" };
  return {
    valid: true,
    all: tokens.some((token) => token.toLowerCase() === "-all"),
    nameFilter: parseDesktopPowerShellOption(tokens, ["-interfacealias", "-name"])
  };
}

export function parseDesktopGetDnsClientServerAddressCommand(command: string): { valid: boolean; addressFamily: string; nameFilter: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "get-dnsclientserveraddress") return { valid: false, addressFamily: "", nameFilter: "" };
  return {
    valid: true,
    addressFamily: parseDesktopPowerShellOption(tokens, ["-addressfamily"]),
    nameFilter: parseDesktopPowerShellOption(tokens, ["-interfacealias", "-name"])
  };
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

export function parseDesktopTasklistCommand(command: string): { valid: boolean; showServices: boolean; pidFilter: string } {
  const tokens = normalizedDesktopTokens(command);
  if (tokens[0] !== "tasklist") return { valid: false, showServices: false, pidFilter: "" };
  const filterMatch = command.match(/(?:\/|-)?fi\s+"?\s*pid\s+eq\s+(\d+)/i);
  return {
    valid: true,
    showServices: tokens.includes("-svc"),
    pidFilter: filterMatch?.[1] ?? ""
  };
}

export function parseDesktopScCommand(command: string): { valid: boolean; extended: boolean; serviceName: string } {
  const tokens = normalizedDesktopTokens(command);
  if (tokens[0] !== "sc" || (tokens[1] !== "query" && tokens[1] !== "queryex")) {
    return { valid: false, extended: false, serviceName: "" };
  }
  return {
    valid: true,
    extended: tokens[1] === "queryex",
    serviceName: tokens[2] ?? ""
  };
}

export function parseDesktopTestNetConnectionCommand(command: string): { valid: boolean; targetText: string; port: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "test-netconnection" && commandName !== "tnc") return { valid: false, targetText: "", port: "" };
  let targetText = "";
  let port = "";
  const commonPorts: Record<string, string> = { http: "80", rdp: "3389", smb: "445", winrm: "5985" };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (["-computername", "-computer", "-cn"].includes(lower) && tokens[index + 1]) {
      targetText = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-computername:")) {
      targetText = token.slice(token.indexOf(":") + 1);
    } else if (["-port", "-p"].includes(lower) && tokens[index + 1]) {
      port = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-port:") || lower.startsWith("-p:")) {
      port = token.slice(token.indexOf(":") + 1);
    } else if (lower === "-commontcpport" && tokens[index + 1]) {
      port = commonPorts[tokens[index + 1].toLowerCase()] ?? port;
      index += 1;
    } else if (lower.startsWith("-commontcpport:")) {
      port = commonPorts[token.slice(token.indexOf(":") + 1).toLowerCase()] ?? port;
    } else if (lower === "-informationlevel" && tokens[index + 1]) {
      index += 1;
    } else if (lower === "-traceroute" || lower === "-diagnoserouting") {
      continue;
    } else if (!lower.startsWith("-") && !targetText) {
      targetText = token;
    }
  }
  return { valid: true, targetText, port };
}

export function isDesktopRoutePrintCommand(command: string): boolean {
  const tokens = normalizedDesktopTokens(command);
  return tokens[0] === "route" && tokens[1] === "print" && tokens.slice(2).every((token) => token === "-4");
}

export function parseDesktopNetstatCommand(command: string): { kind: "routes" | "listening" | "none"; includePid: boolean; includeProcess: boolean } {
  const tokens = normalizedDesktopTokens(command);
  if (tokens[0] !== "netstat") return { kind: "none", includePid: false, includeProcess: false };
  const flags = new Set(tokens.slice(1).flatMap(expandDesktopOptionToken));
  if (flags.has("r")) return { kind: "routes", includePid: false, includeProcess: false };
  if (flags.size === 0 || flags.has("a") || flags.has("n") || flags.has("o") || flags.has("b")) {
    return { kind: "listening", includePid: flags.has("o"), includeProcess: flags.has("b") };
  }
  return { kind: "none", includePid: false, includeProcess: false };
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

export function parseDesktopResolveDnsNameCommand(command: string): { valid: boolean; name: string; serverText: string; queryType: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "resolve-dnsname") return { valid: false, name: "", serverText: "", queryType: "" };
  let name = "";
  let serverText = "";
  let queryType = "";
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower === "-name" && tokens[index + 1]) {
      name = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-name:")) {
      name = token.slice(token.indexOf(":") + 1);
    } else if (lower === "-server" && tokens[index + 1]) {
      serverText = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-server:")) {
      serverText = token.slice(token.indexOf(":") + 1);
    } else if (lower === "-type" && tokens[index + 1]) {
      queryType = tokens[index + 1].toUpperCase();
      index += 1;
    } else if (lower.startsWith("-type:")) {
      queryType = token.slice(token.indexOf(":") + 1).toUpperCase();
    } else if (["-dnsonly", "-nohostsfile", "-quicktimeout"].includes(lower)) {
      continue;
    } else if (!lower.startsWith("-")) {
      positional.push(token);
    }
  }
  return {
    valid: true,
    name: name || positional[0] || "",
    serverText: serverText || positional[1] || "",
    queryType
  };
}

export function parseDesktopWebRequestCommand(command: string): { valid: boolean; targetText: string; method: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (!["invoke-webrequest", "iwr"].includes(commandName ?? "")) return { valid: false, targetText: "", method: "" };
  let targetText = "";
  let method = "GET";
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (["-uri", "-url"].includes(lower) && tokens[index + 1]) {
      targetText = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-uri:") || lower.startsWith("-url:")) {
      targetText = token.slice(token.indexOf(":") + 1);
    } else if (lower === "-method" && tokens[index + 1]) {
      method = tokens[index + 1].toUpperCase();
      index += 1;
    } else if (lower.startsWith("-method:")) {
      method = token.slice(token.indexOf(":") + 1).toUpperCase();
    } else if (["-usebasicparsing", "-disablekeepalive"].includes(lower)) {
      continue;
    } else if (!lower.startsWith("-")) {
      positional.push(token);
    }
  }
  return { valid: true, targetText: targetText || positional[0] || "", method };
}

export function parseDesktopTestConnectionCommand(command: string): { valid: boolean; count: number; targetText: string } {
  const tokens = command.trim().split(/\s+/);
  const commandName = tokens.shift()?.toLowerCase();
  if (commandName !== "test-connection") return { valid: false, count: 4, targetText: "" };
  let count = 4;
  let targetText = "";
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (["-computername", "-targetname", "-source"].includes(lower) && tokens[index + 1]) {
      if (lower !== "-source") targetText = tokens[index + 1];
      index += 1;
    } else if (lower.startsWith("-computername:") || lower.startsWith("-targetname:")) {
      targetText = token.slice(token.indexOf(":") + 1);
    } else if (["-count", "-count:"].includes(lower) && tokens[index + 1]) {
      count = boundedDesktopNumber(tokens[index + 1], 1, 10);
      index += 1;
    } else if (lower.startsWith("-count:")) {
      count = boundedDesktopNumber(token.slice(token.indexOf(":") + 1), 1, 10);
    } else if (["-quiet", "-ipv4"].includes(lower)) {
      continue;
    } else if (!lower.startsWith("-")) {
      positional.push(token);
    }
  }
  return { valid: true, count, targetText: targetText || positional[0] || "" };
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

function splitDesktopEndpoint(endpoint: string): { address: string; port: string } {
  const index = endpoint.lastIndexOf(":");
  if (index < 0) return { address: endpoint, port: "" };
  return {
    address: endpoint.slice(0, index) || "*",
    port: endpoint.slice(index + 1)
  };
}

function normalizeDesktopTcpState(state: string): string {
  const normalized = state.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "listen" || normalized === "listening") return "LISTENING";
  return normalized.toUpperCase();
}

function desktopTcpStateLabel(state: string): string {
  return state === "LISTENING" ? "Listen" : state;
}

function desktopProcessName(imageName: string): string {
  return imageName.replace(/\.exe$/i, "");
}

function cleanDesktopPid(value: string): string {
  return value.split(",")[0]?.replace(/\D/g, "") ?? "";
}

function desktopNetworkPorts(device: NetworkDevice): NetworkDevice["ports"] {
  return device.ports.filter((port) => port.kind !== "console");
}

function filterDesktopPortsByName(ports: NetworkDevice["ports"], nameFilter = ""): NetworkDevice["ports"] {
  const normalized = nameFilter.trim().toLowerCase();
  if (!normalized) return ports;
  return ports.filter((port) => port.name.toLowerCase().includes(normalized));
}

function desktopIfIndex(device: NetworkDevice, port: NetworkPort): string {
  return String(desktopNetworkPorts(device).findIndex((item) => item.id === port.id) + 1);
}

function desktopNetRouteRows(device: NetworkDevice): Array<{ ifIndex: string; destinationPrefix: string; nextHop: string; routeMetric: string; ifMetric: string; policyStore: string }> {
  return desktopNetworkPorts(device)
    .filter((port) => port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask))
    .flatMap((port) => [
      ...(port.gateway ? [{
        ifIndex: desktopIfIndex(device, port),
        destinationPrefix: "0.0.0.0/0",
        nextHop: port.gateway,
        routeMetric: "0",
        ifMetric: "25",
        policyStore: "ActiveStore"
      }] : []),
      {
        ifIndex: desktopIfIndex(device, port),
        destinationPrefix: `${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)}`,
        nextHop: "0.0.0.0",
        routeMetric: "256",
        ifMetric: "25",
        policyStore: "ActiveStore"
      },
      {
        ifIndex: desktopIfIndex(device, port),
        destinationPrefix: `${port.ipAddress}/32`,
        nextHop: "0.0.0.0",
        routeMetric: "256",
        ifMetric: "25",
        policyStore: "ActiveStore"
      }
    ]);
}

function desktopAdapterDescription(kind: PortKind): string {
  const labels: Record<PortKind, string> = {
    console: "PTWeb Console Adapter",
    ethernet: "PTWeb Ethernet Adapter",
    "fast-ethernet": "PTWeb Fast Ethernet Adapter",
    fiber: "PTWeb Fiber Ethernet Adapter",
    "gigabit-ethernet": "PTWeb Gigabit Ethernet Adapter",
    serial: "PTWeb Serial Adapter",
    wireless: "PTWeb Wireless Adapter"
  };
  return labels[kind];
}

function desktopAdapterStatus(port: NetworkPort): string {
  return port.adminUp ? "Up" : "Disabled";
}

function desktopLinkSpeed(port: NetworkPort): string {
  if (port.bandwidth) return `${port.bandwidth} Kbps`;
  if (port.speed && port.speed !== "auto") return `${port.speed} Mbps`;
  const speeds: Record<PortKind, string> = {
    console: "9600 bps",
    ethernet: "10 Mbps",
    "fast-ethernet": "100 Mbps",
    fiber: "1 Gbps",
    "gigabit-ethernet": "1 Gbps",
    serial: "1.544 Mbps",
    wireless: "54 Mbps"
  };
  return speeds[port.kind];
}

function windowsMacAddress(macAddress: string): string {
  const compact = macAddress.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (compact.length === 12) return compact.match(/.{1,2}/g)?.join("-") ?? macAddress;
  return macAddress.toUpperCase();
}

function parseDesktopPowerShellOption(tokens: string[], names: string[]): string {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (names.includes(lower) && tokens[index + 1]) return cleanPowerShellValue(tokens[index + 1]);
    const colonName = names.find((name) => lower.startsWith(`${name}:`));
    if (colonName) return cleanPowerShellValue(token.slice(colonName.length + 1));
  }
  return "";
}

function cleanPowerShellValue(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
