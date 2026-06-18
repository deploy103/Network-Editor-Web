import { defaultConfig } from "../data/deviceCatalog";
import { recalc } from "../engine/topology";
import { createId } from "../utils/id";
import type { CableType, DeviceConfig, DeviceKind, LinkStatus, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, PortKind, PortMode, RuntimeState, SimulationEvent } from "../types/network";

const deviceKinds: DeviceKind[] = ["router", "switch", "firewall", "pc", "server", "wireless", "hub"];
const portKinds: PortKind[] = ["ethernet", "fast-ethernet", "gigabit-ethernet", "serial", "console", "fiber", "wireless"];
const portModes: PortMode[] = ["access", "trunk", "routed"];
const cableTypes: CableType[] = ["auto", "console", "copper-straight", "copper-cross", "fiber", "serial-dce", "serial-dte", "wireless"];
const linkStatuses: LinkStatus[] = ["up", "down", "blocked"];

function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && deviceKinds.includes(value as DeviceKind);
}

function isPortMode(value: unknown): value is PortMode {
  return typeof value === "string" && portModes.includes(value as PortMode);
}

function normalizePortKind(value: unknown): PortKind {
  if (value === "gigabit") return "gigabit-ethernet";
  if (typeof value === "string" && portKinds.includes(value as PortKind)) return value as PortKind;
  return "ethernet";
}

function normalizeCableType(value: unknown): CableType {
  if (typeof value === "string" && cableTypes.includes(value as CableType)) return value as CableType;
  return "copper-straight";
}

function normalizeLinkStatus(value: unknown): LinkStatus {
  if (value === "console") return "up";
  if (typeof value === "string" && linkStatuses.includes(value as LinkStatus)) return value as LinkStatus;
  return "down";
}

export function normalizeProject(project: NetworkProject): NetworkProject {
  const now = new Date().toISOString();
  const legacyProject = project as NetworkProject & {
    ownerUserId?: string;
    simulation?: {
      events?: SimulationEvent[];
      scenarios?: Array<{ pdus?: Array<{ id?: string; sourceDeviceId?: string; destinationDeviceId?: string; protocol?: string; scheduledTime?: number; lastStatus?: string }> }>;
    };
  };
  const hasCurrentSimulationEvents = Array.isArray(project.simulationEvents);
  const storedSimulationEvents = hasCurrentSimulationEvents
    ? project.simulationEvents
    : Array.isArray(legacyProject.simulation?.events)
      ? legacyProject.simulation.events
      : [];
  const legacyPduEvents: SimulationEvent[] = !hasCurrentSimulationEvents && Array.isArray(legacyProject.simulation?.scenarios)
    ? legacyProject.simulation.scenarios.flatMap((scenario) => (scenario.pdus ?? []).map((pdu) => ({
      id: pdu.id || createId("evt"),
      time: Number.isFinite(pdu.scheduledTime) ? pdu.scheduledTime! : Date.now(),
      lastDeviceId: pdu.sourceDeviceId || "",
      atDeviceId: pdu.destinationDeviceId || "",
      sourceDeviceId: pdu.sourceDeviceId || "",
      targetDeviceId: pdu.destinationDeviceId || "",
      packetId: pdu.id || createId("packet"),
      type: pdu.protocol || "ICMP",
      info: `사용자가 만든 ${pdu.protocol || "ICMP"} PDU입니다.`,
      status: pdu.lastStatus === "success" ? "delivered" : pdu.lastStatus === "failed" ? "dropped" : "forwarded",
      osiLayers: ["Layer 7", "Layer 3", "Layer 2"]
    })))
    : [];
  const simulationEvents = [...storedSimulationEvents, ...legacyPduEvents];
  const devices = Array.isArray(project.devices) ? project.devices.map(normalizeDevice) : [];
  const validDeviceIds = new Set(devices.map((device) => device.id));
  const validPortKeys = new Set(devices.flatMap((device) => device.ports.map((port) => `${device.id}:${port.id}`)));
  const seenLinks = new Set<string>();
  const links = (Array.isArray(project.links) ? project.links : [])
    .map(normalizeLink)
    .filter((link) => {
      const valid =
        link.id &&
        !seenLinks.has(link.id) &&
        validDeviceIds.has(link.endpointA.deviceId) &&
        validDeviceIds.has(link.endpointB.deviceId) &&
        validPortKeys.has(`${link.endpointA.deviceId}:${link.endpointA.portId}`) &&
        validPortKeys.has(`${link.endpointB.deviceId}:${link.endpointB.portId}`);
      if (valid) seenLinks.add(link.id);
      return valid;
    });
  const linkByPort = new Map<string, NetworkLink>();
  for (const link of links) {
    linkByPort.set(`${link.endpointA.deviceId}:${link.endpointA.portId}`, link);
    linkByPort.set(`${link.endpointB.deviceId}:${link.endpointB.portId}`, link);
  }
  const projectFields = stripLegacyProjectFields(project);
  return recalc({
    ...projectFields,
    id: project.id || createId("project"),
    ownerId: project.ownerId || legacyProject.ownerUserId || "",
    name: project.name || "제목 없는 네트워크",
    devices: devices.map((device) => ({
      ...device,
      ports: device.ports.map((port) => ({ ...port, linkId: linkByPort.get(`${device.id}:${port.id}`)?.id }))
    })),
    links,
    simulationEvents: simulationEvents.map(normalizeSimulationEvent),
    createdAt: project.createdAt || now,
    updatedAt: project.updatedAt || now
  });
}

