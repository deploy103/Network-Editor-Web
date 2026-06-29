import { canPortUseCable, effectivePortKind, expectedTransceiverSpeedMbps, getTransceiverSpec, transceiverCompatibleWithPort, transceiverMediaLabel, transceiversShareFiberMedia } from "../data/deviceCatalog";
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
    ...diagnoseDynamicRoutingLinks(project),
    ...diagnoseLayer2Loops(project),
    ...diagnoseServices(project)
  ];
}

function diagnoseDevices(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const ipOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort }>>();
  const macOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort }>>();
  const labelOwners = new Map<string, NetworkDevice[]>();
  const hostnameOwners = new Map<string, NetworkDevice[]>();
  const hsrpOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort; group: NonNullable<NetworkPort["hsrpGroups"]>[number] }>>();
  const vrrpOwners = new Map<string, Array<{ device: NetworkDevice; port: NetworkPort; group: NonNullable<NetworkPort["vrrpGroups"]>[number] }>>();

  for (const device of project.devices) {
    pushOwner(labelOwners, device.label.toLowerCase(), device);
    pushOwner(hostnameOwners, device.config.hostname.toLowerCase(), device);
    if (!device.powerOn) {
      issues.push(issue("info", `${device.label} 전원 꺼짐`, "전원이 꺼진 장비는 링크가 다운되고 PDU에 응답할 수 없습니다."));
    }
    if (device.kind === "switch" && !isMultilayerSwitch(device)) {
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
      if (effectivePortKind(port) === "fiber") {
        const transceiver = getTransceiverSpec(port.transceiverId);
        if (!transceiver) {
          issues.push(issue("warning", `${device.label} ${port.name} SFP transceiver가 없습니다`, "fiber media로 쓰려면 SX/LX 같은 transceiver를 선택해야 합니다."));
        } else if (transceiver.media === "copper") {
          issues.push(issue("error", `${device.label} ${port.name} transceiver/media 불일치`, `${transceiver.label}은 RJ-45 copper SFP입니다. Fiber media에는 optical transceiver를 사용하세요.`));
        } else if (!transceiverCompatibleWithPort(transceiver, port)) {
          const expected = expectedTransceiverSpeedMbps(port.name);
          issues.push(issue("error", `${device.label} ${port.name} transceiver speed 불일치`, `${transceiver.label}은 ${transceiver.speedMbps} Mbps 모듈입니다. 이 포트에는 ${expected} Mbps급 optical transceiver를 선택하세요.`));
        }
      }
      if (effectivePortKind(port) !== "fiber" && port.transceiverId) {
        const transceiver = getTransceiverSpec(port.transceiverId);
        if (transceiver && transceiver.media !== "copper") {
          issues.push(issue("info", `${device.label} ${port.name} optical transceiver가 비활성입니다`, "dual-purpose 포트가 RJ-45 copper media로 설정되어 있어 SFP 광 모듈은 사용되지 않습니다."));
        }
      }
      for (const secondary of port.secondaryIpAddresses ?? []) {
        pushOwner(ipOwners, secondary.ipAddress, { device, port });
        if (!port.ipAddress) {
          issues.push(issue("warning", `${device.label} ${port.name} secondary IP에 primary IP가 없습니다`, "secondary 주소를 쓰려면 먼저 primary ip address를 설정하세요."));
        }
        if (!isIpv4(secondary.ipAddress)) {
          issues.push(issue("error", `${device.label} ${port.name} secondary IP가 올바르지 않습니다`, `${secondary.ipAddress}는 유효한 IPv4 주소가 아닙니다.`));
        }
        if (!isSubnetMask(secondary.subnetMask) || maskToPrefix(secondary.subnetMask) === 0) {
          issues.push(issue("error", `${device.label} ${port.name} secondary mask가 올바르지 않습니다`, `${secondary.subnetMask}는 이 랩에서 사용할 수 없습니다.`));
        }
      }
      for (const group of port.hsrpGroups ?? []) {
        if (!isIpv4(group.virtualIp)) {
          issues.push(issue("warning", `${device.label} ${port.name} HSRP group ${group.group} 가상 IP가 없습니다`, "standby <group> ip <address>로 호스트 기본 게이트웨이에 쓸 가상 IP를 지정하세요."));
        } else {
          pushOwner(hsrpOwners, `${portVlan(port)}:${group.group}`, { device, port, group });
          if (port.ipAddress && port.subnetMask && isSubnetMask(port.subnetMask) && !ipInSubnet(group.virtualIp, port.ipAddress, port.subnetMask)) {
            issues.push(issue("error", `${device.label} ${port.name} HSRP 가상 IP가 subnet 밖에 있습니다`, `${group.virtualIp}는 ${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)} 안에 있어야 합니다.`));
          }
          const owner = interfaceOwner(project, group.virtualIp);
          if (owner) {
            issues.push(issue("error", `${device.label} ${port.name} HSRP 가상 IP가 실제 인터페이스 IP와 충돌합니다`, `${group.virtualIp}는 ${owner.device.label} ${owner.port.name}에 이미 설정되어 있습니다.`));
          }
        }
        if (group.trackInterface && !device.ports.some((candidate) => portNameMatches(candidate.name, group.trackInterface!))) {
          issues.push(issue("warning", `${device.label} ${port.name} HSRP track 인터페이스가 없습니다`, `${group.trackInterface}는 이 장비의 인터페이스와 일치하지 않습니다.`));
        }
        if (group.trackObject !== undefined && !(device.config.trackObjects ?? []).some((track) => track.trackId === group.trackObject)) {
          issues.push(issue("warning", `${device.label} ${port.name} HSRP track object가 없습니다`, `Track ${group.trackObject}는 이 장비에 정의되어 있지 않습니다.`));
        }
      }
      for (const group of port.vrrpGroups ?? []) {
        if (!isIpv4(group.virtualIp)) {
          issues.push(issue("warning", `${device.label} ${port.name} VRRP group ${group.group} 가상 IP가 없습니다`, "vrrp <group> ip <address>로 호스트 기본 게이트웨이에 쓸 가상 IP를 지정하세요."));
        } else {
          pushOwner(vrrpOwners, `${portVlan(port)}:${group.group}`, { device, port, group });
          if (port.ipAddress && port.subnetMask && isSubnetMask(port.subnetMask) && !ipInSubnet(group.virtualIp, port.ipAddress, port.subnetMask)) {
            issues.push(issue("error", `${device.label} ${port.name} VRRP 가상 IP가 subnet 밖에 있습니다`, `${group.virtualIp}는 ${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)} 안에 있어야 합니다.`));
          }
          const owner = interfaceOwner(project, group.virtualIp);
          if (owner) {
            issues.push(issue("error", `${device.label} ${port.name} VRRP 가상 IP가 실제 인터페이스 IP와 충돌합니다`, `${group.virtualIp}는 ${owner.device.label} ${owner.port.name}에 이미 설정되어 있습니다.`));
          }
        }
        if (group.trackObject !== undefined && !(device.config.trackObjects ?? []).some((track) => track.trackId === group.trackObject)) {
          issues.push(issue("warning", `${device.label} ${port.name} VRRP track object가 없습니다`, `Track ${group.trackObject}는 이 장비에 정의되어 있지 않습니다.`));
        }
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
      if (
        (device.kind === "pc" || device.kind === "server") &&
        port.gateway &&
        port.ipAddress &&
        port.subnetMask &&
        isIpv4(port.gateway) &&
        isSubnetMask(port.subnetMask) &&
        ipInSubnet(port.gateway, port.ipAddress, port.subnetMask) &&
        !firstHopGatewayExists(project, port.gateway, port.ipAddress, port.subnetMask)
      ) {
        issues.push(issue("warning", `${device.label} gateway가 프로젝트에 없습니다`, `${port.gateway} 주소를 가진 router/SVI/HSRP/VRRP 인터페이스가 없습니다.`));
      }
    }

    const vlanIds = new Set(device.config.vlans.map((vlan) => vlan.id));
    for (const port of device.ports.filter((item) => item.mode === "access")) {
      if (!vlanIds.has(port.vlan)) {
        issues.push(issue("warning", `${device.label} ${port.name}가 없는 VLAN을 사용합니다`, `VLAN ${port.vlan}이 이 장비에 정의되어 있지 않습니다.`));
      }
    }
    for (const channelIssue of diagnoseEtherChannel(device)) {
      issues.push(channelIssue);
    }
    for (const lldpIssue of diagnoseDiscoveryAndSnooping(device)) {
      issues.push(lldpIssue);
    }
    for (const vtpIssue of diagnoseVtpDevice(device)) {
      issues.push(vtpIssue);
    }
    for (const subinterfaceIssue of diagnoseSubinterfaces(device)) {
      issues.push(subinterfaceIssue);
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
  for (const [key, owners] of hsrpOwners) {
    if (owners.length < 2) continue;
    const [, groupId] = key.split(":");
    const virtualIps = owners.map((owner) => owner.group.virtualIp).filter((value, index, list) => value && list.indexOf(value) === index);
    if (virtualIps.length > 1) {
      issues.push(issue("warning", `HSRP group ${groupId} 가상 IP 불일치`, owners.map((owner) => `${owner.device.label} ${owner.port.name}:${owner.group.virtualIp}`).join(", ")));
    }
    const highestPriority = Math.max(...owners.map((owner) => hsrpEffectivePriority(owner.device, owner.group)));
    const topCandidates = owners.filter((owner) => hsrpEffectivePriority(owner.device, owner.group) === highestPriority);
    if (topCandidates.length > 1 && topCandidates.every((owner) => !owner.group.preempt)) {
      issues.push(issue("info", `HSRP group ${groupId} 우선순위가 같습니다`, `${topCandidates.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")}의 effective priority가 ${highestPriority}입니다. 필요하면 priority/preempt를 명확히 설정하세요.`));
    }
  }
  for (const [key, owners] of vrrpOwners) {
    if (owners.length < 2) continue;
    const [, groupId] = key.split(":");
    const virtualIps = owners.map((owner) => owner.group.virtualIp).filter((value, index, list) => value && list.indexOf(value) === index);
    if (virtualIps.length > 1) {
      issues.push(issue("warning", `VRRP group ${groupId} 가상 IP 불일치`, owners.map((owner) => `${owner.device.label} ${owner.port.name}:${owner.group.virtualIp}`).join(", ")));
    }
    const highestPriority = Math.max(...owners.map((owner) => vrrpEffectivePriority(owner.device, owner.group)));
    const topCandidates = owners.filter((owner) => vrrpEffectivePriority(owner.device, owner.group) === highestPriority);
    if (topCandidates.length > 1 && topCandidates.every((owner) => !owner.group.preempt)) {
      issues.push(issue("info", `VRRP group ${groupId} 우선순위가 같습니다`, `${topCandidates.map((owner) => `${owner.device.label} ${owner.port.name}`).join(", ")}의 effective priority가 ${highestPriority}입니다. 필요하면 priority/preempt를 명확히 설정하세요.`));
    }
  }

  return issues;
}

function diagnoseVtpDevice(device: NetworkDevice): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const vtp = device.config.vtp;
  if (!vtp || device.kind !== "switch") return issues;
  if (vtp.mode === "client" && !vtp.domain) {
    issues.push(issue("warning", `${device.label} VTP client domain이 없습니다`, "VTP client는 서버와 같은 domain을 사용해야 VLAN database를 동기화할 수 있습니다."));
  }
  if (vtp.mode === "client" && !device.ports.some((port) => port.mode === "trunk" && port.linkId)) {
    issues.push(issue("info", `${device.label} VTP client trunk 링크가 없습니다`, "VTP 업데이트는 보통 trunk 링크를 통해 전달됩니다."));
  }
  return issues;
}

function diagnoseSubinterfaces(device: NetworkDevice): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const byParentVlan = new Map<string, NetworkPort[]>();
  for (const port of device.ports.filter(isSubinterfacePort)) {
    const parent = parentPort(device, port);
    if (!parent) {
      issues.push(issue("error", `${device.label} ${port.name} parent 인터페이스가 없습니다`, "서브인터페이스 이름의 parent 물리 포트가 장비에 존재해야 합니다."));
      continue;
    }
    if (!port.subinterfaceVlan) {
      issues.push(issue("warning", `${device.label} ${port.name} dot1Q encapsulation이 없습니다`, "router-on-a-stick 서브인터페이스에는 encapsulation dot1Q <vlan> 설정이 필요합니다."));
    } else {
      pushOwner(byParentVlan, `${parent.id}:${port.subinterfaceVlan}`, port);
    }
    if (!parent.linkId) {
      issues.push(issue("info", `${device.label} ${port.name} parent 링크가 없습니다`, `${parent.name} 포트를 trunk/access 스위치 포트에 연결해야 VLAN ${port.subinterfaceVlan ?? "?"} 트래픽을 전달할 수 있습니다.`));
    }
    if (!parent.adminUp) {
      issues.push(issue("warning", `${device.label} ${port.name} parent 포트가 shutdown 상태입니다`, `${parent.name}이 administratively down이면 서브인터페이스도 동작하지 않습니다.`));
    }
  }
  for (const [key, ports] of byParentVlan) {
    if (ports.length > 1) {
      const vlan = key.split(":")[1];
      issues.push(issue("warning", `${device.label} parent VLAN ${vlan} 서브인터페이스가 중복됩니다`, ports.map((port) => port.name).join(", ")));
    }
  }
  return issues;
}

