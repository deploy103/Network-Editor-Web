import { createId } from "../utils/id";
import { isIpv4, maskToPrefix, networkAddress } from "./ip";
import type { DhcpPool, NetworkDevice, NetworkPort, RuntimeState } from "../types/network";

export type CliMode = "exec" | "privileged" | "global" | "interface" | "vlan" | "dhcp";

export interface CliSession {
  mode: CliMode;
  interfaceId?: string;
  vlanId?: number;
  dhcpPoolId?: string;
}

export interface CliResult {
  device: NetworkDevice;
  session: CliSession;
  output: string;
}

export function initialCliSession(): CliSession {
  return { mode: "privileged" };
}

export function cliPrompt(device: NetworkDevice, session: CliSession): string {
  const hostname = device.config.hostname || device.label;
  if (session.mode === "exec") return `${hostname}>`;
  if (session.mode === "global") return `${hostname}(config)#`;
  if (session.mode === "interface") return `${hostname}(config-if)#`;
  if (session.mode === "vlan") return `${hostname}(config-vlan)#`;
  if (session.mode === "dhcp") return `${hostname}(dhcp-config)#`;
  return `${hostname}#`;
}

export function runCliCommand(device: NetworkDevice, session: CliSession, rawCommand: string): CliResult {
  const command = rawCommand.trim();
  if (!command) return result(device, session, "");

  const lower = command.toLowerCase();
  if (lower === "help" || lower === "?") return result(device, session, help(session.mode));
  if (lower.startsWith("help ")) return result(device, session, searchHelp(command.slice(5)));
  if (lower === "enable") return result(device, { mode: "privileged" }, "");
  if (lower === "disable") return result(device, { mode: "exec" }, "");
  if (lower === "end") return result(device, { mode: "privileged" }, "");
  if (lower === "exit") return result(device, exitSession(session), "");
  if (lower === "configure terminal" || lower === "conf t") return result(device, { mode: "global" }, "");
  if (lower === "write memory" || lower === "wr" || lower === "copy running-config startup-config") {
    const startupConfig = runningConfig(device).split("\n");
    return result({ ...device, config: { ...device.config, startupConfig } }, session, "Building configuration...\n[OK]");
  }
  if (lower === "reload") {
    return result({ ...device, powerOn: true, runtime: emptyRuntime() }, { mode: "privileged" }, "Proceed with reload? [confirm]\nSystem Bootstrap, Version PTWEB\nReload complete.");
  }
  if (lower === "erase startup-config" || lower === "write erase") {
    return result({ ...device, config: { ...device.config, startupConfig: [] } }, session, "Erasing the nvram filesystem will remove all configuration files! [confirm]\n[OK]");
  }

  if (lower.startsWith("show ")) return result(device, session, applyPipe(showCommand(device, lower.split("|")[0].trim()), command));
  if (lower.startsWith("clear ")) return clearCommand(device, session, lower);
  if (lower.startsWith("do ")) return runCliCommand(device, { mode: "privileged" }, command.slice(3));

  if (session.mode === "global") return globalCommand(device, session, command, lower);
  if (session.mode === "interface") return interfaceCommand(device, session, command, lower);
  if (session.mode === "vlan") return vlanCommand(device, session, command, lower);
  if (session.mode === "dhcp") return dhcpCommand(device, session, command, lower);

  return result(device, session, "% Unsupported command. Type help or ?.");
}

