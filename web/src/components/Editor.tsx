import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Cable, CircleDot, CircleHelp, Cpu, Download, Edit3, FileJson, Mail, Maximize2, Minimize2, Monitor, MousePointer2, Network, Power, Router, RotateCcw, Save, Server, Settings, Shield, Terminal, Trash2, Wifi, X, ZoomIn, ZoomOut } from "lucide-react";
import { cableCatalog, canPortUseCable, createDevice, deviceCatalog, displayKind, getDeviceModel, getModuleSpec, installModule, removeModule } from "../data/deviceCatalog";
import { cliPrompt, initialCliSession, runCliCommand } from "../engine/cli";
import { diagnoseProject } from "../engine/diagnostics";
import { isIpv4, maskToPrefix, networkAddress } from "../engine/ip";
import { downloadProject } from "../exporters/packetTracerExport";
import { requestDhcp } from "../engine/simulation";
import { addLink, linkLabel, recalc, removeLink, validateConnection } from "../engine/topology";
import { createId } from "../utils/id";
import { engineLabel, simulatePing } from "../wasm/engine";
import type { AccessRule, CableType, DeviceKind, DeviceTab, ModuleSpec, NatRule, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, SimulationEvent, User } from "../types/network";

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1600;
const packetMenuLabels = ["File", "Edit", "Options", "View", "Tools", "Extensions", "Window", "Help"] as const;

type PacketMenuName = typeof packetMenuLabels[number];
type PacketMenuItem = { label: string; action: () => void; disabled?: boolean; danger?: boolean };