function diagnoseDiscoveryAndSnooping(device: NetworkDevice): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  if (device.config.lldp?.enabled && !device.ports.some((port) => port.lldpTransmit || port.lldpReceive)) {
    issues.push(issue("info", `${device.label} LLDP가 켜졌지만 활성 포트가 없습니다`, "인터페이스에서 lldp transmit 또는 lldp receive를 켜야 LLDP 이웃 확인에 사용할 수 있습니다."));
  }
  const snooping = device.config.dhcpSnooping;
  if (snooping?.enabled) {
    if (!snooping.vlans.length) {
      issues.push(issue("warning", `${device.label} DHCP Snooping VLAN이 없습니다`, "ip dhcp snooping vlan <id>로 보호할 VLAN을 지정하세요."));
    }
    if (!device.ports.some((port) => port.dhcpSnoopingTrusted)) {
      issues.push(issue("warning", `${device.label} DHCP Snooping trusted 포트가 없습니다`, "DHCP 서버 또는 라우터 uplink 방향 인터페이스에 ip dhcp snooping trust가 필요할 수 있습니다."));
    }
  }
  return issues;
}

function diagnoseEtherChannel(device: NetworkDevice): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const groups = new Map<number, NetworkPort[]>();
  for (const port of device.ports.filter((item) => item.channelGroup)) {
    groups.set(port.channelGroup!.id, [...(groups.get(port.channelGroup!.id) ?? []), port]);
  }
  for (const [groupId, ports] of groups) {
    if (ports.length < 2) {
      issues.push(issue("warning", `${device.label} Port-channel ${groupId} 멤버가 부족합니다`, "EtherChannel은 보통 둘 이상의 물리 포트를 같은 channel-group으로 묶어야 의미가 있습니다."));
    }
    const modes = new Set(ports.map((port) => port.channelGroup?.mode));
    if (modes.size > 1) {
      issues.push(issue("warning", `${device.label} Port-channel ${groupId} mode가 섞여 있습니다`, ports.map((port) => `${port.name}:${port.channelGroup?.mode}`).join(", ")));
    }
    const vlans = new Set(ports.map((port) => port.mode === "trunk" ? `trunk:${port.allowedVlans.join(",")}` : `access:${port.vlan}`));
    if (vlans.size > 1) {
      issues.push(issue("warning", `${device.label} Port-channel ${groupId} VLAN 설정이 다릅니다`, "같은 EtherChannel 멤버 포트는 access/trunk VLAN 설정을 맞춰야 합니다."));
    }
  }
  return issues;
}