function stripLegacyProjectFields(project: NetworkProject): NetworkProject {
  const next = { ...project } as NetworkProject & { ownerUserId?: string; simulation?: unknown; description?: unknown };
  delete next.ownerUserId;
  delete next.simulation;
  delete next.description;
  return next;
}

function normalizeDevice(device: NetworkDevice): NetworkDevice {
  const legacy = device as NetworkDevice & {
    x?: number;
    y?: number;
    type?: DeviceKind;
    catalogId?: string;
    modelName?: string;
    moduleSlots?: Array<{ id: string; installedModule?: string }>;
  };
  const kind: DeviceKind = isDeviceKind(device.kind) ? device.kind : isDeviceKind(legacy.type) ? legacy.type : "pc";
  const hostname = device.config?.hostname || device.label || "장비";
  const modules = Array.isArray(device.modules)
    ? device.modules
    : Array.isArray(legacy.moduleSlots)
      ? legacy.moduleSlots
        .filter((slot) => slot.installedModule && slot.installedModule !== "Blank")
        .map((slot) => ({ slotId: slot.id, moduleId: slot.installedModule! }))
      : [];
  return {
    ...device,
    id: device.id || createId("dev"),
    kind,
    modelId: device.modelId || legacy.catalogId || "pc-pt",
    model: device.model || legacy.modelName || "장비",
    label: device.label || hostname,
    position: {
      x: Number.isFinite(device.position?.x) ? device.position.x : Number.isFinite(legacy.x) ? legacy.x! : 120,
      y: Number.isFinite(device.position?.y) ? device.position.y : Number.isFinite(legacy.y) ? legacy.y! : 120
    },
    powerOn: device.powerOn !== false,
    ports: Array.isArray(device.ports) ? device.ports.map(normalizePort) : [],
    modules,
    config: normalizeConfig(device.config, hostname, kind),
    runtime: normalizeRuntime(device.runtime)
  };
}

function normalizePort(port: NetworkPort): NetworkPort {
  const legacy = port as NetworkPort & {
    interfaceConfig?: { ipAddress?: string; subnetMask?: string; gateway?: string; dns?: string };
    status?: string;
    requiredModule?: string;
  };
  const vlan = Number.isInteger(port.vlan) ? port.vlan : 1;
  const allowedVlans = Array.isArray(port.allowedVlans) && port.allowedVlans.length ? port.allowedVlans : [vlan];
  const mode = isPortMode(port.mode) ? port.mode : legacy.interfaceConfig?.ipAddress ? "routed" : "access";
  return {
    ...port,
    id: port.id || createId("port"),
    name: port.name || "포트",
    kind: normalizePortKind(port.kind),
    description: port.description ?? (legacy.requiredModule ? `Requires ${legacy.requiredModule}` : ""),
    macAddress: port.macAddress || "02:00:00:00:00:00",
    mode,
    vlan,
    allowedVlans,
    ipAddress: port.ipAddress || legacy.interfaceConfig?.ipAddress || "",
    subnetMask: port.subnetMask || legacy.interfaceConfig?.subnetMask || "",
    gateway: port.gateway || legacy.interfaceConfig?.gateway || "",
    dnsServer: port.dnsServer || legacy.interfaceConfig?.dns || "",
    adminUp: port.adminUp !== false && legacy.status !== "administratively-down",
    ipCapable: Boolean(port.ipCapable || mode === "routed" || port.ipAddress || legacy.interfaceConfig?.ipAddress),
    stpPortfast: port.stpPortfast === true,
    bpduGuard: port.bpduGuard === true,
    accessGroupIn: port.accessGroupIn || "",
    accessGroupOut: port.accessGroupOut || "",
    natRole: port.natRole === "inside" || port.natRole === "outside" ? port.natRole : undefined
  };
}

