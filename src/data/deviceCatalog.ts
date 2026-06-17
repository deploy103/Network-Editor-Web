import type { DeviceSpec, NetworkDevice, NetworkPort } from "../types/network";
import { makeId, nowIso } from "../utils/ids";

const emptyInterface = {
  ipAddress: "",
  subnetMask: "",
  gateway: "",
  dns: "",
  helperAddress: "",
  dhcp: false,
};

export const deviceCatalog: DeviceSpec[] = [
  {
    id: "router-1841",
    type: "router",
    modelName: "1841",
    displayName: "Router 1841",
    icon: "route",
    accent: "#1f7a8c",
    shape: "router",
    ports: [
      { name: "FastEthernet0/0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "FastEthernet0/1", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "Serial0/0/0", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [
      { label: "HWIC 0", compatibleModules: ["HWIC-2T", "HWIC-AP-AG-B", "Blank"] },
      { label: "HWIC 1", compatibleModules: ["HWIC-2T", "Blank"] },
    ],
  },
  {
    id: "router-1941",
    type: "router",
    modelName: "1941",
    displayName: "Router 1941",
    icon: "route",
    accent: "#20748a",
    shape: "router",
    ports: [
      { name: "GigabitEthernet0/0", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "GigabitEthernet0/1", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "Serial0/0/0", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [
      { label: "HWIC 0", compatibleModules: ["HWIC-2T", "HWIC-4ESW", "Blank"] },
      { label: "HWIC 1", compatibleModules: ["HWIC-2T", "Blank"] },
    ],
  },
  {
    id: "router-2811",
    type: "router",
    modelName: "2811",
    displayName: "Router 2811",
    icon: "route",
    accent: "#2f8496",
    shape: "router",
    ports: [
      { name: "FastEthernet0/0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "FastEthernet0/1", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "Serial0/0/0", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Serial0/0/1", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [
      { label: "NME 0", compatibleModules: ["NM-2FE2W", "NM-4E", "Blank"] },
      { label: "HWIC 0", compatibleModules: ["HWIC-2T", "HWIC-4ESW", "Blank"] },
      { label: "HWIC 1", compatibleModules: ["HWIC-2T", "Blank"] },
    ],
  },
  {
    id: "router-2901",
    type: "router",
    modelName: "2901",
    displayName: "Router 2901",
    icon: "route",
    accent: "#1f7a8c",
    shape: "router",
    ports: [
      { name: "GigabitEthernet0/0", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "GigabitEthernet0/1", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "Serial0/0/0", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Serial0/0/1", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [
      { label: "EHWIC 0", compatibleModules: ["HWIC-2T", "HWIC-4ESW", "Blank"] },
      { label: "EHWIC 1", compatibleModules: ["HWIC-2T", "Blank"] },
      { label: "ISM 0", compatibleModules: ["Blank"] },
    ],
  },
  {
    id: "router-2911",
    type: "router",
    modelName: "2911",
    displayName: "Router 2911",
    icon: "route",
    accent: "#146b7d",
    shape: "router",
    ports: [
      { name: "GigabitEthernet0/0", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "GigabitEthernet0/1", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "GigabitEthernet0/2", kind: "gigabit", bandwidthMbps: 1000, mode: "routed", vlan: 1 },
      { name: "Serial0/0/0", kind: "serial", bandwidthMbps: 2, mode: "routed", vlan: 1, requiredModule: "2T" },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [
      { label: "EHWIC 0", compatibleModules: ["HWIC-2T", "HWIC-4ESW", "Blank"] },
      { label: "EHWIC 1", compatibleModules: ["HWIC-2T", "HWIC-AP-AG-B", "Blank"] },
      { label: "ISM 0", compatibleModules: ["Blank"] },
    ],
  },
  {
    id: "switch-2950-24",
    type: "switch",
    modelName: "Catalyst-2950-24",
    displayName: "Switch 2950-24",
    icon: "network",
    accent: "#6c8f2d",
    shape: "switch",
    ports: [
      ...Array.from({ length: 24 }, (_, index) => ({
        name: `FastEthernet0/${index + 1}`,
        kind: "fast-ethernet" as const,
        bandwidthMbps: 100,
        mode: "access" as const,
        vlan: 1,
      })),
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [],
  },
  {
    id: "switch-2960-24tt",
    type: "switch",
    modelName: "Catalyst-2960",
    displayName: "Switch 2960-24TT",
    icon: "network",
    accent: "#6c8f2d",
    shape: "switch",
    ports: [
      ...Array.from({ length: 24 }, (_, index) => ({
        name: `FastEthernet0/${index + 1}`,
        kind: "fast-ethernet" as const,
        bandwidthMbps: 100,
        mode: "access" as const,
        vlan: 1,
      })),
      { name: "GigabitEthernet0/1", kind: "gigabit", bandwidthMbps: 1000, mode: "trunk", vlan: 1 },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [],
  },
  {
    id: "switch-3560-24ps",
    type: "switch",
    modelName: "Catalyst-3560-24PS",
    displayName: "MLS 3560-24PS",
    icon: "network",
    accent: "#597f2b",
    shape: "switch",
    ports: [
      ...Array.from({ length: 24 }, (_, index) => ({
        name: `FastEthernet0/${index + 1}`,
        kind: "fast-ethernet" as const,
        bandwidthMbps: 100,
        mode: "access" as const,
        vlan: 1,
      })),
      { name: "GigabitEthernet0/1", kind: "gigabit", bandwidthMbps: 1000, mode: "trunk", vlan: 1 },
      { name: "GigabitEthernet0/2", kind: "gigabit", bandwidthMbps: 1000, mode: "trunk", vlan: 1 },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [],
  },
  {
    id: "firewall-asa-5505",
    type: "firewall",
    modelName: "ASA-5505",
    displayName: "Firewall",
    icon: "shield",
    accent: "#b44b4b",
    shape: "firewall",
    ports: [
      { name: "Ethernet0/0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "Ethernet0/1", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "Ethernet0/2", kind: "fast-ethernet", bandwidthMbps: 100, mode: "routed", vlan: 1 },
      { name: "Console0", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [],
  },
  {
    id: "pc-pt",
    type: "pc",
    modelName: "PC-PT",
    displayName: "PC",
    icon: "monitor",
    accent: "#3264a8",
    shape: "pc",
    ports: [
      { name: "FastEthernet0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "access", vlan: 1 },
      { name: "RS232", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [{ label: "NIC", compatibleModules: ["PT-HOST-NM-1CFE", "PT-HOST-NM-1W", "Blank"] }],
  },
  {
    id: "laptop-pt",
    type: "pc",
    modelName: "Laptop-PT",
    displayName: "Laptop",
    icon: "monitor",
    accent: "#3f6fb0",
    shape: "pc",
    ports: [
      { name: "FastEthernet0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "access", vlan: 1 },
      { name: "Wireless0", kind: "wireless", bandwidthMbps: 54, mode: "access", vlan: 1 },
      { name: "RS232", kind: "console", bandwidthMbps: 1, mode: "routed", vlan: 1 },
    ],
    moduleSlots: [{ label: "NIC", compatibleModules: ["PT-LAPTOP-NM-1CFE", "PT-LAPTOP-NM-1W", "Blank"] }],
  },
  {
    id: "server-pt",
    type: "server",
    modelName: "Server-PT",
    displayName: "Server",
    icon: "server",
    accent: "#7a4c9f",
    shape: "server",
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "access", vlan: 1 }],
    moduleSlots: [{ label: "NIC", compatibleModules: ["PT-HOST-NM-1CFE", "PT-HOST-NM-1FGE", "Blank"] }],
  },
  {
    id: "wireless-ap-pt",
    type: "wireless",
    modelName: "AccessPoint-PT",
    displayName: "Wireless AP",
    icon: "wifi",
    accent: "#be7c1f",
    shape: "wireless",
    ports: [
      { name: "Port0", kind: "fast-ethernet", bandwidthMbps: 100, mode: "access", vlan: 1 },
      { name: "Wireless0", kind: "wireless", bandwidthMbps: 54, mode: "access", vlan: 1 },
    ],
    moduleSlots: [],
  },
  {
    id: "hub-pt",
    type: "hub",
    modelName: "Hub-PT",
    displayName: "Hub",
    icon: "circle-dot",
    accent: "#777777",
    shape: "hub",
    ports: Array.from({ length: 6 }, (_, index) => ({
      name: `Port ${index + 1}`,
      kind: "fast-ethernet" as const,
      bandwidthMbps: 10,
      mode: "access" as const,
      vlan: 1,
    })),
    moduleSlots: [],
  },
];

function makeMac(seed: string): string {
  const bytes = Array.from(seed).reduce<number[]>((acc, char, index) => {
    acc[index % 6] = (acc[index % 6] ?? 0) + char.charCodeAt(0) + index * 17;
    return acc;
  }, []);
  const normalized = Array.from({ length: 6 }, (_, index) => ((bytes[index] ?? 12) % 256).toString(16).padStart(2, "0"));
  normalized[0] = "02";
  return normalized.join(":");
}

function makePort(port: DeviceSpec["ports"][number], deviceId: string, index: number): NetworkPort {
  return {
    id: makeId("port"),
    name: port.name,
    kind: port.kind,
    requiredModule: port.requiredModule,
    macAddress: makeMac(`${deviceId}-${port.name}-${index}`),
    status: "up",
    bandwidthMbps: port.bandwidthMbps,
    duplex: "auto",
    mode: port.mode,
    vlan: port.vlan,
    allowedVlans: port.mode === "trunk" ? [1, 10, 20, 30, 99] : [port.vlan],
    interfaceConfig: { ...emptyInterface },
  };
}

function hostnamePrefix(spec: DeviceSpec): string {
  if (spec.type === "router") return "Router";
  if (spec.type === "switch") return "Switch";
  if (spec.type === "pc" && spec.id === "laptop-pt") return "Laptop";
  if (spec.type === "pc") return "PC";
  if (spec.type === "wireless") return "AccessPoint";
  return spec.displayName.replace(/[^a-zA-Z0-9가-힣]+/g, "");
}

export function getDeviceSpec(idOrType: DeviceSpec["id"] | DeviceSpec["type"]): DeviceSpec {
  const spec = deviceCatalog.find((entry) => entry.id === idOrType) ?? deviceCatalog.find((entry) => entry.type === idOrType);
  if (!spec) {
    throw new Error(`Unknown device type: ${idOrType}`);
  }
  return spec;
}

export function createDevice(idOrType: DeviceSpec["id"] | DeviceSpec["type"], x: number, y: number, index: number): NetworkDevice {
  const spec = getDeviceSpec(idOrType);
  const id = makeId("dev");
  const hostname = `${hostnamePrefix(spec)}${index}`;
  const isServer = spec.type === "server";
  const hasWireless = spec.ports.some((port) => port.kind === "wireless");

  return {
    id,
    catalogId: spec.id,
    type: spec.type,
    modelName: spec.modelName,
    label: hostname,
    x,
    y,
    powerOn: true,
    ports: spec.ports.map((port, portIndex) => makePort(port, id, portIndex)),
    moduleSlots: spec.moduleSlots.map((slot) => ({
      ...slot,
      id: makeId("slot"),
      installedModule: slot.compatibleModules[0] ?? "Blank",
    })),
    config: {
      hostname,
      runningConfig: [`hostname ${hostname}`],
      startupConfig: [`hostname ${hostname}`],
      staticRoutes: [],
      dhcpPools: [],
      dnsRecords: isServer ? [{ host: "lab.local", address: "192.168.1.10" }] : [],
      httpEnabled: isServer,
      httpBody: isServer ? `<h1>${hostname}</h1><p>HTTP service is enabled.</p>` : "",
      firewallRules: [],
      wireless: {
        ssid: hasWireless ? "Lab-WiFi" : "",
        security: "open",
        wepKey: "",
      },
      cliMode: "user",
      cliContext: {},
    },
    runtime: {
      arp: {},
      mac: {},
      dhcpLeases: {},
      lastBootAt: nowIso(),
    },
  };
}