function isMultilayerSwitch(device: NetworkDevice): boolean {
  return device.modelId === "switch-3560" || device.modelId.startsWith("switch-3560");
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
    if (!canPortUseCable(a.port, link.type) || !canPortUseCable(b.port, link.type)) {
      issues.push(issue("error", "케이블/media 불일치", `${label}: ${link.type} 케이블이 현재 포트 media 설정과 맞지 않습니다.`));
    }
    const fiberProblem = explainFiberOpticsMismatch(a.port, b.port, label, link.type);
    if (fiberProblem) {
      issues.push(issue("error", "광 모듈 불일치", fiberProblem));
    }
    if (link.status === "down") {
      issues.push(issue("warning", "링크 다운", explainDownLink(a.device, a.port, b.device, b.port, label)));
    }
    if (link.status === "up" && !linkOperational(project, link)) {
      issues.push(issue("warning", "링크 상태 불일치", `${label}: 링크는 up으로 저장되어 있지만 끝점 전원 또는 admin state 기준으로는 동작할 수 없습니다. 토폴로지 상태를 다시 계산하세요.`));
    }
    if (link.status === "blocked") {
      issues.push(issue("warning", "링크 차단", `${label}에 공유되는 trunk VLAN이 없습니다.`));
    }
    const vlanProblem = explainVlanMismatch(a.port, b.port, label);
    if (vlanProblem) {
      issues.push(issue("warning", "VLAN 불일치", vlanProblem));
    }
    const vtpProblem = explainVtpMismatch(a.device, a.port, b.device, b.port, label);
    if (vtpProblem) {
      issues.push(issue("warning", "VTP 불일치", vtpProblem));
    }
    const bpduProblem = explainBpduGuardRisk(a.device, a.port, b.device, b.port, label);
    if (bpduProblem) {
      issues.push(issue("warning", "BPDU Guard 위험", bpduProblem));
    }
    const etherChannelProblem = explainEtherChannelMismatch(a.port, b.port, label);
    if (etherChannelProblem) {
      issues.push(issue("warning", "EtherChannel 불일치", etherChannelProblem));
    }
  }
  return issues;
}

type RoutingProtocolConfig = NonNullable<NetworkDevice["config"]["routingProtocols"]>[number];

function diagnoseDynamicRoutingLinks(project: NetworkProject): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  for (const link of project.links.filter((item) => linkOperational(project, item))) {
    const a = endpoint(project, link.endpointA);
    const b = endpoint(project, link.endpointB);
    if (!a || !b || !isRoutingDevice(a.device) || !isRoutingDevice(b.device)) continue;
    if (!a.port.ipAddress || !a.port.subnetMask || !b.port.ipAddress || !b.port.subnetMask) continue;
    if (!ipInSubnet(a.port.ipAddress, b.port.ipAddress, a.port.subnetMask)) continue;
    const leftProtocols = routingProtocols(a.device);
    const rightProtocols = routingProtocols(b.device);
    const compatiblePairs = leftProtocols.flatMap((left) => rightProtocols.filter((right) => routingProtocolsCompatible(left, right)).map((right) => ({ left, right })));
    if (!compatiblePairs.length) {
      const leftAdvertised = leftProtocols.filter((protocol) => routingProtocolAdvertisesPort(protocol, a.port));
      const rightAdvertised = rightProtocols.filter((protocol) => routingProtocolAdvertisesPort(protocol, b.port));
      if (leftAdvertised.length && rightAdvertised.length) {
        issues.push(issue(
          "warning",
          "동적 라우팅 프로토콜 불일치",
          `${a.device.label} ${a.port.name}=${leftAdvertised.map(routingProtocolLabel).join(", ")} / ${b.device.label} ${b.port.name}=${rightAdvertised.map(routingProtocolLabel).join(", ")}. 같은 subnet에서 transit network는 광고되지만 프로토콜 또는 EIGRP process/AS 번호가 맞지 않아 neighbor가 형성되지 않습니다.`
        ));
      }
      continue;
    }
    for (const { left, right } of compatiblePairs) {
      const protocolLabel = routingProtocolLabel(left);
      const leftAdvertises = routingProtocolAdvertisesPort(left, a.port);
      const rightAdvertises = routingProtocolAdvertisesPort(right, b.port);
      if (!leftAdvertises || !rightAdvertises) {
        issues.push(issue(
          "warning",
          `동적 라우팅 transit network 누락 (${protocolLabel})`,
          `${a.device.label} ${a.port.name}=${leftAdvertises ? "advertised" : "missing"} / ${b.device.label} ${b.port.name}=${rightAdvertises ? "advertised" : "missing"}. 같은 subnet의 라우팅 이웃은 양쪽 network statement가 transit interface를 포함해야 합니다.`
        ));
      }
      const leftPassive = routingPortPassive(left, a.port);
      const rightPassive = routingPortPassive(right, b.port);
      if (leftPassive || rightPassive) {
        issues.push(issue(
          "warning",
          `동적 라우팅 passive interface (${protocolLabel})`,
          `${a.device.label} ${a.port.name}=${leftPassive ? "passive" : "active"} / ${b.device.label} ${b.port.name}=${rightPassive ? "passive" : "active"}. passive-interface에서는 라우팅 neighbor가 형성되지 않습니다.`
        ));
      }
      if (leftAdvertises && rightAdvertises && !leftPassive && !rightPassive) {
        const leftMissing = dynamicRoutingUnadvertisedConnectedNetworks(project, a.device, left, a.port);
        const rightMissing = dynamicRoutingUnadvertisedConnectedNetworks(project, b.device, right, b.port);
        if (leftMissing.length || rightMissing.length) {
          const details = [
            ...leftMissing.map((entry) => `${a.device.label} ${entry.portName} ${entry.prefix}`),
            ...rightMissing.map((entry) => `${b.device.label} ${entry.portName} ${entry.prefix}`)
          ];
          issues.push(issue(
            "warning",
            `동적 라우팅 연결망 미광고 (${protocolLabel})`,
            `${a.device.label}와 ${b.device.label}의 neighbor는 형성되지만 ${details.join(", ")} connected network가 network statement에 없습니다. 해당 LAN은 이웃 라우터가 동적으로 학습하지 못합니다.`
          ));
        }
      }
    }
  }
  return issues;
}