function globalCommand(device: NetworkDevice, session: CliSession, command: string, lower: string): CliResult {
  if (lower.startsWith("hostname ")) {
    const hostname = command.split(/\s+/)[1]?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32);
    if (!hostname) return result(device, session, "% Invalid hostname.");
    return result({ ...device, label: hostname, config: { ...device.config, hostname } }, session, "");
  }

  if (lower.startsWith("interface ")) {
    const name = command.slice(command.indexOf(" ") + 1);
    const port = findPort(device, name);
    if (!port) return result(device, session, `% Interface ${name} not found.`);
    return result(device, { mode: "interface", interfaceId: port.id }, "");
  }

  if (lower.startsWith("vlan ")) {
    const id = numberAfter(command, "vlan");
    if (!validVlan(id)) return result(device, session, "% VLAN id must be 1-4094.");
    const exists = device.config.vlans.some((vlan) => vlan.id === id);
    const next = exists ? device : { ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: `VLAN${id}` }].sort((a, b) => a.id - b.id) } };
    return result(next, { mode: "vlan", vlanId: id }, "");
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

  if (lower.startsWith("ip route ")) {
    const [, , network, mask, nextHop] = command.split(/\s+/);
    if (!network || !mask || !nextHop) return result(device, session, "% Usage: ip route <network> <mask> <next-hop>");
    return result({ ...device, config: { ...device.config, staticRoutes: [...device.config.staticRoutes, { id: createId("route"), network, mask, nextHop }] } }, session, "");
  }

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
    const [, interfaceName, action, protocol, source, destination] = command.split(/\s+/);
    if (!interfaceName || !isAction(action) || !isProtocol(protocol) || !source || !destination) {
      return result(device, session, "% Usage: access-list <interface> permit|deny <protocol> <source> <destination>");
    }
    return result({
      ...device,
      config: {
        ...device.config,
        accessRules: [...device.config.accessRules, { id: createId("acl"), interfaceName, action, protocol, source, destination, hits: 0 }]
      }
    }, session, "");
  }

  if (lower.startsWith("no access-list ")) {
    const interfaceName = command.slice("no access-list ".length).trim();
    return result({ ...device, config: { ...device.config, accessRules: device.config.accessRules.filter((rule) => rule.interfaceName !== interfaceName) } }, session, "");
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
    if (!port.ipCapable && port.mode !== "routed") return result(device, session, "% IP address is not supported on this layer-2 interface.");
    return result(updatePort(device, port.id, { ipAddress, subnetMask, mode: "routed" }), session, "");
  }
  if (lower === "no ip address") return result(updatePort(device, port.id, { ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
  if (lower === "shutdown") return result(updatePort(device, port.id, { adminUp: false }), session, "");
  if (lower === "no shutdown") return result(updatePort(device, port.id, { adminUp: true }), session, "");
  if (lower === "switchport mode access") return result(updatePort(device, port.id, { mode: "access", ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
  if (lower === "switchport mode trunk") return result(updatePort(device, port.id, { mode: "trunk", allowedVlans: port.allowedVlans.length ? port.allowedVlans : [1], ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" }), session, "");
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
  if (!pool) return result(device, { mode: "global" }, "% DHCP pool context is missing.");
  if (lower.startsWith("network ")) {
    const [, network, mask] = command.split(/\s+/);
    return result(updatePool(device, pool.id, { network: network ?? "", mask: mask ?? "" }), session, "");
  }
  if (lower.startsWith("default-router ")) return result(updatePool(device, pool.id, { defaultGateway: command.split(/\s+/)[1] ?? "" }), session, "");
  if (lower.startsWith("dns-server ")) return result(updatePool(device, pool.id, { dnsServer: command.split(/\s+/)[1] ?? "" }), session, "");
  if (lower.startsWith("start-ip ")) return result(updatePool(device, pool.id, { startIp: command.split(/\s+/)[1] ?? "" }), session, "");
  if (lower.startsWith("max-leases ")) return result(updatePool(device, pool.id, { maxLeases: Math.max(1, numberAfter(command, "max-leases")) }), session, "");
  if (lower === "shutdown") return result(updatePool(device, pool.id, { enabled: false }), session, "");
  if (lower === "no shutdown") return result(updatePool(device, pool.id, { enabled: true }), session, "");
  return result(device, session, "% Unsupported DHCP pool command.");
}

function showCommand(device: NetworkDevice, lower: string): string {
  if (lower.startsWith("show running-config interface ")) {
    const name = lower.slice("show running-config interface ".length);
    const port = findPort(device, name);
    return port ? interfaceConfig(port).join("\n") : `% Interface ${name} not found.`;
  }
  if (lower === "show run" || lower === "show running-config") return runningConfig(device);
  if (lower === "show version") return [`${device.model} Software, Network Editor Web`, `Device uptime is simulated`, `System image file is "ptweb:${device.modelId}"`, `${device.ports.length} interfaces`, `${device.powerOn ? "System returned to ROM by power-on" : "System is powered off"}`].join("\n");
  if (lower === "show startup-config") return device.config.startupConfig.join("\n") || "% Startup config is not saved.";
  if (lower === "show ip interface brief") {
    return ["Interface              IP-Address      OK? Method Status", ...device.ports.map((port) => `${port.name.padEnd(22)}${(port.ipAddress || "unassigned").padEnd(16)}YES manual ${port.adminUp && device.powerOn ? "up" : "down"}`)].join("\n");
  }
  if (lower === "show interfaces") return device.ports.map((port) => interfaceStatus(device, port)).join("\n\n");
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
  if (lower === "show ip protocols") return device.config.staticRoutes.length ? [`Routing Protocol is "static"`, `  Static routes configured: ${device.config.staticRoutes.length}`, ...device.config.staticRoutes.map((route) => `  ${route.network} ${route.mask} via ${route.nextHop}`)].join("\n") : "No routing protocols configured.";
  if (lower === "show ip dhcp binding") return device.runtime.dhcpLeases.map((lease) => `${lease.ipAddress.padEnd(16)}${lease.macAddress.padEnd(20)}${lease.deviceId}`).join("\n") || "No DHCP bindings.";
  if (lower === "show ip dhcp pool") return device.config.dhcpPools.map((pool) => [`Pool ${pool.name}`, `  Network ${pool.network} ${pool.mask}`, `  Default router ${pool.defaultGateway}`, `  DNS server ${pool.dnsServer}`, `  Range starts ${pool.startIp}, max leases ${pool.maxLeases}`, `  State ${pool.enabled ? "enabled" : "disabled"}`].join("\n")).join("\n\n") || "No DHCP pools.";
  if (lower === "show hosts") return device.config.dnsRecords.map((record) => `${record.name.padEnd(32)}${record.value}`).join("\n") || "No host records.";
  if (lower === "show access-list" || lower === "show access-lists") return device.config.accessRules.map((rule) => `${rule.action} ${rule.protocol} ${rule.source} ${rule.destination} interface ${rule.interfaceName} (${rule.hits} hits)`).join("\n") || "No access rules.";
  if (lower === "show nat") return device.config.natRules.map((rule) => `${rule.insideLocal} -> ${rule.insideGlobal} outside ${rule.outsideInterface} (${rule.hits} hits)`).join("\n") || "No NAT rules.";
  return "% Unsupported show command.";
}

function clearCommand(device: NetworkDevice, session: CliSession, lower: string): CliResult {
  if (lower === "clear arp-cache" || lower === "clear arp") return result({ ...device, runtime: { ...device.runtime, arpTable: [] } }, session, "");
  if (lower === "clear mac address-table") return result({ ...device, runtime: { ...device.runtime, macTable: [] } }, session, "");
  if (lower === "clear ip dhcp binding") return result({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } }, session, "");
  return result(device, session, "% Unsupported clear command.");
}

function runningConfig(device: NetworkDevice): string {
  return [
    `hostname ${device.config.hostname}`,
    ...device.config.vlans.map((vlan) => [`vlan ${vlan.id}`, ` name ${vlan.name}`]).flat(),
    ...device.ports.flatMap((port) => interfaceConfig(port)),
    ...device.config.staticRoutes.map((route) => `ip route ${route.network} ${route.mask} ${route.nextHop}`),
    ...device.config.dnsRecords.map((record) => `ip host ${record.name} ${record.value}`),
    ...device.config.accessRules.map((rule) => `access-list ${rule.interfaceName} ${rule.action} ${rule.protocol} ${rule.source} ${rule.destination}`),
    ...device.config.natRules.map((rule) => `nat ${rule.insideLocal} ${rule.insideGlobal} ${rule.outsideInterface}`),
    ...Object.entries(device.config.services).map(([name, enabled]) => `${enabled ? "" : "no "}service ${name}`),
    ...device.config.dhcpPools.flatMap((pool) => [
      `ip dhcp pool ${pool.name}`,
      ` network ${pool.network} ${pool.mask}`,
      ` default-router ${pool.defaultGateway}`,
      ` dns-server ${pool.dnsServer}`,
      ` start-ip ${pool.startIp}`,
      ` max-leases ${pool.maxLeases}`,
      pool.enabled ? " no shutdown" : " shutdown"
    ])
  ].join("\n");
}

function interfaceConfig(port: NetworkPort): string[] {
  const lines = [`interface ${port.name}`];
  if (port.description) lines.push(` description ${port.description}`);
  if (port.mode === "routed" && port.ipAddress) lines.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
  if (port.mode === "access") lines.push(" switchport mode access", ` switchport access vlan ${port.vlan}`);
  if (port.mode === "trunk") lines.push(" switchport mode trunk", ` switchport trunk allowed vlan ${port.allowedVlans.join(",")}`);
  if (port.kind === "serial" && port.clockRate) lines.push(` clock rate ${port.clockRate}`);
  lines.push(port.adminUp ? " no shutdown" : " shutdown");
  return lines;
}

function interfaceStatus(device: NetworkDevice, port: NetworkPort): string {
  return [
    `${port.name} is ${device.powerOn && port.adminUp ? "up" : "down"}, line protocol is ${port.linkId ? "up" : "down"}`,
    ...(port.description ? [`  Description: ${port.description}`] : []),
    `  Hardware is ${port.kind}, address is ${port.macAddress}`,
    `  Internet address is ${port.ipAddress ? `${port.ipAddress} ${port.subnetMask}` : "unassigned"}`,
    `  Mode ${port.mode}${port.mode === "access" ? `, access VLAN ${port.vlan}` : ""}${port.mode === "trunk" ? `, allowed VLANs ${port.allowedVlans.join(",")}` : ""}`,
    ...(port.kind === "serial" ? [`  Clock rate ${port.clockRate ?? "not set"}`] : []),
    `  ${port.linkId ? "Connected" : "Not connected"}`
  ].join("\n");
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

function routeTable(device: NetworkDevice): string {
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
  const gatewayLine = defaultRoute ? `Gateway of last resort is ${defaultRoute.nextHop} to network 0.0.0.0` : "Gateway of last resort is not set";
  const body = [...connected, ...staticRoutes].filter((line, index, list) => list.indexOf(line) === index);
  return [
    "Codes: C - connected, S - static, L - local",
    gatewayLine,
    "",
    ...(body.length ? body : ["No routes installed."])
  ].join("\n");
}

function help(mode: CliMode): string {
  if (mode === "global") return "hostname <name>, interface <name>, vlan <id>, ip route <network> <mask> <next-hop>, ip dhcp pool <name>, ip host <name> <address>, access-list <interface> permit|deny <protocol> <source> <destination>, nat <local> <global> <outside>, service <name>, show ..., end";
  if (mode === "interface") return "description <text>, ip address <ip> <mask>, switchport mode access|trunk, switchport access vlan <id>, switchport trunk allowed vlan <list>, clock rate <value>, shutdown, no shutdown, exit";
  if (mode === "vlan") return "name <vlan-name>, exit, end";
  if (mode === "dhcp") return "network <network> <mask>, default-router <ip>, dns-server <ip>, start-ip <ip>, max-leases <n>, shutdown, no shutdown, exit";
  return "enable, configure terminal, show run, show version, show interfaces, show interfaces switchport, show interfaces trunk, show ip interface brief, show interfaces status, show vlan brief, show ip route, show ip dhcp pool, show hosts, show access-list, show nat, show cdp neighbors, show arp, show ip dhcp binding, clear ..., write memory, reload, write erase";
}

function searchHelp(term: string): string {
  const query = term.trim().toLowerCase();
  const commands = [
    "show running-config | include <text>",
    "show running-config | begin <text>",
    "show running-config | exclude <text>",
    "show running-config interface <name>",
    "show version",
    "show ip interface brief",
    "show interfaces",
    "show interfaces switchport",
    "show interfaces trunk",
    "show interface <name>",
    "show interfaces status",
    "show vlan brief",
    "show ip route",
    "show ip protocols",
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
    "ip address <ip> <mask>",
    "description <text>",
    "switchport mode access",
    "switchport mode trunk",
    "ip route <network> <mask> <next-hop>",
    "ip dhcp pool <name>",
    "ip host <name> <address>"
  ];
  return commands.filter((command) => command.toLowerCase().includes(query)).join("\n") || "No matching commands.";
}

function applyPipe(output: string, rawCommand: string): string {
  const match = rawCommand.match(/\|\s*(include|exclude|begin)\s+(.+)$/i);
  if (!match) return output;
  const mode = match[1].toLowerCase();
  const term = match[2].trim().toLowerCase();
  const lines = output.split("\n");
  if (mode === "include") return lines.filter((line) => line.toLowerCase().includes(term)).join("\n") || "% No matching lines.";
  if (mode === "exclude") return lines.filter((line) => !line.toLowerCase().includes(term)).join("\n") || "% No lines remain.";
  const index = lines.findIndex((line) => line.toLowerCase().includes(term));
  return index >= 0 ? lines.slice(index).join("\n") : "% No matching start line.";
}

function updatePort(device: NetworkDevice, portId: string, patch: Partial<NetworkPort>): NetworkDevice {
  return { ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) };
}

function updatePool(device: NetworkDevice, poolId: string, patch: Partial<DhcpPool>): NetworkDevice {
  return { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((pool) => pool.id === poolId ? { ...pool, ...patch } : pool) } };
}

function ensureVlan(device: NetworkDevice, id: number): NetworkDevice {
  if (device.config.vlans.some((vlan) => vlan.id === id)) return device;
  return { ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: `VLAN${id}` }].sort((a, b) => a.id - b.id) } };
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
  if (session.mode === "interface" || session.mode === "vlan" || session.mode === "dhcp") return { mode: "global" };
  return { mode: "exec" };
}

function result(device: NetworkDevice, session: CliSession, output: string): CliResult {
  return { device, session, output };
}
