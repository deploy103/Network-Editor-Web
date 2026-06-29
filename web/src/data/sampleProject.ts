import { createDevice } from "./deviceCatalog";
import { type SampleProjectTemplateId } from "./sampleProjectTemplates";
import { addLink, recalc, validateConnection } from "../engine/topology";
import type { NetworkDevice, NetworkPort, NetworkProject } from "../types/network";
import { createId } from "../utils/id";

export { sampleProjectTemplates, type SampleProjectTemplateId } from "./sampleProjectTemplates";
type SampleActivityRequirement = { kind: NonNullable<NonNullable<NetworkProject["activity"]>["requirements"]>[number]["kind"]; label: string; target: number; points: number };

export function createSampleProjectFromTemplate(ownerId: string, templateId: SampleProjectTemplateId = "routed-services"): NetworkProject {
  if (templateId === "ospf-campus") return createOspfCampusSampleProject(ownerId);
  if (templateId === "dual-wan-pbr") return createDualWanPbrSampleProject(ownerId);
  if (templateId === "firewall-dmz") return createFirewallDmzSampleProject(ownerId);
  if (templateId === "wireless-campus") return createWirelessCampusSampleProject(ownerId);
  return createRoutedSampleProject(ownerId);
}

export function createRoutedSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const pc = createDevice("pc-pt", { x: 130, y: 260 }, []);
  const switchDevice = createDevice("switch-2960-24tt", { x: 360, y: 250 }, [pc]);
  const router = createDevice("router-1941", { x: 610, y: 240 }, [pc, switchDevice]);
  const server = createDevice("server-pt", { x: 870, y: 250 }, [pc, switchDevice, router]);

  const configuredPc = updatePortByName(pc, "FastEthernet0", { ipAddress: "192.168.10.10", subnetMask: "255.255.255.0", gateway: "192.168.10.1", dnsServer: "10.10.10.10" });
  const configuredRouter = updatePortByIndex(
    updatePortByIndex(router, 0, { ipAddress: "192.168.10.1", subnetMask: "255.255.255.0", mode: "routed", helperAddresses: ["10.10.10.10"] }),
    1,
    { ipAddress: "10.10.10.1", subnetMask: "255.255.255.0", mode: "routed" }
  );
  const configuredServer = {
    ...updatePortByName(server, "FastEthernet0", { ipAddress: "10.10.10.10", subnetMask: "255.255.255.0", gateway: "10.10.10.1", dnsServer: "10.10.10.10" }),
    config: {
      ...server.config,
      services: { ...server.config.services, http: true, ftp: true, email: true, dhcp: true, dns: true, tftp: true, syslog: true },
      dhcpPools: [{
        id: createId("pool"),
        name: "USERS",
        network: "192.168.10.0",
        mask: "255.255.255.0",
        defaultGateway: "192.168.10.1",
        dnsServer: "10.10.10.10",
        startIp: "192.168.10.100",
        maxLeases: 50,
        enabled: true
      }],
      dhcpExcludedRanges: [{ id: createId("dhcp_exclude"), startIp: "192.168.10.1", endIp: "192.168.10.20" }],
      dnsRecords: [{ id: createId("dns"), name: "www.lab.local", value: "10.10.10.10" }]
    }
  };

  let project: NetworkProject = {
    id: createId("project"),
    ownerId,
    name: "라우팅 HTTP 샘플",
    devices: [configuredPc, switchDevice, configuredRouter, configuredServer],
    links: [],
    notes: [{ id: createId("note"), text: "HTTP/DNS/DHCP 라우팅 샘플", position: { x: 120, y: 130 }, color: "blue" }],
    drawings: [{ id: createId("draw"), kind: "rectangle", label: "Server services zone", position: { x: 700, y: 118 }, width: 300, height: 178, color: "green", strokeStyle: "dashed", fill: true }],
    activity: {
      title: "Routed Services Lab",
      objectives: [
        "Build a routed PC-to-server topology with DNS, DHCP, HTTP, FTP, EMAIL, TFTP, and SYSLOG services.",
        "Document the server services zone and verify traffic with PDU events."
      ],
      requirements: [
        { id: createId("act_req"), kind: "device-count", label: "At least four devices", target: 4, points: 10 },
        { id: createId("act_req"), kind: "link-count", label: "At least three links", target: 3, points: 10 },
        { id: createId("act_req"), kind: "annotation-count", label: "At least two workspace annotations", target: 2, points: 5 },
        { id: createId("act_req"), kind: "tdr-normal-count", label: "Three normal copper TDR links", target: 3, points: 5 },
        { id: createId("act_req"), kind: "service-count", label: "At least one service device", target: 1, points: 5 }
      ],
      commandOutputAssertions: [
        {
          id: createId("act_cli"),
          label: "Router show version output",
          deviceId: configuredRouter.id,
          commands: ["enable", "show version"],
          expectedText: "Configuration register",
          points: 5
        }
      ],
      headerAssertions: [
        {
          id: createId("act_hdr"),
          label: "HTTP destination port header",
          protocol: "HTTP",
          field: "Destination port",
          value: "80",
          points: 5
        }
      ]
    },
    simulationEvents: [],
    createdAt: now,
    updatedAt: now
  };
  project = connect(project, configuredPc.id, switchDevice.id);
  project = connect(project, switchDevice.id, configuredRouter.id);
  project = connect(project, configuredRouter.id, configuredServer.id);
  return recalc(project);
}

function createOspfCampusSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const userPc = createDevice("pc-pt", { x: 90, y: 320 }, []);
  const voicePc = createDevice("laptop-pt", { x: 90, y: 470 }, [userPc]);
  const accessSwitch = createDevice("switch-9200l-24p-4g", { x: 330, y: 390 }, [userPc, voicePc]);
  const distA = createDevice("switch-9300-24t", { x: 590, y: 300 }, [userPc, voicePc, accessSwitch]);
  const distB = createDevice("switch-9300-24t", { x: 590, y: 500 }, [userPc, voicePc, accessSwitch, distA]);
  const edge = createDevice("router-c1111-4p", { x: 850, y: 390 }, [userPc, voicePc, accessSwitch, distA, distB]);
  const services = createDevice("server-pt", { x: 1090, y: 390 }, [userPc, voicePc, accessSwitch, distA, distB, edge]);

  const configuredUserPc = updatePortByName(userPc, "FastEthernet0", { ipAddress: "10.10.10.51", subnetMask: "255.255.255.0", gateway: "10.10.10.1", dnsServer: "10.20.20.10" });
  const configuredVoicePc = updatePortByName(voicePc, "FastEthernet0", { ipAddress: "10.10.20.51", subnetMask: "255.255.255.0", gateway: "10.10.20.1", dnsServer: "10.20.20.10" });
  const configuredAccess = {
    ...accessSwitch,
    config: {
      ...accessSwitch.config,
      hostname: "ACCESS-9200L",
      vlans: [{ id: 1, name: "default" }, { id: 10, name: "USERS" }, { id: 20, name: "VOICE" }, { id: 99, name: "NATIVE" }],
      dhcpSnooping: { enabled: true, vlans: [10, 20], verifyMacAddress: true },
      vtp: { mode: "transparent" as const, domain: "CAMPUS", version: "2" as const, pruning: false, revision: 0 }
    },
    ports: accessSwitch.ports.map((port) => {
      if (port.name === "GigabitEthernet1/0/1") return { ...port, mode: "access" as const, vlan: 10, voiceVlan: 20, stpPortfast: true, bpduGuard: true };
      if (port.name === "GigabitEthernet1/0/2") return { ...port, mode: "access" as const, vlan: 20, stpPortfast: true, bpduGuard: true };
      if (port.name.startsWith("GigabitEthernet1/1/")) return { ...port, mode: "trunk" as const, allowedVlans: [10, 20, 99], nativeVlan: 99, dhcpSnoopingTrusted: true };
      return port;
    })
  };
  const configuredDistA = campusDistributionSwitch(distA, "DIST-A", "10.255.0.1", "10.10.10.1", "10.10.20.1", "10.20.20.2");
  const configuredDistB = campusDistributionSwitch(distB, "DIST-B", "10.255.0.2", "10.10.10.2", "10.10.20.2", "10.20.20.3");
  const configuredEdge = {
    ...updatePortByIndex(edge, 0, { ipAddress: "10.20.20.1", subnetMask: "255.255.255.0", mode: "routed" }),
    config: {
      ...edge.config,
      hostname: "EDGE-C1111",
      routingProtocols: [{
        id: createId("routing"),
        protocol: "ospf" as const,
        processId: "10",
        networks: ["10.20.20.0 0.0.0.255"],
        routerId: "10.255.0.254",
        autoSummary: false,
        passiveInterfaces: [],
        passiveInterfaceDefault: false,
        passiveInterfaceExceptions: [],
        redistributeStatic: true,
        defaultInformationOriginate: true,
        defaultInformationAlways: false
      }]
    }
  };
  const configuredServices = {
    ...updatePortByName(services, "FastEthernet0", { ipAddress: "10.20.20.10", subnetMask: "255.255.255.0", gateway: "10.20.20.1", dnsServer: "10.20.20.10" }),
    config: {
      ...services.config,
      services: { ...services.config.services, http: true, dns: true, dhcp: true, syslog: true },
      dhcpPools: [
        { id: createId("pool"), name: "USERS", network: "10.10.10.0", mask: "255.255.255.0", defaultGateway: "10.10.10.1", dnsServer: "10.20.20.10", startIp: "10.10.10.100", maxLeases: 80, enabled: true },
        { id: createId("pool"), name: "VOICE", network: "10.10.20.0", mask: "255.255.255.0", defaultGateway: "10.10.20.1", dnsServer: "10.20.20.10", startIp: "10.10.20.100", maxLeases: 80, enabled: true }
      ],
      dnsRecords: [{ id: createId("dns"), name: "intranet.campus.local", value: "10.20.20.10" }]
    }
  };

  let project = baseProject(ownerId, now, "OSPF 캠퍼스 샘플", [configuredUserPc, configuredVoicePc, configuredAccess, configuredDistA, configuredDistB, configuredEdge, configuredServices], [
    "Configure access VLANs, trusted uplinks, and OSPF between distribution and edge layers.",
    "Verify default route propagation and DHCP helper reachability."
  ], [
    { kind: "vlan-count", label: "Campus VLANs", target: 3, points: 5 },
    { kind: "trunk-port-count", label: "Redundant trunk uplinks", target: 2, points: 5 },
    { kind: "dynamic-routing-count", label: "OSPF routing processes", target: 3, points: 10 },
    { kind: "dhcp-snooping-device-count", label: "Access DHCP Snooping", target: 1, points: 5 },
    { kind: "dhcp-pool-count", label: "User and voice DHCP pools", target: 2, points: 5 },
    { kind: "routed-port-count", label: "Layer 3 routed interfaces", target: 5, points: 5 }
  ]);
  project = connect(project, configuredUserPc.id, configuredAccess.id);
  project = connect(project, configuredVoicePc.id, configuredAccess.id);
  project = connect(project, configuredAccess.id, configuredDistA.id);
  project = connect(project, configuredAccess.id, configuredDistB.id);
  project = connect(project, configuredDistA.id, configuredEdge.id);
  project = connect(project, configuredDistB.id, configuredEdge.id);
  project = connect(project, configuredEdge.id, configuredServices.id);
  return recalc(project);
}

function createDualWanPbrSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const client = createDevice("pc-pt", { x: 90, y: 360 }, []);
  const branch = createDevice("router-2911", { x: 330, y: 360 }, [client]);
  const primary = createDevice("router-csr1000v", { x: 590, y: 260 }, [client, branch]);
  const backup = createDevice("router-csr1000v", { x: 590, y: 470 }, [client, branch, primary]);
  const appServer = createDevice("server-pt", { x: 860, y: 470 }, [client, branch, primary, backup]);

  const configuredClient = updatePortByName(client, "FastEthernet0", { ipAddress: "172.16.10.10", subnetMask: "255.255.255.0", gateway: "172.16.10.1", dnsServer: "10.50.50.10" });
  const configuredBranch = {
    ...updatePortByIndex(updatePortByIndex(updatePortByIndex(branch, 0, { ipAddress: "172.16.10.1", subnetMask: "255.255.255.0", mode: "routed", policyRouteMap: "PBR-APP" }), 1, { ipAddress: "192.0.2.2", subnetMask: "255.255.255.252", mode: "routed" }), 2, { ipAddress: "198.51.100.2", subnetMask: "255.255.255.252", mode: "routed" }),
    config: {
      ...branch.config,
      hostname: "BRANCH-PBR",
      prefixLists: [{ id: createId("plist"), name: "APP-NET", sequence: 5, action: "permit" as const, prefix: "10.50.50.0/24", hits: 0 }],
      routeMaps: [{ id: createId("rmap"), name: "PBR-APP", sequence: 10, action: "permit" as const, matchAccessLists: [], matchPrefixLists: ["APP-NET"], setNextHop: "198.51.100.1", hits: 0 }],
      ipSlaOperations: [{ id: createId("sla"), operationId: 10, type: "icmp-echo" as const, targetIp: "192.0.2.1", sourceInterface: "GigabitEthernet0/1", frequency: 10, timeout: 1000, threshold: 1000, enabled: true }],
      trackObjects: [{ id: createId("track"), trackId: 10, type: "ip-sla" as const, ipSlaOperationId: 10, mode: "reachability" as const }],
      staticRoutes: [
        { id: createId("route"), network: "0.0.0.0", mask: "0.0.0.0", nextHop: "192.0.2.1", distance: 1, trackId: 10 },
        { id: createId("route"), network: "0.0.0.0", mask: "0.0.0.0", nextHop: "198.51.100.1", distance: 200 }
      ]
    }
  };
  const configuredPrimary = updatePortByIndex(updatePortByIndex(primary, 0, { ipAddress: "192.0.2.1", subnetMask: "255.255.255.252", mode: "routed" }), 1, { ipAddress: "10.50.50.1", subnetMask: "255.255.255.0", mode: "routed" });
  const configuredBackup = updatePortByIndex(updatePortByIndex(backup, 0, { ipAddress: "198.51.100.1", subnetMask: "255.255.255.252", mode: "routed" }), 1, { ipAddress: "10.50.50.2", subnetMask: "255.255.255.0", mode: "routed" });
  const configuredServer = {
    ...updatePortByName(appServer, "FastEthernet0", { ipAddress: "10.50.50.10", subnetMask: "255.255.255.0", gateway: "10.50.50.1", dnsServer: "10.50.50.10" }),
    config: { ...appServer.config, services: { ...appServer.config.services, http: true, dns: true, syslog: true }, dnsRecords: [{ id: createId("dns"), name: "app.branch.local", value: "10.50.50.10" }] }
  };

  let project = baseProject(ownerId, now, "Dual-WAN PBR 샘플", [configuredClient, configuredBranch, configuredPrimary, configuredBackup, configuredServer], [
    "Use policy-based routing for application prefixes and keep a tracked primary default route.",
    "Fail over to the backup next-hop when IP SLA reachability goes down."
  ], [
    { kind: "prefix-list-count", label: "Application prefix-list", target: 1, points: 5 },
    { kind: "pbr-route-map-count", label: "PBR route-map", target: 1, points: 10 },
    { kind: "ip-sla-track-count", label: "IP SLA tracked reachability", target: 1, points: 10 },
    { kind: "static-route-count", label: "Tracked and floating static routes", target: 2, points: 5 },
    { kind: "routed-port-count", label: "WAN routed interfaces", target: 5, points: 5 }
  ]);
  project = connect(project, configuredClient.id, configuredBranch.id);
  project = connect(project, configuredBranch.id, configuredPrimary.id);
  project = connect(project, configuredBranch.id, configuredBackup.id);
  project = connect(project, configuredPrimary.id, configuredServer.id);
  project = connect(project, configuredBackup.id, configuredServer.id);
  return recalc(project);
}

function createFirewallDmzSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const insidePc = createDevice("pc-pt", { x: 90, y: 380 }, []);
  const insideSwitch = createDevice("switch-9200l-24t-4g", { x: 300, y: 380 }, [insidePc]);
  const firewall = createDevice("firewall-fpr1010", { x: 530, y: 380 }, [insidePc, insideSwitch]);
  const dmzServer = createDevice("server-pt", { x: 760, y: 270 }, [insidePc, insideSwitch, firewall]);
  const internet = createDevice("server-pt", { x: 760, y: 500 }, [insidePc, insideSwitch, firewall, dmzServer]);
  const configuredInsidePc = updatePortByName(insidePc, "FastEthernet0", { ipAddress: "10.30.10.20", subnetMask: "255.255.255.0", gateway: "10.30.10.1", dnsServer: "10.30.20.10" });
  const configuredFirewall = {
    ...updatePortByIndex(updatePortByIndex(updatePortByIndex(firewall, 0, { ipAddress: "10.30.10.1", subnetMask: "255.255.255.0", mode: "routed", natRole: "inside" }), 1, { ipAddress: "10.30.20.1", subnetMask: "255.255.255.0", mode: "routed" }), 2, { ipAddress: "203.0.113.2", subnetMask: "255.255.255.252", mode: "routed", natRole: "outside" }),
    config: {
      ...firewall.config,
      hostname: "FPR-DMZ",
      accessRules: [
        { id: createId("acl"), action: "permit" as const, protocol: "http" as const, source: "any", destination: "host 10.30.20.10", interfaceName: "OUTSIDE-IN", listName: "OUTSIDE-IN", listType: "extended" as const, sequence: 10, hits: 0 },
        { id: createId("acl"), action: "permit" as const, protocol: "dns" as const, source: "10.30.10.0 0.0.0.255", destination: "host 10.30.20.10", interfaceName: "INSIDE-DNS", listName: "INSIDE-DNS", listType: "extended" as const, sequence: 10, hits: 0 }
      ],
      natRules: [
        { id: createId("nat"), insideLocal: "10.30.20.10", insideGlobal: "203.0.113.10", outsideInterface: "Ethernet1/3", type: "static" as const, hits: 0 },
        { id: createId("nat"), insideLocal: "list INSIDE-DNS", insideGlobal: "interface Ethernet1/3", outsideInterface: "Ethernet1/3", type: "overload" as const, aclName: "INSIDE-DNS", interfaceName: "Ethernet1/3", overload: true, hits: 0 }
      ],
      staticRoutes: [{ id: createId("route"), network: "0.0.0.0", mask: "0.0.0.0", nextHop: "203.0.113.1" }]
    }
  };
  const configuredDmz = {
    ...updatePortByName(dmzServer, "FastEthernet0", { ipAddress: "10.30.20.10", subnetMask: "255.255.255.0", gateway: "10.30.20.1", dnsServer: "10.30.20.10" }),
    config: { ...dmzServer.config, services: { ...dmzServer.config.services, http: true, dns: true, syslog: true }, dnsRecords: [{ id: createId("dns"), name: "dmz.branch.local", value: "10.30.20.10" }] }
  };
  const configuredInternet = updatePortByName(internet, "FastEthernet0", { ipAddress: "203.0.113.1", subnetMask: "255.255.255.252", gateway: "203.0.113.2", dnsServer: "10.30.20.10" });
  let project = baseProject(ownerId, now, "방화벽 DMZ 샘플", [configuredInsidePc, insideSwitch, configuredFirewall, configuredDmz, configuredInternet], [
    "Separate inside, DMZ, and outside zones with routed firewall interfaces.",
    "Publish a DMZ web server with static NAT and restrict inbound traffic with ACLs."
  ], [
    { kind: "acl-rule-count", label: "Inside and outside ACL rules", target: 2, points: 5 },
    { kind: "nat-rule-count", label: "Static and overload NAT rules", target: 2, points: 10 },
    { kind: "static-route-count", label: "Outside default route", target: 1, points: 5 },
    { kind: "routed-port-count", label: "Firewall routed zones", target: 3, points: 5 }
  ]);
  project = connect(project, configuredInsidePc.id, insideSwitch.id);
  project = connect(project, insideSwitch.id, configuredFirewall.id);
  project = connect(project, configuredFirewall.id, configuredDmz.id);
  project = connect(project, configuredFirewall.id, configuredInternet.id);
  return recalc(project);
}

function createWirelessCampusSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const controller = createDevice("wlc-9800-l", { x: 280, y: 260 }, []);
  const core = createDevice("switch-9300-24p", { x: 520, y: 260 }, [controller]);
  const ap = createDevice("ap-catalyst-9120axi", { x: 760, y: 180 }, [controller, core]);
  const laptop = createDevice("laptop-pt", { x: 970, y: 180 }, [controller, core, ap]);
  const services = createDevice("server-pt", { x: 760, y: 390 }, [controller, core, ap, laptop]);
  const configuredController = updatePortByName(controller, "TenGigabitEthernet0/0/0", { ipAddress: "10.60.0.5", subnetMask: "255.255.255.0", gateway: "10.60.0.1", dnsServer: "10.60.0.10" });
  const configuredCore = {
    ...updatePortByName(core, "Vlan1", { ipAddress: "10.60.0.1", subnetMask: "255.255.255.0", mode: "routed" }),
    config: { ...core.config, hostname: "WLAN-CORE", vlans: [{ id: 1, name: "MGMT" }, { id: 60, name: "WLAN-USERS" }], dhcpSnooping: { enabled: true, vlans: [60], verifyMacAddress: true } }
  };
  const configuredAp = updatePortByName(ap, "GigabitEthernet0", { ipAddress: "10.60.0.21", subnetMask: "255.255.255.0", gateway: "10.60.0.1", dnsServer: "10.60.0.10" });
  const configuredLaptop = updatePortByName(laptop, "Wireless0", { ipAddress: "10.60.60.50", subnetMask: "255.255.255.0", gateway: "10.60.60.1", dnsServer: "10.60.0.10" });
  const configuredServices = {
    ...updatePortByName(services, "FastEthernet0", { ipAddress: "10.60.0.10", subnetMask: "255.255.255.0", gateway: "10.60.0.1", dnsServer: "10.60.0.10" }),
    config: { ...services.config, services: { ...services.config.services, http: true, dhcp: true, dns: true, syslog: true }, dhcpPools: [{ id: createId("pool"), name: "WLAN-USERS", network: "10.60.60.0", mask: "255.255.255.0", defaultGateway: "10.60.60.1", dnsServer: "10.60.0.10", startIp: "10.60.60.100", maxLeases: 120, enabled: true }], dnsRecords: [{ id: createId("dns"), name: "wlc.campus.local", value: "10.60.0.5" }] }
  };
  let project = baseProject(ownerId, now, "무선 캠퍼스 샘플", [configuredController, configuredCore, configuredAp, configuredLaptop, configuredServices], [
    "Place a Catalyst 9800 controller, Catalyst AP, WLAN client, and services server.",
    "Verify management reachability and WLAN DHCP/DNS services."
  ], [
    { kind: "wireless-infrastructure-count", label: "Wireless controller and AP", target: 2, points: 10 },
    { kind: "wireless-client-count", label: "Wireless client addressing", target: 1, points: 5 },
    { kind: "dhcp-pool-count", label: "WLAN DHCP pool", target: 1, points: 5 },
    { kind: "vlan-count", label: "Wireless service VLAN", target: 1, points: 5 },
    { kind: "service-count", label: "Wireless services server", target: 1, points: 5 }
  ]);
  project = connect(project, configuredController.id, configuredCore.id);
  project = connect(project, configuredCore.id, configuredAp.id);
  project = connect(project, configuredCore.id, configuredServices.id);
  project = connect(project, configuredAp.id, configuredLaptop.id);
  return recalc(project);
}

