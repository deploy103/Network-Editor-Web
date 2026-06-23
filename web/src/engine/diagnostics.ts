import { ipInSubnet, ipToNumber, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "./ip";
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
      issues.push(issue("info", `${device.label} 전원 꺼짐`, "전원이 꺼진 장비는 링크가 다운되고 PDU에 응답할 수 없습니다."));
    }
    if (device.kind === "switch" && device.modelId !== "switch-3560") {
      if (device.config.staticRoutes.length > 0) {
        issues.push(issue("warning", `${device.label}는 static route가 있는 Layer 2 스위치입니다`, "L3 포워딩에는 멀티레이어 스위치나 라우터를 사용하세요."));
      }
      if (device.ports.some((port) => port.mode === "routed" && port.ipAddress && !port.name.toLowerCase().startsWith("vlan"))) {
        issues.push(issue("warning", `${device.label}에 routed 물리 스위치 포트가 있습니다`, "Layer 2 스위치 access 포트는 VLAN 설정을 사용하고 관리 IP는 SVI에 두세요."));
      }
    }
    if (device.ports.some((port) => port.kind === "wireless")) {
      if (!device.config.wireless.ssid.trim()) {
        issues.push(issue("warning", `${device.label} 무선 SSID가 비어 있습니다`, "무선 링크는 양쪽 끝점이 같은 SSID를 사용해야 합니다."));
      }
      if (device.config.wireless.auth === "wpa2-psk" && device.config.wireless.key.length < 8) {
        issues.push(issue("warning", `${device.label} WPA2 키가 너무 짧습니다`, "WPA2-PSK 무선 랩에서는 8자 이상의 키를 사용하세요."));
      }
      if (device.config.wireless.channel < 1 || device.config.wireless.channel > 11) {
        issues.push(issue("warning", `${device.label} 무선 채널이 1-11 범위를 벗어났습니다`, "2.4 GHz 랩 채널은 1부터 11 사이를 사용하세요."));
      }
      if (device.config.wireless.range < 20) {
        issues.push(issue("warning", `${device.label} 무선 범위가 너무 작습니다`, "클라이언트가 AP에 매우 가까이 있지 않으면 연결되지 않을 수 있습니다."));
      }
    }

    for (const port of device.ports) {
      pushOwner(macOwners, port.macAddress, { device, port });
      if ((port.helperAddresses ?? []).length > 0 && !port.ipAddress) {
        issues.push(issue("warning", `${device.label} ${port.name} DHCP helper 인터페이스 IP가 없습니다`, "helper-address는 클라이언트 subnet에 있는 routed 인터페이스 IP가 필요합니다."));
      }
      for (const helperAddress of port.helperAddresses ?? []) {
        if (!isIpv4(helperAddress)) {
          issues.push(issue("error", `${device.label} ${port.name} DHCP helper가 올바르지 않습니다`, `${helperAddress}는 유효한 IPv4 주소가 아닙니다.`));
        } else if (!project.devices.some((candidate) => candidate.powerOn && candidate.config.services.dhcp && candidate.config.dhcpPools.some((pool) => pool.enabled) && candidate.ports.some((candidatePort) => candidatePort.adminUp && candidatePort.ipAddress === helperAddress))) {
          issues.push(issue("warning", `${device.label} ${port.name} DHCP helper 대상이 없습니다`, `${helperAddress} 주소의 활성 DHCP 서버가 없습니다.`));
        }
      }
      if (!port.adminUp && port.linkId) {
        issues.push(issue("warning", `${device.label} ${port.name} 포트가 shutdown 상태입니다`, "인터페이스를 활성화하기 전까지 연결된 링크는 다운 상태입니다."));
      }
      if (!port.ipAddress) continue;
      if (port.mode !== "routed" && device.kind !== "pc" && device.kind !== "server") {
        issues.push(issue("warning", `${device.label} ${port.name} Layer 2 포트에 IP가 있습니다`, "IP 주소는 routed 포트 또는 SVI로 옮기세요."));
      }
      pushOwner(ipOwners, port.ipAddress, { device, port });

      if (!isIpv4(port.ipAddress)) {
        issues.push(issue("error", `${device.label} ${port.name} IP가 올바르지 않습니다`, `${port.ipAddress}는 유효한 IPv4 주소가 아닙니다.`));
      }
      if (port.subnetMask && (!isSubnetMask(port.subnetMask) || maskToPrefix(port.subnetMask) === 0)) {
        issues.push(issue("error", `${device.label} ${port.name} mask가 올바르지 않습니다`, `${port.subnetMask}는 이 랩에서 사용할 수 없습니다.`));
      }
      if (port.gateway && !isIpv4(port.gateway)) {
        issues.push(issue("error", `${device.label} ${port.name} gateway가 올바르지 않습니다`, `${port.gateway}는 유효한 IPv4 주소가 아닙니다.`));
      }
      if (port.dnsServer && !isIpv4(port.dnsServer)) {
        issues.push(issue("warning", `${device.label} ${port.name} DNS가 올바르지 않습니다`, `${port.dnsServer}는 유효한 IPv4 주소가 아닙니다.`));
      }
      if (port.gateway && port.ipAddress && port.subnetMask && isIpv4(port.gateway) && !ipInSubnet(port.gateway, port.ipAddress, port.subnetMask)) {
        issues.push(issue("warning", `${device.label} gateway가 subnet 밖에 있습니다`, `${port.gateway}는 ${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)} 안에 없습니다.`));
      }
    }

    const vlanIds = new Set(device.config.vlans.map((vlan) => vlan.id));
    for (const port of device.ports.filter((item) => item.mode === "access")) {
      if (!vlanIds.has(port.vlan)) {
        issues.push(issue("warning", `${device.label} ${port.name}가 없는 VLAN을 사용합니다`, `VLAN ${port.vlan}이 이 장비에 정의되어 있지 않습니다.`));
      }
    }
  }

  for (const [ip, owners] of ipOwners) {
    if (owners.length > 1 && isIpv4(ip)) {
      issues.push(issue("error", `중복 IP ${ip}`, owners.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")));
    }
  }
  for (const [mac, owners] of macOwners) {
    if (owners.length > 1) {
      issues.push(issue("error", `중복 MAC ${mac}`, owners.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")));
    }
  }
  for (const [label, owners] of labelOwners) {
    if (label && owners.length > 1) {
      issues.push(issue("warning", `중복 장비 이름 ${label}`, owners.map((owner) => owner.id).join(", ")));
    }
  }
  for (const [hostname, owners] of hostnameOwners) {
    if (hostname && owners.length > 1) {
      issues.push(issue("warning", `중복 hostname ${hostname}`, owners.map((owner) => owner.label).join(", ")));
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
      issues.push(issue("error", "깨진 케이블 끝점", `링크 ${link.id}가 누락된 장비 또는 포트를 가리킵니다.`));
      continue;
    }
    const label = linkLabel(project, link);
    if (a.port.linkId !== link.id || b.port.linkId !== link.id) {
      issues.push(issue("error", "케이블 상태 불일치", `${label}가 연결되어 있지만 한쪽 포트가 링크를 참조하지 않습니다.`));
    }
    if (link.status === "down") {
      issues.push(issue("warning", "링크 다운", explainDownLink(a.device, a.port, b.device, b.port, label)));
    }
    if (link.status === "blocked") {
      issues.push(issue("warning", "링크 차단", `${label}에 공유되는 trunk VLAN이 없습니다.`));
    }
    const vlanProblem = explainVlanMismatch(a.port, b.port, label);
    if (vlanProblem) {
      issues.push(issue("warning", "VLAN 불일치", vlanProblem));
    }
  }
  return issues;
}

function diagnoseServices(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  for (const device of project.devices) {
    const enabledReachableServices = reachableServiceNames(device);
    if (enabledReachableServices.length > 0 && !device.ports.some((port) => port.adminUp && isIpv4(port.ipAddress))) {
      issues.push(issue("warning", `${device.label} 서비스에 접근 가능한 IP가 없습니다`, `${enabledReachableServices.join(", ").toUpperCase()} 서비스가 켜져 있지만 활성 IPv4 인터페이스가 없습니다.`));
    }
    if (device.config.services.dhcp && device.config.dhcpPools.length === 0) {
      issues.push(issue("warning", `${device.label} DHCP 풀이 없습니다`, "클라이언트가 주소를 갱신하기 전에 활성 DHCP 풀을 만드세요."));
    }
    for (const pool of device.config.dhcpPools) {
      if (!pool.enabled) continue;
      if (!isIpv4(pool.network) || !isSubnetMask(pool.mask) || maskToPrefix(pool.mask) === 0 || !isIpv4(pool.startIp)) {
        issues.push(issue("error", `${device.label} DHCP 풀 ${pool.name} 주소 설정이 올바르지 않습니다`, "Network, subnet mask, start IP는 모두 이 랩에서 사용할 수 있는 IPv4 값이어야 합니다."));
      } else if (networkAddress(pool.startIp, pool.mask) !== networkAddress(pool.network, pool.mask)) {
        issues.push(issue("error", `${device.label} DHCP 풀 ${pool.name} 시작 IP가 네트워크 밖에 있습니다`, `${pool.startIp}는 ${pool.network}/${maskToPrefix(pool.mask)} 밖에 있습니다.`));
      } else {
        const owner = interfaceOwner(project, pool.startIp);
        if (owner) {
          issues.push(issue("warning", `${device.label} DHCP 풀 ${pool.name} 시작 IP가 이미 사용 중입니다`, `${pool.startIp}는 ${owner.device.label} ${owner.port.name}에 설정되어 있습니다.`));
        }
      }
      if (pool.defaultGateway && (!isIpv4(pool.defaultGateway) || !ipInSubnet(pool.defaultGateway, pool.network, pool.mask))) {
        issues.push(issue("error", `${device.label} DHCP 풀 ${pool.name} gateway가 맞지 않습니다`, `${pool.defaultGateway}는 풀 네트워크 안에 없습니다.`));
      }
      if (pool.maxLeases < 1) {
        issues.push(issue("error", `${device.label} DHCP 풀 ${pool.name} 임대 수가 없습니다`, "최대 임대 수를 1 이상으로 설정하세요."));
      }
    }
    for (const range of device.config.dhcpExcludedRanges ?? []) {
      const endIp = range.endIp ?? "";
      if (!isIpv4(range.startIp) || (endIp && !isIpv4(endIp))) {
        issues.push(issue("error", `${device.label} DHCP 제외 범위가 올바르지 않습니다`, `${range.startIp}${endIp ? ` - ${endIp}` : ""}는 IPv4 범위여야 합니다.`));
      } else if (endIp && ipToNumber(endIp) < ipToNumber(range.startIp)) {
        issues.push(issue("error", `${device.label} DHCP 제외 범위 순서가 올바르지 않습니다`, `${endIp}는 ${range.startIp}보다 작습니다.`));
      } else if (!dhcpRangeMatchesAnyEnabledPool(device, range.startIp, endIp)) {
        issues.push(issue("warning", `${device.label} DHCP 제외 범위가 풀 밖에 있습니다`, `${range.startIp}${endIp ? ` - ${endIp}` : ""}는 활성 DHCP 풀 네트워크와 일치하지 않습니다.`));
      }
    }
    if (device.config.services.dns && device.config.dnsRecords.some((record) => !record.name || !isIpv4(record.value))) {
      issues.push(issue("warning", `${device.label}에 올바르지 않은 DNS 레코드가 있습니다`, "모든 DNS 레코드에는 host name과 IPv4 대상이 필요합니다."));
    }
    for (const route of device.config.staticRoutes) {
      if (!isIpv4(route.network) || !isSubnetMask(route.mask) || !isIpv4(route.nextHop)) {
        issues.push(issue("error", `${device.label} static route가 올바르지 않습니다`, `${route.network} ${route.mask} via ${route.nextHop}는 유효한 IPv4 주소와 subnet mask를 사용해야 합니다.`));
        continue;
      }
      if (!device.ports.some((port) => port.adminUp && port.ipAddress && port.subnetMask && ipInSubnet(route.nextHop, port.ipAddress, port.subnetMask))) {
        issues.push(issue("warning", `${device.label} route next-hop이 연결된 subnet에 없습니다`, `${route.nextHop}는 이 장비의 활성 인터페이스에서 도달할 수 없습니다.`));
      }
      if (!project.devices.some((candidate) => candidate.id !== device.id && candidate.powerOn && candidate.ports.some((port) => port.adminUp && port.ipAddress === route.nextHop))) {
        issues.push(issue("warning", `${device.label} route next-hop이 할당되지 않았습니다`, `${route.nextHop}를 가진 전원 켜진 장비가 없습니다.`));
      }
    }
    for (const rule of device.config.accessRules) {
      if (!rule.interfaceName || !rule.source || !rule.destination) {
        issues.push(issue("warning", `${device.label} ACL 규칙이 불완전합니다`, "Access rule에는 source, destination, interface 필드가 필요합니다."));
      }
      if (!rule.listName && rule.interfaceName && !device.ports.some((port) => port.name === rule.interfaceName)) {
        issues.push(issue("warning", `${device.label} ACL interface가 없습니다`, `${rule.interfaceName}는 이 방화벽의 포트와 일치하지 않습니다.`));
      }
    }
    const aclNames = new Set(device.config.accessRules.map((rule) => (rule.listName || rule.interfaceName || "").toLowerCase()).filter(Boolean));
    for (const port of device.ports) {
      for (const listName of [port.accessGroupIn, port.accessGroupOut].filter(Boolean)) {
        if (listName && !aclNames.has(listName.toLowerCase())) {
          issues.push(issue("warning", `${device.label} ${port.name} ACL 참조가 비어 있습니다`, `ip access-group ${listName}에 해당하는 access-list가 없습니다.`));
        }
      }
    }
    for (const rule of device.config.natRules) {
      if (!rule.insideLocal || !rule.insideGlobal || !rule.outsideInterface) {
        issues.push(issue("warning", `${device.label} NAT 규칙이 불완전합니다`, "NAT rule에는 inside local, inside global, outside interface 필드가 필요합니다."));
      }
      if (rule.outsideInterface && !device.ports.some((port) => port.name === rule.outsideInterface)) {
        issues.push(issue("warning", `${device.label} NAT outside interface가 없습니다`, `${rule.outsideInterface}는 이 방화벽의 포트와 일치하지 않습니다.`));
      }
    }
  }
  return issues;
}

function reachableServiceNames(device: NetworkDevice): Array<keyof NetworkDevice["config"]["services"]> {
  return (["dns", "http", "ftp", "email", "tftp", "syslog"] as Array<keyof NetworkDevice["config"]["services"]>)
    .filter((service) => device.config.services[service]);
}

function explainDownLink(aDevice: NetworkDevice, aPort: NetworkPort, bDevice: NetworkDevice, bPort: NetworkPort, label: string): string {
  if (!aDevice.powerOn || !bDevice.powerOn) return `${label}: 한쪽 끝점 전원이 꺼져 있습니다.`;
  if (!aPort.adminUp || !bPort.adminUp) return `${label}: 한쪽 끝점이 administratively down 상태입니다.`;
  if (aPort.kind === "serial" && bPort.kind === "serial" && !aPort.clockRate && !bPort.clockRate) {
    return `${label}: serial DCE 쪽 clock rate가 필요합니다.`;
  }
  if (aPort.kind === "wireless" && bPort.kind === "wireless") {
    return `${label}: 무선 끝점이 범위를 벗어났거나 SSID/security가 다를 수 있습니다.`;
  }
  return `${label}: 포트 모드, 케이블 종류, 끝점 상태를 확인하세요.`;
}

function explainVlanMismatch(aPort: NetworkPort, bPort: NetworkPort, label: string): string {
  if (aPort.mode === "access" && bPort.mode === "access" && aPort.vlan !== bPort.vlan) {
    return `${label}: access VLAN ${aPort.vlan}과 access VLAN ${bPort.vlan}이 일치하지 않습니다.`;
  }
  if (aPort.mode === "trunk" && bPort.mode === "access" && !aPort.allowedVlans.includes(bPort.vlan)) {
    return `${label}: trunk가 access VLAN ${bPort.vlan}을 허용하지 않습니다.`;
  }
  if (bPort.mode === "trunk" && aPort.mode === "access" && !bPort.allowedVlans.includes(aPort.vlan)) {
    return `${label}: trunk가 access VLAN ${aPort.vlan}을 허용하지 않습니다.`;
  }
  return "";
}

function dhcpRangeMatchesAnyEnabledPool(device: NetworkDevice, startIp: string, endIp: string): boolean {
  return device.config.dhcpPools.some((pool) =>
    pool.enabled &&
    ipInSubnet(startIp, pool.network, pool.mask) &&
    (!endIp || ipInSubnet(endIp, pool.network, pool.mask))
  );
}

function interfaceOwner(project: NetworkProject, ipAddress: string): { device: NetworkDevice; port: NetworkPort } | null {
  for (const device of project.devices) {
    const port = device.ports.find((item) => item.ipAddress === ipAddress);
    if (port) return { device, port };
  }
  return null;
}

function pushOwner<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), value]);
}

function issue(severity: NetworkIssueSeverity, title: string, detail: string): NetworkIssue {
  return { id: `${severity}:${title}:${detail}`, severity, title, detail };
}
