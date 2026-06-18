export type DeviceKind = "router" | "switch" | "firewall" | "pc" | "server" | "wireless" | "hub";
export type PortKind = "ethernet" | "fast-ethernet" | "gigabit-ethernet" | "serial" | "console" | "fiber" | "wireless";
export type PortMode = "access" | "trunk" | "routed";
export type CableType = "auto" | "console" | "copper-straight" | "copper-cross" | "fiber" | "serial-dce" | "serial-dte" | "wireless";
export type LinkStatus = "up" | "down" | "blocked";
export type DeviceTab = "physical" | "config" | "cli" | "desktop" | "services";

export interface Position {
  x: number;
  y: number;
}

export interface DeviceModel {
  id: string;
  kind: DeviceKind;
  model: string;
  labelPrefix: string;
  description: string;
  tabs: DeviceTab[];
  ports: PortTemplate[];
  modules: ModuleSlot[];
}

export interface ModuleSlot {
  id: string;
  label: string;
  accepts: string[];
}

export interface ModuleSpec {
  id: string;
  label: string;
  description: string;
  ports: PortTemplate[];
}

export interface PortTemplate {
  name: string;
  kind: PortKind;
  mode: PortMode;
  vlan?: number;
  ipCapable?: boolean;
}

export interface NetworkPort {
  id: string;
  name: string;
  kind: PortKind;
  description: string;
  macAddress: string;
  mode: PortMode;
  vlan: number;
  allowedVlans: number[];
  nativeVlan?: number;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  dnsServer: string;
  adminUp: boolean;
  ipCapable?: boolean;
  stpPortfast?: boolean;
  bpduGuard?: boolean;
  accessGroupIn?: string;
  accessGroupOut?: string;
  natRole?: "inside" | "outside";
  linkId?: string;
  moduleSlotId?: string;
  moduleId?: string;
  clockRate?: number;
}

export interface DeviceModule {
  slotId: string;
  moduleId: string;
}

export interface StaticRoute {
  id: string;
  network: string;
  mask: string;
  nextHop: string;
}

export interface DhcpPool {
  id: string;
  name: string;
  network: string;
  mask: string;
  defaultGateway: string;
  dnsServer: string;
  startIp: string;
  maxLeases: number;
  enabled: boolean;
}

export interface DnsRecord {
  id: string;
  name: string;
  value: string;
}

export interface DhcpExcludedRange {
  id: string;
  startIp: string;
  endIp?: string;
}

export interface AccessRule {
  id: string;
  action: "permit" | "deny";
  protocol: "ip" | "icmp" | "tcp" | "udp" | "http" | "dns" | "dhcp";
  source: string;
  destination: string;
  interfaceName: string;
  listName?: string;
  listType?: "standard" | "extended";
  hits: number;
}

export interface NatRule {
  id: string;
  insideLocal: string;
  insideGlobal: string;
  outsideInterface: string;
  hits: number;
}

export interface DeviceConfig {
  hostname: string;
  startupConfig: string[];
  enableSecret?: string;
  enablePassword?: string;
  motdBanner?: string;
  domainLookup?: boolean;
  domainName?: string;
  sshVersion?: "1" | "2";
  rsaKeyGenerated?: boolean;
  passwordEncryption?: boolean;
  defaultGateway?: string;
  logging?: { console: boolean; buffered: boolean; hosts: string[]; trap: string };
  staticRoutes: StaticRoute[];
  vlans: Array<{ id: number; name: string }>;
  dhcpPools: DhcpPool[];
  dhcpExcludedRanges?: DhcpExcludedRange[];
  dnsRecords: DnsRecord[];
  accessRules: AccessRule[];
  natRules: NatRule[];
  localUsers?: Array<{ id: string; name: string; secret?: string; password?: string; privilege?: number }>;
  lineConfigs?: Array<{ id: string; kind: "console" | "vty"; range: string; password: string; login: boolean; loginLocal?: boolean; transportInput: string; execTimeout: string; loggingSynchronous: boolean }>;
  routingProtocols?: Array<{ id: string; protocol: "rip" | "ospf" | "eigrp"; processId?: string; networks: string[]; version?: string; routerId?: string; autoSummary: boolean; passiveInterfaces: string[]; redistributeStatic: boolean }>;
  services: {
    http: boolean;
    dhcp: boolean;
    dns: boolean;
    tftp: boolean;
    syslog: boolean;
  };
  wireless: {
    ssid: string;
    auth: "open" | "wpa2-psk";
    key: string;
    channel: number;
    range: number;
  };
}

export interface RuntimeState {
  arpTable: Array<{ ipAddress: string; macAddress: string; portName: string }>;
  macTable: Array<{ vlan: number; macAddress: string; portName: string; type: "dynamic" | "static" }>;
  dhcpLeases: Array<{ ipAddress: string; macAddress: string; deviceId: string; expiresAt: number }>;
  logs: Array<{ id: string; level: "info" | "warning" | "error"; message: string; createdAt: number }>;
}

export interface NetworkDevice {
  id: string;
  kind: DeviceKind;
  modelId: string;
  model: string;
  label: string;
  position: Position;
  powerOn: boolean;
  ports: NetworkPort[];
  modules: DeviceModule[];
  config: DeviceConfig;
  runtime: RuntimeState;
}

export interface NetworkLink {
  id: string;
  type: CableType;
  endpointA: { deviceId: string; portId: string };
  endpointB: { deviceId: string; portId: string };
  status: LinkStatus;
  dceEndpoint?: "A" | "B";
  createdAt: number;
}

export interface SimulationEvent {
  id: string;
  time: number;
  lastDeviceId: string;
  atDeviceId: string;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  packetId?: string;
  type: string;
  info: string;
  status: "forwarded" | "delivered" | "dropped";
  osiLayers: string[];
}

export interface NetworkProject {
  id: string;
  ownerId: string;
  name: string;
  devices: NetworkDevice[];
  links: NetworkLink[];
  simulationEvents: SimulationEvent[];
  updatedAt: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  birthDate: string;
}