function campusDistributionSwitch(device: NetworkDevice, hostname: string, routerId: string, usersGateway: string, voiceGateway: string, transitIp: string): NetworkDevice {
  return {
    ...device,
    config: {
      ...device.config,
      hostname,
      vlans: [{ id: 1, name: "default" }, { id: 10, name: "USERS" }, { id: 20, name: "VOICE" }, { id: 99, name: "NATIVE" }],
      routingProtocols: [{
        id: createId("routing"),
        protocol: "ospf",
        processId: "10",
        networks: ["10.10.10.0 0.0.0.255", "10.10.20.0 0.0.0.255", "10.20.20.0 0.0.0.255"],
        routerId,
        autoSummary: false,
        passiveInterfaces: ["Vlan10", "Vlan20"],
        passiveInterfaceDefault: false,
        passiveInterfaceExceptions: [],
        redistributeStatic: false,
        defaultInformationOriginate: false,
        defaultInformationAlways: false
      }]
    },
    ports: device.ports.map((port) => {
      if (port.name === "Vlan1") return { ...port, ipAddress: transitIp, subnetMask: "255.255.255.0", mode: "routed" as const };
      if (port.name === "GigabitEthernet1/0/1") return { ...port, mode: "trunk" as const, allowedVlans: [10, 20, 99], nativeVlan: 99, dhcpSnoopingTrusted: true };
      if (port.name === "GigabitEthernet1/0/2") return { ...port, ipAddress: usersGateway, subnetMask: "255.255.255.0", mode: "routed" as const };
      if (port.name === "GigabitEthernet1/0/3") return { ...port, ipAddress: voiceGateway, subnetMask: "255.255.255.0", mode: "routed" as const };
      return port;
    })
  };
}

