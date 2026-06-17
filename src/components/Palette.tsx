import { Cable, RadioTower, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { CableTool, DeviceType, LinkEndpoint, NetworkLink, NetworkProject } from "../types/network";
import { deviceCatalog } from "../data/deviceCatalog";
import { linkStatusReason } from "../engine/topology";
import { DeviceIcon } from "./iconMap";

const deviceFilters: Array<{ id: "all" | DeviceType; label: string }> = [
  { id: "all", label: "All" },
  { id: "router", label: "Router" },
  { id: "switch", label: "Switch" },
  { id: "pc", label: "End Device" },
  { id: "server", label: "Server" },
  { id: "firewall", label: "Firewall" },
  { id: "wireless", label: "Wireless" },
  { id: "hub", label: "Hub" },
];

const cables: Array<{ type: CableTool; label: string }> = [
  { type: "auto", label: "Auto" },
  { type: "copper-straight", label: "Straight" },
  { type: "copper-cross", label: "Crossover" },
  { type: "fiber", label: "Fiber" },
  { type: "serial-dce", label: "Serial" },
  { type: "console", label: "Console" },
  { type: "wireless", label: "Wireless" },
  { type: "coaxial", label: "Coax" },
  { type: "phone", label: "Phone" },
];

interface Props {
  project: NetworkProject;
  activeCable?: CableTool;
  selectedLinkId?: string;
  onAddDevice: (catalogId: string) => void;
  onSelectCable: (type: CableTool) => void;
  onSelectLink: (linkId?: string) => void;
  onRemoveLink: (linkId: string) => void;
}

function serialRole(link: NetworkLink, endpoint: LinkEndpoint): string {
  if (link.type !== "serial-dce" && link.type !== "serial-dte") return "";
  const isA = link.a.deviceId === endpoint.deviceId && link.a.portId === endpoint.portId;
  const isDce = (link.dceEndpoint ?? "a") === (isA ? "a" : "b");
  return isDce ? "DCE" : "DTE";
}

function endpointLabel(project: NetworkProject, endpoint: LinkEndpoint, link: NetworkLink): string {
  const device = project.devices.find((entry) => entry.id === endpoint.deviceId);
  const port = device?.ports.find((entry) => entry.id === endpoint.portId);
  const role = serialRole(link, endpoint);
  return `${device?.label ?? "Missing"} ${port?.name ?? "port"}${role ? ` (${role})` : ""}`;
}

export default function Palette({ project, activeCable, selectedLinkId, onAddDevice, onSelectCable, onSelectLink, onRemoveLink }: Props) {
  const [deviceFilter, setDeviceFilter] = useState<"all" | DeviceType>("all");
  const visibleDevices = useMemo(() => (deviceFilter === "all" ? deviceCatalog : deviceCatalog.filter((spec) => spec.type === deviceFilter)), [deviceFilter]);

  return (
    <aside className="palette">
      <div className="panel-title">Devices</div>
      <div className="device-category-row">
        {deviceFilters.map((filter) => (
          <button key={filter.id} className={deviceFilter === filter.id ? "active" : ""} onClick={() => setDeviceFilter(filter.id)}>
            {filter.label}
          </button>
        ))}
      </div>
      <div className="device-model-list compact-catalog">
        {visibleDevices.map((spec) => (
          <button key={spec.id} className="tool-tile device-tile" onClick={() => onAddDevice(spec.id)} title={spec.displayName}>
            <span className="tool-icon" style={{ color: spec.accent }}>
              <DeviceIcon icon={spec.icon} />
            </span>
            <span>
              <b>{spec.displayName}</b>
              <small>{spec.modelName}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="panel-title">Connections</div>
      <div className="tool-grid">
        {cables.map((cable) => (
          <button key={cable.type} className={`tool-tile ${activeCable === cable.type ? "active" : ""}`} onClick={() => onSelectCable(cable.type)} title={cable.label}>
            <span className="tool-icon">{cable.type === "auto" ? <Zap size={18} /> : cable.type === "wireless" ? <RadioTower size={18} /> : <Cable size={18} />}</span>
            <span>{cable.label}</span>
          </button>
        ))}
      </div>
      <div className="panel-title">Links</div>
      <div className="link-list">
        {project.links.length ? (
          project.links.map((link) => (
            <div
              key={link.id}
              className={`link-row ${selectedLinkId === link.id ? "selected" : ""}`}
              data-status={link.status}
              title={linkStatusReason(project, link)}
              role="button"
              tabIndex={0}
              onClick={() => onSelectLink(link.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectLink(link.id);
              }}
            >
              <span>
                <b>{link.type}</b>
                <small>{endpointLabel(project, link.a, link)} {"->"} {endpointLabel(project, link.b, link)}</small>
                {link.status !== "up" && <small>{linkStatusReason(project, link)}</small>}
              </span>
              <em>{link.status}</em>
              <button
                className="icon-button danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveLink(link.id);
                }}
                title="링크 삭제"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <span className="muted">No links</span>
        )}
      </div>
    </aside>
  );
}