export function Editor({ project, user, saveError, onBack, onChange, onSave }: { project: NetworkProject; user: User; saveError: string; onBack: () => void; onChange: (project: NetworkProject) => void; onSave: (project: NetworkProject) => void }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedCable, setSelectedCable] = useState<CableType | "">("");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedLinkId, setSelectedLinkId] = useState<string>("");
  const [deviceWindowId, setDeviceWindowId] = useState<string>("");
  const [deviceWindowTab, setDeviceWindowTab] = useState<DeviceTab | undefined>();
  const [pendingDeviceId, setPendingDeviceId] = useState<string>("");
  const [connectionDraft, setConnectionDraft] = useState<{ aDeviceId: string; bDeviceId: string; cable: CableType; message: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ deviceId: string; x: number; y: number } | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ linkId: string; x: number; y: number } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const [topMenu, setTopMenu] = useState<{ name: PacketMenuName; x: number; y: number } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ deviceId: string; value: string } | null>(null);
  const [message, setMessage] = useState("");
  const [zoom, setZoom] = useState(1);
  const [workspaceMode, setWorkspaceMode] = useState<"logical" | "physical">("logical");
  const [timeMode, setTimeMode] = useState<"realtime" | "simulation">("realtime");
  const [pduMode, setPduMode] = useState(false);
  const [pduSourceId, setPduSourceId] = useState("");
  const [engineName, setEngineName] = useState("loading-engine");
  const [focusedEventId, setFocusedEventId] = useState("");
  const deviceWindow = project.devices.find((device) => device.id === deviceWindowId) ?? null;
  const selectedLink = project.links.find((link) => link.id === selectedLinkId) ?? null;
  const pduSource = project.devices.find((device) => device.id === pduSourceId) ?? null;
  const selectedModelInfo = useMemo(() => selectedModel ? deviceCatalog.find((model) => model.id === selectedModel) ?? null : null, [selectedModel]);
  const focusedEvent = useMemo(() => project.simulationEvents.find((event) => event.id === focusedEventId) ?? null, [focusedEventId, project.simulationEvents]);
  const latestEvent = focusedEvent ?? project.simulationEvents.at(-1);

  useEffect(() => {
    onChange(recalc(project));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void engineLabel().then((label) => {
      if (!cancelled) setEngineName(label);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (focusedEventId && !project.simulationEvents.some((event) => event.id === focusedEventId)) {
      setFocusedEventId("");
    }
  }, [focusedEventId, project.simulationEvents]);

  useEffect(() => {
    if (deviceWindowId && !project.devices.some((device) => device.id === deviceWindowId)) {
      setDeviceWindowId("");
      setDeviceWindowTab(undefined);
    }
    if (selectedDeviceId && !project.devices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId("");
    }
    if (selectedLinkId && !project.links.some((link) => link.id === selectedLinkId)) {
      setSelectedLinkId("");
    }
    if (pduSourceId && !project.devices.some((device) => device.id === pduSourceId)) {
      setPduSourceId("");
      setPduMode(false);
    }
  }, [deviceWindowId, selectedDeviceId, selectedLinkId, pduSourceId, project.devices, project.links]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT" || target?.tagName === "TEXTAREA") return;
      if (event.key === "Escape") {
        setSelectedModel("");
        setSelectedCable("");
        setPendingDeviceId("");
        setConnectionDraft(null);
        setPduMode(false);
        setPduSourceId("");
        setSelectedDeviceId("");
        setSelectedLinkId("");
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setContextMenu(null);
        setLinkMenu(null);
        setWorkspaceMenu(null);
        setTopMenu(null);
        setMessage("Selection cleared.");
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (pduMode) {
          event.preventDefault();
          setMessage("Cancel Simple PDU with Escape or Select before deleting.");
          return;
        }
        if (selectedDeviceId) {
          event.preventDefault();
          deleteDevice(selectedDeviceId);
        } else if (selectedLinkId) {
          event.preventDefault();
          onChange(removeLink(project, selectedLinkId));
          setSelectedLinkId("");
          setLinkMenu(null);
          setMessage("Cable removed.");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDeviceId, selectedLinkId, pduMode, project]);

  function placeDevice(modelId: string, position?: { x: number; y: number }) {
    const next = createDevice(modelId, position ?? { x: 160 + project.devices.length * 28, y: 140 + project.devices.length * 22 }, project.devices);
    onChange({ ...project, devices: [...project.devices, next] });
    setSelectedDeviceId(next.id);
    setSelectedModel("");
    setMessage(`${next.label} placed.`);
  }

  function clickWorkspace(event: React.MouseEvent<HTMLElement>) {
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu(null);
    if (selectedModel) {
      const point = canvasPoint(event);
      placeDevice(selectedModel, placementPosition(selectedModel, point));
      return;
    }
    if (pendingDeviceId) {
      setPendingDeviceId("");
      setMessage("Connection cancelled.");
      return;
    }
    if (pduMode) {
      setMessage(pduSourceId ? "Select a destination device for the Simple PDU." : "Select a source device for the Simple PDU.");
      return;
    }
    setSelectedDeviceId("");
    setSelectedLinkId("");
  }

  function dropDevice(event: React.DragEvent<HTMLElement>) {
    const modelId = event.dataTransfer.getData("application/x-device-model");
    if (!modelId) return;
    event.preventDefault();
    closeFloatingMenus();
    const point = canvasPoint(event);
    placeDevice(modelId, placementPosition(modelId, point));
  }

  async function clickDevice(device: NetworkDevice) {
    closeFloatingMenus();
    setSelectedLinkId("");
    if (pduMode) {
      if (!pduSourceId) {
        setPduSourceId(device.id);
        setSelectedDeviceId(device.id);
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setMessage(`Simple PDU source: ${device.label}. Select a destination device.`);
        return;
      }
      if (pduSourceId === device.id) {
        setMessage("Simple PDU destination must be a different device.");
        return;
      }
      await sendPdu(pduSourceId, device.id);
      setPduSourceId("");
      setPduMode(false);
      return;
    }
    if (selectedCable) {
      if (!pendingDeviceId) {
        setPendingDeviceId(device.id);
        setMessage(`First endpoint: ${device.label}`);
        return;
      }
      if (pendingDeviceId === device.id) {
        setMessage("A cable cannot connect a device to itself.");
        setPendingDeviceId("");
        return;
      }
      const result = validateConnection(project, pendingDeviceId, device.id, selectedCable);
      if (!result.ok || !result.link) {
        setMessage(result.message);
        setConnectionDraft({ aDeviceId: pendingDeviceId, bDeviceId: device.id, cable: selectedCable, message: result.message });
      } else {
        setMessage("Select the exact interfaces to connect.");
        setConnectionDraft({ aDeviceId: pendingDeviceId, bDeviceId: device.id, cable: selectedCable, message: "Select the exact interfaces to connect." });
      }
      setPendingDeviceId("");
      return;
    }
    setSelectedDeviceId(device.id);
    setSelectedLinkId("");
    openDeviceWindow(device.id);
  }

  function openDeviceWindow(deviceId: string, tab?: DeviceTab) {
    setSelectedDeviceId(deviceId);
    setSelectedLinkId("");
    setDeviceWindowId(deviceId);
    setDeviceWindowTab(tab);
    closeFloatingMenus();
  }

  async function sendPdu(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const previousEventCount = project.simulationEvents.length;
    const result = await simulatePing(project, sourceId, targetId);
    onChange(result.project);
    setMessage(result.message);
    setTimeMode("simulation");
    setFocusedEventId(result.project.simulationEvents[previousEventCount]?.id ?? result.project.simulationEvents.at(-1)?.id ?? "");
  }

  function updateDevice(next: NetworkDevice) {
    onChange(recalc({ ...project, devices: project.devices.map((device) => (device.id === next.id ? next : device)) }));
  }

  function closeFloatingMenus() {
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu(null);
  }

  function renameDevice(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    setRenameDraft({ deviceId, value: device.label });
  }

  function commitRenameDevice() {
    if (!renameDraft) return;
    const device = project.devices.find((item) => item.id === renameDraft.deviceId);
    if (!device) {
      setRenameDraft(null);
      return;
    }
    const label = cleanDeviceName(renameDraft.value) || device.label;
    updateDevice({ ...device, label, config: { ...device.config, hostname: label } });
    setMessage(`${device.label} renamed to ${label}.`);
    setRenameDraft(null);
  }

  function toggleDevicePower(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    updateDevice({
      ...device,
      powerOn: !device.powerOn,
      runtime: !device.powerOn ? device.runtime : { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
    });
    setMessage(`${device.label} powered ${device.powerOn ? "off" : "on"}.`);
  }

  function deleteDevice(deviceId: string) {
    const links = new Set(project.links.filter((link) => link.endpointA.deviceId === deviceId || link.endpointB.deviceId === deviceId).map((link) => link.id));
    onChange({
      ...project,
      devices: project.devices
        .filter((device) => device.id !== deviceId)
        .map((device) => ({ ...device, ports: device.ports.map((port) => port.linkId && links.has(port.linkId) ? { ...port, linkId: undefined } : port) })),
      links: project.links.filter((link) => !links.has(link.id))
    });
    setSelectedDeviceId("");
    setSelectedLinkId("");
    if (deviceWindowId === deviceId) {
      setDeviceWindowId("");
      setDeviceWindowTab(undefined);
    }
    if (pduSourceId === deviceId) {
      setPduSourceId("");
      setPduMode(false);
    }
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu(null);
  }

  function renameProject(name: string) {
    onChange({ ...project, name: name.slice(0, 100) });
  }

  function repairCurrentProject() {
    const result = repairProject(project);
    onChange(result.project);
    setMessage(result.message);
  }

  function toggleFullscreen() {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setMessage("Exited full screen.");
      return;
    }
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen();
      setMessage("Entered full screen.");
    }
  }

  function canvasPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom
    };
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, device: NetworkDevice) {
    if (selectedCable || selectedModel || pduMode || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".pdu-target")) return;
    event.preventDefault();
    const point = canvasPoint(event);
    dragRef.current = {
      id: device.id,
      offsetX: point.x - device.position.x,
      offsetY: point.y - device.position.y,
      startX: point.x,
      startY: point.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedDeviceId(device.id);
    setSelectedLinkId("");
    closeFloatingMenus();
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const moved = Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    const draggedDevice = project.devices.find((device) => device.id === drag.id);
    const size = draggedDevice ? nodeSize(draggedDevice.kind) : { width: 120, height: 86 };
    const x = Math.max(16, Math.min(CANVAS_WIDTH - size.width - 16, Math.round(point.x - drag.offsetX)));
    const y = Math.max(16, Math.min(CANVAS_HEIGHT - size.height - 16, Math.round(point.y - drag.offsetY)));
    onChange(recalc({
      ...project,
      devices: project.devices.map((device) => (device.id === drag.id ? { ...device, position: { x, y } } : device))
    }));
  }

  function endDrag() {
    if (dragRef.current?.moved) {
      suppressClickRef.current = true;
      setMessage("Device moved.");
    }
    dragRef.current = null;
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLElement>) {
    event.preventDefault();
    setZoom((value) => Math.max(0.45, Math.min(1.9, value + (event.deltaY < 0 ? 0.08 : -0.08))));
  }

  function selectMode() {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(false);
    setPduSourceId("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    closeFloatingMenus();
    setMessage("Select mode.");
  }

  function deleteSelected() {
    if (selectedDeviceId) {
      deleteDevice(selectedDeviceId);
      setMessage("Device deleted.");
      return;
    }
    if (selectedLinkId) {
      onChange(removeLink(project, selectedLinkId));
      setSelectedLinkId("");
      setMessage("Cable removed.");
    }
  }

  function openTopMenu(event: React.MouseEvent<HTMLButtonElement>, name: PacketMenuName) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu((current) => current?.name === name ? null : { name, x: rect.left, y: rect.bottom + 4 });
  }

  function packetMenuItems(name: PacketMenuName): PacketMenuItem[] {
    if (name === "File") {
      return [
        { label: "Save", action: () => { onSave(project); setMessage("Project save requested."); } },
        { label: "Export JSON", action: () => downloadProject(project, "json") },
        { label: "Export PTWEB", action: () => { downloadProject(project, "ptweb"); setMessage("Exported .ptweb project file. Cisco Packet Tracer .pkt binary export is not implemented."); } },
        { label: "Back to Projects", action: onBack }
      ];
    }
    if (name === "Edit") {
      return [
        { label: "Select Mode", action: selectMode },
        { label: "Clear Selection", action: selectMode },
        { label: "Delete Selected", action: deleteSelected, disabled: !selectedDeviceId && !selectedLinkId, danger: true }
      ];
    }
    if (name === "Options") {
      return [
        { label: "Realtime Mode", action: () => setTimeMode("realtime"), disabled: timeMode === "realtime" },
        { label: "Simulation Mode", action: () => setTimeMode("simulation"), disabled: timeMode === "simulation" }
      ];
    }
    if (name === "View") {
      return [
        { label: "Logical Workspace", action: () => setWorkspaceMode("logical"), disabled: workspaceMode === "logical" },
        { label: "Physical Workspace", action: () => setWorkspaceMode("physical"), disabled: workspaceMode === "physical" },
        { label: "Zoom 100%", action: () => { setZoom(1); setMessage("Zoom reset to 100%."); } },
        { label: "Zoom In", action: () => setZoom((value) => Math.min(1.9, value + 0.1)) },
        { label: "Zoom Out", action: () => setZoom((value) => Math.max(0.45, value - 0.1)) }
      ];
    }
    if (name === "Tools") {
      return [
        { label: "Repair Project", action: repairCurrentProject },
        { label: "Run Diagnostics", action: () => setMessage(`${diagnoseProject(project).length} project-level issues.`) }
      ];
    }
    if (name === "Extensions") {
      return [
        { label: "WASM Engine Status", action: () => setMessage(engineName) },
        { label: "PTWEB Compatibility", action: () => setMessage(".ptweb is this app's own format; Cisco .pkt binary export is not implemented.") }
      ];
    }
    if (name === "Window") {
      return [
        { label: typeof document !== "undefined" && document.fullscreenElement ? "Exit Full Screen" : "Enter Full Screen", action: toggleFullscreen },
        { label: "Open Selected Device", action: () => selectedDeviceId && openDeviceWindow(selectedDeviceId), disabled: !selectedDeviceId },
        { label: "Open Selected CLI", action: () => selectedDeviceId && openDeviceWindow(selectedDeviceId, "cli"), disabled: !selectedDeviceId },
        { label: deviceWindow ? `Activate ${deviceWindow.label}` : "No Device Window", action: () => deviceWindow && setMessage(`${deviceWindow.label} window active.`), disabled: !deviceWindow },
        { label: "Close Device Window", action: () => { setDeviceWindowId(""); setDeviceWindowTab(undefined); setMessage("Device window closed."); }, disabled: !deviceWindow },
        { label: "Simulation Panel", action: () => setTimeMode("simulation"), disabled: timeMode === "simulation" }
      ];
    }
    return [
      { label: "About", action: () => setMessage("Network Editor Web Packet Tracer-style lab.") },
      { label: "Format Note", action: () => setMessage("Use .ptweb or JSON here. Cisco Packet Tracer 6.1 .pkt is proprietary binary.") }
    ];
  }

  return (
    <main className="editor-shell packet-shell" onClick={() => { setContextMenu(null); setLinkMenu(null); setWorkspaceMenu(null); setTopMenu(null); }}>
      <header className="topbar packet-topbar">
        <div className="packet-menubar">
          <button className="icon-button" onClick={onBack} title="Back" type="button"><ArrowLeft size={18} /></button>
          <input className="project-title-input" value={project.name} onBlur={() => { if (!project.name.trim()) renameProject("Untitled Network"); }} onChange={(event) => renameProject(event.target.value)} aria-label="Project name" />
          <span className="session-chip">{user.username}</span>
        </div>
        <nav className="packet-menu-labels" aria-label="Packet Tracer menus">
          {packetMenuLabels.map((name) => (
            <button className={topMenu?.name === name ? "active" : ""} key={name} onClick={(event) => openTopMenu(event, name)} type="button">{name}</button>
          ))}
        </nav>
        <div className="packet-toolbar">
          <button className="icon-button" onClick={() => { onSave(project); setMessage("Project save requested."); }} title="Save" type="button"><Save size={18} /></button>
          <button className="icon-button" onClick={() => downloadProject(project, "json")} title="Export JSON" type="button"><FileJson size={18} /></button>
          <button className="icon-button" onClick={() => { downloadProject(project, "ptweb"); setMessage("Exported .ptweb project file. Cisco Packet Tracer .pkt binary export is not implemented."); }} title="Export PTWEB project (not Cisco .pkt)" type="button"><Download size={18} /></button>
          <button className="icon-button" onClick={() => setZoom((value) => Math.min(1.9, value + 0.1))} title="Zoom in" type="button"><ZoomIn size={18} /></button>
          <button className="icon-button" onClick={() => { setZoom(1); setMessage("Zoom reset to 100%."); }} title="Zoom reset" type="button"><RotateCcw size={18} /></button>
          <button className="icon-button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} title="Zoom out" type="button"><ZoomOut size={18} /></button>
        </div>
      </header>
      <section
        className={`workspace packet-workspace ${selectedModel ? "placing" : ""} ${selectedCable ? "cabling" : ""} ${workspaceMode}`}
        onClick={clickWorkspace}
        onContextMenu={(event) => {
          event.preventDefault();
          closeFloatingMenus();
          setWorkspaceMenu({ x: event.clientX, y: event.clientY });
          setMessage("Workspace menu opened.");
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropDevice}
        onWheel={zoomWithWheel}
      >
        <div className="workspace-tabs" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className={workspaceMode === "logical" ? "active" : ""} onClick={() => setWorkspaceMode("logical")} type="button">Logical</button>
          <button className={workspaceMode === "physical" ? "active" : ""} onClick={() => setWorkspaceMode("physical")} type="button">Physical</button>
        </div>
        <div className="zoom-hud" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className="icon-button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} title="Zoom out" type="button"><ZoomOut size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => setZoom((value) => Math.min(1.9, value + 0.1))} title="Zoom in" type="button"><ZoomIn size={16} /></button>
        </div>
        <div className="common-tools-bar" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className={!selectedDeviceId && !selectedLinkId && !selectedCable && !selectedModel && !pduMode ? "active" : ""} onClick={selectMode} title="Select tool" type="button"><MousePointer2 size={16} /></button>
          <button disabled={pduMode || !selectedDeviceId} onClick={() => selectedDeviceId && openDeviceWindow(selectedDeviceId)} title="Inspect selected device" type="button"><Settings size={16} /></button>
          <button disabled={pduMode || (!selectedDeviceId && !selectedLinkId)} onClick={deleteSelected} title="Delete selected" type="button"><Trash2 size={16} /></button>
          <button className={pduMode ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel)} onClick={() => { setPduMode(true); setPduSourceId(""); setSelectedDeviceId(""); setSelectedLinkId(""); setDeviceWindowId(""); setDeviceWindowTab(undefined); setMessage("Add Simple PDU: select a source device."); }} title="Add Simple PDU" type="button"><Mail size={16} /></button>
        </div>
        {(selectedCable || pendingDeviceId) && (
          <div className="cable-hud">
            <strong>{selectedCable || "Cable"}</strong>
            <span>{pendingDeviceId ? `From ${project.devices.find((device) => device.id === pendingDeviceId)?.label ?? "device"}` : "Select first device"}</span>
          </div>
        )}
        {selectedModelInfo && (
          <div className="placement-hud">
            <DeviceIcon kind={selectedModelInfo.kind} size={16} />
            <strong>{selectedModelInfo.model}</strong>
            <span>{displayKind(selectedModelInfo.kind)}</span>
          </div>
        )}
        {pduMode && project.devices.length > 1 && !selectedCable && !selectedModel && (
          <div className="pdu-hud">
            <Mail size={16} />
            <strong>{pduSource ? pduSource.label : "Simple PDU"}</strong>
            <span>{pduSource ? "Select destination" : "Select source"}</span>
          </div>
        )}
        <div className="canvas-scroll-area" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
          <div
            className="logical-canvas"
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            ref={canvasRef}
            style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {workspaceMode === "physical" && <PhysicalWorkspaceBackdrop devices={project.devices} />}
            <svg className="link-layer">
              {project.links.map((link) => {
                const a = project.devices.find((device) => device.id === link.endpointA.deviceId);
                const b = project.devices.find((device) => device.id === link.endpointB.deviceId);
                if (!a || !b) return null;
                const start = linkEdge(a, b);
                const end = linkEdge(b, a);
                const x1 = start.x;
                const y1 = start.y;
                const x2 = end.x;
                const y2 = end.y;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const wirelessControlY = Math.max(18, Math.min(y1, y2) - 90);
                const wirelessPath = `M ${x1} ${y1} Q ${midX} ${wirelessControlY} ${x2} ${y2}`;
                const labelY = link.type === "wireless" ? Math.max(18, wirelessControlY + 38) : midY - 7;
                const activeFlow = latestEvent && (
                  (link.endpointA.deviceId === latestEvent.lastDeviceId && link.endpointB.deviceId === latestEvent.atDeviceId) ||
                  (link.endpointB.deviceId === latestEvent.lastDeviceId && link.endpointA.deviceId === latestEvent.atDeviceId)
                );
                return (
                  <g
                    key={link.id}
                    className={selectedLinkId === link.id ? "selected-link" : ""}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectedCable || selectedModel) {
                        setMessage("Finish or cancel the current placement mode before selecting cables.");
                        return;
                      }
                      closeFloatingMenus();
                      setSelectedDeviceId("");
                      setSelectedLinkId(link.id);
                      setMessage(linkLabel(project, link));
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (selectedCable || selectedModel) {
                        setMessage("Finish or cancel the current placement mode before opening a cable menu.");
                        return;
                      }
                      closeFloatingMenus();
                      setSelectedDeviceId("");
                      setSelectedLinkId(link.id);
                      setLinkMenu({ linkId: link.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <title>{linkLabel(project, link)} [{link.status}]</title>
                    {link.type === "wireless" ? <path className="cable-hitbox" d={wirelessPath} /> : <line className="cable-hitbox" x1={x1} x2={x2} y1={y1} y2={y2} />}
                    {link.type === "wireless" ? <path className={`cable-line ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} d={wirelessPath} /> : <line className={`cable-line ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} x1={x1} x2={x2} y1={y1} y2={y2} />}
                    <circle className={`link-light ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} cx={x1} cy={y1} r="5" />
                    <circle className={`link-light ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} cx={x2} cy={y2} r="5" />
                    <text className="cable-label" x={midX} y={labelY}>{canvasLinkLabel(project, link)}</text>
                  </g>
                );
              })}
            </svg>
            {project.devices.map((device) => (
              <button
                className={`device-node ${device.kind} ${device.powerOn ? "" : "off"} ${selectedDeviceId === device.id ? "selected" : ""} ${pendingDeviceId === device.id ? "pending" : ""}`}
                key={device.id}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    closeFloatingMenus();
                    return;
                  }
                  if (selectedModel) {
                    setMessage("Click an empty workspace area to place the selected model.");
                    return;
                  }
                  void clickDevice(device);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedDeviceId(device.id);
                  setSelectedLinkId("");
                  closeFloatingMenus();
                  setContextMenu({ deviceId: device.id, x: event.clientX, y: event.clientY });
                }}
                onPointerDown={(event) => startDrag(event, device)}
                onPointerMove={(event) => moveDrag(event)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ left: device.position.x, top: device.position.y }}
                type="button"
              >
                <span className="node-head">
                  <span className="device-led" />
                  <DeviceIcon kind={device.kind} />
                  <strong>{device.label}</strong>
                </span>
                <small>{device.model}</small>
                <span className="port-strip">{device.ports.slice(0, 28).map((port) => <i className={portMarkerClass(project, device, port, selectedCable, pendingDeviceId)} key={port.id} title={portMarkerTitle(project, device, port, selectedCable, pendingDeviceId)} />)}</span>
                {pduMode && pduSourceId && pduSourceId !== device.id && <span className="pdu-target" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); void sendPdu(pduSourceId, device.id).then(() => { setPduSourceId(""); setPduMode(false); }); }} title={`Send Simple PDU to ${device.label}`}><Mail size={14} /></span>}
              </button>
            ))}
            {latestEvent && <PduMarker project={project} sourceId={latestEvent.lastDeviceId} status={latestEvent.status} targetId={latestEvent.atDeviceId} type={latestEvent.type} />}
            {selectedLink && (
              <SelectedLinkCard
                link={selectedLink}
                onRemove={(linkId) => {
                  onChange(removeLink(project, linkId));
                  setSelectedLinkId("");
                  closeFloatingMenus();
                }}
                project={project}
              />
            )}
          </div>
        </div>
      </section>
      <section className="bottom-tray">
        <Palette
          selectedModel={selectedModel}
          selectedCable={selectedCable}
          onSelect={() => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedModel(""); setSelectedCable(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setMessage("Select mode."); }}
          onModel={(id) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedModel(id); setSelectedCable(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setMessage("Click the workspace or drag into it to place the selected device."); }}
          onCable={(type) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedCable(type); setSelectedModel(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setMessage("Select two devices to connect."); }}
        />
        <div className="simulation-dock">
          <div className="time-tabs">
            <button className={timeMode === "realtime" ? "active" : ""} onClick={() => setTimeMode("realtime")} type="button">Realtime</button>
            <button className={timeMode === "simulation" ? "active" : ""} onClick={() => setTimeMode("simulation")} type="button">Simulation</button>
          </div>
          <EventPanel focusedEventId={latestEvent?.id ?? ""} message={message} mode={timeMode} onClear={() => { setFocusedEventId(""); onChange({ ...project, simulationEvents: [] }); }} onFocusEvent={setFocusedEventId} onRemoveLink={(linkId) => { onChange(removeLink(project, linkId)); if (selectedLinkId === linkId) setSelectedLinkId(""); }} onRepair={repairCurrentProject} project={project} />
        </div>
      </section>
      {connectionDraft && (
        <DeviceWindow
          title="Connection Assistant"
          subtitle={connectionDraft.cable}
          tone="warning"
          onClose={() => setConnectionDraft(null)}
        >
          <ConnectionAssistant
            draft={connectionDraft}
            onCancel={() => setConnectionDraft(null)}
            onConnected={(nextProject, nextMessage) => {
              onChange(nextProject);
              setSelectedLinkId(nextProject.links.at(-1)?.id ?? "");
              setMessage(nextMessage);
              setConnectionDraft(null);
            }}
            project={project}
          />
        </DeviceWindow>
      )}
      {deviceWindow && (
        <DeviceWindow
          title={deviceWindow.label}
          subtitle={deviceWindow.model}
          onClose={() => { setDeviceWindowId(""); setDeviceWindowTab(undefined); }}
        >
          <Inspector
            device={deviceWindow}
            initialTab={deviceWindowTab}
            project={project}
            onUpdate={updateDevice}
            onProjectChange={(nextProject, nextMessage) => { onChange(nextProject); setMessage(nextMessage); }}
            onDelete={deleteDevice}
            onDhcp={() => { const result = requestDhcp(project, deviceWindow.id); onChange(result.project); setMessage(result.message); }}
          />
        </DeviceWindow>
      )}
      {contextMenu && (
        <DeviceContextMenu
          device={project.devices.find((device) => device.id === contextMenu.deviceId) ?? null}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onDelete={deleteDevice}
          onOpen={openDeviceWindow}
          onRename={renameDevice}
          onTogglePower={toggleDevicePower}
        />
      )}
      {linkMenu && (
        <LinkContextMenu
          link={project.links.find((link) => link.id === linkMenu.linkId) ?? null}
          project={project}
          x={linkMenu.x}
          y={linkMenu.y}
          onClose={() => setLinkMenu(null)}
          onRemove={(linkId) => {
            onChange(removeLink(project, linkId));
            if (selectedLinkId === linkId) setSelectedLinkId("");
            setLinkMenu(null);
          }}
        />
      )}
      {workspaceMenu && (
        <WorkspaceContextMenu
          mode={workspaceMode}
          onClose={() => setWorkspaceMenu(null)}
          onLogical={() => { setWorkspaceMode("logical"); setWorkspaceMenu(null); }}
          onPhysical={() => { setWorkspaceMode("physical"); setWorkspaceMenu(null); }}
          onRepair={() => { repairCurrentProject(); setWorkspaceMenu(null); }}
          onSelect={() => {
            setSelectedModel("");
            setSelectedCable("");
            setPendingDeviceId("");
            setConnectionDraft(null);
            setSelectedDeviceId("");
            setSelectedLinkId("");
            setWorkspaceMenu(null);
            setMessage("Select mode.");
          }}
          onZoomReset={() => { setZoom(1); setWorkspaceMenu(null); setMessage("Zoom reset to 100%."); }}
          x={workspaceMenu.x}
          y={workspaceMenu.y}
        />
      )}
      {topMenu && (
        <PacketMenuDropdown
          items={packetMenuItems(topMenu.name)}
          onClose={() => setTopMenu(null)}
          title={topMenu.name}
          x={topMenu.x}
          y={topMenu.y}
        />
      )}
      {renameDraft && (
        <DeviceRenameDialog
          value={renameDraft.value}
          onCancel={() => setRenameDraft(null)}
          onChange={(value) => setRenameDraft({ ...renameDraft, value })}
          onSubmit={commitRenameDevice}
        />
      )}
      <footer className="statusbar">
        <MousePointer2 size={15} />
        <span>{saveError || message || "Select a device, cable, or PDU target."}</span>
        <small>{engineName}</small>
      </footer>
    </main>
  );
}

