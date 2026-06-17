import { CSSProperties, MouseEvent, PointerEvent, WheelEvent, useMemo, useRef, useState } from "react";
import { Mail, Minus, RotateCcw, Plus, Trash2 } from "lucide-react";
import type { CableTool, CableType, LinkEndpoint, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, SimulationEvent } from "../types/network";
import { deviceCatalog, getDeviceSpec } from "../data/deviceCatalog";
import { chooseAutoCableForEndpoints, chooseAutoCableFromDeviceToEndpoint, isPortAvailable, linkStatusReason, requiredModuleForPort, validateConnection } from "../engine/topology";
import { DeviceIcon } from "./iconMap";

interface Props {
  project: NetworkProject;
  selectedDeviceId?: string;
  selectedLinkId?: string;
  activeCable?: CableTool;
  pendingEndpoint?: LinkEndpoint;
  pendingAutoDeviceId?: string;
  selectedEvent?: SimulationEvent;
  onSelectDevice: (deviceId?: string) => void;
  onSelectLink: (linkId?: string) => void;
  onRemoveLink: (linkId: string) => void;
  onMoveDevice: (deviceId: string, x: number, y: number) => void;
  onPortClick: (endpoint: LinkEndpoint) => void;
  onDeviceCableClick: (deviceId: string) => void;
}

function nodeSize(shape: string): { width: number; height: number } {
  if (shape === "switch") return { width: 146, height: 120 };
  if (shape === "server") return { width: 104, height: 96 };
  if (shape === "hub") return { width: 98, height: 76 };
  return { width: 116, height: 76 };
}

function center(device: NetworkDevice) {
  const spec = getDeviceSpec(device.catalogId ?? device.type);
  const size = nodeSize(spec.shape);
  return { x: device.x + size.width / 2, y: device.y + size.height / 2 };
}