function normalizeConfig(config: DeviceConfig | undefined, hostname: string, kind: DeviceKind): DeviceConfig {
  const base = defaultConfig(hostname, kind);
  const legacy = config as (DeviceConfig & {
    runningConfig?: string[];
    httpEnabled?: boolean;
    firewallRules?: Array<{ id?: string; action?: string; protocol?: string; source?: string; destination?: string; listId?: string }>;
    wireless?: DeviceConfig["wireless"] & { security?: string; wepKey?: string };
  }) | undefined;
  const services = { ...base.services, ...(config?.services ?? {}) };
  if (typeof legacy?.httpEnabled === "boolean") services.http = legacy.httpEnabled;
  return {
    ...base,
    ...config,
    hostname: config?.hostname || hostname,
    startupConfig: Array.isArray(config?.startupConfig) ? config.startupConfig : Array.isArray(legacy?.runningConfig) ? legacy.runningConfig : [],
    domainName: config?.domainName,
    staticRoutes: normalizeStaticRoutes(config?.staticRoutes),
    vlans: Array.isArray(config?.vlans) && config.vlans.length ? config.vlans : base.vlans,
    dhcpPools: normalizeDhcpPools(config?.dhcpPools),
    dnsRecords: normalizeDnsRecords(config?.dnsRecords, base.dnsRecords),
    accessRules: normalizeAccessRules(config?.accessRules ?? legacy?.firewallRules),
    natRules: Array.isArray(config?.natRules) ? config.natRules : [],
    localUsers: normalizeLocalUsers(config?.localUsers),
    lineConfigs: normalizeLineConfigs(config?.lineConfigs),
    routingProtocols: normalizeRoutingProtocols(config?.routingProtocols),
    services,
    wireless: normalizeWireless(base.wireless, legacy?.wireless)
  };
}

function normalizeLocalUsers(users: DeviceConfig["localUsers"] | undefined): NonNullable<DeviceConfig["localUsers"]> {
  if (!Array.isArray(users)) return [];
  return users
    .filter((user) => user.name)
    .map((user) => ({
      id: user.id || createId("user"),
      name: user.name,
      secret: user.secret,
      password: user.password,
      privilege: Number.isInteger(user.privilege) ? user.privilege : undefined
    }));
}

function normalizeStaticRoutes(routes: DeviceConfig["staticRoutes"] | undefined): DeviceConfig["staticRoutes"] {
  if (!Array.isArray(routes)) return [];
  return routes.map((route) => {
    const legacy = route as DeviceConfig["staticRoutes"][number] & { destination?: string };
    return {
      id: route.id || createId("route"),
      network: route.network || legacy.destination || "0.0.0.0",
      mask: route.mask || "0.0.0.0",
      nextHop: route.nextHop || "0.0.0.0"
    };
  });
}

function normalizeDhcpPools(pools: DeviceConfig["dhcpPools"] | undefined): DeviceConfig["dhcpPools"] {
  if (!Array.isArray(pools)) return [];
  return pools.map((pool) => {
    const legacy = pool as DeviceConfig["dhcpPools"][number] & { defaultRouter?: string; nextOffset?: number };
    return {
      id: pool.id || createId("pool"),
      name: pool.name || "POOL",
      network: pool.network || "192.168.1.0",
      mask: pool.mask || "255.255.255.0",
      defaultGateway: pool.defaultGateway || legacy.defaultRouter || "",
      dnsServer: pool.dnsServer || "",
      startIp: pool.startIp || nextPoolStartIp(pool.network || "192.168.1.0", legacy.nextOffset),
      maxLeases: Number.isInteger(pool.maxLeases) ? pool.maxLeases : 64,
      enabled: pool.enabled !== false
    };
  });
}

