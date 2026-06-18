import type { CableType, DeviceConfig, DeviceKind, DeviceModel, ModuleSpec, NetworkDevice, NetworkPort, PortKind, PortTemplate } from "../types/network";
import { createId } from "../utils/id";

const routedTabs = ["physical", "config", "cli"] as const;
const hostTabs = ["physical", "config", "desktop"] as const;

export const moduleCatalog: ModuleSpec[] = [
  {
    id: "HWIC-2T",
    label: "HWIC-2T",
    description: "Two serial WAN interfaces.",
    ports: [
      { name: "Serial0/0/0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/0/1", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "HWIC-4ESW",
    label: "HWIC-4ESW",
    description: "Four switched FastEthernet access ports.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `FastEthernet0/${index + 2}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "HWIC-1SFP",
    label: "HWIC-1SFP",
    description: "One fiber SFP routed uplink.",
    ports: [{ name: "GigabitEthernet0/2", kind: "fiber", mode: "routed", ipCapable: true }]
  },
  {
    id: "PT-HOST-NM-1W",
    label: "PT-HOST-NM-1W",
    description: "Wireless host adapter.",
    ports: [{ name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }]
  }
];

function fastEthernet(count: number, prefix = "FastEthernet0/"): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + 1}`, kind: "fast-ethernet", mode: "access", vlan: 1 }));
}

function gigabit(count: number): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `GigabitEthernet0/${index + 1}`, kind: "gigabit-ethernet", mode: "access", vlan: 1 }));
}

function fiber(count: number): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `Fiber0/${index + 1}`, kind: "fiber", mode: "access", vlan: 1 }));
}

export const deviceCatalog: DeviceModel[] = [
  router("router-1841", "Router 1841", "ISR router with FastEthernet and HWIC slots.", "fast"),
  router("router-1941", "Router 1941", "Gigabit ISR router with WAN expansion.", "gigabit"),
  router("router-2811", "Router 2811", "Modular router for serial, switching, and WAN labs.", "fast", 3),
  router("router-2901", "Router 2901", "Gigabit modular router with four slots.", "gigabit", 4),
  router("router-2911", "Router 2911", "Larger ISR router for multi-WAN topologies.", "gigabit", 4),
  {
    id: "switch-2960",
    kind: "switch",
    model: "Switch 2960-24TT",
    labelPrefix: "Switch",
    description: "Layer 2 access switch.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...gigabit(2), ...fiber(2), { name: "Console0", kind: "console", mode: "access" }],
    modules: []
  },
  {
    id: "switch-3560",
    kind: "switch",
    model: "Multilayer Switch 3560",
    labelPrefix: "Switch",
    description: "Multilayer switch with SVI routing.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...gigabit(2), ...fiber(2), { name: "Vlan1", kind: "ethernet", mode: "routed", ipCapable: true }, { name: "Console0", kind: "console", mode: "access" }],
    modules: []
  },
  {
    id: "firewall-asa5505",
    kind: "firewall",
    model: "ASA 5505",
    labelPrefix: "Firewall",
    description: "Firewall with ACL and NAT.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(8, "Ethernet0/"), { name: "Vlan1", kind: "ethernet", mode: "routed", vlan: 1, ipCapable: true }, { name: "Vlan2", kind: "ethernet", mode: "routed", vlan: 2, ipCapable: true }, { name: "Console0", kind: "console", mode: "access" }],
    modules: []
  },
  {
    id: "pc-pt",
    kind: "pc",
    model: "PC-PT",
    labelPrefix: "PC",
    description: "Desktop host with command prompt and RS232.",
    tabs: [...hostTabs],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }, { name: "RS232", kind: "console", mode: "access" }],
    modules: [{ id: "slot0", label: "Host adapter", accepts: ["PT-HOST-NM-1W"] }]
  },
  {
    id: "laptop-pt",
    kind: "pc",
    model: "Laptop-PT",
    labelPrefix: "Laptop",
    description: "Portable host with Ethernet, wireless, and command prompt.",
    tabs: [...hostTabs],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }, { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }, { name: "RS232", kind: "console", mode: "access" }],
    modules: []
  },
  {
    id: "server-pt",
    kind: "server",
    model: "Server-PT",
    labelPrefix: "Server",
    description: "Server with HTTP, DHCP, DNS, TFTP service surfaces.",
    tabs: ["physical", "config", "desktop", "services"],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }],
    modules: []
  },
  {
    id: "ap-pt",
    kind: "wireless",
    model: "Access Point-PT",
    labelPrefix: "AP",
    description: "Ethernet to wireless bridge.",
    tabs: ["physical", "config"],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1 }, { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1 }],
    modules: []
  },
  {
    id: "wrt300n",
    kind: "wireless",
    model: "Wireless Router WRT300N",
    labelPrefix: "WRouter",
    description: "Wireless router with Internet uplink and four LAN switch ports.",
    tabs: ["physical", "config", "services"],
    ports: [
      { name: "Internet", kind: "gigabit-ethernet", mode: "routed", vlan: 1, ipCapable: true },
      ...fastEthernet(4, "Ethernet"),
      { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }
    ],
    modules: []
  },
  {
    id: "hub-pt",
    kind: "hub",
    model: "Hub-PT",
    labelPrefix: "Hub",
    description: "Repeater that floods frames out active ports.",
    tabs: ["physical", "config"],
    ports: fastEthernet(8, "Port"),
    modules: []
  }
];

export const cableCatalog: Array<{ type: CableType; label: string }> = [
  { type: "auto", label: "Auto" },
  { type: "console", label: "Console" },
  { type: "copper-straight", label: "Copper Straight" },
  { type: "copper-cross", label: "Copper Cross" },
  { type: "fiber", label: "Fiber" },
  { type: "serial-dce", label: "Serial DCE" },
  { type: "serial-dte", label: "Serial DTE" },
  { type: "wireless", label: "Wireless" }
];

function router(id: string, model: string, description: string, portSet: "fast" | "gigabit", slots = 2): DeviceModel {
  const ports = portSet === "gigabit"
    ? [{ name: "GigabitEthernet0/0", kind: "gigabit-ethernet" as const, mode: "routed" as const, ipCapable: true }, { name: "GigabitEthernet0/1", kind: "gigabit-ethernet" as const, mode: "routed" as const, ipCapable: true }]
    : [{ name: "FastEthernet0/0", kind: "fast-ethernet" as const, mode: "routed" as const, ipCapable: true }, { name: "FastEthernet0/1", kind: "fast-ethernet" as const, mode: "routed" as const, ipCapable: true }];
  return {
    id,
    kind: "router",
    model,
    labelPrefix: "Router",
    description,
    tabs: [...routedTabs],
    ports: [...ports, { name: "Console0", kind: "console", mode: "routed" }],
    modules: Array.from({ length: slots }, (_, index) => ({ id: `slot${index}`, label: `Module ${index}`, accepts: ["HWIC-2T", "HWIC-4ESW", "HWIC-1SFP"] }))
  };
}

export function createDevice(modelId: string, position: { x: number; y: number }, existing: NetworkDevice[]): NetworkDevice {
  const model = deviceCatalog.find((item) => item.id === modelId);
  if (!model) {
    throw new Error(`Unknown model ${modelId}`);
  }
  const label = nextDeviceLabel(model.labelPrefix, existing);
  const ports = model.ports.map((port, index) => createPort(port, index));
  const config = defaultConfig(label, model.kind);
  if (ports.some((port) => port.kind === "wireless") && !config.wireless.ssid) {
    config.wireless = { ...config.wireless, ssid: "Lab-Wireless" };
  }
  return {
    id: createId("dev"),
    kind: model.kind,
    modelId: model.id,
    model: model.model,
    label,
    position,
    powerOn: true,
    ports,
    modules: [],
    config,
    runtime: { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
  };
}

function nextDeviceLabel(prefix: string, existing: NetworkDevice[]): string {
  const used = new Set(existing.map((device) => device.label));
  let index = 0;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function createPort(template: PortTemplate, index: number, moduleMeta?: { slotId: string; moduleId: string; existingNames: Set<string> }): NetworkPort {
  const name = moduleMeta ? uniquePortName(moduleMeta.existingNames, modulePortName(template.name, moduleMeta.slotId)) : template.name;
  moduleMeta?.existingNames.add(name);
  return {
    id: createId("port"),
    name,
    kind: template.kind,
    description: "",
    macAddress: createMac(index),
    mode: template.mode,
    vlan: template.vlan ?? 1,
    allowedVlans: [1],
    ipAddress: "",
    subnetMask: "",
    gateway: "",
    dnsServer: "",
    adminUp: true,
    ipCapable: Boolean(template.ipCapable || template.mode === "routed"),
    moduleSlotId: moduleMeta?.slotId,
    moduleId: moduleMeta?.moduleId
  };
}

export function defaultConfig(hostname: string, kind: DeviceKind): DeviceConfig {
  return {
    hostname,
    startupConfig: [],
    staticRoutes: [],
    vlans: [{ id: 1, name: "default" }],
    dhcpPools: [],
    dnsRecords: kind === "server" ? [{ id: createId("dns"), name: "www.lab.local", value: "192.168.1.10" }] : [],
    accessRules: [],
    natRules: [],
    services: { http: kind === "server", dhcp: false, dns: kind === "server", tftp: false, syslog: false },
    wireless: { ssid: kind === "wireless" ? "Lab-Wireless" : "", auth: "open", key: "", channel: 6, range: 180 }
  };
}

export function canPortUseCable(port: NetworkPort, cable: CableType): boolean {
  const ethernet: PortKind[] = ["ethernet", "fast-ethernet", "gigabit-ethernet"];
  if (cable === "auto") return true;
  if (cable === "console") return port.kind === "console";
  if (cable === "copper-straight" || cable === "copper-cross") return ethernet.includes(port.kind);
  if (cable === "serial-dce" || cable === "serial-dte") return port.kind === "serial";
  if (cable === "fiber") return port.kind === "fiber";
  if (cable === "wireless") return port.kind === "wireless";
  return false;
}

export function displayKind(kind: DeviceKind): string {
  return ({ router: "Router", switch: "Switch", firewall: "Firewall", pc: "PC", server: "Server", wireless: "Wireless", hub: "Hub" })[kind];
}

export function getDeviceModel(modelId: string): DeviceModel {
  const model = deviceCatalog.find((item) => item.id === modelId);
  if (!model) {
    throw new Error(`Unknown model ${modelId}`);
  }
  return model;
}

export function getModuleSpec(moduleId: string): ModuleSpec | undefined {
  return moduleCatalog.find((module) => module.id === moduleId);
}

export function installModule(device: NetworkDevice, slotId: string, moduleId: string): { ok: boolean; message: string; device: NetworkDevice } {
  if (device.powerOn) {
    return { ok: false, message: "Power off the device before installing a module.", device };
  }
  const model = getDeviceModel(device.modelId);
  const slot = model.modules.find((candidate) => candidate.id === slotId);
  if (!slot) {
    return { ok: false, message: "This device does not have that module slot.", device };
  }
  if (device.modules.some((module) => module.slotId === slotId)) {
    return { ok: false, message: "Remove the installed module before adding another one.", device };
  }
  if (!slot.accepts.includes(moduleId)) {
    return { ok: false, message: "That module is not supported in this slot.", device };
  }
  const spec = getModuleSpec(moduleId);
  if (!spec) {
    return { ok: false, message: "Unknown module.", device };
  }
  const existingNames = new Set(device.ports.map((port) => port.name));
  const nextPorts = spec.ports.map((port, index) => createPort(port, device.ports.length + index, { slotId, moduleId, existingNames }));
  return {
    ok: true,
    message: `${spec.label} installed in ${slot.label}.`,
    device: {
      ...device,
      modules: [...device.modules, { slotId, moduleId }],
      ports: [...device.ports, ...nextPorts]
    }
  };
}

export function removeModule(device: NetworkDevice, slotId: string): { ok: boolean; message: string; device: NetworkDevice } {
  if (device.powerOn) {
    return { ok: false, message: "Power off the device before removing a module.", device };
  }
  const installed = device.modules.find((module) => module.slotId === slotId);
  if (!installed) {
    return { ok: false, message: "No module is installed in that slot.", device };
  }
  const modulePorts = device.ports.filter((port) => port.moduleSlotId === slotId);
  const connected = modulePorts.find((port) => port.linkId);
  if (connected) {
    return { ok: false, message: `Disconnect ${connected.name} before removing the module.`, device };
  }
  const removedPortNames = new Set(modulePorts.map((port) => port.name));
  return {
    ok: true,
    message: `${installed.moduleId} removed from ${slotId}.`,
    device: {
      ...device,
      modules: device.modules.filter((module) => module.slotId !== slotId),
      ports: device.ports.filter((port) => port.moduleSlotId !== slotId),
      runtime: {
        ...device.runtime,
        arpTable: device.runtime.arpTable.filter((entry) => !removedPortNames.has(entry.portName)),
        macTable: device.runtime.macTable.filter((entry) => !removedPortNames.has(entry.portName))
      }
    }
  };
}

function modulePortName(name: string, slotId: string): string {
  const slotIndex = Number(slotId.replace(/\D/g, "")) || 0;
  if (/^Serial0\/0\//.test(name)) {
    return name.replace("Serial0/0/", `Serial0/${slotIndex}/`);
  }
  if (/^FastEthernet0\//.test(name) && slotIndex > 0) {
    return name.replace("FastEthernet0/", `FastEthernet${slotIndex}/`);
  }
  if (/^Wireless0$/.test(name) && slotIndex > 0) {
    return `Wireless${slotIndex}`;
  }
  return name;
}

function uniquePortName(existing: Set<string>, baseName: string): string {
  if (!existing.has(baseName)) {
    return baseName;
  }
  let suffix = 1;
  while (existing.has(`${baseName}.${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}.${suffix}`;
}

function createMac(seed: number): string {
  const value = Math.floor(Math.random() * 0xffffff);
  return `02:00:${((value >> 16) & 255).toString(16).padStart(2, "0")}:${((value >> 8) & 255).toString(16).padStart(2, "0")}:${(value & 255).toString(16).padStart(2, "0")}:${seed.toString(16).padStart(2, "0")}`;
}
