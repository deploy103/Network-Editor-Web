import { defaultConfig, getDeviceModel, getModuleSpec } from "../data/deviceCatalog";
import { isIpv4, isSubnetMask, maskToPrefix } from "../engine/ip";
import { recalc } from "../engine/topology";
import { createId } from "../utils/id";
import type { ActivityAnswerSnapshot, ActivityCommandOutputAssertion, ActivityCommandRule, ActivityCommandSequence, ActivityHeaderAssertion, ActivityInterfaceExpectation, ActivityRequirementKind, CableType, DeviceConfig, DeviceKind, LinkStatus, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, PortKind, PortMode, RuntimeState, SimulationEvent } from "../types/network";

const deviceKinds: DeviceKind[] = ["router", "switch", "firewall", "pc", "server", "wireless", "hub"];
const portKinds: PortKind[] = ["ethernet", "fast-ethernet", "gigabit-ethernet", "serial", "console", "fiber", "wireless"];
const portModes: PortMode[] = ["access", "trunk", "routed"];
const cableTypes: CableType[] = ["auto", "console", "copper-straight", "copper-cross", "fiber", "serial-dce", "serial-dte", "wireless"];
const linkStatuses: LinkStatus[] = ["up", "down", "blocked"];
const activityRequirementKinds: ActivityRequirementKind[] = [
  "device-count",
  "link-count",
  "annotation-count",
  "delivered-pdu-count",
  "saved-config-count",
  "service-count",
  "tdr-normal-count",
  "vlan-count",
  "trunk-port-count",
  "routed-port-count",
  "svi-count",
  "static-route-count",
  "dynamic-routing-count",
  "acl-rule-count",
  "nat-rule-count",
  "prefix-list-count",
  "pbr-route-map-count",
  "dhcp-pool-count",
  "dhcp-snooping-device-count",
  "port-security-port-count",
  "etherchannel-port-count",
  "first-hop-redundancy-count",
  "wireless-infrastructure-count",
  "wireless-client-count",
  "ip-sla-track-count"
];
const defaultLogging: NonNullable<DeviceConfig["logging"]> = { console: true, buffered: true, hosts: [], trap: "informational" };

function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && deviceKinds.includes(value as DeviceKind);
}

function isPortMode(value: unknown): value is PortMode {
  return typeof value === "string" && portModes.includes(value as PortMode);
}

function validVlan(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4094;
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
    notes: normalizeWorkspaceNotes(project.notes),
    drawings: normalizeWorkspaceDrawings(project.drawings),
    activity: normalizeActivity(project.activity),
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
  const modelId = device.modelId || legacy.catalogId || "pc-pt";
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
    modelId,
    model: device.model || legacy.modelName || "장비",
    label: device.label || hostname,
    position: {
      x: Number.isFinite(device.position?.x) ? device.position.x : Number.isFinite(legacy.x) ? legacy.x! : 120,
      y: Number.isFinite(device.position?.y) ? device.position.y : Number.isFinite(legacy.y) ? legacy.y! : 120
    },
    powerOn: device.powerOn !== false,
    ports: Array.isArray(device.ports) ? device.ports.map(normalizePort) : [],
    modules: normalizeDeviceModules(modules, modelId),
    config: normalizeConfig(device.config, hostname, kind),
    runtime: normalizeRuntime(device.runtime)
  };
}

function normalizeDeviceModules(modules: NetworkDevice["modules"], modelId: string): NetworkDevice["modules"] {
  let modelSlots: string[] = [];
  try {
    modelSlots = getDeviceModel(modelId).modules.map((slot) => slot.id);
  } catch {
    modelSlots = [];
  }
  return modules.map((module) => {
    const spec = getModuleSpec(module.moduleId);
    if (!spec || module.occupiedSlotIds?.length) return module;
    const startIndex = modelSlots.indexOf(module.slotId);
    if (startIndex < 0) return module;
    const occupiedSlotIds = modelSlots.slice(startIndex, startIndex + (spec.widthSlots ?? 1));
    return { ...module, occupiedSlotIds };
  });
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
    nativeVlan: Number.isInteger(port.nativeVlan) ? port.nativeVlan : 1,
    ipAddress: port.ipAddress || legacy.interfaceConfig?.ipAddress || "",
    subnetMask: port.subnetMask || legacy.interfaceConfig?.subnetMask || "",
    secondaryIpAddresses: normalizeSecondaryIpAddresses(port.secondaryIpAddresses),
    parentPortId: typeof port.parentPortId === "string" && port.parentPortId ? port.parentPortId : undefined,
    subinterfaceVlan: validVlan(port.subinterfaceVlan) ? port.subinterfaceVlan : undefined,
    encapsulationDot1qNative: port.encapsulationDot1qNative === true,
    gateway: port.gateway || legacy.interfaceConfig?.gateway || "",
    dnsServer: port.dnsServer || legacy.interfaceConfig?.dns || "",
    adminUp: port.adminUp !== false && legacy.status !== "administratively-down",
    ipCapable: Boolean(port.ipCapable || mode === "routed" || port.ipAddress || legacy.interfaceConfig?.ipAddress),
    stpPortfast: port.stpPortfast === true,
    bpduGuard: port.bpduGuard === true,
    stpCost: Number.isInteger(port.stpCost) && port.stpCost! >= 1 ? Math.min(200000000, port.stpCost!) : undefined,
    stpPriority: Number.isInteger(port.stpPriority) && port.stpPriority! >= 0 ? Math.min(240, Math.floor(port.stpPriority! / 16) * 16) : undefined,
    cdpEnabled: port.cdpEnabled !== false,
    lldpTransmit: port.lldpTransmit === true,
    lldpReceive: port.lldpReceive === true,
    dhcpSnoopingTrusted: port.dhcpSnoopingTrusted === true,
    dhcpSnoopingRateLimit: Number.isInteger(port.dhcpSnoopingRateLimit) && port.dhcpSnoopingRateLimit! > 0 ? Math.min(2048, port.dhcpSnoopingRateLimit!) : undefined,
    voiceVlan: validVlan(port.voiceVlan) ? port.voiceVlan : undefined,
    portSecurity: normalizePortSecurity(port.portSecurity),
    channelGroup: normalizeChannelGroup(port.channelGroup),
    accessGroupIn: port.accessGroupIn || "",
    accessGroupOut: port.accessGroupOut || "",
    policyRouteMap: typeof port.policyRouteMap === "string" ? port.policyRouteMap : "",
    helperAddresses: Array.isArray(port.helperAddresses) ? port.helperAddresses.filter(Boolean) : [],
    switchportNonegotiate: port.switchportNonegotiate === true,
    natRole: port.natRole === "inside" || port.natRole === "outside" ? port.natRole : undefined,
    hsrpGroups: normalizeHsrpGroups(port.hsrpGroups),
    vrrpGroups: normalizeVrrpGroups(port.vrrpGroups)
  };
}