function normalizeDnsRecords(records: DeviceConfig["dnsRecords"] | undefined, fallback: DeviceConfig["dnsRecords"]): DeviceConfig["dnsRecords"] {
  if (!Array.isArray(records)) return fallback;
  return records.map((record) => {
    const legacy = record as DeviceConfig["dnsRecords"][number] & { host?: string; address?: string };
    return {
      id: record.id || createId("dns"),
      name: record.name || legacy.host || "host.local",
      value: record.value || legacy.address || "0.0.0.0"
    };
  });
}

function normalizeAccessRules(rules: DeviceConfig["accessRules"] | Array<{ id?: string; action?: string; protocol?: string; source?: string; destination?: string; listId?: string }> | undefined): DeviceConfig["accessRules"] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule) => {
    const legacy = rule as DeviceConfig["accessRules"][number] & { listId?: string };
    return {
      id: rule.id || createId("acl"),
      action: rule.action === "deny" ? "deny" : "permit",
      protocol: normalizeAccessProtocol(rule.protocol),
      source: rule.source || "any",
      destination: rule.destination || "any",
      interfaceName: legacy.interfaceName || legacy.listId || "outside",
      listName: legacy.listName || legacy.listId || "",
      listType: legacy.listType || inferAccessListType(legacy.listName || legacy.listId || legacy.interfaceName || "", rule.protocol, rule.destination),
      hits: Number.isInteger(legacy.hits) ? legacy.hits : 0
    };
  });
}

function inferAccessListType(name: string, protocol: unknown, destination: unknown): "standard" | "extended" {
  const id = Number(name);
  if (Number.isInteger(id) && ((id >= 1 && id <= 99) || (id >= 1300 && id <= 1999))) return "standard";
  if (protocol === "ip" && (!destination || destination === "any")) return "standard";
  return "extended";
}

function normalizeAccessProtocol(value: unknown): DeviceConfig["accessRules"][number]["protocol"] {
  return value === "icmp" || value === "tcp" || value === "udp" || value === "http" || value === "dns" || value === "dhcp" ? value : "ip";
}

function normalizeLineConfigs(lines: DeviceConfig["lineConfigs"] | undefined): DeviceConfig["lineConfigs"] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line) => line.kind === "console" || line.kind === "vty")
    .map((line) => ({
      id: line.id || createId("line"),
      kind: line.kind,
      range: line.range || (line.kind === "console" ? "0" : "0 4"),
      password: line.password || "",
      login: line.login === true,
      transportInput: line.transportInput || (line.kind === "vty" ? "all" : ""),
      execTimeout: line.execTimeout || "10 0",
      loggingSynchronous: line.loggingSynchronous === true
    }));
}

function normalizeRoutingProtocols(protocols: DeviceConfig["routingProtocols"] | undefined): DeviceConfig["routingProtocols"] {
  if (!Array.isArray(protocols)) return [];
  return protocols
    .filter((protocol) => protocol.protocol === "rip" || protocol.protocol === "ospf" || protocol.protocol === "eigrp")
    .map((protocol) => ({
      id: protocol.id || createId("routing"),
      protocol: protocol.protocol,
      processId: protocol.protocol === "rip" ? undefined : protocol.processId || "1",
      networks: Array.isArray(protocol.networks) ? protocol.networks.filter(Boolean) : [],
      version: protocol.version || (protocol.protocol === "rip" ? "2" : undefined),
      autoSummary: protocol.autoSummary === true,
      passiveInterfaces: Array.isArray(protocol.passiveInterfaces) ? protocol.passiveInterfaces.filter(Boolean) : [],
      redistributeStatic: protocol.redistributeStatic === true
    }));
}

function normalizeWireless(base: DeviceConfig["wireless"], wireless: (DeviceConfig["wireless"] & { security?: string; wepKey?: string }) | undefined): DeviceConfig["wireless"] {
  const key = wireless?.key || wireless?.wepKey || base.key;
  return {
    ...base,
    ...(wireless ?? {}),
    auth: wireless?.auth === "wpa2-psk" || (wireless?.security && wireless.security !== "open" && key) ? "wpa2-psk" : "open",
    key,
    channel: Number.isInteger(wireless?.channel) ? wireless!.channel : base.channel,
    range: Number.isInteger(wireless?.range) ? wireless!.range : base.range
  };
}

