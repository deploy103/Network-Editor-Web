export type DeviceKind = "router" | "switch" | "firewall" | "pc" | "server" | "wireless" | "hub";
export type PortKind = "ethernet" | "fast-ethernet" | "gigabit-ethernet" | "serial" | "console" | "fiber" | "wireless";
export type PortMediaSelection = "auto" | "rj45" | "sfp";
export type PortMode = "access" | "trunk" | "routed";
export type CableType = "auto" | "console" | "copper-straight" | "copper-cross" | "fiber" | "serial-dce" | "serial-dte" | "wireless";
export type LinkStatus = "up" | "down" | "blocked";
export type DeviceTab = "physical" | "config" | "cli" | "desktop" | "services";
export type TransceiverMedia = "copper" | "mmf" | "smf";

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
  softwareVersion?: string;
  softwareTrain?: string;
  iosImage?: string;
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
  widthSlots?: number;
}

export interface TransceiverSpec {
  id: string;
  label: string;
  media: TransceiverMedia;
  compatibleMedia?: TransceiverMedia[];
  speedMbps: number;
  maxDistanceMeters: number;
  connector: string;
}

export interface PortTemplate {
  name: string;
  kind: PortKind;
  mode: PortMode;
  vlan?: number;
  ipCapable?: boolean;
  mediaOptions?: PortKind[];
  activeMedia?: PortKind;
  mediaSelection?: PortMediaSelection;
  transceiverId?: string;
}

export interface NetworkPort {
  id: string;
  name: string;
  kind: PortKind;
  mediaOptions?: PortKind[];
  activeMedia?: PortKind;
  mediaSelection?: PortMediaSelection;
  transceiverId?: string;
  description: string;
  macAddress: string;
  mode: PortMode;
  vlan: number;
  allowedVlans: number[];
  nativeVlan?: number;
  ipAddress: string;
  subnetMask: string;
  secondaryIpAddresses?: Array<{ ipAddress: string; subnetMask: string }>;
  parentPortId?: string;
  subinterfaceVlan?: number;
  encapsulationDot1qNative?: boolean;
  gateway: string;
  dnsServer: string;
  adminUp: boolean;
  ipCapable?: boolean;
  stpPortfast?: boolean;
  bpduGuard?: boolean;
  stpCost?: number;
  stpPriority?: number;
  cdpEnabled?: boolean;
  lldpTransmit?: boolean;
  lldpReceive?: boolean;
  dhcpSnoopingTrusted?: boolean;
  dhcpSnoopingRateLimit?: number;
  voiceVlan?: number;
  portSecurity?: {
    enabled: boolean;
    maximum: number;
    violation: "protect" | "restrict" | "shutdown";
    sticky: boolean;
    secureMacAddresses: string[];
  };
  channelGroup?: {
    id: number;
    mode: "on" | "active" | "passive" | "desirable" | "auto";
  };
  accessGroupIn?: string;
  accessGroupOut?: string;
  policyRouteMap?: string;
  helperAddresses?: string[];
  natRole?: "inside" | "outside";
  hsrpGroups?: Array<{
    group: number;
    virtualIp: string;
    priority: number;
    preempt: boolean;
    version: "1" | "2";
    trackInterface?: string;
    trackObject?: number;
    trackDecrement?: number;
  }>;
  vrrpGroups?: Array<{
    group: number;
    virtualIp: string;
    priority: number;
    preempt: boolean;
    version: "2" | "3";
    advertiseInterval: number;
    trackObject?: number;
    trackDecrement?: number;
  }>;
  switchportNonegotiate?: boolean;
  linkId?: string;
  moduleSlotId?: string;
  moduleId?: string;
  clockRate?: number;
  duplex?: "auto" | "full" | "half";
  speed?: string;
  mtu?: number;
  bandwidth?: number;
}

export interface DeviceModule {
  slotId: string;
  moduleId: string;
  occupiedSlotIds?: string[];
}

export interface StaticRoute {
  id: string;
  network: string;
  mask: string;
  nextHop: string;
  distance?: number;
  trackId?: number;
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
  protocol: "ip" | "icmp" | "tcp" | "udp" | "http" | "ftp" | "dns" | "dhcp";
  source: string;
  destination: string;
  interfaceName: string;
  listName?: string;
  listType?: "standard" | "extended";
  sequence?: number;
  remark?: string;
  hits: number;
}

export interface NatRule {
  id: string;
  insideLocal: string;
  insideGlobal: string;
  outsideInterface: string;
  type?: "static" | "overload";
  aclName?: string;
  interfaceName?: string;
  overload?: boolean;
  hits: number;
}

export interface RouteMapEntry {
  id: string;
  name: string;
  sequence: number;
  action: "permit" | "deny";
  description?: string;
  matchAccessLists: string[];
  matchPrefixLists?: string[];
  setNextHop?: string;
  hits: number;
}

export interface PrefixListEntry {
  id: string;
  name: string;
  sequence: number;
  action: "permit" | "deny";
  prefix: string;
  ge?: number;
  le?: number;
  hits: number;
}

export interface IpSlaOperation {
  id: string;
  operationId: number;
  type: "icmp-echo";
  targetIp: string;
  sourceInterface?: string;
  frequency: number;
  timeout: number;
  threshold: number;
  enabled: boolean;
}