interface Layer2LoopEdge {
  aDeviceId: string;
  bDeviceId: string;
  label: string;
}

function diagnoseLayer2Loops(project: NetworkProject): NetworkIssue[] {
  const edgesByVlan = new Map<number, Map<string, Layer2LoopEdge>>();
  for (const link of project.links.filter((item) => linkOperational(project, item))) {
    const a = endpoint(project, link.endpointA);
    const b = endpoint(project, link.endpointB);
    if (!a || !b || !canForwardLayer2(a.device) || !canForwardLayer2(b.device)) continue;
    for (const vlan of sharedVlans(a.port, b.port)) {
      const bundleKey = logicalLayer2EdgeKey(link.id, a.device.id, a.port, b.device.id, b.port);
      const byKey = edgesByVlan.get(vlan) ?? new Map<string, Layer2LoopEdge>();
      byKey.set(bundleKey, { aDeviceId: a.device.id, bDeviceId: b.device.id, label: linkLabel(project, link) });
      edgesByVlan.set(vlan, byKey);
    }
  }

  const issues: NetworkIssue[] = [];
  for (const [vlan, edgeMap] of edgesByVlan) {
    const edges = [...edgeMap.values()];
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      adjacency.set(edge.aDeviceId, new Set([...(adjacency.get(edge.aDeviceId) ?? []), edge.bDeviceId]));
      adjacency.set(edge.bDeviceId, new Set([...(adjacency.get(edge.bDeviceId) ?? []), edge.aDeviceId]));
    }
    const visited = new Set<string>();
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      const stack = [start];
      const component = new Set<string>();
      visited.add(start);
      while (stack.length) {
        const current = stack.pop()!;
        component.add(current);
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          stack.push(next);
        }
      }
      const componentEdges = edges.filter((edge) => component.has(edge.aDeviceId) && component.has(edge.bDeviceId));
      if (componentEdges.length >= component.size) {
        const devices = [...component].map((id) => project.devices.find((device) => device.id === id)?.label ?? id).sort();
        issues.push(issue(
          "warning",
          `VLAN ${vlan} Layer 2 loop 가능성`,
          `${devices.join(", ")} 사이에 ${componentEdges.length}개 L2 경로가 있어 순환 구조가 됩니다. STP root/blocked 포트, EtherChannel bundle, 또는 불필요한 링크 제거를 확인하세요.`
        ));
      }
    }
  }
  return issues;
}

function explainFiberOpticsMismatch(aPort: NetworkPort, bPort: NetworkPort, label: string, linkType: string): string {
  if (linkType !== "fiber") return "";
  if (effectivePortKind(aPort) !== "fiber" || effectivePortKind(bPort) !== "fiber") return "";
  const aTransceiver = getTransceiverSpec(aPort.transceiverId);
  const bTransceiver = getTransceiverSpec(bPort.transceiverId);
  if (!aTransceiver || !bTransceiver) return `${label}: 양쪽 fiber 포트 모두 optical transceiver가 필요합니다.`;
  if (aTransceiver.media === "copper" || bTransceiver.media === "copper") return `${label}: 1000BASE-T 같은 copper SFP는 fiber cable과 연결할 수 없습니다.`;
  if (!transceiverCompatibleWithPort(aTransceiver, aPort)) return `${label}: ${aPort.name}에는 ${aTransceiver.label} 속도가 맞지 않습니다.`;
  if (!transceiverCompatibleWithPort(bTransceiver, bPort)) return `${label}: ${bPort.name}에는 ${bTransceiver.label} 속도가 맞지 않습니다.`;
  if (!transceiversShareFiberMedia(aTransceiver, bTransceiver)) return `${label}: ${aTransceiver.label}(${transceiverMediaLabel(aTransceiver)})와 ${bTransceiver.label}(${transceiverMediaLabel(bTransceiver)}) 광 매체가 다릅니다.`;
  if (aTransceiver.speedMbps !== bTransceiver.speedMbps) return `${label}: ${aTransceiver.speedMbps} Mbps optic과 ${bTransceiver.speedMbps} Mbps optic은 같은 fiber link로 올라오지 않습니다.`;
  return "";
}

function explainBpduGuardRisk(aDevice: NetworkDevice, aPort: NetworkPort, bDevice: NetworkDevice, bPort: NetworkPort, label: string): string {
  if (aPort.bpduGuard && aPort.stpPortfast && bDevice.kind === "switch") {
    return `${label}: ${aDevice.label} ${aPort.name}는 PortFast/BPDU Guard edge 포트인데 스위치에 연결되어 있습니다.`;
  }
  if (bPort.bpduGuard && bPort.stpPortfast && aDevice.kind === "switch") {
    return `${label}: ${bDevice.label} ${bPort.name}는 PortFast/BPDU Guard edge 포트인데 스위치에 연결되어 있습니다.`;
  }
  return "";
}

function explainEtherChannelMismatch(aPort: NetworkPort, bPort: NetworkPort, label: string): string {
  const aChannel = aPort.channelGroup;
  const bChannel = bPort.channelGroup;
  if (!aChannel && !bChannel) return "";
  if (!aChannel || !bChannel) {
    return `${label}: 한쪽 포트만 channel-group에 속해 있습니다. EtherChannel 멤버는 양쪽 포트를 같은 bundle 정책으로 맞춰야 합니다.`;
  }
  if (aChannel.id !== bChannel.id) {
    return `${label}: channel-group ${aChannel.id}와 ${bChannel.id}가 서로 다릅니다.`;
  }
  if (!channelModesCompatible(aChannel.mode, bChannel.mode)) {
    return `${label}: channel-group ${aChannel.id} mode ${aChannel.mode}/${bChannel.mode} 조합은 협상되지 않습니다.`;
  }
  return "";
}

