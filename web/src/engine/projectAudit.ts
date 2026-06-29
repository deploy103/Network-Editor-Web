import { diagnoseProject } from "./diagnostics";
import { ipInSubnet, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
import { activeDefaultRoutes, activeStaticRoutes } from "./routeState";
import { endpoint } from "./topology";
import type { NetworkDevice, NetworkLink, NetworkPort, NetworkProject } from "../types/network";

export type ProjectAuditSeverity = "pass" | "info" | "warning" | "critical";

export interface ProjectAuditCheck {
  id: string;
  category: string;
  label: string;
  severity: ProjectAuditSeverity;
  summary: string;
  detail: string;
  evidence: string[];
  recommendation: string;
  affectedDeviceIds: string[];
}

export interface ProjectAuditCategory {
  name: string;
  total: number;
  pass: number;
  info: number;
  warning: number;
  critical: number;
}

export interface ProjectAuditReport {
  score: number;
  checks: ProjectAuditCheck[];
  categories: ProjectAuditCategory[];
  totals: {
    pass: number;
    info: number;
    warning: number;
    critical: number;
  };
}

type CheckInput = Omit<ProjectAuditCheck, "id" | "affectedDeviceIds"> & { affectedDeviceIds?: string[] };

export function analyzeProjectAudit(project: NetworkProject): ProjectAuditReport {
  const checks = [
    ...inventoryChecks(project),
    ...linkChecks(project),
    ...addressingChecks(project),
    ...routingChecks(project),
    ...switchingChecks(project),
    ...securityChecks(project),
    ...serviceChecks(project),
    ...wirelessChecks(project),
    ...activityChecks(project),
    ...simulationChecks(project),
    ...diagnosticChecks(project)
  ];
  const totals = {
    pass: checks.filter((check) => check.severity === "pass").length,
    info: checks.filter((check) => check.severity === "info").length,
    warning: checks.filter((check) => check.severity === "warning").length,
    critical: checks.filter((check) => check.severity === "critical").length
  };
  const weightedTotal = checks.reduce((total, check) => total + severityWeight(check.severity), 0);
  const score = checks.length ? Math.max(0, Math.round(100 - (weightedTotal / checks.length) * 100)) : 100;
  return {
    score,
    checks,
    categories: auditCategories(checks),
    totals
  };
}

function inventoryChecks(project: NetworkProject): ProjectAuditCheck[] {
  const networkDevices = project.devices.filter(isNetworkDevice);
  const endpoints = project.devices.filter((device) => device.kind === "pc" || device.kind === "server");
  const poweredOff = project.devices.filter((device) => !device.powerOn);
  const unnamed = project.devices.filter((device) => !device.config.hostname.trim() || device.config.hostname === device.label);
  const duplicateLabels = duplicateValues(project.devices.map((device) => device.label.toLowerCase()));
  return [
    check("inventory", "Device coverage", project.devices.length > 0 ? "pass" : "critical", {
      summary: `${project.devices.length} devices placed`,
      detail: project.devices.length > 0 ? "The workspace has devices to audit." : "The workspace is empty.",
      evidence: [`network devices ${networkDevices.length}`, `endpoints ${endpoints.length}`],
      recommendation: "Place routers, switches, endpoints, and service devices required by the lab."
    }),
    check("inventory", "Power state", poweredOff.length === 0 ? "pass" : "warning", {
      summary: poweredOff.length === 0 ? "All devices are powered on" : `${poweredOff.length} devices are powered off`,
      detail: poweredOff.length === 0 ? "Power state will not block traffic." : "Powered-off devices cannot forward traffic or answer simulation events.",
      evidence: poweredOff.map((device) => device.label),
      recommendation: "Power on required lab devices before scoring or simulation.",
      affectedDeviceIds: poweredOff.map((device) => device.id)
    }),
    check("inventory", "Hostname hygiene", unnamed.length === 0 && duplicateLabels.length === 0 ? "pass" : "info", {
      summary: unnamed.length === 0 && duplicateLabels.length === 0 ? "Device names are distinguishable" : "Some names are default or repeated",
      detail: "Distinct hostnames and labels make reports, CLI output, and troubleshooting easier to follow.",
      evidence: [...unnamed.map((device) => `${device.label} hostname=${device.config.hostname}`), ...duplicateLabels.map((label) => `duplicate label ${label}`)],
      recommendation: "Set meaningful hostnames and labels for core, distribution, access, WAN, server, and client roles.",
      affectedDeviceIds: unnamed.map((device) => device.id)
    })
  ];
}

function linkChecks(project: NetworkProject): ProjectAuditCheck[] {
  const downLinks = project.links.filter((link) => link.status === "down");
  const blockedLinks = project.links.filter((link) => link.status === "blocked");
  const inactiveStoredUpLinks = project.links.filter((link) => link.status === "up" && !linkOperational(project, link));
  const orphanedPorts = project.devices.flatMap((device) => device.ports.filter((port) => port.linkId && !project.links.some((link) => link.id === port.linkId)).map((port) => `${device.label} ${port.name}`));
  const connectedDeviceIds = new Set(project.links.filter((link) => linkOperational(project, link)).flatMap((link) => [link.endpointA.deviceId, link.endpointB.deviceId]));
  const isolated = project.devices.filter((device) => device.powerOn && !connectedDeviceIds.has(device.id));
  return [
    check("links", "Link count", project.links.length > 0 ? "pass" : project.devices.length > 1 ? "critical" : "info", {
      summary: `${project.links.length} links`,
      detail: project.links.length > 0 ? "Topology has physical or wireless connections." : "Multiple devices without links cannot exchange traffic.",
      evidence: [`devices ${project.devices.length}`],
      recommendation: "Connect endpoints to access devices and connect access/core/security layers as required."
    }),
    check("links", "Operational links", downLinks.length === 0 && blockedLinks.length === 0 && inactiveStoredUpLinks.length === 0 ? "pass" : downLinks.length || inactiveStoredUpLinks.length ? "critical" : "warning", {
      summary: downLinks.length === 0 && blockedLinks.length === 0 && inactiveStoredUpLinks.length === 0 ? "No down, blocked, or inactive stored-up links" : `${downLinks.length} down, ${blockedLinks.length} blocked, ${inactiveStoredUpLinks.length} inactive stored-up`,
      detail: "Down or inactive stored-up links usually indicate power, admin state, cable type, stale endpoints, or incompatible port choices. Blocked links are expected only when STP has redundant paths.",
      evidence: [...downLinks.map((link) => `down ${link.id}`), ...blockedLinks.map((link) => `blocked ${link.id}`), ...inactiveStoredUpLinks.map((link) => `inactive ${link.id}`)],
      recommendation: "Fix down links and verify blocked links are intentional redundant switching paths."
    }),
    check("links", "Endpoint isolation", isolated.length === 0 ? "pass" : "warning", {
      summary: isolated.length === 0 ? "No isolated devices" : `${isolated.length} isolated devices`,
      detail: "Isolated devices are often accidental drops on the canvas and are excluded from most traffic flows.",
      evidence: isolated.map((device) => device.label),
      recommendation: "Remove unused devices or connect them to the intended topology.",
      affectedDeviceIds: isolated.map((device) => device.id)
    }),
    check("links", "Port/link consistency", orphanedPorts.length === 0 ? "pass" : "critical", {
      summary: orphanedPorts.length === 0 ? "Port link references are consistent" : `${orphanedPorts.length} orphaned port references`,
      detail: "A port referencing a missing link can produce confusing UI state and inaccurate reports.",
      evidence: orphanedPorts,
      recommendation: "Run project repair to clear orphaned link IDs."
    })
  ];
}

function linkOperational(project: NetworkProject, link: NetworkLink): boolean {
  if (link.status !== "up") return false;
  const a = endpoint(project, link.endpointA);
  const b = endpoint(project, link.endpointB);
  return Boolean(a?.device.powerOn && b?.device.powerOn && a.port.adminUp && b.port.adminUp);
}

function addressingChecks(project: NetworkProject): ProjectAuditCheck[] {
  const addressedPorts = project.devices.flatMap((device) => device.ports.filter((port) => isIpv4(port.ipAddress)).map((port) => ({ device, port })));
  const invalidMasks = addressedPorts.filter(({ port }) => !isSubnetMask(port.subnetMask));
  const duplicateIps = duplicateValues(addressedPorts.map(({ port }) => port.ipAddress));
  const endpointIssues = project.devices
    .filter((device) => device.kind === "pc" || device.kind === "server")
    .flatMap((device) => dataPorts(device).filter((port) => port.linkId || isIpv4(port.ipAddress)).flatMap((port) => {
      const issues: string[] = [];
      if (!isIpv4(port.ipAddress)) issues.push("missing IP");
      if (!isSubnetMask(port.subnetMask)) issues.push("bad mask");
      if (!isIpv4(port.gateway)) issues.push("missing gateway");
      if (!isIpv4(port.dnsServer) && device.kind === "pc") issues.push("missing DNS");
      return issues.map((issue) => `${device.label} ${port.name}: ${issue}`);
    }));
  const gateways = project.devices
    .filter((device) => device.kind === "pc" || device.kind === "server")
    .flatMap((device) => dataPorts(device).filter((port) => isIpv4(port.gateway)).map((port) => ({ device, port })));
  const unreachableGateways = gateways.filter(({ port }) => !gatewayExists(project, port));
  return [
    check("addressing", "IPv4 coverage", addressedPorts.length > 0 ? "pass" : project.devices.length > 1 ? "warning" : "info", {
      summary: `${addressedPorts.length} IPv4-enabled ports`,
      detail: "At least routed interfaces and endpoints should have IPv4 addressing for simulation.",
      evidence: addressedPorts.slice(0, 8).map(({ device, port }) => `${device.label} ${port.name} ${port.ipAddress}`),
      recommendation: "Assign IPv4 addresses, masks, gateways, and DNS servers to participating ports."
    }),
    check("addressing", "Subnet masks", invalidMasks.length === 0 ? "pass" : "critical", {
      summary: invalidMasks.length === 0 ? "All addressed ports have valid masks" : `${invalidMasks.length} ports have invalid masks`,
      detail: "Invalid masks prevent network matching, route calculation, and report prefix rendering.",
      evidence: invalidMasks.map(({ device, port }) => `${device.label} ${port.name} ${port.subnetMask}`),
      recommendation: "Use contiguous subnet masks such as 255.255.255.0 or 255.255.255.252.",
      affectedDeviceIds: invalidMasks.map(({ device }) => device.id)
    }),
    check("addressing", "Duplicate IPv4 addresses", duplicateIps.length === 0 ? "pass" : "critical", {
      summary: duplicateIps.length === 0 ? "No duplicate IPv4 addresses" : `${duplicateIps.length} duplicate IPv4 addresses`,
      detail: "Duplicate addresses create ambiguous forwarding and ARP ownership.",
      evidence: duplicateIps,
      recommendation: "Assign unique host addresses within each subnet."
    }),
    check("addressing", "Endpoint addressing", endpointIssues.length === 0 ? "pass" : "warning", {
      summary: endpointIssues.length === 0 ? "Endpoints have complete addressing" : `${endpointIssues.length} endpoint addressing gaps`,
      detail: "Clients and servers need IP, mask, gateway, and usually DNS settings for application simulation.",
      evidence: endpointIssues,
      recommendation: "Complete desktop IP configuration or use DHCP with a reachable pool."
    }),
    check("addressing", "Gateway reachability", unreachableGateways.length === 0 ? "pass" : "critical", {
      summary: unreachableGateways.length === 0 ? "Endpoint gateways are present" : `${unreachableGateways.length} endpoints reference missing gateways`,
      detail: "A host default gateway must match a routed/SVI/HSRP/VRRP address in the host subnet.",
      evidence: unreachableGateways.map(({ device, port }) => `${device.label} ${port.name} gateway ${port.gateway}`),
      recommendation: "Configure the gateway address on a router, SVI, HSRP group, or VRRP group in the same subnet.",
      affectedDeviceIds: unreachableGateways.map(({ device }) => device.id)
    })
  ];
}

function routingChecks(project: NetworkProject): ProjectAuditCheck[] {
  const configuredL3Devices = project.devices.filter((device) => isNetworkDevice(device) && device.ports.some((port) => isIpv4(port.ipAddress)));
  const l3Devices = configuredL3Devices.filter((device) => device.powerOn && device.ports.some((port) => port.adminUp && isIpv4(port.ipAddress)));
  const networks = uniqueNetworks(project);
  const configuredRouteCount = project.devices.reduce((total, device) => total + device.config.staticRoutes.length, 0);
  const activeRouteCount = project.devices.reduce((total, device) => total + activeStaticRoutes(project, device).length, 0);
  const dynamicCount = project.devices.reduce((total, device) => total + (device.powerOn ? device.config.routingProtocols?.length ?? 0 : 0), 0);
  const configuredDefaultRoutes = project.devices.flatMap((device) => device.config.staticRoutes
    .filter((route) => route.network === "0.0.0.0" && route.mask === "0.0.0.0")
    .map((route) => `${device.label} via ${route.nextHop}${route.trackId ? ` track ${route.trackId}` : ""}`));
  const defaultRoutes = project.devices.flatMap((device) => activeDefaultRoutes(project, device).map((route) => `${device.label} via ${route.nextHop}${route.trackId ? ` track ${route.trackId}` : ""}`));
  const trackedRoutes = project.devices.flatMap((device) => device.config.staticRoutes.filter((route) => route.trackId !== undefined).map((route) => ({ device, route })));
  const badTracked = trackedRoutes.filter(({ device, route }) => !device.config.trackObjects?.some((track) => track.trackId === route.trackId));
  const helperPorts = project.devices.flatMap((device) => device.powerOn ? device.ports.filter((port) => port.adminUp && (port.helperAddresses ?? []).length > 0).map((port) => ({ device, port })) : []);
  const activeDhcpPoolExists = project.devices.some((device) =>
    device.powerOn &&
    device.config.services.dhcp &&
    device.config.dhcpPools.some((pool) => pool.enabled) &&
    device.ports.some((port) => port.adminUp && isIpv4(port.ipAddress))
  );
  return [
    check("routing", "Layer 3 device coverage", networks.length <= 1 || l3Devices.length > 0 ? "pass" : "warning", {
      summary: `${l3Devices.length} active L3 devices (${configuredL3Devices.length} configured) for ${networks.length} routed networks`,
      detail: "Multiple IPv4 networks usually need an active router, firewall, or multilayer switch.",
      evidence: (l3Devices.length ? l3Devices : configuredL3Devices).map((device) => device.label),
      recommendation: "Add or configure routed interfaces on devices that should connect subnets."
    }),
    check("routing", "Route coverage", networks.length <= 1 || activeRouteCount + dynamicCount > 0 ? "pass" : "warning", {
      summary: `${activeRouteCount} active static routes (${configuredRouteCount} configured), ${dynamicCount} active dynamic routing processes`,
      detail: "When more than one subnet exists, active routing information must be present unless all traffic is local.",
      evidence: [`networks ${networks.join(", ") || "-"}`],
      recommendation: "Add static routes, default routes, or RIP/OSPF/EIGRP processes for inter-subnet reachability."
    }),
    check("routing", "Default route", networks.length <= 1 || defaultRoutes.length > 0 ? "pass" : "info", {
      summary: defaultRoutes.length ? `${defaultRoutes.length} active default routes` : configuredDefaultRoutes.length ? "No active default route" : "No default route",
      detail: "Default routes are expected at edges, branches, firewalls, and labs with upstream services. Tracked defaults only count when their track object is up.",
      evidence: defaultRoutes.length ? defaultRoutes : configuredDefaultRoutes,
      recommendation: "Configure a default route where traffic should leave the local routing domain."
    }),
    check("routing", "Tracked routes", badTracked.length === 0 ? "pass" : "critical", {
      summary: badTracked.length === 0 ? "Tracked routes reference valid track objects" : `${badTracked.length} routes reference missing track objects`,
      detail: "A tracked static route cannot evaluate failover if the referenced track object is absent.",
      evidence: badTracked.map(({ device, route }) => `${device.label} ${route.network}/${route.mask} track ${route.trackId}`),
      recommendation: "Create matching track objects or remove stale track IDs.",
      affectedDeviceIds: badTracked.map(({ device }) => device.id)
    }),
    check("routing", "DHCP relay placement", helperPorts.length || !activeDhcpPoolExists ? "pass" : "info", {
      summary: helperPorts.length ? `${helperPorts.length} active helper-address interfaces` : "No active helper-address interfaces",
      detail: "Remote DHCP pools require active helper-address on client-facing routed interfaces.",
      evidence: helperPorts.map(({ device, port }) => `${device.label} ${port.name} -> ${port.helperAddresses?.join(", ")}`),
      recommendation: "Add helper-address on each remote client VLAN when DHCP server is not local."
    })
  ];
}

function switchingChecks(project: NetworkProject): ProjectAuditCheck[] {
  const switches = project.devices.filter((device) => device.kind === "switch");
  const vlans = new Set<number>();
  for (const device of switches) {
    for (const vlan of device.config.vlans) {
      if (vlan.id !== 1) vlans.add(vlan.id);
    }
    for (const port of device.ports) {
      if (port.vlan !== 1) vlans.add(port.vlan);
      for (const vlan of port.allowedVlans) {
        if (vlan !== 1) vlans.add(vlan);
      }
    }
  }
  const trunks = switches.flatMap((device) => device.ports.filter((port) => port.mode === "trunk").map((port) => ({ device, port })));
  const emptyAllowed = trunks.filter(({ port }) => !port.allowedVlans.length);
  const accessWithoutPortfast = switches.flatMap((device) => device.ports.filter((port) => port.mode === "access" && port.linkId && !port.stpPortfast).map((port) => `${device.label} ${port.name}`));
  const snoopingDevices = switches.filter((device) => device.config.dhcpSnooping?.enabled);
  const snoopingWithoutTrust = snoopingDevices.filter((device) => !device.ports.some((port) => port.dhcpSnoopingTrusted));
  const channelMembers = switches.flatMap((device) => device.ports.filter((port) => port.channelGroup).map((port) => `${device.label} ${port.name} Po${port.channelGroup?.id}`));
  return [
    check("switching", "VLAN coverage", switches.length === 0 || vlans.size > 0 ? "pass" : "info", {
      summary: `${vlans.size} non-default VLANs`,
      detail: "VLANs are expected for segmented campus, wireless, voice, and security labs.",
      evidence: Array.from(vlans).sort((a, b) => a - b).map(String),
      recommendation: "Create named VLANs and assign access/trunk ports for segmented labs."
    }),
    check("switching", "Trunk configuration", trunks.length === 0 || emptyAllowed.length === 0 ? "pass" : "warning", {
      summary: `${trunks.length} trunks, ${emptyAllowed.length} with empty allowed list`,
      detail: "Trunks with no explicit allowed list can be ambiguous in labs that expect VLAN filtering.",
      evidence: emptyAllowed.map(({ device, port }) => `${device.label} ${port.name}`),
      recommendation: "Set allowed VLANs and native VLANs on intentional trunk links.",
      affectedDeviceIds: emptyAllowed.map(({ device }) => device.id)
    }),
    check("switching", "Access edge STP", accessWithoutPortfast.length === 0 ? "pass" : "info", {
      summary: accessWithoutPortfast.length === 0 ? "Access edge STP is explicit" : `${accessWithoutPortfast.length} connected access ports lack portfast`,
      detail: "PortFast and BPDU Guard are commonly expected on host-facing access ports.",
      evidence: accessWithoutPortfast.slice(0, 12),
      recommendation: "Enable spanning-tree portfast and bpduguard on host-facing access ports."
    }),
    check("switching", "DHCP Snooping trust", snoopingWithoutTrust.length === 0 ? "pass" : "warning", {
      summary: snoopingDevices.length ? `${snoopingDevices.length} DHCP Snooping devices` : "DHCP Snooping not enabled",
      detail: "DHCP Snooping requires trusted uplinks toward legitimate DHCP servers or relay devices.",
      evidence: snoopingWithoutTrust.map((device) => device.label),
      recommendation: "Trust uplinks/server-facing ports and restrict client-facing ports.",
      affectedDeviceIds: snoopingWithoutTrust.map((device) => device.id)
    }),
    check("switching", "EtherChannel usage", channelMembers.length ? "pass" : switches.length >= 2 ? "info" : "pass", {
      summary: channelMembers.length ? `${channelMembers.length} EtherChannel members` : "No EtherChannel members",
      detail: "EtherChannel is optional but useful for redundant uplink labs.",
      evidence: channelMembers,
      recommendation: "Use channel-group members when the lab calls for bundled uplinks."
    })
  ];
}

function securityChecks(project: NetworkProject): ProjectAuditCheck[] {
  const firewalls = project.devices.filter((device) => device.kind === "firewall");
  const aclDevices = project.devices.filter((device) => device.config.accessRules.length > 0);
  const natDevices = project.devices.filter((device) => device.config.natRules.length > 0);
  const outsidePorts = project.devices.flatMap((device) => device.ports.filter((port) => port.natRole === "outside").map((port) => `${device.label} ${port.name}`));
  const insidePorts = project.devices.flatMap((device) => device.ports.filter((port) => port.natRole === "inside").map((port) => `${device.label} ${port.name}`));
  const pbrDevices = project.devices.filter((device) => (device.config.routeMaps ?? []).some((entry) => entry.setNextHop));
  const routeMapsWithoutMatch = project.devices.flatMap((device) => (device.config.routeMaps ?? []).filter((entry) => entry.setNextHop && !entry.matchAccessLists.length && !(entry.matchPrefixLists ?? []).length).map((entry) => `${device.label} ${entry.name} seq ${entry.sequence}`));
  const portSecurityPorts = project.devices.flatMap((device) => device.ports.filter((port) => port.portSecurity?.enabled).map((port) => `${device.label} ${port.name}`));
  return [
    check("security", "Firewall policy", firewalls.length === 0 || aclDevices.length > 0 ? "pass" : "warning", {
      summary: firewalls.length ? `${firewalls.length} firewalls, ${aclDevices.length} devices with ACLs` : "No firewall devices",
      detail: "Firewall or edge security labs should have explicit ACLs or access policy.",
      evidence: aclDevices.map((device) => device.label),
      recommendation: "Define ACLs for inbound/outbound policy and bind them to interfaces where needed."
    }),
    check("security", "NAT roles", natDevices.length === 0 || (insidePorts.length > 0 && outsidePorts.length > 0) ? "pass" : "warning", {
      summary: natDevices.length ? `${natDevices.length} NAT devices` : "No NAT devices",
      detail: "NAT overload/static rules need clear inside and outside interface roles.",
      evidence: [`inside ${insidePorts.join(", ") || "-"}`, `outside ${outsidePorts.join(", ") || "-"}`],
      recommendation: "Mark NAT inside and outside interfaces before testing translations."
    }),
    check("security", "PBR match criteria", routeMapsWithoutMatch.length === 0 ? "pass" : "warning", {
      summary: pbrDevices.length ? `${pbrDevices.length} PBR-capable devices` : "No PBR route-maps",
      detail: "A route-map with set next-hop but no match criteria can overmatch traffic.",
      evidence: routeMapsWithoutMatch,
      recommendation: "Add ACL or prefix-list match clauses to policy route-map entries."
    }),
    check("security", "Port security", portSecurityPorts.length ? "pass" : project.devices.some((device) => device.kind === "switch") ? "info" : "pass", {
      summary: portSecurityPorts.length ? `${portSecurityPorts.length} secure ports` : "No port-security ports",
      detail: "Port security is expected on some switching security labs but optional elsewhere.",
      evidence: portSecurityPorts.slice(0, 12),
      recommendation: "Enable port-security on access ports when endpoint identity control is required."
    })
  ];
}

function serviceChecks(project: NetworkProject): ProjectAuditCheck[] {
  const serviceDevices = project.devices.filter((device) => enabledServices(device).length > 0);
  const dhcpPools = project.devices.flatMap((device) => device.config.dhcpPools.filter((pool) => pool.enabled).map((pool) => ({ device, pool })));
  const badDhcpPools = dhcpPools.filter(({ pool }) => !isIpv4(pool.network) || !isSubnetMask(pool.mask) || !isIpv4(pool.defaultGateway) || !isIpv4(pool.startIp));
  const dnsRecords = project.devices.flatMap((device) => device.config.dnsRecords.map((record) => `${device.label} ${record.name}=${record.value}`));
  const httpServers = project.devices.filter((device) => device.config.services.http);
  const missingServerIp = serviceDevices.filter((device) => !dataPorts(device).some((port) => isIpv4(port.ipAddress)));
  return [
    check("services", "Service placement", serviceDevices.length ? "pass" : "info", {
      summary: serviceDevices.length ? `${serviceDevices.length} service devices` : "No services enabled",
      detail: "Application and infrastructure labs usually need at least one enabled service device.",
      evidence: serviceDevices.map((device) => `${device.label}: ${enabledServices(device).join(", ")}`),
      recommendation: "Enable DHCP/DNS/HTTP/FTP/EMAIL/TFTP/SYSLOG services on server devices as required."
    }),
    check("services", "Service addressing", missingServerIp.length === 0 ? "pass" : "critical", {
      summary: missingServerIp.length === 0 ? "Service devices have IPv4 addresses" : `${missingServerIp.length} service devices lack IPv4`,
      detail: "A service can be enabled but unreachable if the serving device has no IP address.",
      evidence: missingServerIp.map((device) => device.label),
      recommendation: "Assign IP, gateway, and DNS values to service devices.",
      affectedDeviceIds: missingServerIp.map((device) => device.id)
    }),
    check("services", "DHCP pool validity", badDhcpPools.length === 0 ? "pass" : "critical", {
      summary: dhcpPools.length ? `${dhcpPools.length} DHCP pools` : "No DHCP pools",
      detail: "DHCP pools need valid network, mask, default gateway, DNS, and start address values.",
      evidence: badDhcpPools.map(({ device, pool }) => `${device.label} ${pool.name}`),
      recommendation: "Correct malformed pool fields and verify excluded ranges do not cover the lease start."
    }),
    check("services", "DNS and web services", httpServers.length === 0 || dnsRecords.length > 0 ? "pass" : "info", {
      summary: `${httpServers.length} HTTP servers, ${dnsRecords.length} DNS records`,
      detail: "Web labs are easier to validate when DNS records map names to service IPs.",
      evidence: dnsRecords.slice(0, 12),
      recommendation: "Add DNS records for web, file, and mail services used by the lab."
    })
  ];
}

function wirelessChecks(project: NetworkProject): ProjectAuditCheck[] {
  const wirelessDevices = project.devices.filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless"));
  const emptySsid = wirelessDevices.filter((device) => !device.config.wireless.ssid.trim());
  const shortKeys = wirelessDevices.filter((device) => device.config.wireless.auth === "wpa2-psk" && device.config.wireless.key.length < 8);
  const wirelessClients = project.devices.flatMap((device) => device.ports.filter((port) => device.kind !== "wireless" && port.kind === "wireless").map((port) => ({ device, port })));
  const addressedWirelessClients = wirelessClients.filter(({ port }) => isIpv4(port.ipAddress));
  return [
    check("wireless", "Wireless configuration", emptySsid.length === 0 && shortKeys.length === 0 ? "pass" : "warning", {
      summary: wirelessDevices.length ? `${wirelessDevices.length} wireless-capable devices` : "No wireless devices",
      detail: "Wireless links require matching SSID, authentication type, and WPA2 keys where used.",
      evidence: [...emptySsid.map((device) => `${device.label} empty SSID`), ...shortKeys.map((device) => `${device.label} short WPA2 key`)],
      recommendation: "Set SSID and WPA2-PSK values consistently across APs and clients.",
      affectedDeviceIds: [...emptySsid, ...shortKeys].map((device) => device.id)
    }),
    check("wireless", "Wireless clients", wirelessClients.length === 0 || addressedWirelessClients.length === wirelessClients.length ? "pass" : "warning", {
      summary: `${addressedWirelessClients.length}/${wirelessClients.length} wireless clients addressed`,
      detail: "Wireless client ports need IP configuration or DHCP assignment for end-to-end traffic.",
      evidence: wirelessClients.map(({ device, port }) => `${device.label} ${port.name} ${port.ipAddress || "unassigned"}`),
      recommendation: "Address wireless clients manually or provide a reachable WLAN DHCP pool."
    })
  ];
}

function activityChecks(project: NetworkProject): ProjectAuditCheck[] {
  const activity = project.activity;
  if (!activity) {
    return [check("activity", "Activity definition", "info", {
      summary: "No Activity Wizard spec",
      detail: "Activity metadata is optional, but it makes repeatable scoring possible.",
      evidence: [],
      recommendation: "Add objectives, requirements, command rules, and answer snapshots for instructional labs."
    })];
  }
  const advancedKinds = new Set(activity.requirements.map((requirement) => requirement.kind).filter((kind) => !["device-count", "link-count", "annotation-count"].includes(kind)));
  return [
    check("activity", "Objectives", activity.objectives.length ? "pass" : "info", {
      summary: `${activity.objectives.length} objectives`,
      detail: "Clear objectives help users understand what should be built and verified.",
      evidence: activity.objectives.slice(0, 8),
      recommendation: "Add concise objectives for topology, addressing, services, and verification."
    }),
    check("activity", "Requirement depth", advancedKinds.size ? "pass" : activity.requirements.length ? "info" : "warning", {
      summary: `${activity.requirements.length} requirements, ${advancedKinds.size} advanced kinds`,
      detail: "Advanced requirements allow scoring actual features like routing, VLANs, NAT, PBR, and wireless.",
      evidence: Array.from(advancedKinds),
      recommendation: "Use feature-specific Activity requirements instead of only device/link counts."
    }),
    check("activity", "Answer snapshot", activity.answerSnapshot ? "pass" : "info", {
      summary: activity.answerSnapshot ? "Answer snapshot saved" : "No answer snapshot",
      detail: "A snapshot can compare required devices, links, services, and startup-config ownership.",
      evidence: activity.answerSnapshot ? [`captured ${activity.answerSnapshot.capturedAt}`] : [],
      recommendation: "Capture an answer snapshot when distributing a scored lab."
    })
  ];
}

function simulationChecks(project: NetworkProject): ProjectAuditCheck[] {
  const delivered = project.simulationEvents.filter((event) => event.status === "delivered");
  const dropped = project.simulationEvents.filter((event) => event.status === "dropped");
  const protocols = Array.from(new Set(project.simulationEvents.map((event) => event.type.toUpperCase()))).sort();
  return [
    check("simulation", "Verification events", delivered.length ? "pass" : project.devices.length > 1 ? "info" : "pass", {
      summary: `${delivered.length} delivered events`,
      detail: "Delivered PDU events provide evidence that traffic paths have been tested.",
      evidence: protocols,
      recommendation: "Run Simple or Complex PDU tests for ICMP, DNS, HTTP, DHCP, and service protocols."
    }),
    check("simulation", "Dropped events", dropped.length === 0 ? "pass" : "warning", {
      summary: dropped.length ? `${dropped.length} dropped events` : "No dropped events",
      detail: "Dropped events can be useful when testing policy, but unexpected drops should be investigated.",
      evidence: dropped.slice(0, 10).map((event) => `${event.type}: ${event.info}`),
      recommendation: "Inspect PDU details and diagnostics for unexpected drops."
    })
  ];
}

function diagnosticChecks(project: NetworkProject): ProjectAuditCheck[] {
  const issues = diagnoseProject(project);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return [
    check("diagnostics", "Project diagnostics", errors.length === 0 && warnings.length === 0 ? "pass" : errors.length ? "critical" : "warning", {
      summary: `${errors.length} errors, ${warnings.length} warnings`,
      detail: "The diagnostics engine catches configuration and topology issues that are likely to affect lab behavior.",
      evidence: issues.slice(0, 12).map((issue) => `${issue.severity}: ${issue.title}`),
      recommendation: "Resolve diagnostic errors first, then review warnings for intended exceptions."
    })
  ];
}

function check(category: string, label: string, severity: ProjectAuditSeverity, values: Omit<CheckInput, "category" | "label" | "severity">): ProjectAuditCheck {
  return {
    id: `${category}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    category,
    label,
    severity,
    summary: values.summary,
    detail: values.detail,
    evidence: values.evidence.slice(0, 24),
    recommendation: values.recommendation,
    affectedDeviceIds: values.affectedDeviceIds ?? []
  };
}

function auditCategories(checks: ProjectAuditCheck[]): ProjectAuditCategory[] {
  const names = Array.from(new Set(checks.map((check) => check.category)));
  return names.map((name) => {
    const scoped = checks.filter((check) => check.category === name);
    return {
      name,
      total: scoped.length,
      pass: scoped.filter((check) => check.severity === "pass").length,
      info: scoped.filter((check) => check.severity === "info").length,
      warning: scoped.filter((check) => check.severity === "warning").length,
      critical: scoped.filter((check) => check.severity === "critical").length
    };
  });
}

function severityWeight(severity: ProjectAuditSeverity): number {
  if (severity === "critical") return 1;
  if (severity === "warning") return 0.55;
  if (severity === "info") return 0.2;
  return 0;
}

function isNetworkDevice(device: NetworkDevice): boolean {
  return device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless";
}

function dataPorts(device: NetworkDevice): NetworkPort[] {
  return device.ports.filter((port) => port.kind !== "console");
}

function enabledServices(device: NetworkDevice): string[] {
  return Object.entries(device.config.services).filter(([, enabled]) => enabled).map(([name]) => name);
}

function duplicateValues(values: string[]): string[] {
  const counts = values.reduce<Record<string, number>>((next, value) => {
    if (!value) return next;
    next[value] = (next[value] ?? 0) + 1;
    return next;
  }, {});
  return Object.entries(counts).filter(([, count]) => count > 1).map(([value]) => value);
}

function gatewayExists(project: NetworkProject, hostPort: NetworkPort): boolean {
  if (!isIpv4(hostPort.gateway) || !isIpv4(hostPort.ipAddress) || !isSubnetMask(hostPort.subnetMask)) return false;
  if (!ipInSubnet(hostPort.gateway, hostPort.ipAddress, hostPort.subnetMask)) return false;
  return project.devices.some((device) => device.ports.some((port) => {
    if (port.id === hostPort.id) return false;
    if (!device.powerOn || !port.adminUp) return false;
    if (port.ipAddress === hostPort.gateway && sameSubnetOwner(hostPort.gateway, port.ipAddress, port.subnetMask)) return true;
    if ((port.secondaryIpAddresses ?? []).some((address) => address.ipAddress === hostPort.gateway && sameSubnetOwner(hostPort.gateway, address.ipAddress, address.subnetMask))) return true;
    if ((port.hsrpGroups ?? []).some((group) => group.virtualIp === hostPort.gateway && sameSubnetOwner(hostPort.gateway, port.ipAddress, port.subnetMask))) return true;
    if ((port.vrrpGroups ?? []).some((group) => group.virtualIp === hostPort.gateway && sameSubnetOwner(hostPort.gateway, port.ipAddress, port.subnetMask))) return true;
    return false;
  }));
}

function sameSubnetOwner(gateway: string, ownerIp: string, ownerMask: string): boolean {
  return isIpv4(ownerIp) && isSubnetMask(ownerMask) && ipInSubnet(gateway, ownerIp, ownerMask);
}

function uniqueNetworks(project: NetworkProject): string[] {
  const networks = new Set<string>();
  for (const device of project.devices) {
    for (const port of device.ports) {
      if (isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask)) {
        networks.add(`${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)}`);
      }
      for (const secondary of port.secondaryIpAddresses ?? []) {
        if (isIpv4(secondary.ipAddress) && isSubnetMask(secondary.subnetMask)) {
          networks.add(`${networkAddress(secondary.ipAddress, secondary.subnetMask)}/${maskToPrefix(secondary.subnetMask)}`);
        }
      }
    }
  }
  return Array.from(networks).sort();
}
