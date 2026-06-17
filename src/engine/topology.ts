import type { CableType, LinkEndpoint, LinkStatus, NetworkDevice, NetworkLink, NetworkProject, NetworkPort } from "../types/network";
import { makeId } from "../utils/ids";

function endpointPort(project: NetworkProject, endpoint: LinkEndpoint): { device: NetworkDevice; port: NetworkPort } | null {
  const device = project.devices.find((entry) => entry.id === endpoint.deviceId);
  const port = device?.ports.find((entry) => entry.id === endpoint.portId);
  return device && port ? { device, port } : null;
}

function portInUse(project: NetworkProject, endpoint: LinkEndpoint): boolean {
  const info = endpointPort(project, endpoint);
  if (info?.device.type === "wireless" && info.port.kind === "wireless") return false;
  return project.links.some(
    (link) =>
      (link.a.deviceId === endpoint.deviceId && link.a.portId === endpoint.portId) ||
      (link.b.deviceId === endpoint.deviceId && link.b.portId === endpoint.portId),
  );
}

function portLabel(project: NetworkProject, endpoint: LinkEndpoint): string {
  const info = endpointPort(project, endpoint);
  return `${info?.device.label ?? "Unknown"} ${info?.port.name ?? "port"}`;
}

export function requiredModuleForPort(device: NetworkDevice, port: NetworkPort): string | undefined {
  return port.requiredModule ?? (device.type === "router" && port.kind === "serial" ? "2T" : undefined);
}

export function isPortAvailable(device: NetworkDevice, port: NetworkPort): boolean {
  const requiredModule = requiredModuleForPort(device, port);
  if (!requiredModule) return true;
  return device.moduleSlots.some((slot) => {
    const installed = slot.installedModule ?? "";
    return installed !== "Blank" && installed.includes(requiredModule);
  });
}

export interface ConnectionValidation {
  ok: boolean;
  message: string;
}

export function canCableConnect(type: CableType, a: NetworkPort, b: NetworkPort): boolean {
  if (type === "wireless") return a.kind === "wireless" && b.kind === "wireless";
  if (type === "console") return a.kind === "console" && b.kind === "console";
  if (type === "serial-dce" || type === "serial-dte") return a.kind === "serial" && b.kind === "serial";
  if (type === "fiber") return a.kind === "gigabit" && b.kind === "gigabit";
  if (type === "coaxial") return a.kind === "coaxial" && b.kind === "coaxial";
  if (type === "phone") return a.kind === "phone" && b.kind === "phone";
  return ["ethernet", "fast-ethernet", "gigabit"].includes(a.kind) && ["ethernet", "fast-ethernet", "gigabit"].includes(b.kind);
}

const autoCableTypes: CableType[] = ["copper-straight", "copper-cross", "fiber", "serial-dce", "wireless", "console", "coaxial", "phone"];

function copperRole(device: NetworkDevice): "mdi" | "mdi-x" {
  return device.type === "switch" || device.type === "hub" || device.type === "wireless" ? "mdi-x" : "mdi";
}

function copperPairValid(type: CableType, a: NetworkDevice, b: NetworkDevice): boolean {
  if (type !== "copper-straight" && type !== "copper-cross") return true;
  const sameRole = copperRole(a) === copperRole(b);
  return type === "copper-cross" ? sameRole : !sameRole;
}

function wirelessSettingsValid(type: CableType, a: NetworkDevice, b: NetworkDevice): boolean {
  if (type !== "wireless") return true;
  const aWireless = a.config.wireless;
  const bWireless = b.config.wireless;
  return Boolean(
    aWireless.ssid &&
      aWireless.ssid === bWireless.ssid &&
      aWireless.security === bWireless.security &&
      (aWireless.security === "open" || aWireless.wepKey === bWireless.wepKey),
  );
}

function isSerialCable(type: CableType): boolean {
  return type === "serial-dce" || type === "serial-dte";
}

function serialDceInfo(project: NetworkProject, link: NetworkLink): { device: NetworkDevice; port: NetworkPort } | null {
  if (!isSerialCable(link.type)) return null;
  return endpointPort(project, link.dceEndpoint === "b" ? link.b : link.a);
}