function channelModesCompatible(left: NonNullable<NetworkPort["channelGroup"]>["mode"], right: NonNullable<NetworkPort["channelGroup"]>["mode"]): boolean {
  if (left === "on" || right === "on") return left === "on" && right === "on";
  const lacpModes = new Set(["active", "passive"]);
  if (lacpModes.has(left) || lacpModes.has(right)) return lacpModes.has(left) && lacpModes.has(right) && (left === "active" || right === "active");
  const pagpModes = new Set(["desirable", "auto"]);
  if (pagpModes.has(left) || pagpModes.has(right)) return pagpModes.has(left) && pagpModes.has(right) && (left === "desirable" || right === "desirable");
  return false;
}

function explainVtpMismatch(aDevice: NetworkDevice, aPort: NetworkPort, bDevice: NetworkDevice, bPort: NetworkPort, label: string): string {
  if (aDevice.kind !== "switch" || bDevice.kind !== "switch") return "";
  if (aPort.mode !== "trunk" || bPort.mode !== "trunk") return "";
  const a = aDevice.config.vtp;
  const b = bDevice.config.vtp;
  if (!a || !b || a.mode === "off" || b.mode === "off" || a.mode === "transparent" || b.mode === "transparent") return "";
  if (a.domain && b.domain && a.domain.toLowerCase() !== b.domain.toLowerCase()) {
    return `${label}: VTP domain ${a.domain}과 ${b.domain}이 일치하지 않습니다.`;
  }
  if (a.version !== b.version) {
    return `${label}: VTP version ${a.version}과 ${b.version}이 일치하지 않습니다.`;
  }
  if ((a.password || "") !== (b.password || "")) {
    return `${label}: VTP password 설정이 일치하지 않습니다.`;
  }
  return "";
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
      if (!interfaceIpEntries(device).some((entry) => ipInSubnet(route.nextHop, entry.ipAddress, entry.subnetMask))) {
        issues.push(issue("warning", `${device.label} route next-hop이 연결된 subnet에 없습니다`, `${route.nextHop}는 이 장비의 활성 인터페이스에서 도달할 수 없습니다.`));
      }
      if (!nextHopAssignedExists(project, device.id, route.nextHop)) {
        issues.push(issue("warning", `${device.label} route next-hop이 할당되지 않았습니다`, `${route.nextHop}를 가진 전원 켜진 장비가 없습니다.`));
      }
      if (route.trackId !== undefined && !(device.config.trackObjects ?? []).some((track) => track.trackId === route.trackId)) {
        issues.push(issue("warning", `${device.label} static route track object가 없습니다`, `${route.network} ${route.mask} route가 Track ${route.trackId}를 참조하지만 해당 track object가 없습니다.`));
      }
    }
    for (const trackIssue of diagnoseIpSlaAndTracking(device)) {
      issues.push(trackIssue);
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
    const prefixListNames = new Set((device.config.prefixLists ?? []).map((entry) => entry.name.toLowerCase()));
    const routeMapNames = new Set((device.config.routeMaps ?? []).map((entry) => entry.name.toLowerCase()));
    for (const entry of device.config.prefixLists ?? []) {
      const prefixLength = prefixLengthOf(entry.prefix);
      if (prefixLength < 0) {
        issues.push(issue("error", `${device.label} prefix-list ${entry.name} prefix가 올바르지 않습니다`, `${entry.prefix}는 <network>/<prefix-length> 형식의 IPv4 prefix여야 합니다.`));
      }
      if ((entry.ge !== undefined && entry.ge < prefixLength) || (entry.le !== undefined && entry.le < prefixLength) || (entry.ge !== undefined && entry.le !== undefined && entry.ge > entry.le)) {
        issues.push(issue("warning", `${device.label} prefix-list ${entry.name} ge/le 범위가 올바르지 않습니다`, `seq ${entry.sequence}의 ge/le 값은 prefix length ${prefixLength} 이상이며 ge가 le보다 크면 안 됩니다.`));
      }
    }
    for (const port of device.ports) {
      for (const listName of [port.accessGroupIn, port.accessGroupOut].filter(Boolean)) {
        if (listName && !aclNames.has(listName.toLowerCase())) {
          issues.push(issue("warning", `${device.label} ${port.name} ACL 참조가 비어 있습니다`, `ip access-group ${listName}에 해당하는 access-list가 없습니다.`));
        }
      }
      if (port.policyRouteMap) {
        if (port.mode !== "routed" && device.kind !== "pc" && device.kind !== "server") {
          issues.push(issue("warning", `${device.label} ${port.name} PBR이 Layer 2 포트에 적용되었습니다`, "ip policy route-map은 routed 인터페이스 또는 SVI/subinterface에 적용하세요."));
        }
        if (!routeMapNames.has(port.policyRouteMap.toLowerCase())) {
          issues.push(issue("warning", `${device.label} ${port.name} PBR route-map이 없습니다`, `ip policy route-map ${port.policyRouteMap}에 해당하는 route-map 설정이 없습니다.`));
        }
      }
    }
    for (const entry of device.config.routeMaps ?? []) {
      for (const listName of entry.matchAccessLists) {
        if (!aclNames.has(listName.toLowerCase())) {
          issues.push(issue("warning", `${device.label} route-map ${entry.name} ACL 참조가 없습니다`, `match ip address ${listName}에 해당하는 access-list가 없습니다.`));
        }
      }
      for (const listName of entry.matchPrefixLists ?? []) {
        if (!prefixListNames.has(listName.toLowerCase())) {
          issues.push(issue("warning", `${device.label} route-map ${entry.name} prefix-list 참조가 없습니다`, `match ip address prefix-list ${listName}에 해당하는 ip prefix-list가 없습니다.`));
        }
      }
      if (entry.action === "permit" && !entry.setNextHop) {
        issues.push(issue("info", `${device.label} route-map ${entry.name} next-hop이 없습니다`, "permit route-map에서 set ip next-hop이 없으면 매칭 후에도 일반 라우팅 테이블을 사용합니다."));
      }
      if (entry.setNextHop && !isIpv4(entry.setNextHop)) {
        issues.push(issue("error", `${device.label} route-map ${entry.name} next-hop이 올바르지 않습니다`, `${entry.setNextHop}는 IPv4 주소여야 합니다.`));
      } else if (entry.setNextHop && !interfaceIpEntries(device).some((item) => ipInSubnet(entry.setNextHop!, item.ipAddress, item.subnetMask))) {
        issues.push(issue("warning", `${device.label} route-map ${entry.name} next-hop이 연결된 subnet에 없습니다`, `${entry.setNextHop}는 이 장비의 활성 routed 인터페이스에서 직접 도달할 수 없습니다.`));
      }
    }
    for (const rule of device.config.natRules) {
      if (rule.type === "overload") {
        if (!rule.aclName || !aclNames.has(rule.aclName.toLowerCase())) {
          issues.push(issue("warning", `${device.label} NAT overload ACL이 없습니다`, `ip nat inside source list ${rule.aclName || "(empty)"}에 해당하는 access-list가 없습니다.`));
        }
        const outsideName = rule.interfaceName || rule.outsideInterface;
        if (!outsideName || !device.ports.some((port) => port.name === outsideName)) {
          issues.push(issue("warning", `${device.label} NAT overload outside interface가 없습니다`, `${outsideName || "(empty)"}는 이 장비의 포트와 일치하지 않습니다.`));
        }
        continue;
      }
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
    const port = device.ports.find((item) => item.ipAddress === ipAddress || (item.secondaryIpAddresses ?? []).some((address) => address.ipAddress === ipAddress));
    if (port) return { device, port };
  }
  return null;
}

