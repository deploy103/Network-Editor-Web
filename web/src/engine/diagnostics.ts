import { ipInSubnet, isIpv4, maskToPrefix, networkAddress } from "./ip";
import { endpoint, linkLabel } from "./topology";
import type { NetworkDevice, NetworkPort, NetworkProject } from "../types/network";

export type NetworkIssueSeverity = "error" | "warning" | "info";

export interface NetworkIssue {
  id: string;
  severity: NetworkIssueSeverity;
  title: string;
  detail: string;
}

export function diagnoseProject(project: NetworkProject): NetworkIssue[] {
  return [
    ...diagnoseDevices(project),
    ...diagnoseLinks(project),
    ...diagnoseServices(project)
  ];
}

function diagnoseDevices(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const ipOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort }>>();
  const macOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort }>>();
  const labelOwners = new Map<string, NetworkDevice[]>();
  const hostnameOwners = new Map<string, NetworkDevice[]>();

  for (const device of project.devices) {
    pushOwner(labelOwners, device.label.toLowerCase(), device);
    pushOwner(hostnameOwners, device.config.hostname.toLowerCase(), device);
    if (!device.powerOn) {
      issues.push(issue("info", `${device.label} powered off`, "Powered-off devices keep links down and cannot answer PDUs."));
    }
    if (device.kind === "switch" && device.modelId !== "switch-3560") {
      if (device.config.staticRoutes.length > 0) {
        issues.push(issue("warning", `${device.label} is a layer-2 switch with static routes`, "Use a multilayer switch or router for L3 forwarding."));
      }
      if (device.ports.some((port) => port.mode === "routed" && port.ipAddress && !port.name.toLowerCase().startsWith("vlan"))) {
        issues.push(issue("warning", `${device.label} has routed physical switch ports`, "Layer-2 switch access ports should use VLAN settings; put management IP on an SVI."));
      }
    }
    if (device.ports.some((port) => port.kind === "wireless")) {
      if (!device.config.wireless.ssid.trim()) {
        issues.push(issue("warning", `${device.label} wireless SSID is empty`, "Wireless links require both endpoints to use the same SSID."));
      }
      if (device.config.wireless.auth === "wpa2-psk" && device.config.wireless.key.length < 8) {
        issues.push(issue("warning", `${device.label} WPA2 key is too short`, "Use at least 8 characters for WPA2-PSK wireless labs."));
      }
      if (device.config.wireless.channel < 1 || device.config.wireless.channel > 11) {
        issues.push(issue("warning", `${device.label} wireless channel is outside 1-11`, "Use a 2.4 GHz lab channel from 1 through 11."));
      }
      if (device.config.wireless.range < 20) {
        issues.push(issue("warning", `${device.label} wireless range is very small`, "Clients may not associate unless they are nearly on top of the access point."));
      }
    }

    for (const port of device.ports) {
      pushOwner(macOwners, port.macAddress, { device, port });
      if (!port.ipAddress) continue;
      if (port.mode !== "routed" && device.kind !== "pc" && device.kind !== "server") {
        issues.push(issue("warning", `${device.label} ${port.name} has IP on a layer-2 port`, "Move IP addressing to a routed port or SVI."));
      }
      pushOwner(ipOwners, port.ipAddress, { device, port });

      if (!isIpv4(port.ipAddress)) {
        issues.push(issue("error", `${device.label} ${port.name} has invalid IP`, `${port.ipAddress} is not a valid IPv4 address.`));
      }
      if (port.subnetMask && (!isIpv4(port.subnetMask) || maskToPrefix(port.subnetMask) === 0)) {
        issues.push(issue("error", `${device.label} ${port.name} has invalid mask`, `${port.subnetMask} is not usable for this lab.`));
      }
      if (port.gateway && !isIpv4(port.gateway)) {
        issues.push(issue("error", `${device.label} ${port.name} has invalid gateway`, `${port.gateway} is not a valid IPv4 address.`));
      }
      if (port.dnsServer && !isIpv4(port.dnsServer)) {
        issues.push(issue("warning", `${device.label} ${port.name} has invalid DNS`, `${port.dnsServer} is not a valid IPv4 address.`));
      }
      if (port.gateway && port.ipAddress && port.subnetMask && isIpv4(port.gateway) && !ipInSubnet(port.gateway, port.ipAddress, port.subnetMask)) {
        issues.push(issue("warning", `${device.label} gateway is outside subnet`, `${port.gateway} is not in ${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)}.`));
      }
      if (!port.adminUp && port.linkId) {
        issues.push(issue("warning", `${device.label} ${port.name} is shutdown`, "The connected link remains down until the interface is enabled."));
      }
    }

    const vlanIds = new Set(device.config.vlans.map((vlan) => vlan.id));
    for (const port of device.ports.filter((item) => item.mode === "access")) {
      if (!vlanIds.has(port.vlan)) {
        issues.push(issue("warning", `${device.label} ${port.name} uses missing VLAN`, `VLAN ${port.vlan} is not defined on this device.`));
      }
    }
  }

  for (const [ip, owners] of ipOwners) {
    if (owners.length > 1 && isIpv4(ip)) {
      issues.push(issue("error", `Duplicate IP ${ip}`, owners.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")));
    }
  }
  for (const [mac, owners] of macOwners) {
    if (owners.length > 1) {
      issues.push(issue("error", `Duplicate MAC ${mac}`, owners.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")));
    }
  }
  for (const [label, owners] of labelOwners) {
    if (label && owners.length > 1) {
      issues.push(issue("warning", `Duplicate device label ${label}`, owners.map((owner) => owner.id).join(", ")));
    }
  }
  for (const [hostname, owners] of hostnameOwners) {
    if (hostname && owners.length > 1) {
      issues.push(issue("warning", `Duplicate hostname ${hostname}`, owners.map((owner) => owner.label).join(", ")));
    }
  }

  return issues;
}

function diagnoseLinks(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  for (const link of project.links) {
    const a = endpoint(project, link.endpointA);
    const b = endpoint(project, link.endpointB);
    if (!a || !b) {
      issues.push(issue("error", "Broken cable endpoint", `Link ${link.id} points to a missing device or port.`));
      continue;
    }
    const label = linkLabel(project, link);
    if (a.port.linkId !== link.id || b.port.linkId !== link.id) {
      issues.push(issue("error", "Cable state mismatch", `${label} is connected, but one port does not reference the link.`));
    }
    if (link.status === "down") {
      issues.push(issue("warning", "Link down", explainDownLink(a.device, a.port, b.device, b.port, label)));
    }
    if (link.status === "blocked") {
      issues.push(issue("warning", "Link blocked", `${label} has no shared trunk VLAN.`));
    }
    const vlanProblem = explainVlanMismatch(a.port, b.port, label);
    if (vlanProblem) {
      issues.push(issue("warning", "VLAN mismatch", vlanProblem));
    }
  }
  return issues;
}

function diagnoseServices(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  for (const device of project.devices) {
    if (device.config.services.dhcp && device.config.dhcpPools.length === 0) {
      issues.push(issue("warning", `${device.label} DHCP has no pool`, "Create an enabled DHCP pool before clients can renew addresses."));
    }
    for (const pool of device.config.dhcpPools) {
      if (!pool.enabled) continue;
      if (!isIpv4(pool.network) || !isIpv4(pool.mask) || !isIpv4(pool.startIp)) {
        issues.push(issue("error", `${device.label} DHCP pool ${pool.name} has invalid addressing`, "Network, mask, and start IP must be valid IPv4 values."));
      } else if (networkAddress(pool.startIp, pool.mask) !== networkAddress(pool.network, pool.mask)) {
        issues.push(issue("warning", `${device.label} DHCP pool ${pool.name} starts outside network`, `${pool.startIp} is outside ${pool.network}/${maskToPrefix(pool.mask)}.`));
      }
      if (pool.defaultGateway && (!isIpv4(pool.defaultGateway) || !ipInSubnet(pool.defaultGateway, pool.network, pool.mask))) {
        issues.push(issue("warning", `${device.label} DHCP pool ${pool.name} gateway mismatch`, `${pool.defaultGateway} is not inside the pool network.`));
      }
      if (pool.maxLeases < 1) {
        issues.push(issue("error", `${device.label} DHCP pool ${pool.name} has no leases`, "Set max leases to at least 1."));
      }
    }
    if (device.config.services.dns && device.config.dnsRecords.some((record) => !record.name || !isIpv4(record.value))) {
      issues.push(issue("warning", `${device.label} has invalid DNS records`, "Every DNS record needs a host name and IPv4 target."));
    }
    for (const route of device.config.staticRoutes) {
      if (!isIpv4(route.network) || !isIpv4(route.mask) || !isIpv4(route.nextHop)) {
        issues.push(issue("error", `${device.label} has invalid static route`, `${route.network} ${route.mask} via ${route.nextHop} must use IPv4 values.`));
        continue;
      }
      if (!device.ports.some((port) => port.adminUp && port.ipAddress && port.subnetMask && ipInSubnet(route.nextHop, port.ipAddress, port.subnetMask))) {
        issues.push(issue("warning", `${device.label} route next-hop is not on a connected subnet`, `${route.nextHop} is not reachable from an active interface on this device.`));
      }
      if (!project.devices.some((candidate) => candidate.id !== device.id && candidate.powerOn && candidate.ports.some((port) => port.adminUp && port.ipAddress === route.nextHop))) {
        issues.push(issue("warning", `${device.label} route next-hop is not assigned`, `No powered device owns ${route.nextHop}.`));
      }
    }
    for (const rule of device.config.accessRules) {
      if (!rule.interfaceName || !rule.source || !rule.destination) {
        issues.push(issue("warning", `${device.label} has incomplete ACL rule`, "Access rules need source, destination, and interface fields."));
      }
      if (rule.interfaceName && !device.ports.some((port) => port.name === rule.interfaceName)) {
        issues.push(issue("warning", `${device.label} ACL interface is missing`, `${rule.interfaceName} does not match a port on this firewall.`));
      }
    }
    for (const rule of device.config.natRules) {
      if (!rule.insideLocal || !rule.insideGlobal || !rule.outsideInterface) {
        issues.push(issue("warning", `${device.label} has incomplete NAT rule`, "NAT rules need inside local, inside global, and outside interface fields."));
      }
      if (rule.outsideInterface && !device.ports.some((port) => port.name === rule.outsideInterface)) {
        issues.push(issue("warning", `${device.label} NAT outside interface is missing`, `${rule.outsideInterface} does not match a port on this firewall.`));
      }
    }
  }
  return issues;
}

function explainDownLink(aDevice: NetworkDevice, aPort: NetworkPort, bDevice: NetworkDevice, bPort: NetworkPort, label: string): string {
  if (!aDevice.powerOn || !bDevice.powerOn) return `${label}: one endpoint is powered off.`;
  if (!aPort.adminUp || !bPort.adminUp) return `${label}: one endpoint is administratively down.`;
  if (aPort.kind === "serial" && bPort.kind === "serial" && !aPort.clockRate && !bPort.clockRate) {
    return `${label}: serial DCE side needs a clock rate.`;
  }
  if (aPort.kind === "wireless" && bPort.kind === "wireless") {
    return `${label}: wireless endpoints may be outside range or have mismatched SSID/security.`;
  }
  return `${label}: check port mode, cable type, and endpoint state.`;
}

function explainVlanMismatch(aPort: NetworkPort, bPort: NetworkPort, label: string): string {
  if (aPort.mode === "access" && bPort.mode === "access" && aPort.vlan !== bPort.vlan) {
    return `${label}: access VLAN ${aPort.vlan} does not match access VLAN ${bPort.vlan}.`;
  }
  if (aPort.mode === "trunk" && bPort.mode === "access" && !aPort.allowedVlans.includes(bPort.vlan)) {
    return `${label}: trunk does not allow access VLAN ${bPort.vlan}.`;
  }
  if (bPort.mode === "trunk" && aPort.mode === "access" && !bPort.allowedVlans.includes(aPort.vlan)) {
    return `${label}: trunk does not allow access VLAN ${aPort.vlan}.`;
  }
  return "";
}

function pushOwner<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), value]);
}

function issue(severity: NetworkIssueSeverity, title: string, detail: string): NetworkIssue {
  return { id: `${severity}:${title}:${detail}`, severity, title, detail };
}