function serialClockReady(project: NetworkProject, link: NetworkLink): boolean {
  if (!isSerialCable(link.type)) return true;
  const dce = serialDceInfo(project, link);
  return Boolean(dce?.port.clockRate && dce.port.clockRate > 0);
}

export function validateConnection(project: NetworkProject, type: CableType, a: LinkEndpoint, b: LinkEndpoint): ConnectionValidation {
  if (a.deviceId === b.deviceId && a.portId === b.portId) {
    return { ok: false, message: "같은 포트에는 케이블을 연결할 수 없습니다." };
  }

  const aInfo = endpointPort(project, a);
  const bInfo = endpointPort(project, b);
  if (!aInfo || !bInfo) return { ok: false, message: "선택한 포트를 찾을 수 없습니다." };
  if (!isPortAvailable(aInfo.device, aInfo.port)) return { ok: false, message: `${portLabel(project, a)} 포트에는 ${requiredModuleForPort(aInfo.device, aInfo.port)} 모듈이 필요합니다.` };
  if (!isPortAvailable(bInfo.device, bInfo.port)) return { ok: false, message: `${portLabel(project, b)} 포트에는 ${requiredModuleForPort(bInfo.device, bInfo.port)} 모듈이 필요합니다.` };
  if (portInUse(project, a)) return { ok: false, message: `${portLabel(project, a)} 포트는 이미 연결되어 있습니다.` };
  if (portInUse(project, b)) return { ok: false, message: `${portLabel(project, b)} 포트는 이미 연결되어 있습니다.` };
  if (!canCableConnect(type, aInfo.port, bInfo.port)) {
    return { ok: false, message: `${type} 케이블은 ${aInfo.port.kind} 포트와 ${bInfo.port.kind} 포트 조합에 맞지 않습니다.` };
  }
  if (!copperPairValid(type, aInfo.device, bInfo.device)) {
    const expected = type === "copper-straight" ? "copper-cross" : "copper-straight";
    return { ok: false, message: `${aInfo.device.label}와 ${bInfo.device.label} 조합에는 ${type} 대신 ${expected} 케이블이 맞습니다.` };
  }
  if (!wirelessSettingsValid(type, aInfo.device, bInfo.device)) {
    return { ok: false, message: `${aInfo.device.label}와 ${bInfo.device.label}의 wireless SSID/security 설정이 일치하지 않습니다.` };
  }
  return { ok: true, message: `${portLabel(project, a)} -> ${portLabel(project, b)} 연결 가능` };
}

export interface AutoCableChoice extends ConnectionValidation {
  type?: CableType;
  a?: LinkEndpoint;
  b?: LinkEndpoint;
}

function autoPortRank(type: CableType, port: NetworkPort): number {
  if (type === "copper-straight" || type === "copper-cross") {
    if (port.kind === "fast-ethernet") return 0;
    if (port.kind === "gigabit") return 1;
    if (port.kind === "ethernet") return 2;
    return 90;
  }
  if (type === "fiber") return port.kind === "gigabit" ? 0 : 90;
  if (type === "serial-dce" || type === "serial-dte") return port.kind === "serial" ? 0 : 90;
  if (type === "wireless") return port.kind === "wireless" ? 0 : 90;
  if (type === "console") return port.kind === "console" ? 0 : 90;
  if (type === "coaxial") return port.kind === "coaxial" ? 0 : 90;
  if (type === "phone") return port.kind === "phone" ? 0 : 90;
  return 90;
}

function availableDeviceEndpoints(project: NetworkProject, deviceId: string, type: CableType): LinkEndpoint[] {
  return project.devices
    .filter((device) => device.id === deviceId)
    .flatMap((device) =>
      device.ports
        .filter((port) => isPortAvailable(device, port) && !portInUse(project, { deviceId, portId: port.id }) && autoPortRank(type, port) < 90)
        .sort((a, b) => autoPortRank(type, a) - autoPortRank(type, b))
        .map((port) => ({ deviceId, portId: port.id })),
    );
}