function interfaceIpEntries(device: NetworkDevice): Array<{ port: NetworkPort; ipAddress: string; subnetMask: string; secondary: boolean }> {
  return device.ports
    .filter((port) => port.adminUp)
    .flatMap((port) => [
      ...(port.ipAddress && port.subnetMask ? [{ port, ipAddress: port.ipAddress, subnetMask: port.subnetMask, secondary: false }] : []),
      ...(port.secondaryIpAddresses ?? []).map((address) => ({ port, ipAddress: address.ipAddress, subnetMask: address.subnetMask, secondary: true }))
    ])
    .filter((entry) => isIpv4(entry.ipAddress) && isSubnetMask(entry.subnetMask));
}

function diagnoseIpSlaAndTracking(device: NetworkDevice): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  const operations = device.config.ipSlaOperations ?? [];
  const tracks = device.config.trackObjects ?? [];
  const operationCounts = new Map<number, number>();
  const trackCounts = new Map<number, number>();

  for (const operation of operations) {
    operationCounts.set(operation.operationId, (operationCounts.get(operation.operationId) ?? 0) + 1);
    if (!Number.isInteger(operation.operationId) || operation.operationId < 1) {
      issues.push(issue("error", `${device.label} IP SLA operation ID가 올바르지 않습니다`, `IP SLA ${operation.operationId}는 1 이상의 정수여야 합니다.`));
    }
    if (!operation.targetIp || !isIpv4(operation.targetIp)) {
      issues.push(issue("error", `${device.label} IP SLA ${operation.operationId} 대상 IP가 올바르지 않습니다`, `${operation.targetIp || "(empty)"}는 icmp-echo 대상 IPv4 주소여야 합니다.`));
    }
    if (operation.sourceInterface) {
      const sourcePort = device.ports.find((port) => portNameMatches(port.name, operation.sourceInterface!));
      if (!sourcePort) {
        issues.push(issue("warning", `${device.label} IP SLA ${operation.operationId} source-interface가 없습니다`, `${operation.sourceInterface}는 이 장비의 인터페이스와 일치하지 않습니다.`));
      } else if (!sourcePort.adminUp || !sourcePort.ipAddress) {
        issues.push(issue("warning", `${device.label} IP SLA ${operation.operationId} source-interface가 활성 상태가 아닙니다`, `${sourcePort.name}에 admin up 상태와 IPv4 주소가 필요합니다.`));
      }
    } else if (operation.enabled && interfaceIpEntries(device).length === 0) {
      issues.push(issue("warning", `${device.label} IP SLA ${operation.operationId} 소스 인터페이스가 없습니다`, "활성 IPv4 인터페이스가 없어 icmp-echo를 보낼 수 없습니다."));
    }
    if (!Number.isFinite(operation.frequency) || operation.frequency < 1 || operation.frequency > 604800) {
      issues.push(issue("error", `${device.label} IP SLA ${operation.operationId} frequency가 올바르지 않습니다`, "frequency는 1부터 604800초 사이여야 합니다."));
    }
    if (!Number.isFinite(operation.timeout) || operation.timeout < 1 || operation.timeout > 60000) {
      issues.push(issue("error", `${device.label} IP SLA ${operation.operationId} timeout이 올바르지 않습니다`, "timeout은 1부터 60000밀리초 사이여야 합니다."));
    }
    if (!Number.isFinite(operation.threshold) || operation.threshold < 1 || operation.threshold > 60000) {
      issues.push(issue("error", `${device.label} IP SLA ${operation.operationId} threshold가 올바르지 않습니다`, "threshold는 1부터 60000밀리초 사이여야 합니다."));
    }
  }

  for (const [operationId, count] of operationCounts) {
    if (count > 1) {
      issues.push(issue("warning", `${device.label} IP SLA ${operationId}가 중복되었습니다`, `operation ${operationId}가 ${count}번 정의되어 마지막 설정만 예측 가능하게 동작합니다.`));
    }
  }

  const operationIds = new Set(operations.map((operation) => operation.operationId));
  for (const track of tracks) {
    trackCounts.set(track.trackId, (trackCounts.get(track.trackId) ?? 0) + 1);
    if (!Number.isInteger(track.trackId) || track.trackId < 1) {
      issues.push(issue("error", `${device.label} track object ID가 올바르지 않습니다`, `Track ${track.trackId}는 1 이상의 정수여야 합니다.`));
    }
    if (track.type === "interface") {
      if (!track.interfaceName) {
        issues.push(issue("warning", `${device.label} Track ${track.trackId} 인터페이스가 없습니다`, "interface line-protocol track에는 인터페이스 이름이 필요합니다."));
      } else if (!device.ports.some((port) => portNameMatches(port.name, track.interfaceName!))) {
        issues.push(issue("warning", `${device.label} Track ${track.trackId} 인터페이스를 찾을 수 없습니다`, `${track.interfaceName}는 이 장비의 인터페이스와 일치하지 않습니다.`));
      }
      if (track.mode !== "line-protocol") {
        issues.push(issue("warning", `${device.label} Track ${track.trackId} 모드가 인터페이스 track과 맞지 않습니다`, "interface track은 line-protocol 모드를 사용해야 합니다."));
      }
    }
    if (track.type === "ip-sla") {
      if (track.ipSlaOperationId === undefined || !operationIds.has(track.ipSlaOperationId)) {
        issues.push(issue("warning", `${device.label} Track ${track.trackId} IP SLA operation이 없습니다`, `IP SLA ${track.ipSlaOperationId ?? "(empty)"} 설정을 먼저 만들어야 합니다.`));
      }
      if (track.mode !== "reachability") {
        issues.push(issue("warning", `${device.label} Track ${track.trackId} 모드가 IP SLA track과 맞지 않습니다`, "IP SLA track은 reachability 모드를 사용해야 합니다."));
      }
    }
  }

  for (const [trackId, count] of trackCounts) {
    if (count > 1) {
      issues.push(issue("warning", `${device.label} Track ${trackId}가 중복되었습니다`, `track object ${trackId}가 ${count}번 정의되어 참조 결과가 모호합니다.`));
    }
  }

  return issues;
}

function firstHopGatewayExists(project: NetworkProject, gateway: string, hostIp: string, hostMask: string): boolean {
  if (!ipInSubnet(gateway, hostIp, hostMask)) return false;
  return project.devices.some((device) =>
    device.powerOn &&
    device.ports.some((port) =>
      port.adminUp &&
      (interfaceGatewayOwner(gateway, port.ipAddress, port.subnetMask) ||
        (port.secondaryIpAddresses ?? []).some((address) => interfaceGatewayOwner(gateway, address.ipAddress, address.subnetMask)) ||
        (port.hsrpGroups ?? []).some((group) => group.virtualIp === gateway && ownerSubnetContains(gateway, port.ipAddress, port.subnetMask)) ||
        (port.vrrpGroups ?? []).some((group) => group.virtualIp === gateway && ownerSubnetContains(gateway, port.ipAddress, port.subnetMask)))
    )
  );
}

