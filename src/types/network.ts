export type DeviceType =
  | "router"
  | "switch"
  | "firewall"
  | "pc"
  | "server"
  | "wireless"
  | "hub";

export type CableType =
  | "console"
  | "copper-straight"
  | "copper-cross"
  | "fiber"
  | "serial-dce"
  | "serial-dte"
  | "coaxial"
  | "phone"
  | "wireless";

export type CableTool = CableType | "auto";

export type PortKind =
  | "ethernet"
  | "fast-ethernet"
  | "gigabit"
  | "serial"
  | "console"
  | "coaxial"
  | "phone"
  | "wireless";

export type PortMode = "access" | "trunk" | "routed";
export type LinkStatus = "up" | "down" | "blocked" | "console";
export type SimulationMode = "realtime" | "simulation";
export type EventStatus = "success" | "failed" | "queued" | "info";

export interface InterfaceConfig {
  ipAddress: string;
  subnetMask: string;
  gateway?: string;
  dns?: string;
  helperAddress?: string;
  dhcp: boolean;
}

export interface NetworkPort {
  id: string;
  name: string;
  description?: string;
  kind: PortKind;
  requiredModule?: string;
  macAddress: string;
  status: "up" | "down" | "administratively-down";
  bandwidthMbps: number;
  duplex: "auto" | "half" | "full";
  clockRate?: number;
  mode: PortMode;
  vlan: number;
  allowedVlans: number[];
  interfaceConfig: InterfaceConfig;
}

export interface ModuleSlot {
  id: string;
  label: string;
  installedModule?: string;
  compatibleModules: string[];
}

export interface RouteEntry {
  destination: string;
  mask: string;
  nextHop: string;
  outgoingPortId?: string;
  learnedBy: "connected" | "static" | "rip" | "ospf" | "eigrp";
}

export interface DhcpPool {
  name: string;
  network: string;
  mask: string;
  defaultRouter: string;
  dnsServer: string;
  nextOffset: number;
  leases: Record<string, string>;
}

export interface DnsRecord {
  host: string;
  address: string;
}

export interface FirewallRule {
  id: string;
  listId?: string;
  action: "permit" | "deny";
  protocol: "ip" | "icmp" | "tcp" | "udp";
  source: string;
  destination: string;
}

export interface DeviceConfig {
  hostname: string;
  runningConfig: string[];
  startupConfig: string[];
  staticRoutes: RouteEntry[];
  dhcpPools: DhcpPool[];
  dnsRecords: DnsRecord[];
  httpEnabled: boolean;
  httpBody: string;
  firewallRules: FirewallRule[];
  wireless: {
    ssid: string;
    security: "open" | "wep";
    wepKey: string;
  };
  cliMode: CliMode;
  cliContext: {
    interfaceId?: string;
    dhcpPoolName?: string;
    routerProcess?: string;
    vlanId?: number;
  };
}

export type CliMode =
  | "user"
  | "privileged"
  | "global"
  | "interface"
  | "dhcp"
  | "router"
  | "vlan"
  | "acl";

export interface DeviceRuntimeTables {
  arp: Record<string, string>;
  mac: Record<string, { portId: string; vlan: number; age: number }>;
  dhcpLeases: Record<string, string>;
  lastBootAt: string;
}

export interface NetworkDevice {
  id: string;
  catalogId?: string;
  type: DeviceType;
  modelName: string;
  label: string;
  x: number;
  y: number;
  powerOn: boolean;
  ports: NetworkPort[];
  moduleSlots: ModuleSlot[];
  config: DeviceConfig;
  runtime: DeviceRuntimeTables;
}

export interface LinkEndpoint {
  deviceId: string;
  portId: string;
}

export interface NetworkLink {
  id: string;
  type: CableType;
  a: LinkEndpoint;
  b: LinkEndpoint;
  status: LinkStatus;
  activity: boolean;
  dceEndpoint?: "a" | "b";
}

export interface UserCreatedPdu {
  id: string;
  sourceDeviceId: string;
  destinationDeviceId: string;
  protocol: "ICMP" | "DHCP" | "DNS" | "HTTP";
  color: string;
  scheduledTime: number;
  periodic: boolean;
  lastStatus: EventStatus;
}

export interface OsiLayerTrace {
  layer: number;
  name: string;
  direction: "in" | "out";
  action: "encapsulate" | "de-encapsulate" | "transfer" | "accept" | "queue" | "drop" | "transmit";
  detail: string;
}

export interface SimulationEvent {
  id: string;
  time: number;
  visible: boolean;
  lastDeviceId?: string;
  atDeviceId: string;
  type: string;
  summary: string;
  status: EventStatus;
  layers: OsiLayerTrace[];
  details: Record<string, string>;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  pdus: UserCreatedPdu[];
}

export interface ProjectSimulation {
  mode: SimulationMode;
  time: number;
  activeScenarioId: string;
  scenarios: SimulationScenario[];
  events: SimulationEvent[];
  selectedEventId?: string;
}

export interface NetworkProject {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  devices: NetworkDevice[];
  links: NetworkLink[];
  simulation: ProjectSimulation;
  createdAt: string;
  updatedAt: string;
}

export interface AppUser {
  id: string;
  name: string;
  username: string;
  email: string;
  birthDate: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface AuthSession {
  userId: string;
  username: string;
  signedInAt: string;
}

export interface DeviceSpec {
  id: string;
  type: DeviceType;
  modelName: string;
  displayName: string;
  icon: string;
  accent: string;
  shape: "router" | "switch" | "firewall" | "pc" | "server" | "wireless" | "hub";
  ports: Array<Pick<NetworkPort, "name" | "kind" | "bandwidthMbps" | "mode" | "vlan"> & { requiredModule?: string }>;
  moduleSlots: Array<Omit<ModuleSlot, "id">>;
}
