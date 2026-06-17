import type { CliMode, DhcpPool, FirewallRule, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, RouteEntry } from "../types/network";
import { makeId } from "../utils/ids";
import { connectedRoutes, dynamicLearnedRoutes, isValidIp } from "./ip";
import { simulatePing } from "./simulation";

export interface CliResult {
  device: NetworkDevice;
  output: string;
  project?: NetworkProject;
}

function prompt(device: NetworkDevice): string {
  const mode = device.config.cliMode;
  if (mode === "privileged") return `${device.config.hostname}#`;
  if (mode === "global") return `${device.config.hostname}(config)#`;
  if (mode === "interface") return `${device.config.hostname}(config-if)#`;
  if (mode === "dhcp") return `${device.config.hostname}(dhcp-config)#`;
  if (mode === "router") return `${device.config.hostname}(config-router)#`;
  if (mode === "vlan") return `${device.config.hostname}(config-vlan)#`;
  return `${device.config.hostname}>`;
}

export function cliPrompt(device: NetworkDevice): string {
  return prompt(device);
}

function withConfigLine(device: NetworkDevice, line: string, replacePrefix = line): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      runningConfig: [...device.config.runningConfig.filter((entry) => entry !== line && !entry.startsWith(replacePrefix)), line],
    },
  };
}

function withoutConfigLines(device: NetworkDevice, reject: (line: string) => boolean): NetworkDevice {
  return { ...device, config: { ...device.config, runningConfig: device.config.runningConfig.filter((line) => !reject(line)) } };
}

function setMode(device: NetworkDevice, cliMode: CliMode, context = device.config.cliContext): NetworkDevice {
  return { ...device, config: { ...device.config, cliMode, cliContext: context } };
}

function findPort(device: NetworkDevice, name: string): NetworkPort | undefined {
  const normalized = name.toLowerCase();
  return device.ports.find((port) => port.name.toLowerCase() === normalized || port.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized.replace(/[^a-z0-9]/g, ""));
}

function updatePort(device: NetworkDevice, port: NetworkPort): NetworkDevice {
  return { ...device, ports: device.ports.map((entry) => (entry.id === port.id ? port : entry)) };
}

function isCommand(lower: string, ...aliases: string[]): boolean {
  return aliases.includes(lower);
}

function generatedRunningConfig(device: NetworkDevice): string[] {
  const lines = [`hostname ${device.config.hostname}`];

  for (const port of device.ports) {
    const portLines: string[] = [];
    if (port.description) {
      portLines.push(` description ${port.description}`);
    }
    if (port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask) {
      portLines.push(` ip address ${port.interfaceConfig.ipAddress} ${port.interfaceConfig.subnetMask}`);
    }
    if (port.interfaceConfig.helperAddress) {
      portLines.push(` ip helper-address ${port.interfaceConfig.helperAddress}`);
    }
    if (port.clockRate && port.kind === "serial") {
      portLines.push(` clock rate ${port.clockRate}`);
    }
    if (port.status === "administratively-down") {
      portLines.push(" shutdown");
    } else {
      portLines.push(" no shutdown");
    }
    if (port.mode !== "routed") {
      portLines.push(` switchport mode ${port.mode}`);
      if (port.mode === "access") portLines.push(` switchport access vlan ${port.vlan}`);
      if (port.mode === "trunk") portLines.push(` switchport trunk allowed vlan ${port.allowedVlans.join(",")}`);
    }
    if (portLines.length) lines.push(`interface ${port.name}`, ...portLines);
  }

  for (const route of device.config.staticRoutes) {
    lines.push(`ip route ${route.destination} ${route.mask} ${route.nextHop}`);
  }

  for (const pool of device.config.dhcpPools) {
    lines.push(`ip dhcp pool ${pool.name}`);
    if (pool.network && pool.mask) lines.push(` network ${pool.network} ${pool.mask}`);
    if (pool.defaultRouter) lines.push(` default-router ${pool.defaultRouter}`);
    if (pool.dnsServer) lines.push(` dns-server ${pool.dnsServer}`);
  }

  for (const record of device.config.dnsRecords) {
    lines.push(`ip host ${record.host} ${record.address}`);
  }

  device.config.firewallRules.forEach((rule, index) => {
    lines.push(`access-list ${rule.listId ?? index + 1} ${rule.action} ${rule.protocol} ${rule.source} ${rule.destination}`);
  });

  if (device.config.wireless.ssid) {
    lines.push(`wireless ssid ${device.config.wireless.ssid}`);
    lines.push(`wireless security ${device.config.wireless.security}`);
  }

  const supplemental = device.config.runningConfig.filter(
    (line) =>
      !line.startsWith("hostname ") &&
      !line.startsWith("interface ") &&
      !line.startsWith("ip route ") &&
      !line.startsWith("ip host ") &&
      !line.startsWith("access-list ") &&
      !line.startsWith("ip dhcp pool ") &&
      !line.startsWith("network ") &&
      !line.startsWith("default-router ") &&
      !line.startsWith("dns-server "),
  );

  return Array.from(new Set([...lines, ...supplemental]));
}