function autoSuccess(type: CableType, a: LinkEndpoint, b: LinkEndpoint, message: string): AutoCableChoice {
  return { ok: true, type, a, b, message: `Auto selected ${type}. ${message}` };
}

export function chooseAutoCableForEndpoints(project: NetworkProject, a: LinkEndpoint, b: LinkEndpoint): AutoCableChoice {
  let lastMessage = "선택한 두 포트에 맞는 자동 케이블을 찾지 못했습니다.";
  for (const type of autoCableTypes) {
    const validation = validateConnection(project, type, a, b);
    if (validation.ok) return autoSuccess(type, a, b, validation.message);
    lastMessage = validation.message;
  }
  return { ok: false, message: lastMessage };
}

export function chooseAutoCableFromEndpointToDevice(project: NetworkProject, a: LinkEndpoint, deviceId: string): AutoCableChoice {
  const device = project.devices.find((entry) => entry.id === deviceId);
  if (!device) return { ok: false, message: "두 번째 장비를 찾을 수 없습니다." };
  let lastMessage = `${device.label}에 자동 케이블로 연결할 수 있는 빈 포트가 없습니다.`;

  for (const type of autoCableTypes) {
    for (const b of availableDeviceEndpoints(project, deviceId, type)) {
      const validation = validateConnection(project, type, a, b);
      if (validation.ok) return autoSuccess(type, a, b, validation.message);
      lastMessage = validation.message;
    }
  }

  return { ok: false, message: lastMessage };
}

export function chooseAutoCableFromDeviceToEndpoint(project: NetworkProject, deviceId: string, b: LinkEndpoint): AutoCableChoice {
  const device = project.devices.find((entry) => entry.id === deviceId);
  if (!device) return { ok: false, message: "첫 번째 장비를 찾을 수 없습니다." };
  let lastMessage = `${device.label}에 자동 케이블로 연결할 수 있는 빈 포트가 없습니다.`;

  for (const type of autoCableTypes) {
    for (const a of availableDeviceEndpoints(project, deviceId, type)) {
      const validation = validateConnection(project, type, a, b);
      if (validation.ok) return autoSuccess(type, a, b, validation.message);
      lastMessage = validation.message;
    }
  }

  return { ok: false, message: lastMessage };
}

export function chooseAutoCableBetweenDevices(project: NetworkProject, firstDeviceId: string, secondDeviceId: string): AutoCableChoice {
  const first = project.devices.find((entry) => entry.id === firstDeviceId);
  const second = project.devices.find((entry) => entry.id === secondDeviceId);
  if (!first || !second) return { ok: false, message: "선택한 장비를 찾을 수 없습니다." };
  if (firstDeviceId === secondDeviceId) return { ok: false, message: "같은 장비끼리는 자동 케이블을 연결하지 않습니다. 서로 다른 장비를 선택하세요." };

  let lastMessage = `${first.label}와 ${second.label} 사이에 자동으로 연결할 수 있는 빈 포트가 없습니다.`;
  for (const type of autoCableTypes) {
    const firstEndpoints = availableDeviceEndpoints(project, firstDeviceId, type);
    const secondEndpoints = availableDeviceEndpoints(project, secondDeviceId, type);

    for (const a of firstEndpoints) {
      for (const b of secondEndpoints) {
        const validation = validateConnection(project, type, a, b);
        if (validation.ok) return autoSuccess(type, a, b, validation.message);
        lastMessage = validation.message;
      }
    }
  }

  return { ok: false, message: lastMessage };
}