function interfaceGatewayOwner(gateway: string, ownerIp: string, ownerMask: string): boolean {
  return ownerIp === gateway && isIpv4(ownerIp) && isSubnetMask(ownerMask) && ipInSubnet(gateway, ownerIp, ownerMask);
}

function ownerSubnetContains(gateway: string, ownerIp: string, ownerMask: string): boolean {
  return isIpv4(ownerIp) && isSubnetMask(ownerMask) && ipInSubnet(gateway, ownerIp, ownerMask);
}

function nextHopAssignedExists(project: NetworkProject, sourceDeviceId: string, nextHop: string): boolean {
  return project.devices.some((device) =>
    device.id !== sourceDeviceId &&
    device.powerOn &&
    device.ports.some((port) =>
      port.adminUp &&
      (port.ipAddress === nextHop ||
        (port.secondaryIpAddresses ?? []).some((address) => address.ipAddress === nextHop) ||
        (port.hsrpGroups ?? []).some((group) => group.virtualIp === nextHop) ||
        (port.vrrpGroups ?? []).some((group) => group.virtualIp === nextHop))
    )
  );
}

function hsrpEffectivePriority(device: NetworkDevice, group: NonNullable<NetworkPort["hsrpGroups"]>[number]): number {
  const trackedPort = group.trackInterface ? device.ports.find((port) => portNameMatches(port.name, group.trackInterface!)) : undefined;
  const trackedDown = Boolean(group.trackInterface && (!trackedPort || !device.powerOn || !trackedPort.adminUp || !trackedPort.linkId));
  const trackObjectDown = group.trackObject !== undefined && !trackObjectLikelyUp(device, group.trackObject);
  return Math.max(0, group.priority - (trackedDown || trackObjectDown ? group.trackDecrement ?? 10 : 0));
}

function vrrpEffectivePriority(device: NetworkDevice, group: NonNullable<NetworkPort["vrrpGroups"]>[number]): number {
  const trackObjectDown = group.trackObject !== undefined && !trackObjectLikelyUp(device, group.trackObject);
  return Math.max(0, group.priority - (trackObjectDown ? group.trackDecrement ?? 10 : 0));
}

function trackObjectLikelyUp(device: NetworkDevice, trackId: number): boolean {
  const track = (device.config.trackObjects ?? []).find((item) => item.trackId === trackId);
  if (!track || !device.powerOn) return false;
  if (track.type === "interface") {
    const port = track.interfaceName ? device.ports.find((candidate) => portNameMatches(candidate.name, track.interfaceName!)) : undefined;
    return Boolean(port?.adminUp && port.linkId);
  }
  if (track.type === "ip-sla") {
    const operation = (device.config.ipSlaOperations ?? []).find((item) => item.operationId === track.ipSlaOperationId);
    const sourcePort = operation?.sourceInterface ? device.ports.find((candidate) => portNameMatches(candidate.name, operation.sourceInterface!)) : undefined;
    const sourceReady = sourcePort ? sourcePort.adminUp && Boolean(sourcePort.ipAddress) : interfaceIpEntries(device).length > 0;
    return Boolean(operation?.enabled && isIpv4(operation.targetIp) && sourceReady);
  }
  return false;
}

function portVlan(port: NetworkPort): number {
  if (port.subinterfaceVlan) return port.subinterfaceVlan;
  return port.mode === "trunk" ? port.allowedVlans[0] ?? 1 : port.vlan;
}

function prefixLengthOf(value: string): number {
  const [network, prefixText] = value.split("/");
  const prefix = Number(prefixText);
  return isIpv4(network) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 ? prefix : -1;
}

function canForwardLayer2(device: NetworkDevice): boolean {
  return device.kind === "switch" || device.kind === "hub" || device.kind === "wireless";
}

function sharedVlans(a: NetworkPort, b: NetworkPort): number[] {
  const aVlans = portVlans(a);
  const bVlans = portVlans(b);
  return [...aVlans].filter((vlan) => bVlans.has(vlan));
}

function linkCarriesVlan(a: NetworkPort, b: NetworkPort, vlan: number): boolean {
  return sharedVlans(a, b).includes(vlan);
}

function portVlans(port: NetworkPort): Set<number> {
  if (port.mode === "trunk") return new Set([...port.allowedVlans, port.nativeVlan ?? 1]);
  if (port.subinterfaceVlan) return new Set([port.subinterfaceVlan]);
  return new Set([port.vlan]);
}

function logicalLayer2EdgeKey(linkId: string, aDeviceId: string, aPort: NetworkPort, bDeviceId: string, bPort: NetworkPort): string {
  const aChannel = aPort.channelGroup?.id;
  const bChannel = bPort.channelGroup?.id;
  if (aChannel !== undefined && aChannel === bChannel) {
    return `${[aDeviceId, bDeviceId].sort().join("<->")}:channel-${aChannel}`;
  }
  return linkId;
}

function routingProtocols(device: NetworkDevice): RoutingProtocolConfig[] {
  return device.config.routingProtocols ?? [];
}

function routingProtocolsCompatible(left: RoutingProtocolConfig, right: RoutingProtocolConfig): boolean {
  if (left.protocol !== right.protocol) return false;
  if (left.protocol === "eigrp") return (left.processId ?? "") === (right.processId ?? "");
  return true;
}

function routingProtocolLabel(protocol: RoutingProtocolConfig): string {
  return `${protocol.protocol.toUpperCase()}${protocol.processId ? ` ${protocol.processId}` : ""}`;
}

function routingProtocolAdvertisesPort(protocol: RoutingProtocolConfig, port: NetworkPort): boolean {
  if (!port.ipAddress || !port.subnetMask || !protocol.networks.length) return false;
  return protocol.networks.some((network) => routingNetworkIncludesPort(network, port, protocol.protocol));
}

function dynamicRoutingUnadvertisedConnectedNetworks(project: NetworkProject, device: NetworkDevice, protocol: RoutingProtocolConfig, transitPort: NetworkPort): Array<{ portName: string; prefix: string }> {
  const missing = new Map<string, { portName: string; prefix: string }>();
  for (const entry of interfaceIpEntries(device)) {
    if (entry.port.id === transitPort.id || entry.secondary) continue;
    if (routingProtocolAdvertisesPort(protocol, entry.port)) continue;
    if (!connectedNetworkHasEndpoint(project, device, entry.port, entry.ipAddress, entry.subnetMask)) continue;
    const prefix = `${networkAddress(entry.ipAddress, entry.subnetMask)}/${maskToPrefix(entry.subnetMask)}`;
    missing.set(`${entry.port.id}:${prefix}`, { portName: entry.port.name, prefix });
  }
  return [...missing.values()];
}