function normalizeHsrpGroups(groups: NetworkPort["hsrpGroups"]): NonNullable<NetworkPort["hsrpGroups"]> {
  if (!Array.isArray(groups)) return [];
  const byGroup = new Map<number, NonNullable<NetworkPort["hsrpGroups"]>[number]>();
  for (const group of groups) {
    const groupNumber = Number(group?.group);
    if (!Number.isInteger(groupNumber) || groupNumber < 0 || groupNumber > 4095) continue;
    const priority = Number(group.priority);
    const trackDecrement = Number(group.trackDecrement);
    byGroup.set(groupNumber, {
      group: groupNumber,
      virtualIp: typeof group.virtualIp === "string" && isIpv4(group.virtualIp) ? group.virtualIp : "",
      priority: Number.isInteger(priority) ? Math.max(0, Math.min(255, priority)) : 100,
      preempt: group.preempt === true,
      version: group.version === "2" ? "2" : "1",
      trackInterface: typeof group.trackInterface === "string" && group.trackInterface.trim() ? group.trackInterface.trim() : undefined,
      trackObject: Number.isInteger(group.trackObject) && group.trackObject! >= 1 && group.trackObject! <= 1000 ? group.trackObject : undefined,
      trackDecrement: Number.isInteger(trackDecrement) ? Math.max(1, Math.min(255, trackDecrement)) : undefined
    });
  }
  return [...byGroup.values()].sort((left, right) => left.group - right.group);
}

function normalizeVrrpGroups(groups: NetworkPort["vrrpGroups"]): NonNullable<NetworkPort["vrrpGroups"]> {
  if (!Array.isArray(groups)) return [];
  const byGroup = new Map<number, NonNullable<NetworkPort["vrrpGroups"]>[number]>();
  for (const group of groups) {
    const groupNumber = Number(group?.group);
    if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 255) continue;
    const priority = Number(group.priority);
    const advertiseInterval = Number(group.advertiseInterval);
    const trackObject = Number(group.trackObject);
    const trackDecrement = Number(group.trackDecrement);
    byGroup.set(groupNumber, {
      group: groupNumber,
      virtualIp: typeof group.virtualIp === "string" && isIpv4(group.virtualIp) ? group.virtualIp : "",
      priority: Number.isInteger(priority) ? Math.max(1, Math.min(254, priority)) : 100,
      preempt: group.preempt !== false,
      version: group.version === "3" ? "3" : "2",
      advertiseInterval: Number.isInteger(advertiseInterval) ? Math.max(1, Math.min(255, advertiseInterval)) : 1,
      trackObject: Number.isInteger(trackObject) && trackObject >= 1 && trackObject <= 1000 ? trackObject : undefined,
      trackDecrement: Number.isInteger(trackDecrement) ? Math.max(1, Math.min(255, trackDecrement)) : undefined
    });
  }
  return [...byGroup.values()].sort((left, right) => left.group - right.group);
}