function nextPoolStartIp(network: string, offset = 10): string {
  const parts = network.split(".");
  if (parts.length !== 4) return "192.168.1.10";
  return `${parts[0]}.${parts[1]}.${parts[2]}.${Math.max(2, Math.min(254, offset))}`;
}

function normalizeRuntime(runtime: RuntimeState | undefined): RuntimeState {
  const legacy = runtime as (RuntimeState & {
    arp?: Record<string, string>;
    mac?: Record<string, { portId?: string; vlan?: number }>;
    dhcpLeases?: Record<string, string> | RuntimeState["dhcpLeases"];
  }) | undefined;
  const legacyDhcpLeases: Record<string, string> = legacy?.dhcpLeases && !Array.isArray(legacy.dhcpLeases) ? legacy.dhcpLeases : {};
  return {
    arpTable: Array.isArray(runtime?.arpTable) ? runtime.arpTable : Object.entries(legacy?.arp ?? {}).map(([ipAddress, macAddress]) => ({ ipAddress, macAddress, portName: "" })),
    macTable: Array.isArray(runtime?.macTable) ? runtime.macTable : Object.entries(legacy?.mac ?? {}).map(([macAddress, entry]) => ({ vlan: entry.vlan ?? 1, macAddress, portName: entry.portId ?? "", type: "dynamic" as const })),
    dhcpLeases: Array.isArray(runtime?.dhcpLeases) ? runtime.dhcpLeases : Object.entries(legacyDhcpLeases).map(([deviceId, ipAddress]) => ({ ipAddress, macAddress: "", deviceId, expiresAt: Date.now() + 86_400_000 })),
    logs: Array.isArray(runtime?.logs) ? runtime.logs : []
  };
}

function normalizeLink(link: NetworkLink): NetworkLink {
  const legacy = link as unknown as {
    a?: { deviceId: string; portId: string };
    b?: { deviceId: string; portId: string };
    dceEndpoint?: string;
  };
  const rawDceEndpoint = legacy.dceEndpoint;
  const dceEndpoint = rawDceEndpoint === "a" ? "A" : rawDceEndpoint === "b" ? "B" : rawDceEndpoint;
  return {
    ...link,
    id: link.id || createId("link"),
    type: normalizeCableType(link.type),
    endpointA: link.endpointA ?? legacy.a ?? { deviceId: "", portId: "" },
    endpointB: link.endpointB ?? legacy.b ?? { deviceId: "", portId: "" },
    status: normalizeLinkStatus(link.status),
    dceEndpoint: dceEndpoint === "A" || dceEndpoint === "B" ? dceEndpoint : undefined,
    createdAt: Number.isFinite(link.createdAt) ? link.createdAt : Date.now()
  };
}

function normalizeSimulationEvent(event: SimulationEvent): SimulationEvent {
  const rawStatus = (event as { status?: string }).status;
  const legacySummary = (event as { summary?: string }).summary;
  const legacyLayers = (event as { layers?: Array<{ layer?: number; name?: string }> }).layers;
  const status = rawStatus === "forwarded" || rawStatus === "delivered" || rawStatus === "dropped"
    ? rawStatus
    : rawStatus === "success"
      ? "delivered"
    : rawStatus === "failed"
      ? "dropped"
      : "forwarded";
  const osiLayers = Array.isArray(event.osiLayers) && event.osiLayers.length
    ? event.osiLayers
    : Array.isArray(legacyLayers) && legacyLayers.length
      ? legacyLayers.map((layer) => layer.name ? `Layer ${layer.layer ?? ""} ${layer.name}`.trim() : `Layer ${layer.layer ?? "?"}`)
      : ["Layer 2", "Layer 3"];
  return {
    id: event.id || createId("evt"),
    time: Number.isFinite(event.time) ? event.time : Date.now(),
    lastDeviceId: event.lastDeviceId || event.atDeviceId || "",
    atDeviceId: event.atDeviceId || event.lastDeviceId || "",
    sourceDeviceId: event.sourceDeviceId,
    targetDeviceId: event.targetDeviceId,
    packetId: event.packetId,
    type: event.type || "EVENT",
    info: event.info || legacySummary || "",
    status,
    osiLayers
  };
}