function showIpInterfaceBrief(device: NetworkDevice): string {
  const rows = device.ports.map((port) => {
    const ip = port.interfaceConfig.ipAddress || "unassigned";
    const status = device.powerOn && port.status === "up" ? "up" : "down";
    return `${port.name.padEnd(22)} ${ip.padEnd(16)} ${status.padEnd(8)} ${status}`;
  });
  return ["Interface              IP-Address       Status   Protocol", ...rows].join("\n");
}

function connectedPeer(project: NetworkProject | undefined, deviceId: string, portId: string): string {
  const link = project?.links.find(
    (entry) =>
      (entry.a.deviceId === deviceId && entry.a.portId === portId) ||
      (entry.b.deviceId === deviceId && entry.b.portId === portId),
  );
  if (!link || !project) return "";
  const peer = link.a.deviceId === deviceId && link.a.portId === portId ? link.b : link.a;
  const peerDevice = project.devices.find((entry) => entry.id === peer.deviceId);
  const peerPort = peerDevice?.ports.find((entry) => entry.id === peer.portId);
  return `${peerDevice?.label ?? "unknown"} ${peerPort?.name ?? "port"} ${link.type}/${link.status}`;
}

function showInterfacesStatus(device: NetworkDevice, project?: NetworkProject): string {
  return [
    "Port                  Name               Status       Vlan  Duplex  Speed   Connected To",
    ...device.ports.map((port) => {
      const linkText = connectedPeer(project, device.id, port.id);
      const status = port.status === "administratively-down" ? "disabled" : linkText ? "connected" : "notconnect";
      return `${port.name.padEnd(21)} ${(port.description ?? "").padEnd(18)} ${status.padEnd(12)} ${String(port.vlan).padEnd(5)} ${port.duplex.padEnd(7)} ${String(port.bandwidthMbps).padEnd(7)} ${linkText}`;
    }),
  ].join("\n");
}

function showInterfacesDescription(device: NetworkDevice): string {
  return [
    "Interface              Status      Protocol    Description",
    ...device.ports.map((port) => {
      const status = device.powerOn && port.status === "up" ? "up" : port.status === "administratively-down" ? "admin down" : "down";
      const protocol = status === "up" ? "up" : "down";
      return `${port.name.padEnd(22)} ${status.padEnd(11)} ${protocol.padEnd(11)} ${port.description ?? ""}`;
    }),
  ].join("\n");
}

function showInterfacesTrunk(device: NetworkDevice): string {
  const trunks = device.ports.filter((port) => port.mode === "trunk");
  if (!trunks.length) return "No trunk ports configured";
  return [
    "Port                  Mode         Encapsulation  Status        Native vlan  Vlans allowed on trunk",
    ...trunks.map((port) => `${port.name.padEnd(21)} on           802.1q         ${port.status.padEnd(13)} ${String(port.vlan).padEnd(12)} ${port.allowedVlans.join(",")}`),
  ].join("\n");
}

function linkForPort(project: NetworkProject | undefined, deviceId: string, portId: string): NetworkLink | undefined {
  return project?.links.find(
    (link) =>
      (link.a.deviceId === deviceId && link.a.portId === portId) ||
      (link.b.deviceId === deviceId && link.b.portId === portId),
  );
}

function serialRoleForPort(link: NetworkLink | undefined, deviceId: string, portId: string): "DCE" | "DTE" | "" {
  if (!link || (link.type !== "serial-dce" && link.type !== "serial-dte")) return "";
  const isA = link.a.deviceId === deviceId && link.a.portId === portId;
  const dceSide = link.dceEndpoint ?? "a";
  return dceSide === (isA ? "a" : "b") ? "DCE" : "DTE";
}