function connectedNetworkHasEndpoint(project: NetworkProject, owner: NetworkDevice, port: NetworkPort, ipAddress: string, subnetMask: string): boolean {
  return project.devices.some((device) =>
    device.id !== owner.id &&
    device.powerOn &&
    !isRoutingDevice(device) &&
    device.ports.some((candidate) =>
      candidate.adminUp &&
      candidate.ipAddress &&
      candidate.subnetMask &&
      ipInSubnet(candidate.ipAddress, ipAddress, subnetMask) &&
      layer2EndpointReachable(project, owner.id, port, device.id, candidate.id)
    )
  );
}

function layer2EndpointReachable(project: NetworkProject, sourceDeviceId: string, sourcePort: NetworkPort, targetDeviceId: string, targetPortId: string): boolean {
  const vlan = portVlan(sourcePort);
  const seen = new Set([sourceDeviceId]);
  const queue = [sourceDeviceId];
  while (queue.length) {
    const current = queue.shift()!;
    const currentDevice = project.devices.find((device) => device.id === current);
    if (!currentDevice?.powerOn) continue;
    if (current !== sourceDeviceId && current !== targetDeviceId && !canForwardLayer2(currentDevice)) continue;
    for (const link of project.links.filter((item) => linkOperational(project, item) && (item.endpointA.deviceId === current || item.endpointB.deviceId === current))) {
      const currentEndpoint = link.endpointA.deviceId === current ? link.endpointA : link.endpointB;
      if (current === sourceDeviceId && currentEndpoint.portId !== sourcePort.id) continue;
      const otherEndpoint = link.endpointA.deviceId === current ? link.endpointB : link.endpointA;
      const currentPort = endpoint(project, currentEndpoint)?.port;
      const other = endpoint(project, otherEndpoint);
      if (!currentPort || !other || !currentPort.adminUp || !other.port.adminUp || !other.device.powerOn || !linkCarriesVlan(currentPort, other.port, vlan)) continue;
      if (other.device.id === targetDeviceId && other.port.id === targetPortId) return true;
      if (!seen.has(other.device.id)) {
        seen.add(other.device.id);
        queue.push(other.device.id);
      }
    }
  }
  return false;
}

function linkOperational(project: NetworkProject, link: NetworkProject["links"][number]): boolean {
  if (link.status !== "up") return false;
  const a = endpoint(project, link.endpointA);
  const b = endpoint(project, link.endpointB);
  return Boolean(a?.device.powerOn && b?.device.powerOn && a.port.adminUp && b.port.adminUp);
}

function routingNetworkIncludesPort(network: string, port: NetworkPort, protocol: RoutingProtocolConfig["protocol"]): boolean {
  const statement = network.trim();
  if (!statement || !isIpv4(port.ipAddress) || !isSubnetMask(port.subnetMask)) return false;
  const cidr = statement.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (cidr) {
    const [, base, prefixText] = cidr;
    const prefix = Number(prefixText);
    return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 && ipInSubnet(port.ipAddress, base, prefixToMask(prefix));
  }
  const [base, maskOrWildcard] = statement.split(/\s+/);
  if (!isIpv4(base)) return false;
  if (maskOrWildcard) {
    if (!isIpv4(maskOrWildcard)) return false;
    return isSubnetMask(maskOrWildcard) ? ipInSubnet(port.ipAddress, base, maskOrWildcard) : ipMatchesWildcard(port.ipAddress, base, maskOrWildcard);
  }
  if (networkAddress(port.ipAddress, port.subnetMask) === base) return true;
  if (protocol === "ospf") return false;
  return ipInSubnet(port.ipAddress, base, classfulMask(base));
}

function routingPortPassive(protocol: RoutingProtocolConfig, port: NetworkPort): boolean {
  if (protocol.passiveInterfaceDefault) {
    return !(protocol.passiveInterfaceExceptions ?? []).some((name) => portNameMatches(port.name, name));
  }
  return protocol.passiveInterfaces.some((name) => portNameMatches(port.name, name));
}

function isRoutingDevice(device: NetworkDevice): boolean {
  if (device.kind === "router" || device.kind === "firewall") return true;
  if (device.kind !== "switch") return false;
  return isMultilayerSwitch(device) || device.ports.some((port) => port.name.toLowerCase().startsWith("vlan") && port.adminUp && port.ipAddress && port.subnetMask);
}

function classfulMask(ipAddress: string): string {
  const firstOctet = Number(ipAddress.split(".")[0]);
  if (firstOctet < 128) return "255.0.0.0";
  if (firstOctet < 192) return "255.255.0.0";
  return "255.255.255.0";
}

function ipMatchesWildcard(ipAddress: string, network: string, wildcard: string): boolean {
  if (!isIpv4(ipAddress) || !isIpv4(network) || !isIpv4(wildcard)) return false;
  const inverseWildcard = (~ipToNumber(wildcard)) >>> 0;
  return ((ipToNumber(ipAddress) ^ ipToNumber(network)) & inverseWildcard) === 0;
}

function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join(".");
}

function isSubinterfacePort(port: NetworkPort): boolean {
  return Boolean(port.parentPortId || /\.\d+$/.test(port.name));
}

function parentPort(device: NetworkDevice, port: NetworkPort): NetworkPort | undefined {
  if (port.parentPortId) return device.ports.find((candidate) => candidate.id === port.parentPortId);
  const match = port.name.match(/^(.+)\.\d+$/);
  return match ? device.ports.find((candidate) => portNameMatches(candidate.name, match[1])) : undefined;
}

function portNameMatches(portName: string, query: string): boolean {
  const wanted = normalizePortName(query);
  const normalized = normalizePortName(portName);
  return normalized === wanted || compactPortAlias(portName) === wanted;
}

function normalizePortName(name: string): string {
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.startsWith("fastethernet")) return compact;
  if (compact.startsWith("gigabitethernet")) return compact;
  if (compact.startsWith("tengigabitethernet")) return compact;
  if (compact.startsWith("serial")) return compact;
  if (compact.startsWith("vlan")) return compact;
  if (compact.startsWith("fa")) return compact.replace(/^fa/, "fastethernet");
  if (compact.startsWith("f")) return compact.replace(/^f/, "fastethernet");
  if (compact.startsWith("gi")) return compact.replace(/^gi/, "gigabitethernet");
  if (compact.startsWith("g")) return compact.replace(/^g/, "gigabitethernet");
  if (compact.startsWith("te")) return compact.replace(/^te/, "tengigabitethernet");
  if (compact.startsWith("ten")) return compact.replace(/^ten/, "tengigabitethernet");
  if (compact.startsWith("se")) return compact.replace(/^se/, "serial");
  if (compact.startsWith("s")) return compact.replace(/^s/, "serial");
  return compact;
}

function compactPortAlias(name: string): string {
  return normalizePortName(name).replace("fastethernet", "f").replace("tengigabitethernet", "te").replace("gigabitethernet", "g").replace("serial", "s");
}

function pushOwner<T>(map: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), value]);
}

function issue(severity: NetworkIssueSeverity, title: string, detail: string): NetworkIssue {
  return { id: `${severity}:${title}:${detail}`, severity, title, detail };
}