function linkEdge(from: NetworkDevice, to: NetworkDevice) {
  const spec = getDeviceSpec(from.catalogId ?? from.type);
  const size = nodeSize(spec.shape);
  const fromCenter = center(from);
  const toCenter = center(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  const radius = Math.max(size.width, size.height) / 2 + 5;
  return { x: fromCenter.x + (dx / length) * radius, y: fromCenter.y + (dy / length) * radius };
}

function linkClass(type: CableType): string {
  return `link-line ${type}`;
}

function serialRole(link: NetworkLink | undefined, endpoint: LinkEndpoint): string {
  if (!link || (link.type !== "serial-dce" && link.type !== "serial-dte")) return "";
  const isA = link.a.deviceId === endpoint.deviceId && link.a.portId === endpoint.portId;
  const isDce = (link.dceEndpoint ?? "a") === (isA ? "a" : "b");
  return isDce ? "DCE" : "DTE";
}

function endpointText(project: NetworkProject, endpoint: LinkEndpoint, link?: NetworkLink): string {
  const device = project.devices.find((entry) => entry.id === endpoint.deviceId);
  const port = device?.ports.find((entry) => entry.id === endpoint.portId);
  const role = serialRole(link, endpoint);
  return `${device?.label ?? "?"} ${port?.name ?? "?"}${role ? ` (${role})` : ""}`;
}

function connectedPeerText(project: NetworkProject, endpoint: LinkEndpoint): string {
  const link = project.links.find(
    (entry) =>
      (entry.a.deviceId === endpoint.deviceId && entry.a.portId === endpoint.portId) ||
      (entry.b.deviceId === endpoint.deviceId && entry.b.portId === endpoint.portId),
  );
  if (!link) return "";
  const peer = link.a.deviceId === endpoint.deviceId && link.a.portId === endpoint.portId ? link.b : link.a;
  return `${endpointText(project, peer, link)} via ${link.type} (${link.status})`;
}

function clampZoom(value: number): number {
  return Math.min(1.8, Math.max(0.45, Number(value.toFixed(2))));
}

function selectedPduPath(project: NetworkProject, selectedEvent?: SimulationEvent) {
  if (!selectedEvent?.lastDeviceId || selectedEvent.lastDeviceId === selectedEvent.atDeviceId) return null;
  const fromDevice = project.devices.find((device) => device.id === selectedEvent.lastDeviceId);
  const toDevice = project.devices.find((device) => device.id === selectedEvent.atDeviceId);
  if (!fromDevice || !toDevice) return null;
  const from = center(fromDevice);
  const to = center(toDevice);
  return {
    from,
    to,
    label: selectedEvent.type,
    status: selectedEvent.status,
    summary: selectedEvent.summary,
  };
}

function linkMidpoint(project: NetworkProject, link: NetworkLink): { x: number; y: number } | null {
  const a = project.devices.find((device) => device.id === link.a.deviceId);
  const b = project.devices.find((device) => device.id === link.b.deviceId);
  if (!a || !b) return null;
  const ac = linkEdge(a, b);
  const bc = linkEdge(b, a);
  return { x: (ac.x + bc.x) / 2, y: (ac.y + bc.y) / 2 };
}

function eventUsesLink(link: NetworkLink, selectedEvent?: SimulationEvent): boolean {
  if (!selectedEvent?.lastDeviceId || selectedEvent.lastDeviceId === selectedEvent.atDeviceId) return false;
  return (
    (link.a.deviceId === selectedEvent.lastDeviceId && link.b.deviceId === selectedEvent.atDeviceId) ||
    (link.b.deviceId === selectedEvent.lastDeviceId && link.a.deviceId === selectedEvent.atDeviceId)
  );
}

function portKindMatchesCable(type: CableTool, port: NetworkPort): boolean {
  if (type === "auto") return ["ethernet", "fast-ethernet", "gigabit", "serial", "console", "coaxial", "phone", "wireless"].includes(port.kind);
  if (type === "wireless") return port.kind === "wireless";
  if (type === "console") return port.kind === "console";
  if (type === "serial-dce" || type === "serial-dte") return port.kind === "serial";
  if (type === "fiber") return port.kind === "gigabit";
  if (type === "coaxial") return port.kind === "coaxial";
  if (type === "phone") return port.kind === "phone";
  return ["ethernet", "fast-ethernet", "gigabit"].includes(port.kind);
}

function wirelessMultiAttachAllowed(device: NetworkDevice, port: NetworkPort): boolean {
  return device.type === "wireless" && port.kind === "wireless";
}

export default function Workspace({
  project,
  selectedDeviceId,
  selectedLinkId,
  activeCable,
  pendingEndpoint,
  pendingAutoDeviceId,
  selectedEvent,
  onSelectDevice,
  onSelectLink,
  onRemoveLink,
  onMoveDevice,
  onPortClick,
  onDeviceCableClick,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ deviceId: string; dx: number; dy: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const specs = useMemo(() => Object.fromEntries(deviceCatalog.map((spec) => [spec.id, spec])), []);
  const activePdu = useMemo(() => selectedPduPath(project, selectedEvent), [project, selectedEvent]);
  const selectedLink = project.links.find((link) => link.id === selectedLinkId);
  const selectedLinkPoint = selectedLink ? linkMidpoint(project, selectedLink) : null;
  const pendingAutoDevice = pendingAutoDeviceId ? project.devices.find((device) => device.id === pendingAutoDeviceId) : undefined;

  function startDrag(event: PointerEvent, device: NetworkDevice) {
    if ((event.target as HTMLElement).closest(".port-dot")) return;
    if (activeCable) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setDrag({ deviceId: device.id, dx: (event.clientX - rect.left) / zoom - device.x, dy: (event.clientY - rect.top) / zoom - device.y });
    onSelectDevice(device.id);
    onSelectLink(undefined);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onMoveDevice(drag.deviceId, Math.max(8, (event.clientX - rect.left) / zoom - drag.dx), Math.max(8, (event.clientY - rect.top) / zoom - drag.dy));
  }

  function zoomWheel(event: WheelEvent) {
    event.preventDefault();
    setZoom((value) => clampZoom(value + (event.deltaY > 0 ? -0.08 : 0.08)));
  }

  return (
    <section
      className={`workspace ${activeCable ? "cable-mode" : ""}`}
      ref={ref}
      onWheel={zoomWheel}
      onPointerMove={moveDrag}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onClick={() => {
        onSelectDevice(undefined);
        onSelectLink(undefined);
      }}
    >
      <div className="zoom-controls">
        <button onClick={() => setZoom((value) => clampZoom(value - 0.1))} title="Zoom out"><Minus size={14} /></button>
        <button onClick={() => setZoom(1)} title="Zoom reset"><RotateCcw size={14} /></button>
        <button onClick={() => setZoom((value) => clampZoom(value + 0.1))} title="Zoom in"><Plus size={14} /></button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      {activeCable && (
        <div className="cable-status">
          <strong>{activeCable === "auto" ? "Auto" : activeCable}</strong>
          <span>{pendingEndpoint ? `From ${endpointText(project, pendingEndpoint)}` : pendingAutoDevice ? `From ${pendingAutoDevice.label}` : "Select first device or port"}</span>
        </div>
      )}
      <div className="workspace-stage" style={{ transform: `scale(${zoom})` }}>
        <svg className="link-layer">
          {project.links.map((link) => {
            const a = project.devices.find((device) => device.id === link.a.deviceId);
            const b = project.devices.find((device) => device.id === link.b.deviceId);
            if (!a || !b) return null;
            const ac = linkEdge(a, b);
            const bc = linkEdge(b, a);
            const wireless = link.type === "wireless";
            const activeFlow = eventUsesLink(link, selectedEvent);
            const selectLink = (event: MouseEvent<SVGGElement>) => {
              event.stopPropagation();
              if (activeCable) return;
              onSelectDevice(undefined);
              onSelectLink(link.id);
            };
            const title = `${endpointText(project, link.a, link)} -> ${endpointText(project, link.b, link)}\n${link.status}: ${linkStatusReason(project, link)}`;
            return wireless ? (
              <g key={link.id} className={`link-group ${selectedLinkId === link.id ? "selected" : ""} ${activeFlow ? "active-flow" : ""}`} onClick={selectLink}>
                <title>{title}</title>
                <path className="link-hitbox" d={`M ${ac.x} ${ac.y} Q ${(ac.x + bc.x) / 2} ${Math.min(ac.y, bc.y) - 90} ${bc.x} ${bc.y}`} />
                <path className={linkClass(link.type)} d={`M ${ac.x} ${ac.y} Q ${(ac.x + bc.x) / 2} ${Math.min(ac.y, bc.y) - 90} ${bc.x} ${bc.y}`} data-status={link.status} />
                <circle className="link-light" data-status={link.status} cx={ac.x} cy={ac.y} r="5" />
                <circle className="link-light" data-status={link.status} cx={bc.x} cy={bc.y} r="5" />
                <text className="link-label" x={(ac.x + bc.x) / 2} y={Math.min(ac.y, bc.y) - 48}>{link.type}: {endpointText(project, link.a, link)} / {endpointText(project, link.b, link)}</text>
              </g>
            ) : (
              <g key={link.id} className={`link-group ${selectedLinkId === link.id ? "selected" : ""} ${activeFlow ? "active-flow" : ""}`} onClick={selectLink}>
                <title>{title}</title>
                <line className="link-hitbox" x1={ac.x} y1={ac.y} x2={bc.x} y2={bc.y} />
                <line className={linkClass(link.type)} x1={ac.x} y1={ac.y} x2={bc.x} y2={bc.y} data-status={link.status} />
                <circle className="link-light" data-status={link.status} cx={ac.x} cy={ac.y} r="5" />
                <circle className="link-light" data-status={link.status} cx={bc.x} cy={bc.y} r="5" />
                <text className="link-label" x={(ac.x + bc.x) / 2} y={(ac.y + bc.y) / 2 - 8}>{link.type}: {endpointText(project, link.a, link)} / {endpointText(project, link.b, link)}</text>
              </g>
            );
          })}
        </svg>
        <div className="grid-bg" />
        {project.devices.map((device) => {
          const spec = specs[device.catalogId ?? ""] ?? getDeviceSpec(device.type);
          return (
            <div
              key={device.id}
              className={`device-node ${spec.shape} ${selectedDeviceId === device.id ? "selected" : ""}`}
              style={{ left: device.x, top: device.y, borderColor: spec.accent }}
              onPointerDown={(event) => startDrag(event, device)}
              onClick={(event) => {
                event.stopPropagation();
                if (activeCable) {
                  onDeviceCableClick(device.id);
                  return;
                }
                onSelectLink(undefined);
                onSelectDevice(device.id);
              }}
            >
              <div className="node-top">
                <span className={`status-led ${device.powerOn ? "on" : "off"}`} />
                <DeviceIcon icon={spec.icon} />
                <strong>{device.label}</strong>
              </div>
              <span className="node-model">{device.modelName}</span>
              <div className="port-strip">
                {device.ports.slice(0, 28).map((port) => {
                  const endpoint = { deviceId: device.id, portId: port.id };
                  const peerText = connectedPeerText(project, endpoint);
                  const moduleReady = isPortAvailable(device, port);
                  const requiredModule = requiredModuleForPort(device, port);
                  const availableForFirstClick = moduleReady && portKindMatchesCable(activeCable ?? "copper-straight", port) && (!peerText || wirelessMultiAttachAllowed(device, port));
                  const cableCandidate = activeCable
                    ? activeCable === "auto"
                      ? pendingEndpoint
                        ? chooseAutoCableForEndpoints(project, pendingEndpoint, endpoint).ok
                        : pendingAutoDeviceId
                          ? chooseAutoCableFromDeviceToEndpoint(project, pendingAutoDeviceId, endpoint).ok
                          : availableForFirstClick
                      : pendingEndpoint
                        ? validateConnection(project, activeCable, pendingEndpoint, endpoint).ok
                        : availableForFirstClick
                    : false;
                  const cableBlocked = Boolean(activeCable && !cableCandidate);
                  return (
                    <button
                      key={port.id}
                      className={`port-dot ${pendingEndpoint?.portId === port.id ? "pending" : ""} ${peerText ? "connected" : ""} ${moduleReady ? "" : "unavailable"} ${cableCandidate ? "candidate" : ""} ${cableBlocked ? "blocked" : ""}`}
                      data-status={port.status}
                      title={[
                        port.name,
                        port.interfaceConfig.ipAddress || "unassigned",
                        moduleReady ? "" : `Requires module: ${requiredModule}`,
                        peerText ? `Connected: ${peerText}` : "",
                      ].filter(Boolean).join("\n")}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (activeCable) onPortClick(endpoint);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {activePdu && selectedEvent && (
          <div
            key={selectedEvent.id}
            className={`pdu-envelope ${activePdu.status}`}
            title={activePdu.summary}
            style={
              {
                left: activePdu.from.x,
                top: activePdu.from.y,
                "--pdu-x": `${activePdu.to.x - activePdu.from.x}px`,
                "--pdu-y": `${activePdu.to.y - activePdu.from.y}px`,
              } as CSSProperties
            }
          >
            <Mail size={15} />
            <span>{activePdu.label}</span>
          </div>
        )}
        {selectedLink && selectedLinkPoint && (
          <div
            className="selected-link-card"
            style={{ left: selectedLinkPoint.x, top: selectedLinkPoint.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <strong>{selectedLink.type}</strong>
            <span>{endpointText(project, selectedLink.a, selectedLink)}</span>
            <span>{endpointText(project, selectedLink.b, selectedLink)}</span>
            <em>{selectedLink.status}: {linkStatusReason(project, selectedLink)}</em>
            <button
              onClick={() => {
                onRemoveLink(selectedLink.id);
                onSelectLink(undefined);
              }}
              title="링크 삭제"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
