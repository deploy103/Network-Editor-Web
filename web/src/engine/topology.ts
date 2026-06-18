import { canPortUseCable } from "../data/deviceCatalog";
import type { CableType, LinkStatus, NetworkDevice, NetworkLink, NetworkPort, NetworkProject } from "../types/network";
import { createId } from "../utils/id";

export function endpoint(project: NetworkProject, ref: { deviceId: string; portId: string }): { device: NetworkDevice; port: NetworkPort } | null {
  const device = project.devices.find((item) => item.id === ref.deviceId);
  const port = device?.ports.find((item) => item.id === ref.portId);
  return device && port ? { device, port } : null;
}

export function validateConnection(project: NetworkProject, aDeviceId: string, bDeviceId: string, cable: CableType, aPortId?: string, bPortId?: string): { ok: boolean; message: string; link?: NetworkLink } {
  if (aDeviceId === bDeviceId) return { ok: false, message: "케이블은 같은 장비끼리 연결할 수 없습니다." };
  const a = project.devices.find((device) => device.id === aDeviceId);
  const b = project.devices.find((device) => device.id === bDeviceId);
  if (!a || !b) return { ok: false, message: "유효한 장비 두 개를 선택하세요." };
  const pair = aPortId && bPortId ? chooseSelectedPorts(a, b, cable, aPortId, bPortId) : choosePorts(a, b, cable);
  if (!pair) return { ok: false, message: connectionFailure(a, b, cable, aPortId, bPortId) };
  const type = cable === "auto" ? inferCable(pair.a, pair.b, a, b) : cable;
  const link: NetworkLink = {
    id: createId("link"),
    type,
    endpointA: { deviceId: a.id, portId: pair.a.id },
    endpointB: { deviceId: b.id, portId: pair.b.id },
    status: linkStatus(a, pair.a, b, pair.b),
    dceEndpoint: type === "serial-dce" ? "A" : type === "serial-dte" ? "B" : undefined,
    createdAt: Date.now()
  };
  return { ok: true, message: linkLabel({ ...project, links: [...project.links, link] }, link), link };
}

export function addLink(project: NetworkProject, link: NetworkLink): NetworkProject {
  return {
    ...project,
    devices: project.devices.map((device) => ({
      ...device,
      ports: device.ports.map((port) =>
        (device.id === link.endpointA.deviceId && port.id === link.endpointA.portId) ||
        (device.id === link.endpointB.deviceId && port.id === link.endpointB.portId)
          ? { ...port, linkId: link.id }
          : port
      )
    })),
    links: [...project.links, link]
  };
}

export function removeLink(project: NetworkProject, linkId: string): NetworkProject {
  return {
    ...project,
    links: project.links.filter((link) => link.id !== linkId),
    devices: project.devices.map((device) => ({
      ...device,
      ports: device.ports.map((port) => (port.linkId === linkId ? { ...port, linkId: undefined } : port))
    }))
  };
}

export function recalc(project: NetworkProject): NetworkProject {
  return {
    ...project,
    links: project.links.map((link) => {
      const a = endpoint(project, link.endpointA);
      const b = endpoint(project, link.endpointB);
      return a && b ? { ...link, status: linkStatus(a.device, a.port, b.device, b.port) } : { ...link, status: "down" };
    })
  };
}

export function linkLabel(project: NetworkProject, link: NetworkLink): string {
  const a = endpoint(project, link.endpointA);
  const b = endpoint(project, link.endpointB);
  if (!a || !b) return "끝점 누락";
  const aRole = link.dceEndpoint ? (link.dceEndpoint === "A" ? " DCE" : " DTE") : "";
  const bRole = link.dceEndpoint ? (link.dceEndpoint === "B" ? " DCE" : " DTE") : "";
  return `${a.device.label} ${a.port.name}${aRole} <-> ${b.device.label} ${b.port.name}${bRole}`;
}

function choosePorts(a: NetworkDevice, b: NetworkDevice, cable: CableType): { a: NetworkPort; b: NetworkPort } | null {
  for (const aPort of a.ports.filter((port) => !port.linkId && canPortUseCable(port, cable))) {
    for (const bPort of b.ports.filter((port) => !port.linkId && canPortUseCable(port, cable))) {
      const type = cable === "auto" ? inferCable(aPort, bPort, a, b) : cable;
      if (canPortUseCable(aPort, type) && canPortUseCable(bPort, type)) return { a: aPort, b: bPort };
    }
  }
  return null;
}