export function findAutoEndpoint(project: NetworkProject, type: CableType, deviceId: string, peer?: LinkEndpoint): { endpoint?: LinkEndpoint; message: string } {
  const device = project.devices.find((entry) => entry.id === deviceId);
  if (!device) return { message: "장비를 찾을 수 없습니다." };

  const candidates = device.ports
    .map((port) => ({ deviceId, portId: port.id }))
    .filter((endpoint) => {
      const info = endpointPort(project, endpoint);
      return Boolean(info && isPortAvailable(info.device, info.port) && !portInUse(project, endpoint));
    });

  if (!candidates.length) return { message: `${device.label}에 빈 포트가 없습니다. 케이블을 꽂을 공간이 없거나 모든 인터페이스가 이미 사용 중입니다. 모듈을 추가하거나 기존 케이블을 제거하세요.` };

  if (!peer) {
    const endpoint = candidates.find((entry) => {
      const info = endpointPort(project, entry);
      if (!info) return false;
      if (type === "console") return info.port.kind === "console";
      if (type === "wireless") return info.port.kind === "wireless";
      if (type === "serial-dce" || type === "serial-dte") return info.port.kind === "serial";
      if (type === "fiber") return info.port.kind === "gigabit";
      if (type === "coaxial") return info.port.kind === "coaxial";
      if (type === "phone") return info.port.kind === "phone";
      return ["ethernet", "fast-ethernet", "gigabit"].includes(info.port.kind);
    });
    return endpoint ? { endpoint, message: `${portLabel(project, endpoint)} 선택됨` } : { message: `${device.label}에는 ${type} 케이블을 꽂을 수 있는 빈 포트/모듈이 없습니다.` };
  }

  const endpoint = candidates.find((candidate) => validateConnection(project, type, peer, candidate).ok);
  if (!endpoint) return { message: `${device.label}에는 ${portLabel(project, peer)}와 ${type}로 연결할 수 있는 빈 포트/모듈이 없습니다.` };
  return { endpoint, message: `${portLabel(project, peer)} -> ${portLabel(project, endpoint)} 자동 선택됨` };
}

export function linkStatus(project: NetworkProject, link: NetworkLink): LinkStatus {
  const a = endpointPort(project, link.a);
  const b = endpointPort(project, link.b);
  if (!a || !b) return "down";
  if (link.type === "console") return "console";
  if (!isPortAvailable(a.device, a.port) || !isPortAvailable(b.device, b.port)) return "down";
  if (!a.device.powerOn || !b.device.powerOn) return "down";
  if (a.port.status !== "up" || b.port.status !== "up") return "down";
  if (!canCableConnect(link.type, a.port, b.port)) return "down";
  if (!copperPairValid(link.type, a.device, b.device)) return "down";
  if (!wirelessSettingsValid(link.type, a.device, b.device)) return "down";
  if (!serialClockReady(project, link)) return "down";
  return "up";
}

export function linkStatusReason(project: NetworkProject, link: NetworkLink): string {
  const a = endpointPort(project, link.a);
  const b = endpointPort(project, link.b);
  if (!a || !b) return "Missing endpoint";
  if (link.type === "console") return "Console connection";
  if (!isPortAvailable(a.device, a.port)) return `${a.device.label} ${a.port.name} requires ${requiredModuleForPort(a.device, a.port)} module`;
  if (!isPortAvailable(b.device, b.port)) return `${b.device.label} ${b.port.name} requires ${requiredModuleForPort(b.device, b.port)} module`;
  if (!a.device.powerOn) return `${a.device.label} is powered off`;
  if (!b.device.powerOn) return `${b.device.label} is powered off`;
  if (a.port.status !== "up") return `${a.device.label} ${a.port.name} is ${a.port.status}`;
  if (b.port.status !== "up") return `${b.device.label} ${b.port.name} is ${b.port.status}`;
  if (!canCableConnect(link.type, a.port, b.port)) return `${link.type} does not match ${a.port.kind}/${b.port.kind}`;
  if (!copperPairValid(link.type, a.device, b.device)) return `${link.type} is not the right copper type for this device pair`;
  if (!wirelessSettingsValid(link.type, a.device, b.device)) return "Wireless SSID/security mismatch";
  if (!serialClockReady(project, link)) {
    const dce = serialDceInfo(project, link);
    return dce ? `${dce.device.label} ${dce.port.name} is DCE and needs clock rate` : "Serial DCE endpoint is missing clock rate";
  }
  return "Operational";
}

function vlanCompatible(a: NetworkPort, b: NetworkPort): boolean {
  if (a.mode === "routed" || b.mode === "routed") return true;
  if (a.mode === "trunk" && b.mode === "trunk") return a.allowedVlans.some((vlan) => b.allowedVlans.includes(vlan));
  if (a.mode === "trunk") return a.allowedVlans.includes(b.vlan);
  if (b.mode === "trunk") return b.allowedVlans.includes(a.vlan);
  return a.vlan === b.vlan;
}