function normalizeSecondaryIpAddresses(addresses: NetworkPort["secondaryIpAddresses"]): NonNullable<NetworkPort["secondaryIpAddresses"]> {
  if (!Array.isArray(addresses)) return [];
  const seen = new Set<string>();
  const normalized: NonNullable<NetworkPort["secondaryIpAddresses"]> = [];
  for (const address of addresses) {
    const ipAddress = address?.ipAddress ?? "";
    const subnetMask = address?.subnetMask ?? "";
    if (!isIpv4(ipAddress) || !isSubnetMask(subnetMask) || maskToPrefix(subnetMask) === 0) continue;
    const key = `${ipAddress}/${subnetMask}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ ipAddress, subnetMask });
  }
  return normalized;
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
    sshVersion: config?.sshVersion === "1" ? "1" : "2",
    rsaKeyGenerated: config?.rsaKeyGenerated === true,
    passwordEncryption: config?.passwordEncryption === true,
    logging: normalizeLogging(base.logging ?? defaultLogging, config?.logging),
    staticRoutes: normalizeStaticRoutes(config?.staticRoutes),
    vlans: Array.isArray(config?.vlans) && config.vlans.length ? config.vlans : base.vlans,
    dhcpPools: normalizeDhcpPools(config?.dhcpPools),
    dhcpExcludedRanges: normalizeDhcpExcludedRanges(config?.dhcpExcludedRanges),
    dnsRecords: normalizeDnsRecords(config?.dnsRecords, base.dnsRecords),
    nameServers: normalizeNameServers(config?.nameServers),
    accessRules: normalizeAccessRules(config?.accessRules ?? legacy?.firewallRules),
    natRules: normalizeNatRules(config?.natRules),
    prefixLists: normalizePrefixLists(config?.prefixLists),
    routeMaps: normalizeRouteMaps(config?.routeMaps),
    ipSlaOperations: normalizeIpSlaOperations(config?.ipSlaOperations),
    trackObjects: normalizeTrackObjects(config?.trackObjects),
    stpRootPrimaryVlans: normalizeVlanList(config?.stpRootPrimaryVlans),
    stpRootSecondaryVlans: normalizeVlanList(config?.stpRootSecondaryVlans),
    stpMode: config?.stpMode === "rapid-pvst" ? "rapid-pvst" : "pvst",
    errdisableRecovery: normalizeErrdisableRecovery(config?.errdisableRecovery),
    cdp: normalizeCdpConfig(config?.cdp),
    lldp: normalizeLldpConfig(config?.lldp),
    dhcpSnooping: normalizeDhcpSnooping(config?.dhcpSnooping),
    vtp: normalizeVtpConfig(config?.vtp),
    localUsers: normalizeLocalUsers(config?.localUsers),
    lineConfigs: normalizeLineConfigs(config?.lineConfigs),
    routingProtocols: normalizeRoutingProtocols(config?.routingProtocols),
    services,
    wireless: normalizeWireless(base.wireless, legacy?.wireless)
  };
}

function normalizePortSecurity(value: NetworkPort["portSecurity"] | undefined): NonNullable<NetworkPort["portSecurity"]> {
  const violation = value?.violation === "protect" || value?.violation === "restrict" || value?.violation === "shutdown"
    ? value.violation
    : "shutdown";
  const maximum = Number.isInteger(value?.maximum) ? Math.min(132, Math.max(1, value!.maximum)) : 1;
  return {
    enabled: value?.enabled === true,
    maximum,
    violation,
    sticky: value?.sticky === true,
    secureMacAddresses: Array.isArray(value?.secureMacAddresses) ? value.secureMacAddresses.filter(Boolean) : []
  };
}

function normalizeCdpConfig(value: DeviceConfig["cdp"] | undefined): NonNullable<DeviceConfig["cdp"]> {
  const timer = Number.isInteger(value?.timer) ? Math.min(254, Math.max(5, value!.timer)) : 60;
  const holdtime = Number.isInteger(value?.holdtime) ? Math.min(255, Math.max(10, value!.holdtime)) : 180;
  return {
    enabled: value?.enabled !== false,
    timer,
    holdtime,
    version: value?.version === "1" ? "1" : "2"
  };
}

function normalizeLldpConfig(value: DeviceConfig["lldp"] | undefined): NonNullable<DeviceConfig["lldp"]> {
  const timer = Number.isInteger(value?.timer) ? Math.min(65534, Math.max(5, value!.timer)) : 30;
  const holdtime = Number.isInteger(value?.holdtime) ? Math.min(65535, Math.max(10, value!.holdtime)) : 120;
  const reinitDelay = Number.isInteger(value?.reinitDelay) ? Math.min(10, Math.max(1, value!.reinitDelay)) : 2;
  return {
    enabled: value?.enabled === true,
    timer,
    holdtime,
    reinitDelay
  };
}

function normalizeDhcpSnooping(value: DeviceConfig["dhcpSnooping"] | undefined): NonNullable<DeviceConfig["dhcpSnooping"]> {
  return {
    enabled: value?.enabled === true,
    vlans: normalizeVlanList(value?.vlans),
    verifyMacAddress: value?.verifyMacAddress !== false
  };
}

function normalizeVtpConfig(value: DeviceConfig["vtp"] | undefined): NonNullable<DeviceConfig["vtp"]> {
  const mode = value?.mode === "client" || value?.mode === "transparent" || value?.mode === "off" ? value.mode : "server";
  const version = value?.version === "1" || value?.version === "3" ? value.version : "2";
  const revision = Number.isInteger(value?.revision) ? Math.max(0, Math.min(999999, value!.revision)) : 0;
  return {
    mode,
    domain: typeof value?.domain === "string" ? value.domain.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32) : "",
    version,
    password: value?.password ? String(value.password).slice(0, 64) : undefined,
    pruning: value?.pruning === true,
    revision
  };
}

function normalizeErrdisableRecovery(value: DeviceConfig["errdisableRecovery"] | undefined): NonNullable<DeviceConfig["errdisableRecovery"]> {
  const interval = Number.isInteger(value?.interval) ? Math.min(86400, Math.max(30, value!.interval)) : 300;
  return {
    bpduguard: value?.bpduguard === true,
    interval
  };
}

function normalizeChannelGroup(value: NetworkPort["channelGroup"] | undefined): NetworkPort["channelGroup"] | undefined {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || value.id > 48) return undefined;
  const mode = value.mode === "on" || value.mode === "active" || value.mode === "passive" || value.mode === "desirable" || value.mode === "auto"
    ? value.mode
    : "on";
  return { id: value.id, mode };
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
      nextHop: route.nextHop || "0.0.0.0",
      distance: Number.isInteger(route.distance) && route.distance! >= 1 && route.distance! <= 255 ? route.distance : undefined,
      trackId: Number.isInteger(route.trackId) && route.trackId! >= 1 && route.trackId! <= 1000 ? route.trackId : undefined
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

function normalizeLogging(base: NonNullable<DeviceConfig["logging"]>, logging: DeviceConfig["logging"] | undefined): NonNullable<DeviceConfig["logging"]> {
  return {
    console: logging?.console !== false,
    buffered: logging?.buffered !== false,
    hosts: Array.isArray(logging?.hosts) ? logging.hosts.filter(Boolean) : base.hosts,
    trap: logging?.trap || base.trap
  };
}

function normalizeDhcpExcludedRanges(ranges: DeviceConfig["dhcpExcludedRanges"] | undefined): NonNullable<DeviceConfig["dhcpExcludedRanges"]> {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .filter((range) => range.startIp)
    .map((range) => ({
      id: range.id || createId("dhcp_exclude"),
      startIp: range.startIp,
      endIp: range.endIp || undefined
    }));
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

function normalizeNameServers(servers: DeviceConfig["nameServers"] | undefined): DeviceConfig["nameServers"] {
  if (!Array.isArray(servers)) return [];
  return servers.filter(isIpv4).filter((server, index, list) => list.indexOf(server) === index);
}

function normalizeVlanList(vlans: number[] | undefined): number[] {
  if (!Array.isArray(vlans)) return [];
  return vlans.filter((vlan) => Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094).filter((vlan, index, list) => list.indexOf(vlan) === index);
}

function normalizeAccessRules(rules: DeviceConfig["accessRules"] | Array<{ id?: string; action?: string; protocol?: string; source?: string; destination?: string; listId?: string }> | undefined): DeviceConfig["accessRules"] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule): DeviceConfig["accessRules"][number] => {
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
      sequence: Number.isInteger(legacy.sequence) && legacy.sequence! > 0 ? Math.min(2147483647, legacy.sequence!) : undefined,
      remark: typeof legacy.remark === "string" && legacy.remark.trim() ? legacy.remark.trim().slice(0, 100) : undefined,
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
  return value === "icmp" || value === "tcp" || value === "udp" || value === "http" || value === "ftp" || value === "dns" || value === "dhcp" ? value : "ip";
}

function normalizeNatRules(rules: DeviceConfig["natRules"] | undefined): DeviceConfig["natRules"] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule): DeviceConfig["natRules"][number] => ({
    id: rule.id || createId("nat"),
    insideLocal: rule.insideLocal || (rule.aclName ? `list ${rule.aclName}` : ""),
    insideGlobal: rule.insideGlobal || (rule.interfaceName ? `interface ${rule.interfaceName}` : ""),
    outsideInterface: rule.outsideInterface || rule.interfaceName || "outside",
    type: rule.type === "overload" || rule.overload ? "overload" : "static",
    aclName: rule.aclName,
    interfaceName: rule.interfaceName,
    overload: rule.overload === true || rule.type === "overload",
    hits: Number.isInteger(rule.hits) ? rule.hits : 0
  })).filter((rule) => rule.type === "overload" ? Boolean(rule.aclName && rule.interfaceName) : Boolean(rule.insideLocal && rule.insideGlobal));
}

function normalizeRouteMaps(routeMaps: DeviceConfig["routeMaps"] | undefined): NonNullable<DeviceConfig["routeMaps"]> {
  if (!Array.isArray(routeMaps)) return [];
  const seen = new Set<string>();
  const normalized: NonNullable<DeviceConfig["routeMaps"]> = [];
  for (const entry of routeMaps) {
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 64) : "";
    const sequence = Number.isInteger(entry.sequence) && entry.sequence > 0 ? Math.min(65535, entry.sequence) : 10;
    if (!name) continue;
    const key = `${name.toLowerCase()}:${sequence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: entry.id || createId("rmap"),
      name,
      sequence,
      action: entry.action === "deny" ? "deny" : "permit",
      description: typeof entry.description === "string" && entry.description.trim() ? entry.description.trim().slice(0, 100) : undefined,
      matchAccessLists: Array.isArray(entry.matchAccessLists) ? entry.matchAccessLists.map((item) => String(item).trim()).filter(Boolean) : [],
      matchPrefixLists: Array.isArray(entry.matchPrefixLists) ? entry.matchPrefixLists.map((item) => String(item).trim()).filter(Boolean) : [],
      setNextHop: typeof entry.setNextHop === "string" && isIpv4(entry.setNextHop) ? entry.setNextHop : undefined,
      hits: Number.isInteger(entry.hits) ? Math.max(0, entry.hits) : 0
    });
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name) || left.sequence - right.sequence);
}