export interface TrackObject {
  id: string;
  trackId: number;
  type: "interface" | "ip-sla";
  interfaceName?: string;
  ipSlaOperationId?: number;
  mode: "line-protocol" | "reachability";
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
  nameServers: string[];
  accessRules: AccessRule[];
  natRules: NatRule[];
  prefixLists?: PrefixListEntry[];
  routeMaps?: RouteMapEntry[];
  ipSlaOperations?: IpSlaOperation[];
  trackObjects?: TrackObject[];
  stpRootPrimaryVlans: number[];
  stpRootSecondaryVlans: number[];
  stpMode?: "pvst" | "rapid-pvst";
  errdisableRecovery?: { bpduguard: boolean; interval: number };
  cdp?: { enabled: boolean; timer: number; holdtime: number; version: "1" | "2" };
  lldp?: { enabled: boolean; timer: number; holdtime: number; reinitDelay: number };
  dhcpSnooping?: { enabled: boolean; vlans: number[]; verifyMacAddress: boolean };
  vtp?: {
    mode: "server" | "client" | "transparent" | "off";
    domain: string;
    version: "1" | "2" | "3";
    password?: string;
    pruning: boolean;
    revision: number;
  };
  localUsers?: Array<{ id: string; name: string; secret?: string; password?: string; privilege?: number }>;
  lineConfigs?: Array<{ id: string; kind: "console" | "vty"; range: string; password: string; login: boolean; loginLocal?: boolean; transportInput: string; execTimeout: string; loggingSynchronous: boolean }>;
  routingProtocols?: Array<{ id: string; protocol: "rip" | "ospf" | "eigrp"; processId?: string; networks: string[]; version?: string; routerId?: string; autoSummary: boolean; passiveInterfaces: string[]; passiveInterfaceDefault?: boolean; passiveInterfaceExceptions?: string[]; redistributeStatic: boolean; defaultInformationOriginate?: boolean; defaultInformationAlways?: boolean }>;
  services: {
    http: boolean;
    ftp: boolean;
    email: boolean;
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
  natTranslations?: Array<{ protocol: string; insideLocal: string; insideGlobal: string; outsideLocal: string; outsideGlobal: string; interfaceName: string; hits: number; createdAt: number }>;
  logs: Array<{ id: string; level: "info" | "warning" | "error"; message: string; createdAt: number }>;
  clock?: string;
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
  headers?: Array<{ layer: string; field: string; value: string }>;
}

export type WorkspaceNoteColor = "yellow" | "blue" | "green" | "rose";
export type WorkspaceDrawingKind = "rectangle" | "ellipse" | "line" | "freehand";
export type WorkspaceDrawingColor = "amber" | "blue" | "green" | "rose";

export interface WorkspaceNote {
  id: string;
  text: string;
  position: Position;
  color: WorkspaceNoteColor;
}

export interface WorkspaceDrawing {
  id: string;
  kind: WorkspaceDrawingKind;
  label: string;
  position: Position;
  width: number;
  height: number;
  points?: Position[];
  color: WorkspaceDrawingColor;
  strokeStyle: "solid" | "dashed";
  fill: boolean;
}

export type ActivityRequirementKind =
  | "device-count"
  | "link-count"
  | "annotation-count"
  | "delivered-pdu-count"
  | "saved-config-count"
  | "service-count"
  | "tdr-normal-count"
  | "vlan-count"
  | "trunk-port-count"
  | "routed-port-count"
  | "svi-count"
  | "static-route-count"
  | "dynamic-routing-count"
  | "acl-rule-count"
  | "nat-rule-count"
  | "prefix-list-count"
  | "pbr-route-map-count"
  | "dhcp-pool-count"
  | "dhcp-snooping-device-count"
  | "port-security-port-count"
  | "etherchannel-port-count"
  | "first-hop-redundancy-count"
  | "wireless-infrastructure-count"
  | "wireless-client-count"
  | "ip-sla-track-count";

export interface ActivityRequirement {
  id: string;
  kind: ActivityRequirementKind;
  label: string;
  target: number;
  points: number;
}

export interface ActivityAnswerSnapshot {
  capturedAt: string;
  devices: Array<{ id: string; label: string; kind: DeviceKind; model: string }>;
  links: Array<{ id: string; type: CableType; endpointADeviceId: string; endpointBDeviceId: string }>;
  annotationCount: number;
  serviceDeviceIds: string[];
  startupConfigDeviceIds: string[];
}

export interface ActivityCommandRule {
  id: string;
  label: string;
  deviceId?: string;
  command: string;
  points: number;
}

export interface ActivityCommandSequence {
  id: string;
  label: string;
  deviceId?: string;
  commands: string[];
  points: number;
}

export interface ActivityCommandOutputAssertion {
  id: string;
  label: string;
  deviceId?: string;
  commands: string[];
  expectedText: string;
  points: number;
}

export interface ActivityInterfaceExpectation {
  id: string;
  label: string;
  deviceId: string;
  portId: string;
  ipAddress?: string;
  subnetMask?: string;
  mode?: PortMode;
  vlan?: number;
  points: number;
}

export interface ActivityHeaderAssertion {
  id: string;
  label: string;
  protocol?: string;
  field: string;
  value: string;
  points: number;
}

export interface ActivitySpec {
  title: string;
  objectives: string[];
  requirements: ActivityRequirement[];
  answerSnapshot?: ActivityAnswerSnapshot;
  commandRules?: ActivityCommandRule[];
  commandSequences?: ActivityCommandSequence[];
  commandOutputAssertions?: ActivityCommandOutputAssertion[];
  interfaceExpectations?: ActivityInterfaceExpectation[];
  headerAssertions?: ActivityHeaderAssertion[];
}

export interface NetworkProject {
  id: string;
  ownerId: string;
  name: string;
  devices: NetworkDevice[];
  links: NetworkLink[];
  notes?: WorkspaceNote[];
  drawings?: WorkspaceDrawing[];
  activity?: ActivitySpec;
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