function PhysicalWorkspaceBackdrop({ devices }: { devices: NetworkDevice[] }) {
  const routers = devices.filter((device) => device.kind === "router" || device.kind === "firewall").length;
  const switches = devices.filter((device) => device.kind === "switch" || device.kind === "hub").length;
  const hosts = devices.filter((device) => device.kind === "pc" || device.kind === "server").length;
  const wireless = devices.filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless")).length;
  return (
    <div className="physical-backdrop" aria-hidden="true">
      <div className="physical-location-strip">
        <strong>Intercity / City / Corporate Office / Wiring Closet</strong>
        <span>{devices.length} devices | {routers} routers/firewalls | {switches} switches/hubs | {hosts} hosts | {wireless} wireless</span>
      </div>
      <div className="physical-rack">
        <span>Rack 1</span>
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="physical-bench">
        <span>Desktop Table</span>
        <i />
        <i />
        <i />
      </div>
      <div className="physical-wireless-zone">
        <span>Wireless Cell</span>
      </div>
    </div>
  );
}

function DeviceWindow({
  title,
  subtitle,
  tone,
  children,
  onClose
}: {
  title: string;
  subtitle?: string;
  tone?: "warning";
  children: ReactNode;
  onClose: () => void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState(() => initialWindowPosition(tone));
  const [maximized, setMaximized] = useState(false);

  function startWindowDrag(event: React.PointerEvent<HTMLElement>) {
    if (maximized) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveWindowDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const rect = windowRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    setPosition({
      x: Math.max(8, Math.min(maxX, event.clientX - drag.offsetX)),
      y: Math.max(8, Math.min(maxY, event.clientY - drag.offsetY))
    });
  }

  function endWindowDrag() {
    dragRef.current = null;
  }

  return (
    <section className={`device-window floating ${maximized ? "maximized" : ""} ${tone ?? ""}`} ref={windowRef} style={{ left: position.x, top: position.y }} onClick={(event) => event.stopPropagation()}>
      <header className="device-window-title" onPointerCancel={endWindowDrag} onPointerDown={startWindowDrag} onPointerMove={moveWindowDrag} onPointerUp={endWindowDrag}>
        <span className="window-mark"><Cpu size={16} /></span>
        <div>
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <button className="icon-button" onClick={() => setMaximized((value) => !value)} title={maximized ? "Restore window" : "Maximize window"} type="button">{maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" onClick={onClose} title="Close window" type="button"><X size={17} /></button>
      </header>
      <div className="device-window-body">{children}</div>
    </section>
  );
}

function initialWindowPosition(tone?: "warning"): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 80, y: 70 };
  const width = tone === "warning" ? Math.min(620, window.innerWidth - 36) : Math.min(920, window.innerWidth - 36);
  const height = tone === "warning" ? Math.min(360, window.innerHeight - 72) : Math.min(690, window.innerHeight - 72);
  return {
    x: Math.max(18, (window.innerWidth - width) / 2),
    y: Math.max(54, (window.innerHeight - height) / 2)
  };
}

function DeviceContextMenu({
  device,
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onTogglePower,
  onDelete
}: {
  device: NetworkDevice | null;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (deviceId: string, tab?: DeviceTab) => void;
  onRename: (deviceId: string) => void;
  onTogglePower: (deviceId: string) => void;
  onDelete: (deviceId: string) => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!device) return null;
  const tabs = safeDeviceTabs(device);
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 230));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 300));

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="device-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <strong>{device.label}</strong>
      <button onClick={() => run(() => onOpen(device.id))} type="button"><Settings size={15} />Open</button>
      {tabs.includes("cli") && <button onClick={() => run(() => onOpen(device.id, "cli"))} type="button"><Terminal size={15} />CLI</button>}
      {tabs.includes("desktop") && <button onClick={() => run(() => onOpen(device.id, "desktop"))} type="button"><Monitor size={15} />Desktop</button>}
      <button onClick={() => run(() => onRename(device.id))} type="button"><Edit3 size={15} />Rename</button>
      <button onClick={() => run(() => onTogglePower(device.id))} type="button"><Power size={15} />{device.powerOn ? "Power Off" : "Power On"}</button>
      <button className="danger" onClick={() => run(() => onDelete(device.id))} type="button"><Trash2 size={15} />Delete</button>
    </div>
  );
}

function WorkspaceContextMenu({
  x,
  y,
  mode,
  onClose,
  onSelect,
  onZoomReset,
  onLogical,
  onPhysical,
  onRepair
}: {
  x: number;
  y: number;
  mode: "logical" | "physical";
  onClose: () => void;
  onSelect: () => void;
  onZoomReset: () => void;
  onLogical: () => void;
  onPhysical: () => void;
  onRepair: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 230));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 230));

  return (
    <div className="device-context-menu workspace-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <strong>Workspace</strong>
      <button onClick={onSelect} type="button"><MousePointer2 size={15} />Select Mode</button>
      <button onClick={onZoomReset} type="button"><RotateCcw size={15} />Zoom 100%</button>
      <button className={mode === "logical" ? "active" : ""} onClick={onLogical} type="button"><Network size={15} />Logical</button>
      <button className={mode === "physical" ? "active" : ""} onClick={onPhysical} type="button"><Cpu size={15} />Physical</button>
      <button onClick={onRepair} type="button"><Settings size={15} />Repair Project</button>
    </div>
  );
}