function normalizePrefixLists(prefixLists: DeviceConfig["prefixLists"] | undefined): NonNullable<DeviceConfig["prefixLists"]> {
  if (!Array.isArray(prefixLists)) return [];
  const seen = new Set<string>();
  const normalized: NonNullable<DeviceConfig["prefixLists"]> = [];
  for (const entry of prefixLists) {
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 64) : "";
    const sequence = Number.isInteger(entry.sequence) && entry.sequence > 0 ? Math.min(4294967294, entry.sequence) : 5;
    const prefix = typeof entry.prefix === "string" ? entry.prefix.trim() : "";
    if (!name || !isPrefix(prefix)) continue;
    const ge = Number.isInteger(entry.ge) && entry.ge! >= 0 && entry.ge! <= 32 ? entry.ge : undefined;
    const le = Number.isInteger(entry.le) && entry.le! >= 0 && entry.le! <= 32 ? entry.le : undefined;
    const key = `${name.toLowerCase()}:${sequence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: entry.id || createId("plist"),
      name,
      sequence,
      action: entry.action === "deny" ? "deny" : "permit",
      prefix,
      ge,
      le,
      hits: Number.isInteger(entry.hits) ? Math.max(0, entry.hits) : 0
    });
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name) || left.sequence - right.sequence);
}

function isPrefix(value: string): boolean {
  const [network, prefixText] = value.split("/");
  const prefix = Number(prefixText);
  return isIpv4(network) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

function normalizeIpSlaOperations(operations: DeviceConfig["ipSlaOperations"] | undefined): NonNullable<DeviceConfig["ipSlaOperations"]> {
  if (!Array.isArray(operations)) return [];
  const byId = new Map<number, NonNullable<DeviceConfig["ipSlaOperations"]>[number]>();
  for (const operation of operations) {
    const operationId = Number(operation.operationId);
    if (!Number.isInteger(operationId) || operationId < 1 || operationId > 2147483647) continue;
    const frequency = Number(operation.frequency);
    const timeout = Number(operation.timeout);
    const threshold = Number(operation.threshold);
    byId.set(operationId, {
      id: operation.id || createId("sla"),
      operationId,
      type: "icmp-echo",
      targetIp: typeof operation.targetIp === "string" && isIpv4(operation.targetIp) ? operation.targetIp : "",
      sourceInterface: typeof operation.sourceInterface === "string" && operation.sourceInterface.trim() ? operation.sourceInterface.trim() : undefined,
      frequency: Number.isInteger(frequency) ? Math.max(1, Math.min(604800, frequency)) : 60,
      timeout: Number.isInteger(timeout) ? Math.max(1, Math.min(60000, timeout)) : 5000,
      threshold: Number.isInteger(threshold) ? Math.max(1, Math.min(60000, threshold)) : 5000,
      enabled: operation.enabled === true
    });
  }
  return [...byId.values()].sort((left, right) => left.operationId - right.operationId);
}

function normalizeTrackObjects(objects: DeviceConfig["trackObjects"] | undefined): NonNullable<DeviceConfig["trackObjects"]> {
  if (!Array.isArray(objects)) return [];
  const byId = new Map<number, NonNullable<DeviceConfig["trackObjects"]>[number]>();
  for (const object of objects) {
    const trackId = Number(object.trackId);
    if (!Number.isInteger(trackId) || trackId < 1 || trackId > 1000) continue;
    if (object.type === "interface") {
      const interfaceName = typeof object.interfaceName === "string" ? object.interfaceName.trim() : "";
      if (!interfaceName) continue;
      byId.set(trackId, {
        id: object.id || createId("track"),
        trackId,
        type: "interface",
        interfaceName,
        mode: "line-protocol"
      });
      continue;
    }
    if (object.type === "ip-sla") {
      const ipSlaOperationId = Number(object.ipSlaOperationId);
      if (!Number.isInteger(ipSlaOperationId) || ipSlaOperationId < 1) continue;
      byId.set(trackId, {
        id: object.id || createId("track"),
        trackId,
        type: "ip-sla",
        ipSlaOperationId,
        mode: "reachability"
      });
    }
  }
  return [...byId.values()].sort((left, right) => left.trackId - right.trackId);
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
      loginLocal: line.loginLocal === true,
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
      routerId: protocol.routerId,
      autoSummary: protocol.autoSummary === true,
      passiveInterfaces: Array.isArray(protocol.passiveInterfaces) ? protocol.passiveInterfaces.filter(Boolean) : [],
      passiveInterfaceDefault: protocol.passiveInterfaceDefault === true,
      passiveInterfaceExceptions: Array.isArray(protocol.passiveInterfaceExceptions) ? protocol.passiveInterfaceExceptions.filter(Boolean) : [],
      redistributeStatic: protocol.redistributeStatic === true,
      defaultInformationOriginate: protocol.defaultInformationOriginate === true,
      defaultInformationAlways: protocol.defaultInformationAlways === true
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
    natTranslations: Array.isArray(runtime?.natTranslations)
      ? runtime.natTranslations.map((entry) => ({
        protocol: entry.protocol || "icmp",
        insideLocal: entry.insideLocal || "",
        insideGlobal: entry.insideGlobal || "",
        outsideLocal: entry.outsideLocal || "---",
        outsideGlobal: entry.outsideGlobal || "---",
        interfaceName: entry.interfaceName || "",
        hits: Number.isInteger(entry.hits) ? entry.hits : 0,
        createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now()
      })).filter((entry) => entry.insideLocal && entry.insideGlobal)
      : [],
    logs: Array.isArray(runtime?.logs) ? runtime.logs : [],
    clock: typeof runtime?.clock === "string" ? runtime.clock : undefined
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

function normalizeWorkspaceNotes(notes: NetworkProject["notes"]): NonNullable<NetworkProject["notes"]> {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => note && typeof note.text === "string")
    .map((note) => ({
      id: note.id || createId("note"),
      text: note.text.slice(0, 240),
      position: {
        x: Number.isFinite(note.position?.x) ? Math.max(0, Math.min(2400, note.position.x)) : 120,
        y: Number.isFinite(note.position?.y) ? Math.max(0, Math.min(1600, note.position.y)) : 120
      },
      color: note.color === "blue" || note.color === "green" || note.color === "rose" ? note.color : "yellow"
    }));
}

function normalizeWorkspaceDrawings(drawings: NetworkProject["drawings"]): NonNullable<NetworkProject["drawings"]> {
  if (!Array.isArray(drawings)) return [];
  return drawings
    .filter((drawing) => drawing && (drawing.kind === "rectangle" || drawing.kind === "ellipse" || drawing.kind === "line" || drawing.kind === "freehand"))
    .map((drawing) => {
      const width = Number.isFinite(drawing.width) ? drawing.width : drawing.kind === "line" || drawing.kind === "freehand" ? 260 : 300;
      const height = Number.isFinite(drawing.height) ? drawing.height : drawing.kind === "line" || drawing.kind === "freehand" ? 120 : 170;
      const minWidth = drawing.kind === "line" || drawing.kind === "freehand" ? 28 : 32;
      const minHeight = drawing.kind === "line" || drawing.kind === "freehand" ? 8 : 32;
      const normalizedWidth = Math.max(minWidth, Math.min(1200, Math.round(width)));
      const normalizedHeight = Math.max(minHeight, Math.min(900, Math.round(height)));
      return {
        id: drawing.id || createId("draw"),
        kind: drawing.kind,
        label: typeof drawing.label === "string" ? drawing.label.slice(0, 80) : "",
        position: {
          x: Number.isFinite(drawing.position?.x) ? Math.max(0, Math.min(2400, drawing.position.x)) : 120,
          y: Number.isFinite(drawing.position?.y) ? Math.max(0, Math.min(1600, drawing.position.y)) : 120
        },
        width: normalizedWidth,
        height: normalizedHeight,
        points: drawing.kind === "freehand" ? normalizeWorkspaceDrawingPoints(drawing.points, normalizedWidth, normalizedHeight) : undefined,
        color: drawing.color === "blue" || drawing.color === "green" || drawing.color === "rose" ? drawing.color : "amber",
        strokeStyle: drawing.strokeStyle === "dashed" ? "dashed" : "solid",
        fill: drawing.kind === "line" || drawing.kind === "freehand" ? false : drawing.fill !== false
      };
    });
}

function normalizeWorkspaceDrawingPoints(points: unknown, width: number, height: number): Array<{ x: number; y: number }> {
  if (!Array.isArray(points)) return defaultWorkspaceDrawingPoints(width, height);
  const normalized = points
    .filter((point): point is { x: number; y: number } => {
      const value = point as { x?: unknown; y?: unknown } | null;
      return Number.isFinite(value?.x) && Number.isFinite(value?.y);
    })
    .map((point) => ({
      x: Math.max(0, Math.min(width, Math.round(point.x))),
      y: Math.max(0, Math.min(height, Math.round(point.y)))
    }))
    .slice(0, 300);
  return normalized.length >= 2 ? normalized : defaultWorkspaceDrawingPoints(width, height);
}

function defaultWorkspaceDrawingPoints(width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: 0, y: Math.round(height * 0.62) },
    { x: Math.round(width * 0.24), y: Math.round(height * 0.28) },
    { x: Math.round(width * 0.52), y: Math.round(height * 0.7) },
    { x: Math.round(width * 0.78), y: Math.round(height * 0.38) },
    { x: width, y: Math.round(height * 0.58) }
  ];
}

function normalizeActivity(activity: NetworkProject["activity"]): NonNullable<NetworkProject["activity"]> {
  return {
    title: typeof activity?.title === "string" ? activity.title.trim().slice(0, 100) : "",
    objectives: Array.isArray(activity?.objectives)
      ? activity.objectives
        .filter((objective) => typeof objective === "string" && objective.trim())
        .map((objective) => objective.trim().slice(0, 180))
        .slice(0, 12)
      : [],
    requirements: Array.isArray(activity?.requirements)
      ? activity.requirements
        .filter((requirement) => requirement && activityRequirementKinds.includes(requirement.kind))
        .map((requirement) => ({
          id: requirement.id || createId("act_req"),
          kind: requirement.kind,
          label: (typeof requirement.label === "string" && requirement.label.trim() ? requirement.label.trim() : activityRequirementKindLabel(requirement.kind)).slice(0, 80),
          target: Math.max(1, Math.min(999, Math.round(Number.isFinite(requirement.target) ? requirement.target : 1))),
          points: Math.max(1, Math.min(100, Math.round(Number.isFinite(requirement.points) ? requirement.points : 5)))
        }))
        .slice(0, 24)
      : [],
    answerSnapshot: normalizeActivityAnswerSnapshot(activity?.answerSnapshot),
    commandRules: normalizeActivityCommandRules(activity?.commandRules),
    commandSequences: normalizeActivityCommandSequences(activity?.commandSequences),
    commandOutputAssertions: normalizeActivityCommandOutputAssertions(activity?.commandOutputAssertions),
    interfaceExpectations: normalizeActivityInterfaceExpectations(activity?.interfaceExpectations),
    headerAssertions: normalizeActivityHeaderAssertions(activity?.headerAssertions)
  };
}

function normalizeActivityInterfaceExpectations(expectations: ActivityInterfaceExpectation[] | undefined): ActivityInterfaceExpectation[] {
  if (!Array.isArray(expectations)) return [];
  return expectations
    .filter((expectation) => expectation && typeof expectation.deviceId === "string" && typeof expectation.portId === "string")
    .map((expectation) => {
      const vlan = Number.isInteger(expectation.vlan) ? expectation.vlan : undefined;
      return {
        id: expectation.id || createId("act_int"),
        label: (typeof expectation.label === "string" && expectation.label.trim() ? expectation.label.trim() : "Interface expectation").slice(0, 80),
        deviceId: expectation.deviceId,
        portId: expectation.portId,
        ipAddress: typeof expectation.ipAddress === "string" && expectation.ipAddress.trim() ? expectation.ipAddress.trim().slice(0, 40) : undefined,
        subnetMask: typeof expectation.subnetMask === "string" && expectation.subnetMask.trim() ? expectation.subnetMask.trim().slice(0, 40) : undefined,
        mode: isPortMode(expectation.mode) ? expectation.mode : undefined,
        vlan: vlan === undefined ? undefined : Math.max(1, Math.min(4094, vlan)),
        points: Math.max(1, Math.min(100, Math.round(Number.isFinite(expectation.points) ? expectation.points : 5)))
      };
    })
    .slice(0, 80);
}

function normalizeActivityHeaderAssertions(assertions: ActivityHeaderAssertion[] | undefined): ActivityHeaderAssertion[] {
  if (!Array.isArray(assertions)) return [];
  return assertions
    .filter((assertion) => assertion && typeof assertion.field === "string" && assertion.field.trim() && typeof assertion.value === "string" && assertion.value.trim())
    .map((assertion) => ({
      id: assertion.id || createId("act_hdr"),
      label: (typeof assertion.label === "string" && assertion.label.trim() ? assertion.label.trim() : `${assertion.field}: ${assertion.value}`).slice(0, 80),
      protocol: typeof assertion.protocol === "string" && assertion.protocol.trim() ? assertion.protocol.trim().toUpperCase().slice(0, 24) : undefined,
      field: assertion.field.trim().slice(0, 48),
      value: assertion.value.trim().slice(0, 120),
      points: Math.max(1, Math.min(100, Math.round(Number.isFinite(assertion.points) ? assertion.points : 5)))
    }))
    .slice(0, 80);
}

function normalizeActivityCommandRules(rules: ActivityCommandRule[] | undefined): ActivityCommandRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((rule) => rule && typeof rule.command === "string" && rule.command.trim())
    .map((rule) => ({
      id: rule.id || createId("act_cmd"),
      label: (typeof rule.label === "string" && rule.label.trim() ? rule.label.trim() : rule.command.trim()).slice(0, 80),
      deviceId: typeof rule.deviceId === "string" && rule.deviceId.trim() ? rule.deviceId.trim() : undefined,
      command: rule.command.trim().replace(/\s+/g, " ").slice(0, 120),
      points: Math.max(1, Math.min(100, Math.round(Number.isFinite(rule.points) ? rule.points : 5)))
    }))
    .slice(0, 40);
}

function normalizeActivityCommandSequences(sequences: ActivityCommandSequence[] | undefined): ActivityCommandSequence[] {
  if (!Array.isArray(sequences)) return [];
  return sequences
    .filter((sequence) => sequence && Array.isArray(sequence.commands) && sequence.commands.some((command) => typeof command === "string" && command.trim()))
    .map((sequence) => {
      const commands = sequence.commands
        .filter((command) => typeof command === "string" && command.trim())
        .map((command) => command.trim().replace(/\s+/g, " ").slice(0, 120))
        .slice(0, 20);
      return {
        id: sequence.id || createId("act_seq"),
        label: (typeof sequence.label === "string" && sequence.label.trim() ? sequence.label.trim() : commands.join(" -> ")).slice(0, 80),
        deviceId: typeof sequence.deviceId === "string" && sequence.deviceId.trim() ? sequence.deviceId.trim() : undefined,
        commands,
        points: Math.max(1, Math.min(100, Math.round(Number.isFinite(sequence.points) ? sequence.points : 10)))
      };
    })
    .slice(0, 24);
}

function normalizeActivityCommandOutputAssertions(assertions: ActivityCommandOutputAssertion[] | undefined): ActivityCommandOutputAssertion[] {
  if (!Array.isArray(assertions)) return [];
  return assertions
    .filter((assertion) => assertion && Array.isArray(assertion.commands) && typeof assertion.expectedText === "string" && assertion.expectedText.trim())
    .map((assertion) => {
      const commands = assertion.commands
        .filter((command) => typeof command === "string" && command.trim())
        .map((command) => command.trim().replace(/\s+/g, " ").slice(0, 120))
        .slice(0, 20);
      return {
        id: assertion.id || createId("act_out"),
        label: (typeof assertion.label === "string" && assertion.label.trim() ? assertion.label.trim() : `${commands.at(-1) ?? "CLI"} contains ${assertion.expectedText}`).slice(0, 80),
        deviceId: typeof assertion.deviceId === "string" && assertion.deviceId.trim() ? assertion.deviceId.trim() : undefined,
        commands,
        expectedText: assertion.expectedText.trim().slice(0, 160),
        points: Math.max(1, Math.min(100, Math.round(Number.isFinite(assertion.points) ? assertion.points : 10)))
      };
    })
    .filter((assertion) => assertion.commands.length > 0)
    .slice(0, 24);
}

function normalizeActivityAnswerSnapshot(snapshot: ActivityAnswerSnapshot | undefined): ActivityAnswerSnapshot | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const value = snapshot as NonNullable<NonNullable<NetworkProject["activity"]>["answerSnapshot"]>;
  const devices = Array.isArray(value.devices)
    ? value.devices
      .filter((device) => device && typeof device.id === "string" && isDeviceKind(device.kind))
      .map((device) => ({
        id: device.id,
        label: typeof device.label === "string" ? device.label.slice(0, 80) : device.id,
        kind: device.kind,
        model: typeof device.model === "string" ? device.model.slice(0, 80) : ""
      }))
      .slice(0, 200)
    : [];
  const links = Array.isArray(value.links)
    ? value.links
      .filter((link) => link && typeof link.id === "string" && typeof link.endpointADeviceId === "string" && typeof link.endpointBDeviceId === "string")
      .map((link) => ({
        id: link.id,
        type: normalizeCableType(link.type),
        endpointADeviceId: link.endpointADeviceId,
        endpointBDeviceId: link.endpointBDeviceId
      }))
      .slice(0, 300)
    : [];
  return {
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : new Date().toISOString(),
    devices,
    links,
    annotationCount: Math.max(0, Math.min(999, Math.round(Number.isFinite(value.annotationCount) ? value.annotationCount : 0))),
    serviceDeviceIds: Array.isArray(value.serviceDeviceIds) ? value.serviceDeviceIds.filter((id) => typeof id === "string").slice(0, 200) : [],
    startupConfigDeviceIds: Array.isArray(value.startupConfigDeviceIds) ? value.startupConfigDeviceIds.filter((id) => typeof id === "string").slice(0, 200) : []
  };
}

function activityRequirementKindLabel(kind: ActivityRequirementKind): string {
  return ({
    "device-count": "Required devices",
    "link-count": "Required links",
    "annotation-count": "Workspace annotations",
    "delivered-pdu-count": "Delivered PDU events",
    "saved-config-count": "Saved network configs",
    "service-count": "Enabled service devices",
    "tdr-normal-count": "Normal TDR copper links",
    "vlan-count": "Configured VLANs",
    "trunk-port-count": "Trunk ports",
    "routed-port-count": "Routed ports",
    "svi-count": "Configured SVIs",
    "static-route-count": "Static routes",
    "dynamic-routing-count": "Dynamic routing processes",
    "acl-rule-count": "ACL rules",
    "nat-rule-count": "NAT rules",
    "prefix-list-count": "Prefix-list entries",
    "pbr-route-map-count": "PBR route-map entries",
    "dhcp-pool-count": "DHCP pools",
    "dhcp-snooping-device-count": "DHCP Snooping devices",
    "port-security-port-count": "Port-security ports",
    "etherchannel-port-count": "EtherChannel member ports",
    "first-hop-redundancy-count": "HSRP/VRRP groups",
    "wireless-infrastructure-count": "Wireless infrastructure devices",
    "wireless-client-count": "Wireless client ports",
    "ip-sla-track-count": "IP SLA track pairs"
  })[kind];
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
    osiLayers,
    headers: normalizePduHeaders(event.headers)
  };
}

function normalizePduHeaders(headers: SimulationEvent["headers"]): SimulationEvent["headers"] {
  if (!Array.isArray(headers)) return undefined;
  const normalized = headers
    .filter((header) => header && typeof header.layer === "string" && typeof header.field === "string" && typeof header.value === "string")
    .map((header) => ({
      layer: header.layer.trim().slice(0, 32),
      field: header.field.trim().slice(0, 48),
      value: header.value.trim().slice(0, 120)
    }))
    .filter((header) => header.layer && header.field)
    .slice(0, 24);
  return normalized.length ? normalized : undefined;
}