function dataLinkUsable(project: NetworkProject, link: NetworkLink): boolean {
  if (link.status !== "up") return false;
  const a = endpointPort(project, link.a);
  const b = endpointPort(project, link.b);
  return Boolean(a && b && vlanCompatible(a.port, b.port));
}

export function refreshLinkStatuses(project: NetworkProject): NetworkProject {
  const next = {
    ...project,
    links: project.links.map((link) => ({ ...link, status: linkStatus(project, link), activity: false })),
  };
  return next;
}

export function addLink(project: NetworkProject, type: CableType, a: LinkEndpoint, b: LinkEndpoint): NetworkProject {
  if (!validateConnection(project, type, a, b).ok) return project;
  const duplicate = project.links.some(
    (link) =>
      (link.a.deviceId === a.deviceId && link.a.portId === a.portId && link.b.deviceId === b.deviceId && link.b.portId === b.portId) ||
      (link.b.deviceId === a.deviceId && link.b.portId === a.portId && link.a.deviceId === b.deviceId && link.a.portId === b.portId),
  );
  if (duplicate) return project;
  const link: NetworkLink = {
    id: makeId("link"),
    type,
    a,
    b,
    status: "down",
    activity: false,
    dceEndpoint: type === "serial-dce" ? "a" : type === "serial-dte" ? "b" : undefined,
  };
  return refreshLinkStatuses({ ...project, links: [...project.links, link] });
}

export function removeDevice(project: NetworkProject, deviceId: string): NetworkProject {
  return refreshLinkStatuses({
    ...project,
    devices: project.devices.filter((device) => device.id !== deviceId),
    links: project.links.filter((link) => link.a.deviceId !== deviceId && link.b.deviceId !== deviceId),
  });
}

export function removeLink(project: NetworkProject, linkId: string): NetworkProject {
  return refreshLinkStatuses({
    ...project,
    links: project.links.filter((link) => link.id !== linkId),
  });
}

export function updateDevice(project: NetworkProject, device: NetworkDevice): NetworkProject {
  return refreshLinkStatuses({
    ...project,
    devices: project.devices.map((entry) => (entry.id === device.id ? device : entry)),
  });
}

interface PathOptions {
  includeConsole?: boolean;
}

export function neighbors(project: NetworkProject, deviceId: string, options: PathOptions = {}): Array<{ device: NetworkDevice; via: NetworkLink }> {
  return project.links
    .filter((link) => dataLinkUsable(project, link) || (options.includeConsole && link.status === "console"))
    .flatMap((link) => {
      if (link.a.deviceId === deviceId) {
        const device = project.devices.find((entry) => entry.id === link.b.deviceId);
        return device ? [{ device, via: link }] : [];
      }
      if (link.b.deviceId === deviceId) {
        const device = project.devices.find((entry) => entry.id === link.a.deviceId);
        return device ? [{ device, via: link }] : [];
      }
      return [];
    });
}

export function findPath(project: NetworkProject, sourceId: string, destinationId: string, options: PathOptions = {}): NetworkDevice[] {
  const queue: Array<{ id: string; path: string[] }> = [{ id: sourceId, path: [sourceId] }];
  const seen = new Set<string>([sourceId]);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.id === destinationId) {
      return current.path.map((id) => project.devices.find((device) => device.id === id)).filter(Boolean) as NetworkDevice[];
    }
    for (const neighbor of neighbors(project, current.id, options)) {
      if (!seen.has(neighbor.device.id) && neighbor.device.powerOn) {
        seen.add(neighbor.device.id);
        queue.push({ id: neighbor.device.id, path: [...current.path, neighbor.device.id] });
      }
    }
  }

  return [];
}

export function getLinkBetween(project: NetworkProject, aDeviceId: string, bDeviceId: string): NetworkLink | undefined {
  return project.links.find(
    (link) =>
      (link.a.deviceId === aDeviceId && link.b.deviceId === bDeviceId) ||
      (link.b.deviceId === aDeviceId && link.a.deviceId === bDeviceId),
  );
}