function showInterfaceDetail(device: NetworkDevice, port: NetworkPort, project?: NetworkProject): string {
  const link = linkForPort(project, device.id, port.id);
  const lineProtocol = device.powerOn && port.status === "up" && (!link || link.status === "up" || link.status === "console") ? "up" : "down";
  const serialRole = serialRoleForPort(link, device.id, port.id);
  return [
    `${port.name} is ${port.status === "administratively-down" ? "administratively down" : port.status}, line protocol is ${lineProtocol}`,
    port.description ? `  Description: ${port.description}` : "  Description: not set",
    `  Hardware is ${port.kind}, address is ${port.macAddress}`,
    `  Internet address is ${port.interfaceConfig.ipAddress || "unassigned"}${port.interfaceConfig.subnetMask ? ` ${port.interfaceConfig.subnetMask}` : ""}`,
    port.interfaceConfig.helperAddress ? `  Helper address is ${port.interfaceConfig.helperAddress}` : "",
    `  MTU 1500 bytes, BW ${port.bandwidthMbps * 1000} Kbit, DLY 100 usec`,
    `  Duplex ${port.duplex}, link type ${link?.type ?? "not connected"}, state ${link?.status ?? "notconnect"}`,
    port.mode === "routed" ? "  Routed port" : `  Switchport mode ${port.mode}, access vlan ${port.vlan}, allowed vlans ${port.allowedVlans.join(",")}`,
    serialRole ? `  Serial cable role ${serialRole}, clock rate ${port.clockRate ? `${port.clockRate} bps` : "not set"}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function showCdpNeighbors(device: NetworkDevice, project?: NetworkProject): string {
  if (!project) return "CDP data is unavailable outside a project.";
  const rows = project.links
    .filter((link) => link.status === "up" && (link.a.deviceId === device.id || link.b.deviceId === device.id))
    .map((link) => {
      const local = link.a.deviceId === device.id ? link.a : link.b;
      const peer = link.a.deviceId === device.id ? link.b : link.a;
      const peerDevice = project.devices.find((entry) => entry.id === peer.deviceId);
      const localPort = device.ports.find((port) => port.id === local.portId);
      const peerPort = peerDevice?.ports.find((port) => port.id === peer.portId);
      return `${(peerDevice?.label ?? "unknown").padEnd(18)} ${(localPort?.name ?? "port").padEnd(18)} ${(peerPort?.name ?? "port").padEnd(18)} ${link.type}/${link.status}`;
    });
  return rows.length ? ["Device ID          Local Interface    Port ID            Platform/State", ...rows].join("\n") : "No CDP neighbors found";
}

function showControllersSerial(device: NetworkDevice, port: NetworkPort, project?: NetworkProject): string {
  if (port.kind !== "serial") return `% ${port.name} is not a serial interface`;
  const link = linkForPort(project, device.id, port.id);
  const role = serialRoleForPort(link, device.id, port.id) || "not connected";
  return [
    `Interface ${port.name}`,
    `Hardware is serial`,
    `Cable type: ${role}`,
    `Clock rate: ${port.clockRate ? `${port.clockRate} bps` : "not set"}`,
    `Link state: ${link?.status ?? "notconnect"}`,
  ].join("\n");
}

function findDeviceByIp(project: NetworkProject, ipAddress: string): NetworkDevice | undefined {
  return project.devices.find((device) => device.ports.some((port) => port.interfaceConfig.ipAddress === ipAddress));
}

function showVlan(device: NetworkDevice): string {
  const vlans = Array.from(new Set(device.ports.map((port) => port.vlan))).sort((a, b) => a - b);
  return [
    "VLAN Name                             Status    Ports",
    ...vlans.map((vlan) => {
      const ports = device.ports.filter((port) => port.vlan === vlan && port.mode === "access").map((port) => port.name);
      return `${String(vlan).padEnd(4)} VLAN${String(vlan).padEnd(28)} active    ${ports.join(", ")}`;
    }),
  ].join("\n");
}

function showMac(device: NetworkDevice): string {
  const entries = Object.entries(device.runtime.mac);
  if (!entries.length) return "Mac Address Table is empty";
  return [
    "Vlan    Mac Address       Type        Ports",
    ...entries.map(([mac, entry]) => `${String(entry.vlan).padEnd(8)}${mac.padEnd(18)}dynamic     ${device.ports.find((port) => port.id === entry.portId)?.name ?? "unknown"}`),
  ].join("\n");
}

function showIpRoute(device: NetworkDevice, project?: NetworkProject): string {
  const routes = [...connectedRoutes(device), ...device.config.staticRoutes, ...dynamicLearnedRoutes(device, project)];
  if (!routes.length) return "Gateway of last resort is not set\n\nNo routes configured";
  const defaultRoute = routes.find((route) => route.destination === "0.0.0.0" && route.mask === "0.0.0.0");
  return [
    "Codes: C - connected, S - static, R - RIP, O - OSPF, D - EIGRP",
    defaultRoute ? `Gateway of last resort is ${defaultRoute.nextHop}` : "Gateway of last resort is not set",
    "",
    ...routes.map((route) => {
      const code =
        route.learnedBy === "connected"
          ? "C"
          : route.learnedBy === "rip"
            ? "R"
            : route.learnedBy === "ospf"
              ? "O"
              : route.learnedBy === "eigrp"
                ? "D"
                : route.destination === "0.0.0.0" && route.mask === "0.0.0.0"
                  ? "S*"
                  : "S";
      return `${code.padEnd(5)}${route.destination}/${route.mask} via ${route.nextHop}${route.outgoingPortId ? `, ${device.ports.find((port) => port.id === route.outgoingPortId)?.name ?? "unknown"}` : ""}`;
    }),
  ].join("\n");
}

function showIpProtocols(device: NetworkDevice): string {
  const lines = device.config.runningConfig;
  const processes = Array.from(new Set(lines.filter((line) => line.startsWith("router ")).map((line) => line.split("\n")[0].replace("router ", ""))));
  const networks = lines.filter((line) => line.includes("\n network ")).map((line) => line.split("\n").at(-1)?.trim()).filter(Boolean) as string[];
  if (!processes.length) return "Routing Protocol is not configured";
  return [
    "Routing Protocol is configured",
    ...processes.map((line) => `  Protocol: ${line}`),
    networks.length ? "  Routing for Networks:" : "  No networks configured",
    ...networks.map((line) => `    ${line.replace("network ", "")}`),
  ].join("\n");
}

function showArp(device: NetworkDevice): string {
  const entries = Object.entries(device.runtime.arp);
  if (!entries.length) return "Protocol  Address          Age (min)  Hardware Addr   Type   Interface\nInternet  -- empty --";
  return [
    "Protocol  Address          Age (min)  Hardware Addr   Type   Interface",
    ...entries.map(([ip, mac]) => `Internet  ${ip.padEnd(16)} 0          ${mac.padEnd(15)} ARPA   local`),
  ].join("\n");
}

function showDhcpBinding(device: NetworkDevice): string {
  const rows = device.config.dhcpPools.flatMap((pool) =>
    Object.entries(pool.leases).map(([mac, ip]) => `${ip.padEnd(16)} ${mac.padEnd(18)} ${pool.name}`),
  );
  return rows.length ? ["IP address       Client-ID          Pool", ...rows].join("\n") : "No DHCP bindings";
}

function showDhcpPool(device: NetworkDevice): string {
  if (!device.config.dhcpPools.length) return "No DHCP pools configured";
  return device.config.dhcpPools
    .map((pool) => [`Pool ${pool.name}`, `  Network: ${pool.network} ${pool.mask}`, `  Default router: ${pool.defaultRouter || "not set"}`, `  DNS server: ${pool.dnsServer || "not set"}`, `  Leases: ${Object.keys(pool.leases).length}`, `  Next offset: ${pool.nextOffset}`].join("\n"))
    .join("\n\n");
}

function showHosts(device: NetworkDevice): string {
  if (!device.config.dnsRecords.length) return "Host table is empty";
  return ["Default domain is not set", "Name                 Address", ...device.config.dnsRecords.map((record) => `${record.host.padEnd(20)} ${record.address}`)].join("\n");
}

function showAccessLists(device: NetworkDevice): string {
  if (!device.config.firewallRules.length) return "No access lists configured";
  return device.config.firewallRules.map((rule, index) => `access-list ${rule.listId ?? index + 1} ${rule.action} ${rule.protocol} ${rule.source} ${rule.destination}`).join("\n");
}

function showInventory(device: NetworkDevice): string {
  const slots = device.moduleSlots.length
    ? device.moduleSlots.map((slot) => `NAME: "${slot.label}", DESCR: "${slot.installedModule || "Blank"}"\nPID: ${slot.installedModule || "Blank"}, VID: 1.0, SN: ${slot.id.toUpperCase()}`)
    : ['NAME: "Chassis", DESCR: "Fixed configuration"'];
  return [`NAME: "${device.label}", DESCR: "${device.modelName}"`, `PID: ${device.modelName}, VID: 1.0, SN: ${device.id.toUpperCase()}`, "", ...slots].join("\n");
}

function makeDhcpPool(name: string): DhcpPool {
  return {
    name,
    network: "",
    mask: "",
    defaultRouter: "",
    dnsServer: "",
    nextOffset: 10,
    leases: {},
  };
}

function cliHelp(): string {
  return [
    "Common commands:",
    "  enable",
    "  configure terminal",
    "  interface <name>",
    "  ip address <ip> <mask>",
    "  ip helper-address <ip>",
    "  no shutdown",
    "  switchport trunk allowed vlan <list>",
    "  description <text>",
    "  clock rate <bps>",
    "  ip dhcp pool <name>",
    "  ip host <name> <ip>",
    "  access-list <id> permit|deny <protocol> <source> <destination>",
    "  show running-config",
    "  show ip interface brief",
    "  show interfaces description",
    "  show interfaces status",
    "  show interfaces trunk",
    "  show inventory",
    "  show cdp neighbors",
    "  show ip route",
    "  show ip protocols",
    "  show controllers serial <interface>",
    "  show ip dhcp binding",
    "  show ip dhcp pool",
    "  show hosts",
    "  show access-lists",
    "  show vlan brief",
    "  clear arp",
    "  clear mac address-table dynamic",
    "  ping <ip>",
    "  copy running-config startup-config",
  ].join("\n");
}

export function runCliCommand(inputDevice: NetworkDevice, rawCommand: string, project?: NetworkProject): CliResult {
  const command = rawCommand.trim();
  let device = inputDevice;

  if (!command) return { device, output: prompt(device) };

  const lower = command.toLowerCase();
  const parts = command.split(/\s+/);

  if (lower === "?" || lower === "help") {
    return { device, output: cliHelp() };
  }

  if (lower === "enable" || lower === "en") {
    device = setMode(device, "privileged", {});
    return { device, output: prompt(device) };
  }

  if (["configure terminal", "conf t", "config t"].includes(lower)) {
    if (device.config.cliMode === "user") return { device, output: "% Privileged mode required" };
    device = setMode(device, "global", {});
    return { device, output: prompt(device) };
  }

  if (lower === "end") {
    device = setMode(device, "privileged", {});
    return { device, output: prompt(device) };
  }

  if (lower === "exit") {
    const nextMode: CliMode = device.config.cliMode === "user" ? "user" : device.config.cliMode === "privileged" ? "user" : device.config.cliMode === "global" ? "privileged" : "global";
    device = setMode(device, nextMode, {});
    return { device, output: prompt(device) };
  }

  if (isCommand(lower, "show running-config", "show run", "sh running-config", "sh run")) {
    return { device, output: ["Building configuration...", "", ...generatedRunningConfig(device)].join("\n") };
  }

  if (isCommand(lower, "show startup-config", "show start", "sh startup-config", "sh start")) {
    return { device, output: device.config.startupConfig.length ? device.config.startupConfig.join("\n") : "startup-config is not present" };
  }

  if (isCommand(lower, "show ip interface brief", "show ip int brief", "sh ip interface brief", "sh ip int brief")) {
    return { device, output: showIpInterfaceBrief(device) };
  }

  if (isCommand(lower, "show interfaces status", "show interface status", "show int status", "sh interfaces status", "sh interface status", "sh int status")) {
    return { device, output: showInterfacesStatus(device, project) };
  }

  if (isCommand(lower, "show interfaces description", "show interface description", "show int description", "sh interfaces description", "sh interface description", "sh int description")) {
    return { device, output: showInterfacesDescription(device) };
  }

  if (isCommand(lower, "show interfaces trunk", "show interface trunk", "show int trunk", "sh interfaces trunk", "sh interface trunk", "sh int trunk")) {
    return { device, output: showInterfacesTrunk(device) };
  }

  if (isCommand(lower, "show inventory", "sh inventory")) {
    return { device, output: showInventory(device) };
  }

  if (lower.startsWith("show interfaces ") || lower.startsWith("show interface ") || lower.startsWith("show int ") || lower.startsWith("sh interfaces ") || lower.startsWith("sh interface ") || lower.startsWith("sh int ")) {
    const portName = command.replace(/^(show|sh)\s+(interfaces?|int)\s+/i, "");
    const port = findPort(device, portName);
    return { device, output: port ? showInterfaceDetail(device, port, project) : `% Invalid interface ${portName}` };
  }

  if (isCommand(lower, "show cdp neighbors", "show cdp neighbor", "sh cdp neighbors", "sh cdp neighbor")) {
    return { device, output: showCdpNeighbors(device, project) };
  }

  if (lower.startsWith("show controllers serial ")) {
    const portName = command.slice("show controllers serial ".length);
    const port = findPort(device, portName);
    return { device, output: port ? showControllersSerial(device, port, project) : `% Invalid interface ${portName}` };
  }

  if (isCommand(lower, "show vlan brief", "show vlan", "sh vlan brief", "sh vlan")) {
    return { device, output: showVlan(device) };
  }

  if (isCommand(lower, "show mac address-table", "sh mac address-table")) {
    return { device, output: showMac(device) };
  }

  if (isCommand(lower, "show ip route", "sh ip route")) {
    return { device, output: showIpRoute(device, project) };
  }

  if (isCommand(lower, "show ip protocols", "sh ip protocols")) {
    return { device, output: showIpProtocols(device) };
  }

  if (isCommand(lower, "show arp", "show ip arp", "sh arp", "sh ip arp")) {
    return { device, output: showArp(device) };
  }

  if (isCommand(lower, "show ip dhcp binding", "sh ip dhcp binding")) {
    return { device, output: showDhcpBinding(device) };
  }

  if (isCommand(lower, "show ip dhcp pool", "sh ip dhcp pool")) {
    return { device, output: showDhcpPool(device) };
  }

  if (isCommand(lower, "show hosts", "show host", "sh hosts", "sh host")) {
    return { device, output: showHosts(device) };
  }

  if (isCommand(lower, "show access-lists", "show access-list", "sh access-lists", "sh access-list")) {
    return { device, output: showAccessLists(device) };
  }

  if (lower === "copy running-config startup-config" || lower === "write memory" || lower === "wr") {
    device = { ...device, config: { ...device.config, startupConfig: generatedRunningConfig(device) } };
    return { device, output: "Building configuration...\n[OK]" };
  }

  if (lower === "clear arp") {
    device = { ...device, runtime: { ...device.runtime, arp: {} } };
    return { device, output: "ARP cache cleared" };
  }

  if (lower === "clear mac address-table dynamic") {
    device = { ...device, runtime: { ...device.runtime, mac: {} } };
    return { device, output: "Dynamic MAC address table cleared" };
  }

  if (lower.startsWith("ping ")) {
    const targetIp = parts[1];
    if (!project) return { device, output: `Use the Simulation PDU controls for simulated ping to ${targetIp}.` };
    const destination = findDeviceByIp(project, targetIp);
    if (!destination) {
      return {
        device,
        output: [`Type escape sequence to abort.`, `Sending 5, 100-byte ICMP Echos to ${targetIp}, timeout is 2 seconds:`, ".....", "Success rate is 0 percent", "% Destination IP not found in topology"].join("\n"),
      };
    }
    const simulated = simulatePing(project, device.id, destination.id);
    const latest = simulated.simulation.events.at(-1);
    const selectedProject = latest ? { ...simulated, simulation: { ...simulated.simulation, selectedEventId: latest.id } } : simulated;
    const success = latest?.status === "success";
    return {
      device,
      project: selectedProject,
      output: [
        "Type escape sequence to abort.",
        `Sending 5, 100-byte ICMP Echos to ${targetIp}, timeout is 2 seconds:`,
        success ? "!!!!!" : ".....",
        success ? "Success rate is 100 percent (5/5)" : `Success rate is 0 percent (0/5)\n${latest?.summary ?? "Ping failed."}`,
      ].join("\n"),
    };
  }

  if (device.config.cliMode === "global") {
    if (lower.startsWith("hostname ")) {
      const hostname = parts.slice(1).join("-");
      device = withConfigLine({ ...device, label: hostname, config: { ...device.config, hostname } }, `hostname ${hostname}`, "hostname ");
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("interface ") || lower.startsWith("int ")) {
      const portName = lower.startsWith("int ") ? command.slice("int ".length) : command.slice("interface ".length);
      const port = findPort(device, portName);
      if (!port) return { device, output: `% Invalid interface ${portName}` };
      device = setMode(device, "interface", { interfaceId: port.id });
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("ip route ") && parts.length >= 5) {
      const [, , destination, mask, nextHop] = parts;
      if (!isValidIp(destination) || !isValidIp(mask) || !isValidIp(nextHop)) return { device, output: "% Invalid route" };
      const route: RouteEntry = { destination, mask, nextHop, learnedBy: "static" };
      device = {
        ...withConfigLine(device, `ip route ${destination} ${mask} ${nextHop}`),
        config: {
          ...device.config,
          staticRoutes: [...device.config.staticRoutes.filter((entry) => entry.destination !== destination || entry.mask !== mask || entry.nextHop !== nextHop), route],
        },
      };
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("no ip route ") && parts.length >= 6) {
      const [, , , destination, mask, nextHop] = parts;
      device = withoutConfigLines(
        {
          ...device,
          config: {
            ...device.config,
            staticRoutes: device.config.staticRoutes.filter((route) => route.destination !== destination || route.mask !== mask || route.nextHop !== nextHop),
          },
        },
        (line) => line === `ip route ${destination} ${mask} ${nextHop}`,
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("ip host ") && parts.length >= 4) {
      const host = parts[2];
      const address = parts[3];
      if (!isValidIp(address)) return { device, output: "% Invalid host address" };
      device = withConfigLine(
        {
          ...device,
          config: {
            ...device.config,
            dnsRecords: [...device.config.dnsRecords.filter((record) => record.host !== host), { host, address }],
          },
        },
        `ip host ${host} ${address}`,
        `ip host ${host} `,
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("no ip host ") && parts.length >= 4) {
      const host = parts[3];
      device = withoutConfigLines(
        { ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.filter((record) => record.host !== host) } },
        (line) => line.startsWith(`ip host ${host} `),
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("access-list ") && parts.length >= 6) {
      const [, listId, action, protocol, source, destination] = parts;
      if (action !== "permit" && action !== "deny") return { device, output: "% Invalid ACL action" };
      if (!["ip", "icmp", "tcp", "udp"].includes(protocol)) return { device, output: "% Invalid ACL protocol" };
      const rule: FirewallRule = {
        id: makeId("acl"),
        listId,
        action,
        protocol: protocol as FirewallRule["protocol"],
        source,
        destination,
      };
      device = withConfigLine(
        { ...device, config: { ...device.config, firewallRules: [...device.config.firewallRules, rule] } },
        `access-list ${listId} ${action} ${protocol} ${source} ${destination}`,
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("no access-list ") && parts.length >= 3) {
      const listId = parts[2];
      device = withoutConfigLines(
        {
          ...device,
          config: {
            ...device.config,
            firewallRules: device.config.firewallRules.filter((rule, index) => rule.listId !== listId && String(index + 1) !== listId),
          },
        },
        (line) => line.startsWith(`access-list ${listId} `),
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("ip dhcp pool ")) {
      const name = parts.slice(3).join("-");
      const existing = device.config.dhcpPools.find((pool) => pool.name === name);
      device = {
        ...device,
        config: {
          ...device.config,
          dhcpPools: existing ? device.config.dhcpPools : [...device.config.dhcpPools, makeDhcpPool(name)],
          cliMode: "dhcp",
          cliContext: { dhcpPoolName: name },
        },
      };
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("router ")) {
      const routerProcess = parts.slice(1).join(" ");
      device = setMode(withConfigLine(device, `router ${routerProcess}`), "router", { routerProcess });
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("vlan ")) {
      const vlanId = Number(parts[1]);
      if (!Number.isInteger(vlanId)) return { device, output: "% Invalid VLAN" };
      device = setMode(withConfigLine(device, `vlan ${vlanId}`), "vlan", { vlanId });
      return { device, output: prompt(device) };
    }
  }

  if (device.config.cliMode === "interface") {
    const port = device.ports.find((entry) => entry.id === device.config.cliContext.interfaceId);
    if (!port) return { device: setMode(device, "global", {}), output: "% Interface context lost" };

    if (lower.startsWith("ip address ") && parts.length >= 4) {
      const [, , ipAddress, subnetMask] = parts;
      if (!isValidIp(ipAddress) || !isValidIp(subnetMask)) return { device, output: "% Invalid IP address" };
      device = withConfigLine(
        updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, ipAddress, subnetMask, dhcp: false } }),
        `interface ${port.name}\n ip address ${ipAddress} ${subnetMask}`,
        `interface ${port.name}\n ip address `,
      );
      return { device, output: prompt(device) };
    }

    if (lower === "no ip address") {
      device = withoutConfigLines(
        updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, ipAddress: "", subnetMask: "", dhcp: false } }),
        (line) => line.startsWith(`interface ${port.name}\n ip address `),
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("ip helper-address ") && parts.length >= 3) {
      const helperAddress = parts[2];
      if (!isValidIp(helperAddress)) return { device, output: "% Invalid helper address" };
      device = withConfigLine(
        updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, helperAddress } }),
        `interface ${port.name}\n ip helper-address ${helperAddress}`,
        `interface ${port.name}\n ip helper-address `,
      );
      return { device, output: prompt(device) };
    }

    if (lower === "no ip helper-address") {
      device = withoutConfigLines(
        updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, helperAddress: "" } }),
        (line) => line.startsWith(`interface ${port.name}\n ip helper-address `),
      );
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("description ")) {
      const description = command.slice("description ".length).trim();
      device = withConfigLine(updatePort(device, { ...port, description }), `interface ${port.name}\n description ${description}`, `interface ${port.name}\n description `);
      return { device, output: prompt(device) };
    }

    if (lower === "no description") {
      device = withoutConfigLines(updatePort(device, { ...port, description: "" }), (line) => line.startsWith(`interface ${port.name}\n description `));
      return { device, output: prompt(device) };
    }

    if (lower === "no shutdown") {
      device = withConfigLine(updatePort(device, { ...port, status: "up" }), `interface ${port.name}\n no shutdown`, `interface ${port.name}\n shutdown`);
      return { device, output: prompt(device) };
    }

    if (lower === "shutdown") {
      device = withConfigLine(updatePort(device, { ...port, status: "administratively-down" }), `interface ${port.name}\n shutdown`, `interface ${port.name}\n no shutdown`);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("duplex ")) {
      const duplex = parts[1] as NetworkPort["duplex"];
      if (!["auto", "half", "full"].includes(duplex)) return { device, output: "% Invalid duplex" };
      device = withConfigLine(updatePort(device, { ...port, duplex }), `interface ${port.name}\n duplex ${duplex}`, `interface ${port.name}\n duplex `);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("speed ")) {
      const speed = Number(parts[1]);
      if (!Number.isInteger(speed) || speed <= 0) return { device, output: "% Invalid speed" };
      device = withConfigLine(updatePort(device, { ...port, bandwidthMbps: speed }), `interface ${port.name}\n speed ${speed}`, `interface ${port.name}\n speed `);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("clock rate ")) {
      if (port.kind !== "serial") return { device, output: "% Clock rate can only be set on serial interfaces" };
      const clockRate = Number(parts[2]);
      if (!Number.isInteger(clockRate) || clockRate <= 0) return { device, output: "% Invalid clock rate" };
      device = withConfigLine(updatePort(device, { ...port, clockRate }), `interface ${port.name}\n clock rate ${clockRate}`, `interface ${port.name}\n clock rate `);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("switchport mode ")) {
      const mode = parts[2] === "trunk" ? "trunk" : "access";
      device = withConfigLine(updatePort(device, { ...port, mode }), `interface ${port.name}\n switchport mode ${mode}`, `interface ${port.name}\n switchport mode `);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("switchport access vlan ")) {
      const vlan = Number(parts[3]);
      if (!Number.isInteger(vlan)) return { device, output: "% Invalid VLAN" };
      device = withConfigLine(updatePort(device, { ...port, vlan, mode: "access", allowedVlans: [vlan] }), `interface ${port.name}\n switchport access vlan ${vlan}`, `interface ${port.name}\n switchport access vlan `);
      return { device, output: prompt(device) };
    }

    if (lower.startsWith("switchport trunk allowed vlan ")) {
      const allowedVlans = command
        .slice("switchport trunk allowed vlan ".length)
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (!allowedVlans.length) return { device, output: "% Invalid VLAN list" };
      device = withConfigLine(updatePort(device, { ...port, mode: "trunk", allowedVlans }), `interface ${port.name}\n switchport trunk allowed vlan ${allowedVlans.join(",")}`, `interface ${port.name}\n switchport trunk allowed vlan `);
      return { device, output: prompt(device) };
    }
  }

  if (device.config.cliMode === "dhcp") {
    const name = device.config.cliContext.dhcpPoolName;
    const pools = device.config.dhcpPools.map((pool) => ({ ...pool }));
    const pool = pools.find((entry) => entry.name === name);
    if (!pool) return { device: setMode(device, "global", {}), output: "% DHCP context lost" };

    if (lower.startsWith("network ") && parts.length >= 3) {
      pool.network = parts[1];
      pool.mask = parts[2];
    } else if (lower.startsWith("default-router ")) {
      pool.defaultRouter = parts[1];
    } else if (lower.startsWith("dns-server ")) {
      pool.dnsServer = parts[1];
    } else {
      return { device, output: "% Unsupported DHCP command" };
    }

    device = { ...device, config: { ...device.config, dhcpPools: pools, runningConfig: [...device.config.runningConfig, command] } };
    return { device, output: prompt(device) };
  }

  if (device.config.cliMode === "router") {
    if (lower.startsWith("network ")) {
      device = withConfigLine(device, `router ${device.config.cliContext.routerProcess}\n network ${parts[1]}`);
      return { device, output: prompt(device) };
    }
  }

  if (device.config.cliMode === "vlan") {
    if (lower.startsWith("name ")) {
      device = withConfigLine(device, `vlan ${device.config.cliContext.vlanId}\n name ${parts.slice(1).join("-")}`);
      return { device, output: prompt(device) };
    }
  }

  return { device, output: "% Invalid input detected at '^' marker." };
}