function chooseSelectedPorts(a: NetworkDevice, b: NetworkDevice, cable: CableType, aPortId: string, bPortId: string): { a: NetworkPort; b: NetworkPort } | null {
  const aPort = a.ports.find((port) => port.id === aPortId);
  const bPort = b.ports.find((port) => port.id === bPortId);
  if (!aPort || !bPort || aPort.linkId || bPort.linkId) {
    return null;
  }
  const type = cable === "auto" ? inferCable(aPort, bPort, a, b) : cable;
  return canPortUseCable(aPort, type) && canPortUseCable(bPort, type) ? { a: aPort, b: bPort } : null;
}

function connectionFailure(a: NetworkDevice, b: NetworkDevice, cable: CableType, aPortId?: string, bPortId?: string): string {
  if (aPortId || bPortId) {
    const aPort = a.ports.find((port) => port.id === aPortId);
    const bPort = b.ports.find((port) => port.id === bPortId);
    if (!aPort || !bPort) return "선택한 포트가 더 이상 존재하지 않습니다.";
    if (aPort.linkId) return `${a.label} ${aPort.name} 포트는 이미 연결되어 있습니다.`;
    if (bPort.linkId) return `${b.label} ${bPort.name} 포트는 이미 연결되어 있습니다.`;
    const type = cable === "auto" ? inferCable(aPort, bPort, a, b) : cable;
    if (!canPortUseCable(aPort, type)) return `${a.label} ${aPort.name} 포트는 ${cableLabel(type)} 케이블을 사용할 수 없습니다.`;
    if (!canPortUseCable(bPort, type)) return `${b.label} ${bPort.name} 포트는 ${cableLabel(type)} 케이블을 사용할 수 없습니다.`;
    return `${a.label} ${aPort.name}와 ${b.label} ${bPort.name}는 유효한 포트 조합이 아닙니다.`;
  }
  const aFree = a.ports.filter((port) => !port.linkId && (cable === "auto" || canPortUseCable(port, cable)));
  const bFree = b.ports.filter((port) => !port.linkId && (cable === "auto" || canPortUseCable(port, cable)));
  if (aFree.length === 0) return `${a.label}에 비어 있는 ${cableLabel(cable)} 포트가 없습니다. 전원을 끄고 모듈을 추가하거나 포트를 비우세요.`;
  if (bFree.length === 0) return `${b.label}에 비어 있는 ${cableLabel(cable)} 포트가 없습니다. 전원을 끄고 모듈을 추가하거나 포트를 비우세요.`;
  return "호환되는 빈 포트 조합이 없습니다. 다른 케이블을 선택하거나 연결 도우미에서 포트를 직접 고르세요.";
}

function cableLabel(type: CableType): string {
  return ({
    auto: "자동",
    console: "콘솔",
    "copper-straight": "구리 직결",
    "copper-cross": "구리 크로스",
    fiber: "광케이블",
    "serial-dce": "Serial DCE",
    "serial-dte": "Serial DTE",
    wireless: "무선"
  })[type];
}

function inferCable(aPort: NetworkPort, bPort: NetworkPort, aDevice: NetworkDevice, bDevice: NetworkDevice): CableType {
  if (aPort.kind === "console" || bPort.kind === "console") return "console";
  if (aPort.kind === "serial" && bPort.kind === "serial") return "serial-dce";
  if (aPort.kind === "fiber" && bPort.kind === "fiber") return "fiber";
  if (aPort.kind === "wireless" && bPort.kind === "wireless") return "wireless";
  if (aDevice.kind === bDevice.kind) return "copper-cross";
  return "copper-straight";
}

function linkStatus(a: NetworkDevice, aPort: NetworkPort, b: NetworkDevice, bPort: NetworkPort): LinkStatus {
  if (!a.powerOn || !b.powerOn || !aPort.adminUp || !bPort.adminUp) return "down";
  if (aPort.kind === "serial" && bPort.kind === "serial" && !aPort.clockRate && !bPort.clockRate) return "down";
  if (aPort.kind === "wireless" && bPort.kind === "wireless" && (!wirelessCompatible(a, b) || wirelessDistance(a, b) > Math.min(a.config.wireless.range || 180, b.config.wireless.range || 180))) return "down";
  if (aPort.mode === "trunk" && bPort.mode === "trunk" && !aPort.allowedVlans.some((vlan) => bPort.allowedVlans.includes(vlan))) return "blocked";
  return "up";
}

function wirelessDistance(a: NetworkDevice, b: NetworkDevice): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

function wirelessCompatible(a: NetworkDevice, b: NetworkDevice): boolean {
  if (!a.config.wireless.ssid || !b.config.wireless.ssid || a.config.wireless.ssid !== b.config.wireless.ssid) return false;
  if (a.config.wireless.auth !== b.config.wireless.auth) return false;
  if (a.config.wireless.auth === "wpa2-psk" && a.config.wireless.key !== b.config.wireless.key) return false;
  return true;
}