function baseProject(ownerId: string, now: string, name: string, devices: NetworkDevice[], objectives: string[], extraRequirements: SampleActivityRequirement[] = []): NetworkProject {
  return {
    id: createId("project"),
    ownerId,
    name,
    devices,
    links: [],
    notes: [{ id: createId("note"), text: name, position: { x: 110, y: 110 }, color: "blue" }],
    drawings: [],
    activity: {
      title: name,
      objectives,
      requirements: [
        { id: createId("act_req"), kind: "device-count", label: "Required devices", target: devices.length, points: 10 },
        { id: createId("act_req"), kind: "link-count", label: "Required links", target: Math.max(1, devices.length - 1), points: 10 },
        { id: createId("act_req"), kind: "annotation-count", label: "Workspace note", target: 1, points: 5 },
        { id: createId("act_req"), kind: "saved-config-count", label: "Saved network configs", target: Math.max(1, devices.filter((device) => device.kind === "router" || device.kind === "switch" || device.kind === "firewall").length), points: 10 },
        ...extraRequirements.map((requirement) => ({ id: createId("act_req"), ...requirement }))
      ]
    },
    simulationEvents: [],
    createdAt: now,
    updatedAt: now
  };
}

function connect(project: NetworkProject, aDeviceId: string, bDeviceId: string): NetworkProject {
  const result = validateConnection(project, aDeviceId, bDeviceId, "auto");
  return result.link ? addLink(project, result.link) : project;
}

function updatePortByName(device: NetworkDevice, name: string, patch: Partial<NetworkPort>): NetworkDevice {
  return { ...device, ports: device.ports.map((port) => port.name === name ? { ...port, ...patch } : port) };
}

function updatePortByIndex(device: NetworkDevice, index: number, patch: Partial<NetworkPort>): NetworkDevice {
  let dataIndex = -1;
  return {
    ...device,
    ports: device.ports.map((port) => {
      if (port.kind === "console") return port;
      dataIndex += 1;
      return dataIndex === index ? { ...port, ...patch } : port;
    })
  };
}