function PacketMenuDropdown({ title, items, x, y, onClose }: { title: string; items: PacketMenuItem[]; x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 250));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 280));

  return (
    <div className="device-context-menu packet-menu-dropdown" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <strong>{title}</strong>
      {items.map((item) => (
        <button
          className={item.danger ? "danger" : ""}
          disabled={item.disabled}
          key={item.label}
          onClick={() => {
            item.action();
            onClose();
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function safeDeviceTabs(device: NetworkDevice): DeviceTab[] {
  try {
    return getDeviceModel(device.modelId).tabs;
  } catch {
    if (device.kind === "server") return ["physical", "config", "desktop", "services"];
    if (device.kind === "pc") return ["physical", "config", "desktop"];
    return ["physical", "config", "cli"];
  }
}

function LinkContextMenu({
  link,
  project,
  x,
  y,
  onClose,
  onRemove
}: {
  link: NetworkLink | null;
  project: NetworkProject;
  x: number;
  y: number;
  onClose: () => void;
  onRemove: (linkId: string) => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!link) return null;
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 260));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 220));

  return (
    <div className="device-context-menu link-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <strong>{shortCableLabel(link.type)}</strong>
      <span>{linkLabel(project, link)}</span>
      <span>{linkStatusDetail(project, link)}</span>
      <em>{link.status}</em>
      <button className="danger" onClick={() => onRemove(link.id)} type="button"><Trash2 size={15} />Remove Cable</button>
    </div>
  );
}

function SelectedLinkCard({ link, project, onRemove }: { link: NetworkLink; project: NetworkProject; onRemove: (linkId: string) => void }) {
  const point = linkMidpoint(project, link);
  if (!point) return null;
  const endpoints = linkEndpointSummaries(project, link);
  return (
    <div
      className={`selected-link-card ${link.status}`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      style={{ left: point.x, top: point.y }}
    >
      <header>
        <strong>{shortCableLabel(link.type)}</strong>
        <small>{link.status}</small>
      </header>
      <span>{linkLabel(project, link)}</span>
      <div className="selected-link-endpoints">
        {endpoints.map((endpoint) => (
          <div key={endpoint.side}>
            <strong>{endpoint.side}</strong>
            <span>{endpoint.device}</span>
            <em>{endpoint.port}</em>
            <small>{endpoint.mode} / {endpoint.state}</small>
          </div>
        ))}
      </div>
      <em>{linkStatusDetail(project, link)}</em>
      <button className="danger" onClick={() => onRemove(link.id)} type="button"><Trash2 size={14} />Remove Cable</button>
    </div>
  );
}

function DeviceRenameDialog({
  value,
  onChange,
  onCancel,
  onSubmit
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div className="rename-dialog" onClick={(event) => { event.stopPropagation(); onCancel(); }} role="dialog" aria-modal="true" aria-label="Rename device">
      <form onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <header>
          <Edit3 size={16} />
          <strong>Rename Device</strong>
        </header>
        <input autoFocus maxLength={32} value={value} onChange={(event) => onChange(event.target.value)} />
        <div className="button-row">
          <button className="primary-action" type="submit">Rename</button>
          <button className="secondary-action" onClick={onCancel} type="button">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function DeviceIcon({ kind, size = 18 }: { kind: DeviceKind; size?: number }) {
  if (kind === "router") return <Router size={size} />;
  if (kind === "switch") return <Network size={size} />;
  if (kind === "firewall") return <Shield size={size} />;
  if (kind === "pc") return <Monitor size={size} />;
  if (kind === "server") return <Server size={size} />;
  if (kind === "wireless") return <Wifi size={size} />;
  return <CircleDot size={size} />;
}

function nodeSize(kind: DeviceKind): { width: number; height: number } {
  if (kind === "switch") return { width: 148, height: 116 };
  if (kind === "server") return { width: 112, height: 96 };
  if (kind === "hub") return { width: 106, height: 78 };
  return { width: 120, height: 86 };
}

function placementPosition(modelId: string, point: { x: number; y: number }): { x: number; y: number } {
  const model = getDeviceModel(modelId);
  const size = nodeSize(model.kind);
  return {
    x: Math.max(16, Math.min(CANVAS_WIDTH - size.width - 16, Math.round(point.x - size.width / 2))),
    y: Math.max(16, Math.min(CANVAS_HEIGHT - size.height - 16, Math.round(point.y - size.height / 2)))
  };
}

function nodeCenter(device: NetworkDevice): { x: number; y: number } {
  const size = nodeSize(device.kind);
  return { x: device.position.x + size.width / 2, y: device.position.y + size.height / 2 };
}

function linkEdge(from: NetworkDevice, to: NetworkDevice): { x: number; y: number } {
  const fromCenter = nodeCenter(from);
  const toCenter = nodeCenter(to);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  const size = nodeSize(from.kind);
  const radius = Math.max(size.width, size.height) / 2 + 5;
  return {
    x: fromCenter.x + (dx / length) * radius,
    y: fromCenter.y + (dy / length) * radius
  };
}

function linkMidpoint(project: NetworkProject, link: NetworkLink): { x: number; y: number } | null {
  const a = project.devices.find((device) => device.id === link.endpointA.deviceId);
  const b = project.devices.find((device) => device.id === link.endpointB.deviceId);
  if (!a || !b) return null;
  const start = linkEdge(a, b);
  const end = linkEdge(b, a);
  const x = Math.max(132, Math.min(CANVAS_WIDTH - 132, (start.x + end.x) / 2));
  const rawY = link.type === "wireless" ? Math.min(start.y, end.y) - 52 : (start.y + end.y) / 2 - 40;
  return { x, y: Math.max(116, Math.min(CANVAS_HEIGHT - 20, rawY)) };
}

function canvasLinkLabel(project: NetworkProject, link: NetworkLink): string {
  const a = project.devices.find((device) => device.id === link.endpointA.deviceId);
  const b = project.devices.find((device) => device.id === link.endpointB.deviceId);
  const aPort = a?.ports.find((port) => port.id === link.endpointA.portId);
  const bPort = b?.ports.find((port) => port.id === link.endpointB.portId);
  if (!a || !b || !aPort || !bPort) return "missing endpoint";
  return `${shortCableLabel(link.type)} ${shortPortName(aPort.name)}-${shortPortName(bPort.name)} ${link.status}`;
}

function shortCableLabel(type: CableType): string {
  return type
    .replace("copper-", "Cu ")
    .replace("serial-", "Serial ")
    .replace("straight", "Straight")
    .replace("cross", "Cross")
    .replace("dce", "DCE")
    .replace("dte", "DTE");
}

function linkStatusDetail(project: NetworkProject, link: NetworkLink): string {
  const aDevice = project.devices.find((device) => device.id === link.endpointA.deviceId);
  const bDevice = project.devices.find((device) => device.id === link.endpointB.deviceId);
  const aPort = aDevice?.ports.find((port) => port.id === link.endpointA.portId);
  const bPort = bDevice?.ports.find((port) => port.id === link.endpointB.portId);
  if (!aDevice || !bDevice || !aPort || !bPort) return "Missing endpoint.";
  if (!aDevice.powerOn || !bDevice.powerOn) return "One endpoint is powered off.";
  if (!aPort.adminUp || !bPort.adminUp) return "One endpoint port is shutdown.";
  if (link.type === "console") return "Console cable is available for terminal/CLI access.";
  if (aPort.kind === "serial" && bPort.kind === "serial" && !aPort.clockRate && !bPort.clockRate) return "Serial link needs a DCE clock rate.";
  if (aPort.kind === "wireless" && bPort.kind === "wireless") {
    const distance = Math.hypot(aDevice.position.x - bDevice.position.x, aDevice.position.y - bDevice.position.y);
    const range = Math.min(aDevice.config.wireless.range || 180, bDevice.config.wireless.range || 180);
    if (aDevice.config.wireless.ssid !== bDevice.config.wireless.ssid || aDevice.config.wireless.auth !== bDevice.config.wireless.auth) return "Wireless SSID/authentication mismatch.";
    if (aDevice.config.wireless.auth === "wpa2-psk" && aDevice.config.wireless.key !== bDevice.config.wireless.key) return "Wireless key mismatch.";
    if (distance > range) return `Wireless endpoints are out of range (${Math.round(distance)} > ${range}).`;
  }
  if (aPort.mode === "trunk" && bPort.mode === "trunk" && !aPort.allowedVlans.some((vlan) => bPort.allowedVlans.includes(vlan))) return "Trunk allowed VLAN lists do not overlap.";
  if (aPort.mode === "access" && bPort.mode === "access" && aPort.vlan !== bPort.vlan) return `Access VLAN mismatch (${aPort.vlan} != ${bPort.vlan}).`;
  if (aPort.mode === "trunk" && bPort.mode === "access" && !aPort.allowedVlans.includes(bPort.vlan)) return `Trunk does not allow access VLAN ${bPort.vlan}.`;
  if (bPort.mode === "trunk" && aPort.mode === "access" && !bPort.allowedVlans.includes(aPort.vlan)) return `Trunk does not allow access VLAN ${aPort.vlan}.`;
  return "Link is operational.";
}

function linkEndpointSummaries(project: NetworkProject, link: NetworkLink): Array<{ side: string; device: string; port: string; mode: string; state: string }> {
  return [
    linkEndpointSummary(project, link.endpointA, link.dceEndpoint === "A" ? "A DCE" : link.dceEndpoint === "B" ? "A DTE" : "A"),
    linkEndpointSummary(project, link.endpointB, link.dceEndpoint === "B" ? "B DCE" : link.dceEndpoint === "A" ? "B DTE" : "B")
  ];
}

function linkEndpointSummary(project: NetworkProject, ref: NetworkLink["endpointA"], side: string): { side: string; device: string; port: string; mode: string; state: string } {
  const device = project.devices.find((item) => item.id === ref.deviceId);
  const port = device?.ports.find((item) => item.id === ref.portId);
  if (!device || !port) return { side, device: "Missing device", port: "missing port", mode: "unknown", state: "down" };
  return {
    side,
    device: device.label,
    port: port.name,
    mode: portModeSummary(port),
    state: `${device.powerOn ? "powered" : "off"} / ${port.adminUp ? "up" : "shutdown"}`
  };
}

function portModeSummary(port: NetworkPort): string {
  if (port.mode === "trunk") return `trunk ${port.allowedVlans.join(",") || "1"}`;
  if (port.mode === "access") return `access vlan ${port.vlan}`;
  return port.ipAddress ? `routed ${port.ipAddress}` : "routed";
}

function portMarkerClass(project: NetworkProject, device: NetworkDevice, port: NetworkPort, selectedCable: CableType | "", pendingDeviceId: string): string {
  const classes: string[] = [];
  if (!port.adminUp) classes.push("shutdown");
  if (port.linkId) classes.push("used");
  if (!selectedCable) return classes.join(" ");
  if (pendingDeviceId === device.id) classes.push("pending");
  classes.push(portCanParticipate(project, device, port, selectedCable, pendingDeviceId) ? "candidate" : "blocked");
  return classes.join(" ");
}

function portMarkerTitle(project: NetworkProject, device: NetworkDevice, port: NetworkPort, selectedCable: CableType | "", pendingDeviceId: string): string {
  const mode = port.mode === "trunk" ? `trunk ${port.allowedVlans.join(",") || "1"}` : port.mode === "access" ? `access vlan ${port.vlan}` : "routed";
  const connected = port.linkId ? `connected: ${portConnectionLabel(project, device, port)}` : "free";
  const admin = port.adminUp ? "up" : "shutdown";
  if (!selectedCable) return `${port.name} / ${port.kind} / ${mode} / ${admin} / ${connected}`;
  if (pendingDeviceId === device.id) return `${port.name} / ${port.kind} / ${mode} / ${admin} / first endpoint device`;
  return `${port.name} / ${port.kind} / ${mode} / ${admin} / ${portCanParticipate(project, device, port, selectedCable, pendingDeviceId) ? "candidate for selected cable" : connected === "free" ? "not compatible with selected cable" : connected}`;
}

function portCanParticipate(project: NetworkProject, device: NetworkDevice, port: NetworkPort, selectedCable: CableType, pendingDeviceId: string): boolean {
  if (port.linkId) return false;
  if (!pendingDeviceId || pendingDeviceId === device.id) {
    return selectedCable === "auto" || canPortUseCable(port, selectedCable);
  }
  const peer = project.devices.find((item) => item.id === pendingDeviceId);
  if (!peer) return false;
  return peer.ports.some((peerPort) => !peerPort.linkId && portsCanConnect(peerPort, peer, port, device, selectedCable));
}

function ConnectionAssistant({
  project,
  draft,
  onConnected,
  onCancel
}: {
  project: NetworkProject;
  draft: { aDeviceId: string; bDeviceId: string; cable: CableType; message: string };
  onConnected: (project: NetworkProject, message: string) => void;
  onCancel: () => void;
}) {
  const aDevice = project.devices.find((device) => device.id === draft.aDeviceId);
  const bDevice = project.devices.find((device) => device.id === draft.bDeviceId);
  const initialPair = firstSelectablePair(aDevice, bDevice, draft.cable);
  const [aPortId, setAPortId] = useState(() => initialPair?.a.id ?? "");
  const [bPortId, setBPortId] = useState(() => initialPair?.b.id ?? "");
  const [error, setError] = useState(draft.message);

  useEffect(() => {
    const pair = firstSelectablePair(aDevice, bDevice, draft.cable);
    setAPortId(pair?.a.id ?? "");
    setBPortId(pair?.b.id ?? "");
    setError(draft.message);
  }, [aDevice?.id, bDevice?.id, draft.cable, draft.message]);

  if (!aDevice || !bDevice) {
    return <EventPanel message="Connection endpoints are missing." onClear={onCancel} project={project} />;
  }

  function connect() {
    const result = validateConnection(project, aDevice!.id, bDevice!.id, draft.cable, aPortId, bPortId);
    if (!result.ok || !result.link) {
      setError(result.message);
      return;
    }
    onConnected(addLink(project, result.link), result.message);
  }

  return (
    <section className="connection-assistant">
      <header>
        <strong>Connection Assistant</strong>
        <small>{draft.cable}</small>
      </header>
      <p>{error}</p>
      <PortPicker cable={draft.cable} device={aDevice} label="First endpoint" onChange={setAPortId} peerDevice={bDevice} peerPort={bDevice.ports.find((port) => port.id === bPortId)} project={project} value={aPortId} />
      <PortPicker cable={draft.cable} device={bDevice} label="Second endpoint" onChange={setBPortId} peerDevice={aDevice} peerPort={aDevice.ports.find((port) => port.id === aPortId)} project={project} value={bPortId} />
      <div className="button-row">
        <button className="primary-action" disabled={!aPortId || !bPortId} onClick={connect} type="button">Connect selected ports</button>
        <button className="secondary-action" onClick={onCancel} type="button">Cancel</button>
      </div>
    </section>
  );
}

function PortPicker({ project, device, peerDevice, peerPort, cable, label, value, onChange }: { project: NetworkProject; device: NetworkDevice; peerDevice: NetworkDevice; peerPort: NetworkPort | undefined; cable: CableType; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <section className="port-picker">
      <span>{label}</span>
      <strong>{device.label}</strong>
      <select aria-label={`${device.label} ${label} port`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select port</option>
        {device.ports.map((port) => (
          <option disabled={!portSelectable(port, device, peerPort, peerDevice, cable)} key={port.id} value={port.id}>{portOptionLabel(project, port, device, peerPort, peerDevice, cable)}</option>
        ))}
      </select>
      <div className="port-choice-list">
        {device.ports.map((port) => {
          const selectable = portSelectable(port, device, peerPort, peerDevice, cable);
          const state = portChoiceState(port, device, peerPort, peerDevice, cable);
          return (
            <button
              className={`${state} ${value === port.id ? "selected" : ""}`}
              disabled={!selectable}
              key={port.id}
              onClick={() => onChange(port.id)}
              title={portOptionLabel(project, port, device, peerPort, peerDevice, cable)}
              type="button"
            >
              <span>{shortPortName(port.name)}</span>
              <small>{port.kind}</small>
              <em>{portChoiceReason(project, port, device, peerPort, peerDevice, cable)}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function firstSelectablePair(aDevice: NetworkDevice | undefined, bDevice: NetworkDevice | undefined, cable: CableType): { a: NetworkPort; b: NetworkPort } | null {
  if (!aDevice || !bDevice) return null;
  for (const aPort of aDevice.ports) {
    for (const bPort of bDevice.ports) {
      if (portsCanConnect(aPort, aDevice, bPort, bDevice, cable)) return { a: aPort, b: bPort };
    }
  }
  return null;
}

function portSelectable(port: NetworkPort, device: NetworkDevice, peerPort: NetworkPort | undefined, peerDevice: NetworkDevice, cable: CableType): boolean {
  if (!peerPort) return !port.linkId && (cable === "auto" || canPortUseCable(port, cable));
  return portsCanConnect(port, device, peerPort, peerDevice, cable);
}

function portOptionLabel(project: NetworkProject, port: NetworkPort, device: NetworkDevice, peerPort: NetworkPort | undefined, peerDevice: NetworkDevice, cable: CableType): string {
  const status = portChoiceState(port, device, peerPort, peerDevice, cable);
  const mode = port.mode === "trunk" ? `trunk ${port.allowedVlans.join(",") || "1"}` : port.mode === "access" ? `access vlan ${port.vlan}` : "routed";
  return `${port.name} - ${port.kind} - ${mode} - ${portChoiceReason(project, port, device, peerPort, peerDevice, cable) || status}`;
}

function portChoiceState(port: NetworkPort, device: NetworkDevice, peerPort: NetworkPort | undefined, peerDevice: NetworkDevice, cable: CableType): "ready" | "used" | "incompatible" {
  if (port.linkId) return "used";
  const compatible = peerPort ? portsCanConnect(port, device, peerPort, peerDevice, cable) : cable === "auto" || canPortUseCable(port, cable);
  return compatible ? "ready" : "incompatible";
}

function portChoiceReason(project: NetworkProject, port: NetworkPort, device: NetworkDevice, peerPort: NetworkPort | undefined, peerDevice: NetworkDevice, cable: CableType): string {
  if (port.linkId) return `used by ${portConnectionLabel(project, device, port)}`;
  if (portChoiceState(port, device, peerPort, peerDevice, cable) === "ready") return peerPort ? "valid pair" : "ready";
  if (!peerPort) return "wrong cable";
  return `not valid with ${shortPortName(peerPort.name)}`;
}

function portsCanConnect(aPort: NetworkPort, aDevice: NetworkDevice, bPort: NetworkPort, bDevice: NetworkDevice, cable: CableType): boolean {
  if (aPort.linkId || bPort.linkId) return false;
  const resolvedCable = cable === "auto" ? inferPairCable(aPort, bPort, aDevice, bDevice) : cable;
  return canPortUseCable(aPort, resolvedCable) && canPortUseCable(bPort, resolvedCable);
}

function inferPairCable(aPort: NetworkPort, bPort: NetworkPort, aDevice: NetworkDevice, bDevice: NetworkDevice): CableType {
  if (aPort.kind === "console" || bPort.kind === "console") return "console";
  if (aPort.kind === "serial" && bPort.kind === "serial") return "serial-dce";
  if (aPort.kind === "fiber" && bPort.kind === "fiber") return "fiber";
  if (aPort.kind === "wireless" && bPort.kind === "wireless") return "wireless";
  if (aDevice.kind === bDevice.kind) return "copper-cross";
  return "copper-straight";
}

function boundedNumber(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parseVlanList(value: string): number[] {
  const ids = value
    .split(",")
    .map((item) => boundedNumber(item.trim(), 1, 4094))
    .filter((item, index, list) => list.indexOf(item) === index);
  return ids.length > 0 ? ids : [1];
}

function ensureVlanRows(vlans: Array<{ id: number; name: string }>, ids: number[]): Array<{ id: number; name: string }> {
  const byId = new Map(vlans.filter((vlan) => validVlanId(vlan.id)).map((vlan) => [vlan.id, vlan.name]));
  byId.set(1, byId.get(1) || "default");
  for (const id of ids.filter(validVlanId)) byId.set(id, byId.get(id) || `VLAN${id}`);
  return Array.from(byId.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
}

function modePatch(mode: NetworkPort["mode"]): Partial<NetworkPort> {
  if (mode === "routed") return { mode };
  return { mode, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" };
}

function isIpCapable(device: NetworkDevice, port: NetworkPort): boolean {
  return Boolean(port.ipCapable || port.mode === "routed" || device.kind === "pc" || device.kind === "server");
}

function repairProject(project: NetworkProject): { project: NetworkProject; message: string } {
  let changes = 0;
  const validDeviceIds = new Set(project.devices.map((device) => device.id));
  const validPortKeys = new Set(project.devices.flatMap((device) => device.ports.map((port) => `${device.id}:${port.id}`)));
  const occupiedPorts = new Set<string>();
  const links = project.links.filter((link) => {
    const aKey = `${link.endpointA.deviceId}:${link.endpointA.portId}`;
    const bKey = `${link.endpointB.deviceId}:${link.endpointB.portId}`;
    const valid = validDeviceIds.has(link.endpointA.deviceId) &&
      validDeviceIds.has(link.endpointB.deviceId) &&
      validPortKeys.has(aKey) &&
      validPortKeys.has(bKey) &&
      !occupiedPorts.has(aKey) &&
      !occupiedPorts.has(bKey);
    if (valid) {
      occupiedPorts.add(aKey);
      occupiedPorts.add(bKey);
    } else {
      changes += 1;
    }
    return valid;
  });
  const linkByPort = new Map<string, string>();
  for (const link of links) {
    linkByPort.set(`${link.endpointA.deviceId}:${link.endpointA.portId}`, link.id);
    linkByPort.set(`${link.endpointB.deviceId}:${link.endpointB.portId}`, link.id);
  }
  const usedLabels = new Set<string>();
  const usedHostnames = new Set<string>();
  const devices = project.devices.map((device) => {
    const label = uniqueDeviceName(cleanDeviceName(device.label) || `${devicePrefix(device)}0`, usedLabels);
    const hostname = uniqueDeviceName(cleanHostname(device.config.hostname || label) || label, usedHostnames);
    const vlanMap = new Map(device.config.vlans.filter((vlan) => validVlanId(vlan.id)).map((vlan) => [vlan.id, vlan.name]));
    vlanMap.set(1, vlanMap.get(1) || "default");
    for (const port of device.ports) {
      if (port.mode === "access" && validVlanId(port.vlan)) vlanMap.set(port.vlan, vlanMap.get(port.vlan) || `VLAN${port.vlan}`);
      if (port.mode === "trunk") {
        for (const vlan of port.allowedVlans.filter(validVlanId)) vlanMap.set(vlan, vlanMap.get(vlan) || `VLAN${vlan}`);
      }
    }
    const ports = device.ports.map((port) => {
      const linkId = linkByPort.get(`${device.id}:${port.id}`);
      if (port.linkId !== linkId) changes += 1;
      return {
        ...port,
        description: port.description ?? "",
        vlan: validVlanId(port.vlan) ? port.vlan : 1,
        allowedVlans: port.allowedVlans.filter(validVlanId).length ? port.allowedVlans.filter(validVlanId) : [1],
        linkId
      };
    });
    const vlans = Array.from(vlanMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
    if (label !== device.label || hostname !== device.config.hostname || vlans.length !== device.config.vlans.length) changes += 1;
    return {
      ...device,
      label,
      ports,
      config: {
        ...device.config,
        hostname,
        vlans
      }
    };
  });
  const next = recalc({ ...project, devices, links });
  return { project: next, message: changes ? `Project repair applied (${changes} fixes).` : "No repairable project issues found." };
}

function cleanDeviceName(value: string): string {
  return value.replace(/[<>]/g, "").trim().slice(0, 32);
}

function validVlanId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4094;
}

function cleanHostname(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32);
}

function uniqueDeviceName(base: string, used: Set<string>): string {
  let candidate = base || "Device";
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base || "Device"}_${index}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function devicePrefix(device: NetworkDevice): string {
  try {
    return getDeviceModel(device.modelId).labelPrefix;
  } catch {
    return displayKind(device.kind);
  }
}

function deviceTabLabel(tab: DeviceTab): string {
  return ({ physical: "Physical", config: "Config", cli: "CLI", desktop: "Desktop", services: "Services" })[tab];
}

function Palette({ selectedModel, selectedCable, onSelect, onModel, onCable }: { selectedModel: string; selectedCable: CableType | ""; onSelect: () => void; onModel: (id: string) => void; onCable: (type: CableType) => void }) {
  const [kind, setKind] = useState<DeviceKind>("router");
  const models = useMemo(() => deviceCatalog.filter((device) => device.kind === kind), [kind]);
  return (
    <section className="palette packet-palette">
      <div className="palette-toolbar">
        <button className={!selectedModel && !selectedCable ? "active" : ""} onClick={onSelect} title="Select" type="button"><MousePointer2 size={15} /></button>
        <span>Device-Type Selection</span>
      </div>
      <div className="tool-row">
        {(["router", "switch", "firewall", "pc", "server", "wireless", "hub"] as DeviceKind[]).map((item) => (
          <button className={kind === item ? "active" : ""} key={item} onClick={() => setKind(item)} title={displayKind(item)} type="button">
            <DeviceIcon kind={item} size={18} />
          </button>
        ))}
      </div>
      <div className="model-list">
        {models.map((model) => (
          <button
            className={selectedModel === model.id ? "active" : ""}
            draggable
            key={model.id}
            onClick={() => onModel(model.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-device-model", model.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            title={model.description}
            type="button"
          >
            <DeviceIcon kind={model.kind} />
            <span><strong>{model.model}</strong><small>{model.description}</small></span>
          </button>
        ))}
      </div>
      <div className="connection-box">
        <div className="palette-toolbar"><Cable size={15} /><span>Connections</span></div>
        <div className="cable-list">{cableCatalog.map((cable) => <button className={selectedCable === cable.type ? "active" : ""} key={cable.type} onClick={() => onCable(cable.type)} title={cable.label} type="button"><span className={`cable-swatch ${cable.type}`} />{cable.label}</button>)}</div>
      </div>
    </section>
  );
}

function Inspector({ device, project, initialTab, onUpdate, onProjectChange, onDelete, onDhcp }: { device: NetworkDevice; project: NetworkProject; initialTab?: DeviceTab; onUpdate: (device: NetworkDevice) => void; onProjectChange: (project: NetworkProject, message: string) => void; onDelete: (deviceId: string) => void; onDhcp: () => void }) {
  const [tab, setTab] = useState<DeviceTab>(initialTab ?? (device.kind === "pc" || device.kind === "server" ? "config" : "physical"));
  const tabs: DeviceTab[] = deviceCatalog.find((model) => model.id === device.modelId)?.tabs ?? ["physical", "config"];
  useEffect(() => {
    if (!tabs.some((item) => item === tab)) setTab(tabs[0]);
  }, [device.id, tab, tabs]);
  useEffect(() => {
    const defaultTab: DeviceTab = device.kind === "pc" || device.kind === "server" ? "config" : "physical";
    setTab(initialTab && tabs.includes(initialTab) ? initialTab : defaultTab);
  }, [device.id, device.kind, initialTab, tabs]);
  return (
    <>
      <header className="inspector-head">
        <div><h2>{device.label}</h2><p>{device.model}</p></div>
        <button className="icon-button danger" onClick={() => onDelete(device.id)} title="Delete device" type="button"><Trash2 size={17} /></button>
      </header>
      <div className="tab-row">{tabs.map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)} type="button">{deviceTabLabel(item)}</button>)}</div>
      {tab === "physical" && <PhysicalTab device={device} onProjectChange={onProjectChange} onUpdate={onUpdate} project={project} />}
      {tab === "config" && <ConfigTab device={device} onUpdate={onUpdate} onDhcp={onDhcp} />}
      {tab === "cli" && <CliTab device={device} project={project} onProjectChange={onProjectChange} onUpdate={onUpdate} />}
      {tab === "desktop" && <DesktopTab device={device} project={project} onProjectChange={onProjectChange} onUpdate={onUpdate} />}
      {tab === "services" && <ServicesTab device={device} onUpdate={onUpdate} />}
    </>
  );
}

function PhysicalTab({ device, project, onUpdate, onProjectChange }: { device: NetworkDevice; project: NetworkProject; onUpdate: (device: NetworkDevice) => void; onProjectChange: (project: NetworkProject, message: string) => void }) {
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const model = getDeviceModel(device.modelId);
  const compatibleModules = Array.from(new Set(model.modules.flatMap((slot) => slot.accepts)))
    .map((moduleId) => getModuleSpec(moduleId))
    .filter((module): module is ModuleSpec => Boolean(module));

  function selectCompatibleModule(moduleId: string) {
    const slot = model.modules.find((candidate) => candidate.accepts.includes(moduleId) && !device.modules.some((module) => module.slotId === candidate.id));
    if (!slot) {
      setNotice("No empty compatible slot is available.");
      return;
    }
    setSlotSelections((current) => ({ ...current, [slot.id]: moduleId }));
    setNotice(`${moduleId} selected for ${slot.label}. Power off the device, then install.`);
  }

  function install(slotId: string) {
    const slot = model.modules.find((item) => item.id === slotId);
    const moduleId = slotSelections[slotId] || slot?.accepts[0] || "";
    const result = installModule(device, slotId, moduleId);
    setNotice(result.message);
    if (result.ok) onUpdate(result.device);
  }

  function remove(slotId: string) {
    const result = removeModule(device, slotId);
    setNotice(result.message);
    if (result.ok) onUpdate(result.device);
  }

  function setPower(powerOn: boolean) {
    onUpdate({
      ...device,
      powerOn,
      runtime: powerOn ? device.runtime : { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
    });
  }

  return (
    <section className="panel-section physical-panel">
      <aside className="physical-module-list">
        <header>
          <strong>Modules</strong>
          <small>{compatibleModules.length ? "Select a module for an empty slot." : "No expansion modules."}</small>
        </header>
        {compatibleModules.map((module) => (
          <button key={module.id} onClick={() => selectCompatibleModule(module.id)} type="button">
            <strong>{module.label}</strong>
            <span>{module.description}</span>
            <small>{module.ports.length} port{module.ports.length === 1 ? "" : "s"}</small>
          </button>
        ))}
      </aside>
      <div className="physical-chassis-pane">
        <label className="toggle"><input checked={device.powerOn} onChange={(event) => setPower(event.target.checked)} type="checkbox" />Power</label>
        <div className={`physical-front-panel ${device.powerOn ? "powered" : "off"}`}>
          <div>
            <strong>{device.model}</strong>
            <small>{device.modules.length} modules installed</small>
          </div>
          <div className="physical-port-map">
            {device.ports.map((port) => (
              <button
                className={`physical-port ${port.kind} ${port.linkId ? "connected" : ""} ${port.adminUp ? "" : "shutdown"}`}
                key={port.id}
                onClick={() => port.linkId && onProjectChange(removeLink(project, port.linkId), `${device.label} ${port.name} disconnected.`)}
                title={`${port.name} / ${port.kind} / ${portConnectionLabel(project, device, port)}`}
                type="button"
              >
                <span>{shortPortName(port.name)}</span>
              </button>
            ))}
          </div>
        </div>
        {model.modules.length > 0 && (
          <div className="module-rack">
            <header>
              <strong>Module Slots</strong>
              <small>{device.powerOn ? "Power off before changing modules" : "Safe for module changes"}</small>
            </header>
            {model.modules.map((slot) => {
              const installed = device.modules.find((module) => module.slotId === slot.id);
              const installedSpec = installed ? getModuleSpec(installed.moduleId) : null;
              return (
                <div className="module-slot" key={slot.id}>
                  <div>
                    <strong>{slot.label}</strong>
                    <span>{installedSpec ? `${installedSpec.label}: ${installedSpec.description}` : "empty"}</span>
                  </div>
                  {installed ? (
                    <button className="secondary-action" disabled={device.powerOn} onClick={() => remove(slot.id)} type="button">Remove</button>
                  ) : (
                    <>
                      <select disabled={device.powerOn} value={slotSelections[slot.id] ?? slot.accepts[0]} onChange={(event) => setSlotSelections({ ...slotSelections, [slot.id]: event.target.value })}>
                        {slot.accepts.map((moduleId) => {
                          const spec = getModuleSpec(moduleId);
                          return <option key={moduleId} value={moduleId}>{spec?.label ?? moduleId}</option>;
                        })}
                      </select>
                      <button className="secondary-action" disabled={device.powerOn} onClick={() => install(slot.id)} type="button">Install</button>
                    </>
                  )}
                </div>
              );
            })}
            {notice && <small className={notice.includes("Power off") || notice.includes("Disconnect") || notice.includes("not") ? "module-notice warning" : "module-notice"}>{notice}</small>}
          </div>
        )}
        <div className="port-table physical-port-table">{device.ports.map((port) => (
          <div key={port.id}>
            <strong>{port.name}</strong>
            <span>{port.kind}</span>
            <span>{port.adminUp ? "up" : "shutdown"}</span>
            <span>{port.mode === "trunk" ? `trunk ${port.allowedVlans.join(",")}` : port.mode === "access" ? `vlan ${port.vlan}` : port.ipAddress || "routed"}</span>
            <span>{portConnectionLabel(project, device, port)}</span>
            {port.linkId ? <button className="secondary-action" onClick={() => onProjectChange(removeLink(project, port.linkId!), `${device.label} ${port.name} disconnected.`)} type="button">Disconnect</button> : <small>free</small>}
          </div>
        ))}</div>
      </div>
    </section>
  );
}

function shortPortName(name: string): string {
  return name
    .replace("FastEthernet", "Fa")
    .replace("GigabitEthernet", "Gi")
    .replace("Serial", "Se")
    .replace("Ethernet", "Eth")
    .replace("Wireless", "W")
    .replace("Console", "Con");
}

function portConnectionLabel(project: NetworkProject, device: NetworkDevice, port: NetworkPort): string {
  if (!port.linkId) return "free";
  const link = project.links.find((item) => item.id === port.linkId);
  if (!link) return "broken link";
  const peerRef = link.endpointA.deviceId === device.id && link.endpointA.portId === port.id ? link.endpointB : link.endpointA;
  const peer = project.devices.find((item) => item.id === peerRef.deviceId);
  const peerPort = peer?.ports.find((item) => item.id === peerRef.portId);
  return peer && peerPort ? `${peer.label} ${peerPort.name}` : "missing peer";
}

function ConfigTab({ device, onUpdate, onDhcp }: { device: NetworkDevice; onUpdate: (device: NetworkDevice) => void; onDhcp: () => void }) {
  const dataPorts = device.ports.filter((item) => item.kind !== "console");
  const [selectedPortId, setSelectedPortId] = useState(dataPorts[0]?.id ?? "");
  const [routeDraft, setRouteDraft] = useState({ network: "", mask: "", nextHop: "" });
  const [vlanDraft, setVlanDraft] = useState({ id: "10", name: "Users" });
  const [aclDraft, setAclDraft] = useState<Omit<AccessRule, "id" | "hits">>({ action: "permit", protocol: "ip", source: "any", destination: "any", interfaceName: "" });
  const [natDraft, setNatDraft] = useState<Omit<NatRule, "id" | "hits">>({ insideLocal: "", insideGlobal: "", outsideInterface: "" });
  const port = dataPorts.find((item) => item.id === selectedPortId) ?? dataPorts[0];

  useEffect(() => {
    if (!dataPorts.some((item) => item.id === selectedPortId)) setSelectedPortId(dataPorts[0]?.id ?? "");
  }, [device.id, dataPorts.length, selectedPortId]);

  function updatePort(portId: string, patch: Partial<NetworkPort>) {
    const requiredVlans = [
      ...(patch.vlan && validVlanId(patch.vlan) ? [patch.vlan] : []),
      ...(patch.allowedVlans ?? []).filter(validVlanId)
    ];
    onUpdate({
      ...device,
      ports: device.ports.map((item) => (item.id === portId ? { ...item, ...patch } : item)),
      config: requiredVlans.length ? { ...device.config, vlans: ensureVlanRows(device.config.vlans, requiredVlans) } : device.config
    });
  }

  function addRoute() {
    if (!routeDraft.network || !routeDraft.mask || !routeDraft.nextHop) return;
    onUpdate({
      ...device,
      config: {
        ...device.config,
        staticRoutes: [...device.config.staticRoutes, { id: createId("route"), network: routeDraft.network.trim(), mask: routeDraft.mask.trim(), nextHop: routeDraft.nextHop.trim() }]
      }
    });
    setRouteDraft({ network: "", mask: "", nextHop: "" });
  }

  function updateRoute(routeId: string, patch: Partial<NetworkDevice["config"]["staticRoutes"][number]>) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        staticRoutes: device.config.staticRoutes.map((route) => route.id === routeId ? { ...route, ...patch } : route)
      }
    });
  }

  function addVlan() {
    const id = Number(vlanDraft.id);
    if (!Number.isInteger(id) || id < 1 || id > 4094 || device.config.vlans.some((vlan) => vlan.id === id)) return;
    onUpdate({ ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: vlanDraft.name.trim() || `VLAN${id}` }].sort((a, b) => a.id - b.id) } });
  }

  function updateVlanName(id: number, name: string) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        vlans: device.config.vlans.map((vlan) => vlan.id === id ? { ...vlan, name: name.trim().slice(0, 32) || `VLAN${id}` } : vlan)
      }
    });
  }

  function addAccessRule() {
    if (!aclDraft.source || !aclDraft.destination) return;
    onUpdate({ ...device, config: { ...device.config, accessRules: [...device.config.accessRules, { ...aclDraft, id: createId("acl"), interfaceName: aclDraft.interfaceName || port?.name || "outside", hits: 0 }] } });
  }

  function updateAccessRule(ruleId: string, patch: Partial<AccessRule>) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        accessRules: device.config.accessRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule)
      }
    });
  }

  function addNatRule() {
    if (!natDraft.insideLocal || !natDraft.insideGlobal) return;
    onUpdate({ ...device, config: { ...device.config, natRules: [...device.config.natRules, { ...natDraft, id: createId("nat"), outsideInterface: natDraft.outsideInterface || port?.name || "outside", hits: 0 }] } });
  }

  function updateNatRule(ruleId: string, patch: Partial<NatRule>) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        natRules: device.config.natRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule)
      }
    });
  }

  function scrollConfig(section: string) {
    document.getElementById(`${device.id}-config-${section}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <section className="panel-section config-panel">
      <div className="config-shortcuts">
        <button onClick={() => scrollConfig("interface")} type="button">Interface</button>
        {(device.kind === "router" || device.kind === "switch" || device.kind === "firewall") && <button onClick={() => scrollConfig("routes")} type="button">Routes</button>}
        {(device.kind === "switch" || device.kind === "router" || device.kind === "firewall") && <button onClick={() => scrollConfig("vlans")} type="button">VLAN</button>}
        {(device.kind === "wireless" || device.ports.some((item) => item.kind === "wireless")) && <button onClick={() => scrollConfig("wireless")} type="button">Wireless</button>}
        {device.kind === "firewall" && <button onClick={() => scrollConfig("security")} type="button">Security</button>}
      </div>
      <label id={`${device.id}-config-interface`}>Hostname<input value={device.config.hostname} onChange={(event) => onUpdate({ ...device, label: event.target.value, config: { ...device.config, hostname: event.target.value } })} /></label>
      {port && (
        <div className="config-group">
          <header><strong>Interface</strong><select value={port.id} onChange={(event) => setSelectedPortId(event.target.value)}>{dataPorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></header>
          <label className="toggle"><input checked={port.adminUp} onChange={(event) => updatePort(port.id, { adminUp: event.target.checked })} type="checkbox" />Admin up</label>
          <label>Description<input value={port.description} onChange={(event) => updatePort(port.id, { description: event.target.value.slice(0, 80) })} placeholder="Link to CoreSwitch Gi0/1" /></label>
          {isIpCapable(device, port) ? (
            <>
              <label>IP<input value={port.ipAddress} onChange={(event) => updatePort(port.id, { ipAddress: event.target.value.trim() })} placeholder="192.168.1.1" /></label>
              <label>Mask<input value={port.subnetMask} onChange={(event) => updatePort(port.id, { subnetMask: event.target.value.trim() })} placeholder="255.255.255.0" /></label>
              <label>Gateway<input value={port.gateway} onChange={(event) => updatePort(port.id, { gateway: event.target.value.trim() })} placeholder="192.168.1.254" /></label>
              <label>DNS<input value={port.dnsServer} onChange={(event) => updatePort(port.id, { dnsServer: event.target.value.trim() })} placeholder="8.8.8.8" /></label>
            </>
          ) : <small>Layer 2 switch ports use VLAN settings instead of interface IP addressing.</small>}
          <label>Mode<select value={port.mode} onChange={(event) => updatePort(port.id, modePatch(event.target.value as NetworkPort["mode"]))}>
            <option value="access">access</option>
            <option value="trunk">trunk</option>
            <option value="routed">routed</option>
          </select></label>
          {port.mode === "access" && <label>Access VLAN<input value={port.vlan} onChange={(event) => updatePort(port.id, { vlan: boundedNumber(event.target.value, 1, 4094) })} type="number" /></label>}
          {port.mode === "trunk" && <label>Allowed VLANs<input value={port.allowedVlans.join(",")} onChange={(event) => updatePort(port.id, { allowedVlans: parseVlanList(event.target.value) })} placeholder="1,10,20" /></label>}
          {port.kind === "serial" && <label>Clock rate<input value={port.clockRate ?? ""} onChange={(event) => updatePort(port.id, { clockRate: event.target.value ? boundedNumber(event.target.value, 1200, 8000000) : undefined })} placeholder="64000" type="number" /></label>}
        </div>
      )}
      {(device.kind === "pc" || device.kind === "server") && <button className="secondary-action" onClick={onDhcp} type="button">DHCP Renew</button>}
      {(device.kind === "router" || device.kind === "switch" || device.kind === "firewall") && (
        <div className="config-group" id={`${device.id}-config-routes`}>
          <header><strong>Static Routes</strong><small>{device.config.staticRoutes.length}</small></header>
          <div className="inline-grid">
            <input value={routeDraft.network} onChange={(event) => setRouteDraft({ ...routeDraft, network: event.target.value })} placeholder="Network" />
            <input value={routeDraft.mask} onChange={(event) => setRouteDraft({ ...routeDraft, mask: event.target.value })} placeholder="Mask" />
            <input value={routeDraft.nextHop} onChange={(event) => setRouteDraft({ ...routeDraft, nextHop: event.target.value })} placeholder="Next hop" />
            <button className="secondary-action" onClick={addRoute} type="button">Add</button>
          </div>
          {device.config.staticRoutes.map((route) => (
            <div className="editable-route-row" key={route.id}>
              <label>Network<input value={route.network} onChange={(event) => updateRoute(route.id, { network: event.target.value.trim() })} /></label>
              <label>Mask<input value={route.mask} onChange={(event) => updateRoute(route.id, { mask: event.target.value.trim() })} /></label>
              <label>Next hop<input value={route.nextHop} onChange={(event) => updateRoute(route.id, { nextHop: event.target.value.trim() })} /></label>
              <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.filter((item) => item.id !== route.id) } })} type="button">Remove</button>
            </div>
          ))}
        </div>
      )}
      {(device.kind === "switch" || device.kind === "router" || device.kind === "firewall") && (
        <div className="config-group" id={`${device.id}-config-vlans`}>
          <header><strong>VLAN Database</strong><small>{device.config.vlans.length}</small></header>
          <div className="inline-grid narrow">
            <input value={vlanDraft.id} onChange={(event) => setVlanDraft({ ...vlanDraft, id: event.target.value })} placeholder="ID" type="number" />
            <input value={vlanDraft.name} onChange={(event) => setVlanDraft({ ...vlanDraft, name: event.target.value })} placeholder="Name" />
            <button className="secondary-action" onClick={addVlan} type="button">Add</button>
          </div>
          {device.config.vlans.map((vlan) => (
            <div className="editable-vlan-row" key={vlan.id}>
              <strong>{vlan.id}</strong>
              <label>Name<input value={vlan.name} onChange={(event) => updateVlanName(vlan.id, event.target.value)} /></label>
              {vlan.id !== 1 && <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, vlans: device.config.vlans.filter((item) => item.id !== vlan.id) }, ports: device.ports.map((item) => item.vlan === vlan.id ? { ...item, vlan: 1, allowedVlans: item.allowedVlans.filter((allowed) => allowed !== vlan.id) } : item) })} type="button">Remove</button>}
            </div>
          ))}
        </div>
      )}
      {(device.kind === "wireless" || device.ports.some((item) => item.kind === "wireless")) && (
        <div className="config-group" id={`${device.id}-config-wireless`}>
          <header><strong>Wireless</strong><small>{device.config.wireless.ssid}</small></header>
          <label>SSID<input value={device.config.wireless.ssid} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, ssid: event.target.value } } })} /></label>
          <label>Security<select value={device.config.wireless.auth} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, auth: event.target.value as "open" | "wpa2-psk" } } })}><option value="open">open</option><option value="wpa2-psk">wpa2-psk</option></select></label>
          <label>Key<input value={device.config.wireless.key} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, key: event.target.value } } })} /></label>
          <label>Channel<input value={device.config.wireless.channel} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, channel: boundedNumber(event.target.value, 1, 11) } } })} type="number" /></label>
          <label>Range<input value={device.config.wireless.range} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, range: boundedNumber(event.target.value, 20, 1000) } } })} type="number" /></label>
        </div>
      )}
      {device.kind === "firewall" && (
        <>
          <div className="config-group" id={`${device.id}-config-security`}>
            <header><strong>Access Rules</strong><small>{device.config.accessRules.length}</small></header>
            <div className="inline-grid services">
              <select value={aclDraft.action} onChange={(event) => setAclDraft({ ...aclDraft, action: event.target.value as AccessRule["action"] })}><option value="permit">permit</option><option value="deny">deny</option></select>
              <select value={aclDraft.protocol} onChange={(event) => setAclDraft({ ...aclDraft, protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select>
              <input value={aclDraft.source} onChange={(event) => setAclDraft({ ...aclDraft, source: event.target.value })} placeholder="Source" />
              <input value={aclDraft.destination} onChange={(event) => setAclDraft({ ...aclDraft, destination: event.target.value })} placeholder="Destination" />
              <input value={aclDraft.interfaceName} onChange={(event) => setAclDraft({ ...aclDraft, interfaceName: event.target.value })} placeholder="Interface" />
              <button className="secondary-action" onClick={addAccessRule} type="button">Add ACL</button>
            </div>
            {device.config.accessRules.map((rule) => (
              <div className="editable-acl-row" key={rule.id}>
                <label>Action<select value={rule.action} onChange={(event) => updateAccessRule(rule.id, { action: event.target.value as AccessRule["action"] })}><option value="permit">permit</option><option value="deny">deny</option></select></label>
                <label>Protocol<select value={rule.protocol} onChange={(event) => updateAccessRule(rule.id, { protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select></label>
                <label>Source<input value={rule.source} onChange={(event) => updateAccessRule(rule.id, { source: event.target.value.trim() })} /></label>
                <label>Destination<input value={rule.destination} onChange={(event) => updateAccessRule(rule.id, { destination: event.target.value.trim() })} /></label>
                <label>Interface<input value={rule.interfaceName} onChange={(event) => updateAccessRule(rule.id, { interfaceName: event.target.value.trim() })} /></label>
                <small>{rule.hits} hits</small>
                <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, accessRules: device.config.accessRules.filter((item) => item.id !== rule.id) } })} type="button">Remove</button>
              </div>
            ))}
          </div>
          <div className="config-group">
            <header><strong>NAT Rules</strong><small>{device.config.natRules.length}</small></header>
            <div className="inline-grid narrow">
              <input value={natDraft.insideLocal} onChange={(event) => setNatDraft({ ...natDraft, insideLocal: event.target.value })} placeholder="Inside local" />
              <input value={natDraft.insideGlobal} onChange={(event) => setNatDraft({ ...natDraft, insideGlobal: event.target.value })} placeholder="Inside global" />
              <input value={natDraft.outsideInterface} onChange={(event) => setNatDraft({ ...natDraft, outsideInterface: event.target.value })} placeholder="Outside int" />
              <button className="secondary-action" onClick={addNatRule} type="button">Add NAT</button>
            </div>
            {device.config.natRules.map((rule) => (
              <div className="editable-nat-row" key={rule.id}>
                <label>Inside local<input value={rule.insideLocal} onChange={(event) => updateNatRule(rule.id, { insideLocal: event.target.value.trim() })} /></label>
                <label>Inside global<input value={rule.insideGlobal} onChange={(event) => updateNatRule(rule.id, { insideGlobal: event.target.value.trim() })} /></label>
                <label>Outside interface<input value={rule.outsideInterface} onChange={(event) => updateNatRule(rule.id, { outsideInterface: event.target.value.trim() })} /></label>
                <small>{rule.hits} hits</small>
                <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, natRules: device.config.natRules.filter((item) => item.id !== rule.id) } })} type="button">Remove</button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const cliCommandHints = [
  { command: "enable", detail: "privileged EXEC" },
  { command: "configure terminal", detail: "global config" },
  { command: "hostname ", detail: "rename device" },
  { command: "interface ", detail: "enter interface" },
  { command: "description ", detail: "interface description" },
  { command: "ip address ", detail: "set IP and mask" },
  { command: "no shutdown", detail: "enable interface" },
  { command: "shutdown", detail: "disable interface" },
  { command: "switchport mode access", detail: "access mode" },
  { command: "switchport mode trunk", detail: "trunk mode" },
  { command: "switchport access vlan ", detail: "set VLAN" },
  { command: "switchport trunk allowed vlan ", detail: "allowed VLANs" },
  { command: "ip route ", detail: "static route" },
  { command: "ip dhcp pool ", detail: "DHCP pool" },
  { command: "network ", detail: "DHCP network" },
  { command: "default-router ", detail: "DHCP gateway" },
  { command: "dns-server ", detail: "DHCP DNS" },
  { command: "show running-config", detail: "current config" },
  { command: "show startup-config", detail: "saved config" },
  { command: "show ip interface brief", detail: "interface summary" },
  { command: "show interfaces trunk", detail: "trunks" },
  { command: "show vlan brief", detail: "VLAN table" },
  { command: "show mac address-table", detail: "MAC table" },
  { command: "show cdp neighbors", detail: "direct neighbors" },
  { command: "show ip route", detail: "routing table" },
  { command: "show arp", detail: "ARP table" },
  { command: "ping ", detail: "ICMP test" },
  { command: "traceroute ", detail: "path trace" },
  { command: "write memory", detail: "save startup-config" },
  { command: "copy running-config startup-config", detail: "save config" },
  { command: "exit", detail: "leave mode" },
  { command: "end", detail: "privileged mode" },
  { command: "help", detail: "command list" }
];

function CliTab({ device, project, onUpdate, onProjectChange }: { device: NetworkDevice; project: NetworkProject; onUpdate: (device: NetworkDevice) => void; onProjectChange: (project: NetworkProject, message: string) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [session, setSession] = useState(initialCliSession);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const outputRef = useRef<HTMLDivElement | null>(null);
  const visibleHints = cliCommandHints.filter((hint) => `${hint.command} ${hint.detail}`.toLowerCase().includes(helpQuery.trim().toLowerCase()));

  useEffect(() => {
    setLines([]);
    setInput("");
    setSession(initialCliSession());
    setHelpOpen(false);
    setHelpQuery("");
  }, [device.id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  async function run() {
    const prompt = cliPrompt(device, session);
    if (input.trim().toLowerCase().startsWith("ping ") || input.trim().toLowerCase().startsWith("traceroute ") || input.trim().toLowerCase().startsWith("tracert ")) {
      const output = await runCliPacketCommand(project, device, input, onProjectChange);
      setLines([...lines, `${prompt} ${input}`, output].filter(Boolean));
      setInput("");
      return;
    }
    if (input.trim().toLowerCase() === "show cdp neighbors") {
      setLines([...lines, `${prompt} ${input}`, showCdpNeighbors(project, device)].filter(Boolean));
      setInput("");
      return;
    }
    const result = runCliCommand(device, session, input);
    setSession(result.session);
    onUpdate(result.device);
    setLines([...lines, `${prompt} ${input}`, result.output].filter(Boolean));
    setInput("");
  }
  return (
    <section className="terminal cli-terminal">
      <header className="terminal-header">
        <Terminal size={16} />
        <span>{device.config.hostname}</span>
        <button className="terminal-help-button" onClick={() => setHelpOpen((value) => !value)} title="CLI command helper" type="button"><CircleHelp size={15} /></button>
      </header>
      {helpOpen && (
        <div className="cli-help-panel">
          <input value={helpQuery} onChange={(event) => setHelpQuery(event.target.value)} placeholder="Search commands" />
          <div className="cli-help-list">
            {visibleHints.map((hint) => (
              <button key={hint.command} onClick={() => { setInput(hint.command); setHelpOpen(false); }} type="button">
                <strong>{hint.command}</strong>
                <span>{hint.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={outputRef} className="terminal-output">{lines.map((line, index) => <pre key={index}>{line}</pre>)}</div>
      <form className="cli-input-row" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <span>{cliPrompt(device, session)}</span>
        <input aria-label="CLI command" value={input} onChange={(event) => setInput(event.target.value)} placeholder="show ip interface brief" />
      </form>
      <small>{cliPrompt(device, session)} | help, ping, traceroute, tracert, conf t, interface, vlan, ip route, ip dhcp pool, show run, write memory</small>
    </section>
  );
}

async function runCliPacketCommand(project: NetworkProject, device: NetworkDevice, command: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<string> {
  const lower = command.trim().toLowerCase();
  const targetText = command.trim().split(/\s+/).slice(1).join(" ");
  const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
  if (!resolved.target) return `% Unable to resolve ${targetText}: ${resolved.error}`;
  const before = resolved.project.simulationEvents.length;
  const result = await simulatePing(resolved.project, device.id, resolved.target.id);
  onProjectChange(result.project, result.message);
  if (lower.startsWith("traceroute ") || lower.startsWith("tracert ")) {
    const newEvents = result.project.simulationEvents.slice(before);
    const hops = newEvents
      .map((event) => result.project.devices.find((item) => item.id === event.atDeviceId)?.label ?? event.atDeviceId)
      .filter((label, index, list) => list.indexOf(label) === index);
    return [`Tracing route to ${resolved.target.label}`, ...hops.map((hop, index) => `${index + 1}  ${hop}`), result.success ? "Trace complete." : result.message].join("\n");
  }
  return result.success
    ? `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${resolved.target.label}.\n!!!!!\nSuccess rate is 100 percent\n${result.message}`
    : `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${resolved.target.label}.\n.....\nSuccess rate is 0 percent\n${result.message}`;
}

function showCdpNeighbors(project: NetworkProject, device: NetworkDevice): string {
  const rows = project.links
    .filter((link) => link.status === "up" && (link.endpointA.deviceId === device.id || link.endpointB.deviceId === device.id))
    .map((link) => {
      const localRef = link.endpointA.deviceId === device.id ? link.endpointA : link.endpointB;
      const peerRef = link.endpointA.deviceId === device.id ? link.endpointB : link.endpointA;
      const localPort = endpointLabel(project, localRef.deviceId, localRef.portId);
      const peer = project.devices.find((item) => item.id === peerRef.deviceId);
      const peerPort = endpointLabel(project, peerRef.deviceId, peerRef.portId);
      return `${(peer?.label ?? peerRef.deviceId).padEnd(18)}${localPort.padEnd(22)}${(peer?.model ?? "").padEnd(22)}${peerPort}`;
    });
  return rows.length ? ["Device ID         Local Interface       Platform              Port ID", ...rows].join("\n") : "No CDP neighbors found.";
}

function endpointLabel(project: NetworkProject, deviceId: string, portId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.ports.find((port) => port.id === portId)?.name ?? portId;
}

function DesktopTab({ device, project, onProjectChange, onUpdate }: { device: NetworkDevice; project: NetworkProject; onProjectChange: (project: NetworkProject, message: string) => void; onUpdate: (device: NetworkDevice) => void }) {
  const dataPorts = device.ports.filter((port) => port.kind !== "console");
  const [activeApp, setActiveApp] = useState<"ip" | "prompt" | "browser">("prompt");
  const [selectedPortId, setSelectedPortId] = useState(dataPorts[0]?.id ?? "");
  const [output, setOutput] = useState("Command Prompt");
  const [input, setInput] = useState("");
  const [browserTarget, setBrowserTarget] = useState("www.lab.local");
  const [browserOutput, setBrowserOutput] = useState("Web Browser");
  const selectedPort = dataPorts.find((port) => port.id === selectedPortId) ?? dataPorts[0];

  useEffect(() => {
    if (!dataPorts.some((port) => port.id === selectedPortId)) setSelectedPortId(dataPorts[0]?.id ?? "");
  }, [device.id, dataPorts.length, selectedPortId]);

  function updateDesktopPort(portId: string, patch: Partial<NetworkPort>) {
    onUpdate({ ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) });
  }

  async function runDesktopCommand() {
    const command = input.trim();
    if (!command) return;
    const nextOutput = await desktopCommand(project, device, command, onProjectChange);
    setOutput((current) => `${current}\n\n> ${command}\n${nextOutput}`);
    setInput("");
  }

  async function runBrowser() {
    const target = browserTarget.trim();
    if (!target) return;
    const nextOutput = await desktopCommand(project, device, `http ${target}`, onProjectChange);
    setBrowserOutput(nextOutput);
  }

  return (
    <section className="desktop-panel">
      <div className="desktop-app-bar">
        <button className={activeApp === "ip" ? "active" : ""} onClick={() => setActiveApp("ip")} type="button"><Settings size={15} />IP Configuration</button>
        <button className={activeApp === "prompt" ? "active" : ""} onClick={() => setActiveApp("prompt")} type="button"><Terminal size={15} />Command Prompt</button>
        <button className={activeApp === "browser" ? "active" : ""} onClick={() => setActiveApp("browser")} type="button"><Monitor size={15} />Web Browser</button>
      </div>
      {activeApp === "ip" && (
        <div className="desktop-ip-config">
          <header>
            <strong>IP Configuration</strong>
            <select value={selectedPort?.id ?? ""} onChange={(event) => setSelectedPortId(event.target.value)}>
              {dataPorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}
            </select>
          </header>
          {selectedPort ? (
            <>
              <label>IPv4 Address<input value={selectedPort.ipAddress} onChange={(event) => updateDesktopPort(selectedPort.id, { ipAddress: event.target.value.trim() })} placeholder="192.168.1.10" /></label>
              <label>Subnet Mask<input value={selectedPort.subnetMask} onChange={(event) => updateDesktopPort(selectedPort.id, { subnetMask: event.target.value.trim() })} placeholder="255.255.255.0" /></label>
              <label>Default Gateway<input value={selectedPort.gateway} onChange={(event) => updateDesktopPort(selectedPort.id, { gateway: event.target.value.trim() })} placeholder="192.168.1.1" /></label>
              <label>DNS Server<input value={selectedPort.dnsServer} onChange={(event) => updateDesktopPort(selectedPort.id, { dnsServer: event.target.value.trim() })} placeholder="192.168.1.10" /></label>
              <button className="secondary-action" onClick={() => { const result = requestDhcp(project, device.id); onProjectChange(result.project, result.message); }} type="button">DHCP</button>
            </>
          ) : <p className="empty-state">No configurable network adapter.</p>}
        </div>
      )}
      {activeApp === "prompt" && (
        <section className="terminal desktop-terminal">
          <pre>{output}</pre>
          <form className="desktop-input-row" onSubmit={(event) => { event.preventDefault(); void runDesktopCommand(); }}>
            <span>{device.config.hostname || device.label}&gt;</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="ipconfig | ping 192.168.1.1 | nslookup www.lab.local | http www.lab.local" />
          </form>
          <small>{project.devices.length} devices in project | ipconfig, arp -a, route print, ping, tracert, nslookup, http</small>
        </section>
      )}
      {activeApp === "browser" && (
        <section className="desktop-browser">
          <form onSubmit={(event) => { event.preventDefault(); void runBrowser(); }}>
            <input value={browserTarget} onChange={(event) => setBrowserTarget(event.target.value)} placeholder="www.lab.local or 192.168.1.10" />
            <button className="secondary-action" type="submit">Go</button>
          </form>
          <pre>{browserOutput}</pre>
        </section>
      )}
    </section>
  );
}

async function desktopCommand(project: NetworkProject, device: NetworkDevice, command: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<string> {
  const lower = command.toLowerCase();
  if (lower === "ipconfig" || lower === "ipconfig /all") {
    return device.ports
      .filter((port) => port.kind !== "console")
      .map((port) => [
        `${port.name}:`,
        `  IPv4 Address . . . . . . . . . : ${port.ipAddress || "0.0.0.0"}`,
        `  Subnet Mask . . . . . . . . . . : ${port.subnetMask || "0.0.0.0"}`,
        `  Default Gateway . . . . . . . . : ${port.gateway || "0.0.0.0"}`,
        `  DNS Servers . . . . . . . . . . : ${port.dnsServer || "0.0.0.0"}`
      ].join("\n"))
      .join("\n");
  }
  if (lower === "ipconfig /renew") {
    const result = requestDhcp(project, device.id);
    onProjectChange(result.project, result.message);
    return result.message;
  }
  if (lower === "ipconfig /release") {
    const released = releaseDhcp(project, device.id);
    onProjectChange(released, "DHCP lease released.");
    return "DHCP lease released.";
  }
  if (lower === "arp -a") {
    return device.runtime.arpTable.map((entry) => `${entry.ipAddress.padEnd(16)}${entry.macAddress.padEnd(20)}${entry.portName}`).join("\n") || "No ARP entries.";
  }
  if (lower === "route print") {
    const routes = device.ports
      .filter((port) => port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask))
      .flatMap((port) => [
        `${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)} on-link dev ${port.name}`,
        `${port.ipAddress}/32 on-link dev ${port.name}`,
        ...(port.gateway ? [`0.0.0.0/0 via ${port.gateway} dev ${port.name}`] : [])
      ]);
    return routes.join("\n") || "No routes installed.";
  }
  if (lower.startsWith("ping ")) {
    const resolved = await resolveDesktopNetworkTarget(project, device, command.slice(5), onProjectChange);
    if (!resolved.target) return `Ping request could not find host ${command.slice(5).trim()}: ${resolved.error}`;
    const result = await simulatePing(resolved.project, device.id, resolved.target.id);
    onProjectChange(result.project, result.message);
    return result.success ? result.message : `Request timed out. ${result.message}`;
  }
  if (lower.startsWith("tracert ") || lower.startsWith("traceroute ")) {
    const targetText = command.split(/\s+/).slice(1).join(" ");
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return `Unable to resolve target ${targetText}: ${resolved.error}`;
    const before = resolved.project.simulationEvents.length;
    const result = await simulatePing(resolved.project, device.id, resolved.target.id);
    onProjectChange(result.project, result.message);
    const hops = result.project.simulationEvents
      .slice(before)
      .map((event) => result.project.devices.find((item) => item.id === event.atDeviceId)?.label ?? event.atDeviceId)
      .filter((label, index, list) => list.indexOf(label) === index);
    return [
      `Tracing route to ${resolved.target.label}`,
      ...hops.map((hop, index) => `${String(index + 1).padStart(2)}    <1 ms    ${hop}`),
      result.success ? "Trace complete." : `Trace failed: ${result.message}`
    ].join("\n");
  }
  if (lower.startsWith("nslookup ")) {
    const name = cleanHost(command.slice("nslookup ".length));
    const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
    if (!dnsServerIp) return "DNS request failed: no DNS server configured.";
    const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
    if (!server) return `DNS request failed: server ${dnsServerIp} was not found.`;
    const reachability = await simulatePing(project, device.id, server.id);
    if (!reachability.success) {
      const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `DNS query for ${name} timed out: ${reachability.message}`, "dropped");
      onProjectChange(nextProject, reachability.message);
      return `DNS request timed out for ${name}: ${reachability.message}`;
    }
    const record = server.config.dnsRecords.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!record) {
      const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `DNS query for ${name} returned NXDOMAIN.`, "dropped");
      onProjectChange(nextProject, "DNS record not found.");
      return `Server: ${server.label}\nName: ${name}\n*** No address record found.`;
    }
    onProjectChange(appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `Resolved ${record.name} to ${record.value}.`, "delivered"), `DNS resolved ${record.name}.`);
    return `Server: ${server.label}\nName: ${record.name}\nAddress: ${record.value}`;
  }
  if (lower.startsWith("http ")) {
    const resolved = await resolveDesktopNetworkTarget(project, device, command.slice(5), onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    if (!target.config.services.http) {
      const nextProject = appendDesktopEvent(resolvedProject, device.id, target.id, "HTTP", `${target.label} refused HTTP connection.`, "dropped");
      onProjectChange(nextProject, `${target.label} refused HTTP connection.`);
      return `${target.label} refused HTTP connection.`;
    }
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "HTTP", `HTTP request failed: ${result.message}`, "dropped"), result.message);
      return `HTTP request failed: ${result.message}`;
    }
    onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "HTTP", `GET ${target.label} returned 200 OK.`, "delivered"), "HTTP 200 OK.");
    return `HTTP/1.1 200 OK\nServer: ${target.label}\n\n${target.label} web service is running.`;
  }
  return "Unknown desktop command. Try ipconfig, arp -a, route print, ping <ip|name>, tracert <ip|name>, nslookup <name>, or http <ip|name>.";
}

function resolveDesktopTarget(project: NetworkProject, value: string): NetworkDevice | null {
  const host = cleanHost(value);
  const ip = isIpv4(host) ? host : resolveDns(project, host);
  if (ip) {
    const byIp = project.devices.find((device) => device.ports.some((port) => port.ipAddress === ip));
    if (byIp) return byIp;
  }
  return project.devices.find((device) => device.label.toLowerCase() === host.toLowerCase() || device.config.hostname.toLowerCase() === host.toLowerCase()) ?? null;
}

function releaseDhcp(project: NetworkProject, deviceId: string): NetworkProject {
  const time = Date.now();
  const packetId = createId("packet");
  return {
    ...project,
    devices: project.devices.map((device) => {
      if (device.id === deviceId) {
        return { ...device, ports: device.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" } : port) };
      }
      return { ...device, runtime: { ...device.runtime, dhcpLeases: device.runtime.dhcpLeases.filter((lease) => lease.deviceId !== deviceId) } };
    }),
    simulationEvents: [
      ...project.simulationEvents,
      { id: createId("evt"), time, lastDeviceId: deviceId, atDeviceId: deviceId, sourceDeviceId: deviceId, targetDeviceId: deviceId, packetId, type: "DHCP", info: "DHCPRELEASE sent by client.", status: "delivered", osiLayers: ["Layer 7", "Layer 3"] }
    ]
  };
}

function appendDesktopEvent(project: NetworkProject, sourceId: string, targetId: string, type: string, info: string, status: "forwarded" | "delivered" | "dropped"): NetworkProject {
  return {
    ...project,
    simulationEvents: [...project.simulationEvents, { id: createId("evt"), time: Date.now(), lastDeviceId: sourceId, atDeviceId: targetId, sourceDeviceId: sourceId, targetDeviceId: targetId, packetId: createId("packet"), type, info, status, osiLayers: ["Layer 7", "Layer 4", "Layer 3"] }]
  };
}

async function resolveDesktopNetworkTarget(project: NetworkProject, device: NetworkDevice, value: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<{ target: NetworkDevice | null; project: NetworkProject; error: string }> {
  const host = cleanHost(value);
  if (isIpv4(host)) {
    return { target: resolveDesktopTarget(project, host), project, error: `Could not resolve ${host}.` };
  }
  const direct = project.devices.find((item) => item.label.toLowerCase() === host.toLowerCase() || item.config.hostname.toLowerCase() === host.toLowerCase());
  if (direct) return { target: direct, project, error: "" };
  const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
  if (!dnsServerIp) return { target: null, project, error: `Could not resolve ${host}: no DNS server configured.` };
  const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
  if (!server) return { target: null, project, error: `Could not resolve ${host}: DNS server ${dnsServerIp} was not found.` };
  const dnsReachability = await simulatePing(project, device.id, server.id);
  onProjectChange(dnsReachability.project, dnsReachability.message);
  if (!dnsReachability.success) return { target: null, project: dnsReachability.project, error: `Could not resolve ${host}: DNS server unreachable (${dnsReachability.message}).` };
  const record = server.config.dnsRecords.find((item) => item.name.toLowerCase() === host.toLowerCase());
  if (!record) return { target: null, project: dnsReachability.project, error: `Could not resolve ${host}: no DNS record.` };
  return { target: resolveDesktopTarget(dnsReachability.project, record.value), project: dnsReachability.project, error: `DNS record ${record.value} does not match a device.` };
}

function resolveDns(project: NetworkProject, host: string): string {
  return project.devices.find((device) => device.config.services.dns)?.config.dnsRecords.find((record) => record.name.toLowerCase() === host.toLowerCase())?.value ?? "";
}

function cleanHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").split("/")[0].trim();
}

function ServicesTab({ device, onUpdate }: { device: NetworkDevice; onUpdate: (device: NetworkDevice) => void }) {
  type ServiceName = keyof NetworkDevice["config"]["services"];
  const [poolDraft, setPoolDraft] = useState({
    name: "LAN",
    network: "192.168.1.0",
    mask: "255.255.255.0",
    defaultGateway: "192.168.1.1",
    dnsServer: "192.168.1.10",
    startIp: "192.168.1.100",
    maxLeases: "50"
  });
  const [recordDraft, setRecordDraft] = useState({ name: "www.lab.local", value: "192.168.1.10" });
  const [servicePane, setServicePane] = useState<ServiceName>("dhcp");
  const serviceKeys = Object.keys(device.config.services) as ServiceName[];

  function toggleService(service: ServiceName, enabled: boolean) {
    onUpdate({ ...device, config: { ...device.config, services: { ...device.config.services, [service]: enabled } } });
  }

  function addPool() {
    if (!poolDraft.name || !poolDraft.network || !poolDraft.mask || !poolDraft.startIp) return;
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dhcpPools: [
          ...device.config.dhcpPools,
          {
            id: createId("pool"),
            name: poolDraft.name.trim(),
            network: poolDraft.network.trim(),
            mask: poolDraft.mask.trim(),
            defaultGateway: poolDraft.defaultGateway.trim(),
            dnsServer: poolDraft.dnsServer.trim(),
            startIp: poolDraft.startIp.trim(),
            maxLeases: boundedNumber(poolDraft.maxLeases, 1, 4096),
            enabled: true
          }
        ]
      }
    });
  }

  function updatePool(poolId: string, patch: Partial<NetworkDevice["config"]["dhcpPools"][number]>) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dhcpPools: device.config.dhcpPools.map((pool) => pool.id === poolId ? { ...pool, ...patch } : pool)
      }
    });
  }

  function addRecord() {
    if (!recordDraft.name || !recordDraft.value) return;
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dnsRecords: [...device.config.dnsRecords, { id: createId("dns"), name: recordDraft.name.trim(), value: recordDraft.value.trim() }]
      }
    });
  }

  function updateRecord(recordId: string, patch: Partial<NetworkDevice["config"]["dnsRecords"][number]>) {
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dnsRecords: device.config.dnsRecords.map((record) => record.id === recordId ? { ...record, ...patch } : record)
      }
    });
  }

  return (
    <section className="panel-section">
      <div className="services-workbench">
        <aside className="services-sidebar">
          {serviceKeys.map((service) => (
            <button className={servicePane === service ? "active" : ""} key={service} onClick={() => setServicePane(service)} type="button">
              <span>{service.toUpperCase()}</span>
              <small>{device.config.services[service] ? "On" : "Off"}</small>
            </button>
          ))}
        </aside>
        <div className="services-detail">
          {servicePane === "dhcp" && (
            <div className="config-group">
              <header><strong>DHCP</strong><label className="toggle"><input checked={device.config.services.dhcp} onChange={(event) => toggleService("dhcp", event.target.checked)} type="checkbox" />Service</label><button className="secondary-action" onClick={() => onUpdate({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } })} type="button">Clear bindings</button></header>
              <div className="service-draft-grid dhcp-draft">
                <label>Pool Name<input value={poolDraft.name} onChange={(event) => setPoolDraft({ ...poolDraft, name: event.target.value })} placeholder="LAN" /></label>
                <label>Network<input value={poolDraft.network} onChange={(event) => setPoolDraft({ ...poolDraft, network: event.target.value })} placeholder="192.168.1.0" /></label>
                <label>Subnet Mask<input value={poolDraft.mask} onChange={(event) => setPoolDraft({ ...poolDraft, mask: event.target.value })} placeholder="255.255.255.0" /></label>
                <label>Default Gateway<input value={poolDraft.defaultGateway} onChange={(event) => setPoolDraft({ ...poolDraft, defaultGateway: event.target.value })} placeholder="192.168.1.1" /></label>
                <label>DNS Server<input value={poolDraft.dnsServer} onChange={(event) => setPoolDraft({ ...poolDraft, dnsServer: event.target.value })} placeholder="192.168.1.10" /></label>
                <label>Start IP<input value={poolDraft.startIp} onChange={(event) => setPoolDraft({ ...poolDraft, startIp: event.target.value })} placeholder="192.168.1.100" /></label>
                <label>Maximum Users<input value={poolDraft.maxLeases} onChange={(event) => setPoolDraft({ ...poolDraft, maxLeases: event.target.value })} placeholder="50" type="number" /></label>
                <button className="secondary-action" onClick={addPool} type="button">Add pool</button>
              </div>
              {device.config.dhcpPools.map((pool) => (
                <div className="editable-service-row" key={pool.id}>
                  <label className="toggle"><input checked={pool.enabled} onChange={(event) => updatePool(pool.id, { enabled: event.target.checked })} type="checkbox" />Enabled</label>
                  <label>Name<input value={pool.name} onChange={(event) => updatePool(pool.id, { name: event.target.value.slice(0, 40) })} /></label>
                  <label>Network<input value={pool.network} onChange={(event) => updatePool(pool.id, { network: event.target.value.trim() })} /></label>
                  <label>Mask<input value={pool.mask} onChange={(event) => updatePool(pool.id, { mask: event.target.value.trim() })} /></label>
                  <label>Gateway<input value={pool.defaultGateway} onChange={(event) => updatePool(pool.id, { defaultGateway: event.target.value.trim() })} /></label>
                  <label>DNS<input value={pool.dnsServer} onChange={(event) => updatePool(pool.id, { dnsServer: event.target.value.trim() })} /></label>
                  <label>Start IP<input value={pool.startIp} onChange={(event) => updatePool(pool.id, { startIp: event.target.value.trim() })} /></label>
                  <label>Leases<input value={pool.maxLeases} min={1} onChange={(event) => updatePool(pool.id, { maxLeases: boundedNumber(event.target.value, 1, 4096) })} type="number" /></label>
                  <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.filter((item) => item.id !== pool.id) } })} type="button">Remove</button>
                </div>
              ))}
              {device.runtime.dhcpLeases.map((lease) => (
                <div className="compact-row" key={`${lease.deviceId}-${lease.ipAddress}`}>
                  <span>{lease.ipAddress} {lease.macAddress}</span>
                  <small>{new Date(lease.expiresAt).toLocaleString()}</small>
                </div>
              ))}
            </div>
          )}
          {servicePane === "dns" && (
            <div className="config-group">
              <header><strong>DNS</strong><label className="toggle"><input checked={device.config.services.dns} onChange={(event) => toggleService("dns", event.target.checked)} type="checkbox" />Service</label><small>{device.config.dnsRecords.length} records</small></header>
              <div className="service-draft-grid dns-draft">
                <label>Name<input value={recordDraft.name} onChange={(event) => setRecordDraft({ ...recordDraft, name: event.target.value })} placeholder="www.lab.local" /></label>
                <label>Address<input value={recordDraft.value} onChange={(event) => setRecordDraft({ ...recordDraft, value: event.target.value })} placeholder="192.168.1.10" /></label>
                <button className="secondary-action" onClick={addRecord} type="button">Add</button>
              </div>
              {device.config.dnsRecords.map((record) => (
                <div className="editable-record-row" key={record.id}>
                  <label>Name<input value={record.name} onChange={(event) => updateRecord(record.id, { name: event.target.value.trim() })} /></label>
                  <label>IPv4<input value={record.value} onChange={(event) => updateRecord(record.id, { value: event.target.value.trim() })} /></label>
                  <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.filter((item) => item.id !== record.id) } })} type="button">Remove</button>
                </div>
              ))}
            </div>
          )}
          {servicePane === "http" && (
            <div className="config-group">
              <header><strong>HTTP</strong><label className="toggle"><input checked={device.config.services.http} onChange={(event) => toggleService("http", event.target.checked)} type="checkbox" />Service</label></header>
              <div className="diagnostic-row info"><strong>{device.config.services.http ? "HTTP On" : "HTTP Off"}</strong><span>Web Browser and `http` desktop command use this service when the server is reachable.</span></div>
            </div>
          )}
          {(servicePane === "tftp" || servicePane === "syslog") && (
            <div className="config-group">
              <header><strong>{servicePane.toUpperCase()}</strong><label className="toggle"><input checked={device.config.services[servicePane]} onChange={(event) => toggleService(servicePane, event.target.checked)} type="checkbox" />Service</label></header>
              <div className="diagnostic-row info"><strong>{device.config.services[servicePane] ? "Service On" : "Service Off"}</strong><span>Service state is stored in the project and available to CLI/service checks.</span></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function EventPanel({
  project,
  message,
  mode = "simulation",
  focusedEventId,
  onClear,
  onFocusEvent,
  onRemoveLink,
  onRepair
}: {
  project: NetworkProject;
  message: string;
  mode?: "realtime" | "simulation";
  focusedEventId?: string;
  onClear: () => void;
  onFocusEvent?: (eventId: string) => void;
  onRemoveLink?: (linkId: string) => void;
  onRepair?: () => void;
}) {
  const issues = diagnoseProject(project);
  const [eventFilter, setEventFilter] = useState("all");
  const filteredEvents = project.simulationEvents.filter((event) => eventFilter === "all" || event.type.toLowerCase() === eventFilter || event.status === eventFilter);
  const userPackets = userCreatedPacketRows(project);
  const activeEventId = focusedEventId ?? "";
  const focusedIndex = filteredEvents.findIndex((event) => event.id === activeEventId);
  const selectedEvent = filteredEvents.find((event) => event.id === activeEventId) ?? filteredEvents.at(-1);
  const eventStats = {
    total: project.simulationEvents.length,
    forwarded: project.simulationEvents.filter((event) => event.status === "forwarded").length,
    delivered: project.simulationEvents.filter((event) => event.status === "delivered").length,
    dropped: project.simulationEvents.filter((event) => event.status === "dropped").length
  };
  const linkStats = {
    total: project.links.length,
    up: project.links.filter((link) => link.status === "up").length,
    down: project.links.filter((link) => link.status === "down").length,
    blocked: project.links.filter((link) => link.status === "blocked").length
  };
  function focusRelative(delta: number) {
    if (!onFocusEvent) return;
    if (filteredEvents.length === 0) return;
    const start = focusedIndex >= 0 ? focusedIndex : filteredEvents.length - 1;
    const nextIndex = Math.max(0, Math.min(filteredEvents.length - 1, start + delta));
    onFocusEvent(filteredEvents[nextIndex].id);
  }
  function captureForward() {
    if (!onFocusEvent || filteredEvents.length === 0) return;
    const nextIndex = focusedIndex >= 0 ? Math.min(filteredEvents.length - 1, focusedIndex + 1) : 0;
    onFocusEvent(filteredEvents[nextIndex].id);
  }
  function autoCapturePlay() {
    if (!onFocusEvent || filteredEvents.length === 0) return;
    onFocusEvent(filteredEvents[filteredEvents.length - 1].id);
  }
  return (
    <section className={`event-panel ${mode}`}>
      {mode === "simulation" ? (
        <>
          <header><strong>Simulation Events</strong><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">all</option><option value="icmp">ICMP</option><option value="arp">ARP</option><option value="switch">SWITCH</option><option value="hub">HUB</option><option value="dhcp">DHCP</option><option value="dns">DNS</option><option value="http">HTTP</option><option value="delivered">delivered</option><option value="forwarded">forwarded</option><option value="dropped">dropped</option></select><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex <= 0} onClick={() => focusRelative(-1)} type="button">Back</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex === filteredEvents.length - 1} onClick={captureForward} type="button">Capture/Forward</button><button disabled={!onFocusEvent || filteredEvents.length === 0} onClick={autoCapturePlay} type="button">Auto Capture/Play</button><button onClick={onClear} type="button">Clear</button></header>
          <div className="sim-status-strip">
            <span><strong>{eventStats.total}</strong> events</span>
            <span className="forwarded"><strong>{eventStats.forwarded}</strong> forwarded</span>
            <span className="delivered"><strong>{eventStats.delivered}</strong> delivered</span>
            <span className="dropped"><strong>{eventStats.dropped}</strong> dropped</span>
            <span><strong>{filteredEvents.length}</strong> shown</span>
          </div>
          <div className="simulation-layout">
            <div className="simulation-main">
              {message && <p>{message}</p>}
              <div className="event-table">
                <div className="event-table-head"><span>Time</span><span>Last Device</span><span>At Device</span><span>Type</span><span>Info</span><span>Status</span></div>
                {filteredEvents.slice(-12).reverse().map((event) => (
                  <div className={`event-row ${event.status} ${activeEventId === event.id ? "selected" : ""}`} key={event.id} onClick={() => onFocusEvent?.(event.id)} role="button" tabIndex={0}>
                    <span>{new Date(event.time).toLocaleTimeString()}</span>
                    <span>{eventDeviceLabel(project, event.lastDeviceId)}</span>
                    <span>{eventDeviceLabel(project, event.atDeviceId)}</span>
                    <span>{event.type}</span>
                    <span>{event.info}</span>
                    <small>{event.status}</small>
                  </div>
                ))}
                {filteredEvents.length === 0 && <p className="event-empty-state">No simulation events.</p>}
              </div>
            </div>
            <aside className="simulation-side">
              <div className="user-packet-window">
                <header><strong>User Created Packets</strong><small>{userPackets.length} recent</small></header>
                <div className="user-packet-head"><span>Protocol</span><span>Source</span><span>Destination</span><span>Status</span></div>
                {userPackets.map((packet) => (
                  <button className={`${packet.status} ${activeEventId === packet.id ? "selected" : ""}`} key={packet.id} onClick={() => onFocusEvent?.(packet.id)} type="button">
                    <span>{packet.protocol}</span>
                    <span>{packet.source}</span>
                    <span>{packet.destination}</span>
                    <small>{packet.status}</small>
                  </button>
                ))}
                {userPackets.length === 0 && <p className="event-empty-state">No user-created packets yet.</p>}
              </div>
              {selectedEvent && (
                <div className={`pdu-info-panel ${selectedEvent.status}`}>
                  <header><strong>PDU Information</strong><small>{selectedEvent.type} / {selectedEvent.status}</small></header>
                  <p>{selectedEvent.info}</p>
                  <div>{(selectedEvent.osiLayers?.length ? selectedEvent.osiLayers : ["Layer 2", "Layer 3"]).map((layer) => <span key={layer}>{layer}</span>)}</div>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        <>
          <header><strong>Realtime Status</strong><small>{project.links.filter((link) => link.status === "up").length} up / {project.links.length} links</small></header>
          <div className="sim-status-strip">
            <span><strong>{project.devices.length}</strong> devices</span>
            <span><strong>{linkStats.total}</strong> cables</span>
            <span className="delivered"><strong>{linkStats.up}</strong> up</span>
            <span className="dropped"><strong>{linkStats.down}</strong> down</span>
            <span className="forwarded"><strong>{linkStats.blocked}</strong> blocked</span>
          </div>
          {message && <p>{message}</p>}
        </>
      )}
      <header><strong>Network Diagnostics</strong><small>{issues.length} issues</small>{onRepair && issues.length > 0 && <button className="secondary-action" onClick={onRepair} type="button">Repair</button>}</header>
      {issues.length === 0 ? <p className="empty-state">No project-level problems detected.</p> : issues.slice(0, 10).map((item) => (
        <div className={`diagnostic-row ${item.severity}`} key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.detail}</span>
        </div>
      ))}
      {onRemoveLink && project.links.length > 0 && (
        <>
          <header><strong>Cables</strong><small>{project.links.length} links</small></header>
          {project.links.map((link) => (
            <div className={`event-row cable-row ${link.status}`} key={link.id}>
              <span className="cable-row-kind"><i className={`cable-swatch ${link.type}`} />{shortCableLabel(link.type)}</span>
              <span>{linkLabel(project, link)}</span>
              <small title={linkStatusDetail(project, link)}>{link.status}: {linkStatusDetail(project, link)}</small>
              <button className="secondary-action" onClick={() => onRemoveLink(link.id)} type="button">Remove</button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function PduMarker({ project, sourceId, targetId, status, type }: { project: NetworkProject; sourceId: string; targetId: string; status: SimulationEvent["status"]; type: string }) {
  const source = project.devices.find((device) => device.id === sourceId);
  const target = project.devices.find((device) => device.id === targetId);
  if (!source || !target) return null;
  const start = nodeCenter(source);
  const end = nodeCenter(target);
  const startX = start.x;
  const startY = start.y;
  const endX = end.x;
  const endY = end.y;
  return (
    <div
      className={`pdu-marker ${status}`}
      style={{
        left: startX,
        top: startY,
        "--pdu-mid-x": `${(endX - startX) / 2}px`,
        "--pdu-mid-y": `${(endY - startY) / 2}px`,
        "--pdu-dx": `${endX - startX}px`,
        "--pdu-dy": `${endY - startY}px`
      } as CSSProperties}
      title={`${type} ${status}`}
    >
      <Mail size={17} />
    </div>
  );
}

function userCreatedPacketRows(project: NetworkProject): Array<{ id: string; protocol: string; source: string; destination: string; status: SimulationEvent["status"] }> {
  const protocols = new Set(["ICMP", "DHCP", "DNS", "HTTP"]);
  const seenPackets = new Set<string>();
  return project.simulationEvents
    .filter((event) => protocols.has(event.type.toUpperCase()))
    .reverse()
    .filter((event) => {
      const key = event.packetId ?? event.id;
      if (seenPackets.has(key)) return false;
      seenPackets.add(key);
      return true;
    })
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      protocol: event.type.toUpperCase(),
      source: eventDeviceLabel(project, event.sourceDeviceId ?? event.lastDeviceId),
      destination: eventDeviceLabel(project, event.targetDeviceId ?? event.atDeviceId),
      status: event.status
    }));
}

function eventDeviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
}
