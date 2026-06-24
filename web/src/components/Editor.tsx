import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Cable, CircleDot, CircleHelp, Copy, Cpu, Download, Edit3, FileJson, Info, Mail, Maximize2, Minimize2, Minus, Monitor, MousePointer2, Network, PenLine, Plus, Power, Router, RotateCcw, Save, Search, Server, Settings, Shield, Square, Terminal, Trash2, Wifi, Wrench, X, ZoomIn, ZoomOut } from "lucide-react";
import { cableCatalog, canPortUseCable, createDevice, deviceCatalog, displayKind, getDeviceModel, getModuleSpec, installModule, removeModule } from "../data/deviceCatalog";
import { bootBanner, bootDevice, initialCliSession, initialConsoleSession, runCliCommand, type CliSession } from "../engine/cli";
import { cliEngine } from "../engine/cliEngine";
import { desktopConsoleTargets } from "../engine/desktopTerminal";
import { diagnoseProject, type NetworkIssueSeverity } from "../engine/diagnostics";
import { ipInSubnet, ipToNumber, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "../engine/ip";
import { downloadProject } from "../exporters/packetTracerExport";
import { requestDhcp } from "../engine/simulation";
import { addLink, linkLabel, recalc, removeLink, validateConnection } from "../engine/topology";
import { createId } from "../utils/id";
import { engineLabel, simulatePing } from "../wasm/engine";
import type { AccessRule, ActivityRequirementKind, CableType, DeviceKind, DeviceTab, ModuleSpec, NatRule, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, SimulationEvent, User, WorkspaceDrawing, WorkspaceDrawingKind, WorkspaceNote } from "../types/network";

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1600;
const packetMenuLabels = ["파일", "편집", "옵션", "보기", "도구", "확장", "창", "도움말"] as const;
const quickWorkspaceModelIds = ["router-1941", "switch-2960", "pc-pt", "server-pt", "ap-pt"] as const;
const complexPduProtocols = [
  { value: "icmp", label: "ICMP Echo" },
  { value: "dns", label: "DNS Query" },
  { value: "http", label: "HTTP GET" },
  { value: "ftp", label: "FTP LIST" },
  { value: "email", label: "EMAIL" },
  { value: "tftp", label: "TFTP Read" },
  { value: "syslog", label: "SYSLOG" }
] as const;
const activityRequirementCatalog: Array<{ kind: ActivityRequirementKind; label: string; detail: string; defaultTarget: number; defaultPoints: number }> = [
  { kind: "device-count", label: "장비 수", detail: "배치된 전체 장비 수", defaultTarget: 4, defaultPoints: 10 },
  { kind: "link-count", label: "링크 수", detail: "생성된 전체 케이블/무선 링크 수", defaultTarget: 3, defaultPoints: 10 },
  { kind: "annotation-count", label: "주석 수", detail: "메모와 도형 주석 수", defaultTarget: 2, defaultPoints: 5 },
  { kind: "delivered-pdu-count", label: "전달 PDU 수", detail: "delivered 상태의 PDU 이벤트 수", defaultTarget: 1, defaultPoints: 10 },
  { kind: "saved-config-count", label: "저장된 설정 수", detail: "startup-config가 있는 네트워크 장비 수", defaultTarget: 1, defaultPoints: 5 },
  { kind: "service-count", label: "서비스 장비 수", detail: "하나 이상 서비스가 켜진 장비 수", defaultTarget: 1, defaultPoints: 5 },
  { kind: "tdr-normal-count", label: "정상 TDR 링크", detail: "양 끝점이 정상으로 진단되는 구리 링크 수", defaultTarget: 1, defaultPoints: 5 }
];

type ComplexPduProtocol = typeof complexPduProtocols[number]["value"];
type PacketMenuName = typeof packetMenuLabels[number];
type PacketMenuItem = { label: string; action: () => void; disabled?: boolean; danger?: boolean };
type WorkspaceMenuState = { x: number; y: number; canvasX: number; canvasY: number };
type CanvasViewport = { x: number; y: number; width: number; height: number };
type SaveStatus = "saved" | "pending" | "saving" | "error";
type WorkspaceSearchResult = { id: string; kind: "device" | "link" | "note" | "drawing"; label: string; detail: string; point: { x: number; y: number } };
type DrawingResizeHandle = "nw" | "ne" | "se" | "sw";
type DrawingResizeDrag = {
  id: string;
  kind: WorkspaceDrawingKind;
  handle: DrawingResizeHandle;
  startX: number;
  startY: number;
  startPosition: { x: number; y: number };
  startWidth: number;
  startHeight: number;
  moved: boolean;
};

function activateRowOnKeyboard(event: ReactKeyboardEvent<Element>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function keyboardNudgeDelta(key: string, step: number): { x: number; y: number } | null {
  if (key === "ArrowLeft") return { x: -step, y: 0 };
  if (key === "ArrowRight") return { x: step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -step };
  if (key === "ArrowDown") return { x: 0, y: step };
  return null;
}

export function Editor({ project, user, saveError, saveStatus, lastSavedAt, onBack, onChange, onSave }: { project: NetworkProject; user: User; saveError: string; saveStatus: SaveStatus; lastSavedAt: string; onBack: () => void; onChange: (project: NetworkProject) => void; onSave: (project: NetworkProject) => void }) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const noteDragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const drawingDragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const drawingResizeRef = useRef<DrawingResizeDrag | null>(null);
  const freehandDraftRef = useRef<{ pointerId: number; points: Array<{ x: number; y: number }> } | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const suppressWorkspaceClickRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedCable, setSelectedCable] = useState<CableType | "">("");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedLinkId, setSelectedLinkId] = useState<string>("");
  const [selectedNoteId, setSelectedNoteId] = useState<string>("");
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>("");
  const [deviceWindowId, setDeviceWindowId] = useState<string>("");
  const [deviceWindowTab, setDeviceWindowTab] = useState<DeviceTab | undefined>();
  const [pendingDeviceId, setPendingDeviceId] = useState<string>("");
  const [connectionDraft, setConnectionDraft] = useState<{ aDeviceId: string; bDeviceId: string; cable: CableType; message: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ deviceId: string; x: number; y: number } | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ linkId: string; x: number; y: number } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [topMenu, setTopMenu] = useState<{ name: PacketMenuName; x: number; y: number } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ deviceId: string; value: string } | null>(null);
  const [message, setMessage] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [isPanning, setIsPanning] = useState(false);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [workspaceMode, setWorkspaceMode] = useState<"logical" | "physical">("logical");
  const [timeMode, setTimeMode] = useState<"realtime" | "simulation">("realtime");
  const [trayCollapsed, setTrayCollapsed] = useState(false);
  const [pduMode, setPduMode] = useState(false);
  const [pduSourceId, setPduSourceId] = useState("");
  const [complexPduMode, setComplexPduMode] = useState(false);
  const [complexPduSourceId, setComplexPduSourceId] = useState("");
  const [complexPduProtocol, setComplexPduProtocol] = useState<ComplexPduProtocol>("icmp");
  const [complexPduCount, setComplexPduCount] = useState(1);
  const [complexPduTtl, setComplexPduTtl] = useState(128);
  const [complexPduIntervalMs, setComplexPduIntervalMs] = useState(0);
  const [noteMode, setNoteMode] = useState(false);
  const [drawingMode, setDrawingMode] = useState<WorkspaceDrawingKind | "">("");
  const [freehandPreview, setFreehandPreview] = useState<Array<{ x: number; y: number }>>([]);
  const [engineName, setEngineName] = useState("엔진 로딩 중");
  const [focusedEventId, setFocusedEventId] = useState("");
  const [activityWindowOpen, setActivityWindowOpen] = useState(false);
  const deviceWindow = project.devices.find((device) => device.id === deviceWindowId) ?? null;
  const selectedDevice = project.devices.find((device) => device.id === selectedDeviceId) ?? null;
  const selectedLink = project.links.find((link) => link.id === selectedLinkId) ?? null;
  const selectedDrawing = (project.drawings ?? []).find((drawing) => drawing.id === selectedDrawingId) ?? null;
  const pduSource = project.devices.find((device) => device.id === pduSourceId) ?? null;
  const complexPduSource = project.devices.find((device) => device.id === complexPduSourceId) ?? null;
  const selectedModelInfo = useMemo(() => selectedModel ? deviceCatalog.find((model) => model.id === selectedModel) ?? null : null, [selectedModel]);
  const focusedEvent = useMemo(() => project.simulationEvents.find((event) => event.id === focusedEventId) ?? null, [focusedEventId, project.simulationEvents]);
  const workspaceSearchResults = useMemo(() => workspaceSearchResultsFor(project, workspaceSearch), [project, workspaceSearch]);
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
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, [zoom]);

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
    if (selectedNoteId && !(project.notes ?? []).some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId("");
    }
    if (selectedDrawingId && !(project.drawings ?? []).some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId("");
    }
    if (pduSourceId && !project.devices.some((device) => device.id === pduSourceId)) {
      setPduSourceId("");
      setPduMode(false);
    }
    if (complexPduSourceId && !project.devices.some((device) => device.id === complexPduSourceId)) {
      setComplexPduSourceId("");
      setComplexPduMode(false);
    }
  }, [deviceWindowId, selectedDeviceId, selectedLinkId, selectedNoteId, selectedDrawingId, pduSourceId, complexPduSourceId, project.devices, project.links, project.notes, project.drawings]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave(project);
        setMessage("프로젝트 저장을 요청했습니다.");
        return;
      }
      if (target?.tagName === "INPUT" || target?.tagName === "SELECT" || target?.tagName === "TEXTAREA") return;
      if (event.key === "Escape") {
        setSelectedModel("");
        setSelectedCable("");
        setPendingDeviceId("");
        setConnectionDraft(null);
        setPduMode(false);
        setPduSourceId("");
        setComplexPduMode(false);
        setComplexPduSourceId("");
        setNoteMode(false);
        setDrawingMode("");
        setSelectedDeviceId("");
        setSelectedLinkId("");
        setSelectedNoteId("");
        setSelectedDrawingId("");
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setActivityWindowOpen(false);
        setContextMenu(null);
        setLinkMenu(null);
        setWorkspaceMenu(null);
        setTopMenu(null);
        setMessage("선택을 해제했습니다.");
      }
      const nudgeDelta = keyboardNudgeDelta(event.key, event.shiftKey ? 10 : 1);
      if (nudgeDelta && nudgeSelected(nudgeDelta.x, nudgeDelta.y)) {
        event.preventDefault();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (pduMode) {
          event.preventDefault();
          setMessage("삭제하기 전에 Escape 또는 선택 도구로 Simple PDU를 취소하세요.");
          return;
        }
        if (complexPduMode) {
          event.preventDefault();
          setMessage("삭제하기 전에 Escape 또는 선택 도구로 Complex PDU를 취소하세요.");
          return;
        }
        if (selectedNoteId) {
          event.preventDefault();
          deleteWorkspaceNote(selectedNoteId);
        } else if (selectedDrawingId) {
          event.preventDefault();
          deleteWorkspaceDrawing(selectedDrawingId);
        } else if (selectedDeviceId) {
          event.preventDefault();
          deleteDevice(selectedDeviceId);
        } else if (selectedLinkId) {
          event.preventDefault();
          onChange(removeLink(project, selectedLinkId));
          setSelectedLinkId("");
          setLinkMenu(null);
          setMessage("케이블을 삭제했습니다.");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDeviceId, selectedLinkId, selectedNoteId, selectedDrawingId, pduMode, complexPduMode, selectedModel, selectedCable, noteMode, drawingMode, deviceWindowId, activityWindowOpen, connectionDraft, project, onSave, onChange]);

  function placeDevice(modelId: string, position?: { x: number; y: number }) {
    const next = createDevice(modelId, position ?? { x: 160 + project.devices.length * 28, y: 140 + project.devices.length * 22 }, project.devices);
    onChange({ ...project, devices: [...project.devices, next] });
    setSelectedDeviceId(next.id);
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setSelectedModel("");
    setMessage(`${next.label} 장비를 배치했습니다.`);
  }

  function clickWorkspace(event: React.MouseEvent<HTMLElement>) {
    if (suppressWorkspaceClickRef.current) {
      suppressWorkspaceClickRef.current = false;
      return;
    }
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu(null);
    if (selectedModel) {
      const point = canvasPoint(event);
      placeDevice(selectedModel, placementPosition(selectedModel, point));
      return;
    }
    if (noteMode) {
      addWorkspaceNote(canvasPoint(event));
      return;
    }
    if (drawingMode) {
      if (drawingMode === "freehand") {
        setMessage("자유선은 작업공간에서 드래그해서 그립니다.");
        return;
      }
      addWorkspaceDrawing(drawingMode, canvasPoint(event));
      return;
    }
    if (pendingDeviceId) {
      setPendingDeviceId("");
      setMessage("연결을 취소했습니다.");
      return;
    }
    if (pduMode) {
      setMessage(pduSourceId ? "Simple PDU 목적지 장비를 선택하세요." : "Simple PDU 출발지 장비를 선택하세요.");
      return;
    }
    if (complexPduMode) {
      setMessage(complexPduSourceId ? "Complex PDU 목적지 장비를 선택하세요." : "Complex PDU 출발지 장비를 선택하세요.");
      return;
    }
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
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
    setSelectedNoteId("");
    setSelectedDrawingId("");
    if (pduMode) {
      if (!pduSourceId) {
        setPduSourceId(device.id);
        setSelectedDeviceId(device.id);
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setMessage(`Simple PDU 출발지: ${device.label}. 목적지 장비를 선택하세요.`);
        return;
      }
      if (pduSourceId === device.id) {
        setMessage("Simple PDU 목적지는 다른 장비여야 합니다.");
        return;
      }
      await sendPdu(pduSourceId, device.id);
      setPduSourceId("");
      setPduMode(false);
      return;
    }
    if (complexPduMode) {
      if (!complexPduSourceId) {
        setComplexPduSourceId(device.id);
        setSelectedDeviceId(device.id);
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setMessage(`Complex PDU 출발지: ${device.label}. 프로토콜을 확인하고 목적지 장비를 선택하세요.`);
        return;
      }
      if (complexPduSourceId === device.id) {
        setMessage("Complex PDU 목적지는 다른 장비여야 합니다.");
        return;
      }
      await sendComplexPdu(complexPduSourceId, device.id);
      setComplexPduSourceId("");
      setComplexPduMode(false);
      return;
    }
    if (selectedCable) {
      if (!pendingDeviceId) {
        setPendingDeviceId(device.id);
        setMessage(`첫 번째 끝점: ${device.label}`);
        return;
      }
      if (pendingDeviceId === device.id) {
        setMessage("케이블은 같은 장비끼리 연결할 수 없습니다.");
        setPendingDeviceId("");
        return;
      }
      const result = validateConnection(project, pendingDeviceId, device.id, selectedCable);
      if (!result.ok || !result.link) {
        setMessage(result.message);
        setConnectionDraft({ aDeviceId: pendingDeviceId, bDeviceId: device.id, cable: selectedCable, message: result.message });
      } else {
        setMessage("연결할 인터페이스를 선택하세요.");
        setConnectionDraft({ aDeviceId: pendingDeviceId, bDeviceId: device.id, cable: selectedCable, message: "연결할 인터페이스를 선택하세요." });
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
    setSelectedNoteId("");
    setSelectedDrawingId("");
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

  async function sendComplexPdu(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const source = project.devices.find((device) => device.id === sourceId);
    const target = project.devices.find((device) => device.id === targetId);
    if (!source || !target) {
      setMessage("Complex PDU 출발지 또는 목적지 장비를 찾을 수 없습니다.");
      return;
    }

    const previousEventCount = project.simulationEvents.length;
    const protocolLabel = complexPduProtocolLabel(complexPduProtocol);
    const repeatCount = Math.max(1, Math.min(10, complexPduCount));
    const ttl = Math.max(1, Math.min(255, complexPduTtl));
    const intervalMs = Math.max(0, Math.min(2000, complexPduIntervalMs));
    if (complexPduProtocol === "icmp") {
      let nextProject = project;
      let success = 0;
      let dropped = 0;
      let lastMessage = "";
      for (let index = 0; index < repeatCount; index += 1) {
        const eventStart = nextProject.simulationEvents.length;
        const result = await simulatePing(nextProject, sourceId, targetId);
        nextProject = annotateComplexPduEvents(result.project, eventStart, ttl, intervalMs, index, repeatCount);
        lastMessage = result.message;
        if (result.success) success += 1;
        else dropped += 1;
        if (intervalMs > 0 && index < repeatCount - 1) await waitForInterval(intervalMs);
      }
      onChange(nextProject);
      setMessage(`Complex PDU ${protocolLabel} ${repeatCount}회 완료: 성공 ${success}개, 실패 ${dropped}개. TTL ${ttl}, 간격 ${intervalMs}ms. ${lastMessage}`);
      setTimeMode("simulation");
      setFocusedEventId(nextProject.simulationEvents[previousEventCount]?.id ?? nextProject.simulationEvents.at(-1)?.id ?? "");
      return;
    }

    let nextProject = project;
    let delivered = 0;
    let dropped = 0;
    let lastInfo = "";
    const complexPacketId = createId("packet");
    for (let index = 0; index < repeatCount; index += 1) {
      const eventStart = nextProject.simulationEvents.length;
      const reachability = await simulatePing(nextProject, sourceId, targetId);
      nextProject = annotateComplexPduEvents(reachability.project, eventStart, ttl, intervalMs, index, repeatCount);
      let status: SimulationEvent["status"] = "delivered";
      let info = "";
      if (!reachability.success) {
        status = "dropped";
        info = `${protocolLabel} PDU가 ${target.label}에 도달하지 못했습니다: ${reachability.message}`;
      } else if (!complexPduServiceEnabled(target, complexPduProtocol)) {
        status = "dropped";
        info = `${target.label}의 ${protocolLabel} 서비스가 꺼져 있습니다.`;
      } else {
        info = `${source.label}에서 ${target.label}(으)로 ${protocolLabel} PDU를 전달했습니다.`;
      }
      if (repeatCount > 1) info = `[${index + 1}/${repeatCount}] ${info}`;
      info = `${info}${complexPduOptionSuffix(ttl, intervalMs)}`;
      lastInfo = info;
      nextProject = appendDesktopEvent(nextProject, sourceId, targetId, complexPduProtocol.toUpperCase(), info, status, complexPacketId);
      if (complexPduProtocol === "syslog" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `${source.label}: Complex PDU syslog test ${index + 1}/${repeatCount} TTL ${ttl}`);
      }
      if (complexPduProtocol === "email" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `EMAIL Complex PDU from ${source.label} repeat ${index + 1}/${repeatCount} TTL ${ttl}`);
      }
      if (complexPduProtocol === "ftp" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `FTP Complex PDU from ${source.label} repeat ${index + 1}/${repeatCount} TTL ${ttl}`);
      }
      if (complexPduProtocol === "http" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `HTTP Complex PDU GET from ${source.label} repeat ${index + 1}/${repeatCount} TTL ${ttl}`);
      }
      if (complexPduProtocol === "tftp" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `TFTP Complex PDU read from ${source.label} repeat ${index + 1}/${repeatCount} TTL ${ttl}`);
      }
      if (status === "delivered") delivered += 1;
      else dropped += 1;
      if (intervalMs > 0 && index < repeatCount - 1) await waitForInterval(intervalMs);
    }
    onChange(nextProject);
    setTimeMode("simulation");
    setFocusedEventId(nextProject.simulationEvents.at(-1)?.id ?? nextProject.simulationEvents[previousEventCount]?.id ?? "");
    setMessage(`Complex PDU ${protocolLabel} ${repeatCount}회 완료: 전달 ${delivered}개, 드롭 ${dropped}개. ${lastInfo}`);
  }

  async function pingFromSelectedToAll() {
    const source = project.devices.find((device) => device.id === selectedDeviceId);
    if (!source) {
      setMessage("먼저 출발지 장비를 선택하세요.");
      return;
    }
    const targets = project.devices.filter((device) => device.id !== source.id && device.powerOn);
    if (!targets.length) {
      setMessage("검증할 전원 켜진 대상 장비가 없습니다.");
      return;
    }
    let nextProject = project;
    let success = 0;
    let failed = 0;
    const firstEventIndex = project.simulationEvents.length;
    for (const target of targets) {
      const result = await simulatePing(nextProject, source.id, target.id);
      nextProject = result.project;
      if (result.success) success += 1;
      else failed += 1;
    }
    onChange(nextProject);
    setTimeMode("simulation");
    setFocusedEventId(nextProject.simulationEvents[firstEventIndex]?.id ?? nextProject.simulationEvents.at(-1)?.id ?? "");
    setMessage(`${source.label}에서 전체 Ping 검증 완료: 성공 ${success}개, 실패 ${failed}개.`);
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

  function duplicateDevice(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    const size = nodeSize(device.kind);
    const position = {
      x: Math.max(16, Math.min(CANVAS_WIDTH - size.width - 16, device.position.x + 44)),
      y: Math.max(16, Math.min(CANVAS_HEIGHT - size.height - 16, device.position.y + 44))
    };
    const next = cloneDeviceForDuplicate(device, position, project.devices);
    onChange(recalc({ ...project, devices: [...project.devices, next] }));
    setSelectedDeviceId(next.id);
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setMessage(`${device.label} 장비를 ${next.label}(으)로 설정 포함 복제했습니다.`);
  }

  function startPduFromDevice(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setSelectedDeviceId(deviceId);
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setPduMode(true);
    setPduSourceId(deviceId);
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setMessage(`Simple PDU 출발지: ${device.label}. 목적지 장비를 선택하세요.`);
  }

  function startComplexPduFromDevice(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setSelectedDeviceId(deviceId);
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setComplexPduMode(true);
    setComplexPduSourceId(deviceId);
    setPduMode(false);
    setPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setMessage(`Complex PDU 출발지: ${device.label}. 프로토콜과 횟수를 확인하고 목적지 장비를 선택하세요.`);
  }

  function startCableFromDevice(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    setSelectedModel("");
    setSelectedCable("auto");
    setPendingDeviceId(deviceId);
    setConnectionDraft(null);
    setSelectedDeviceId(deviceId);
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setMessage(`${device.label}에서 자동 케이블 연결을 시작했습니다. 연결할 장비를 선택하세요.`);
  }

  function startNoteTool() {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setNoteMode(true);
    setDrawingMode("");
    closeFloatingMenus();
    setMessage("메모를 놓을 위치를 선택하세요.");
  }

  function addWorkspaceNote(point: { x: number; y: number }) {
    const text = promptWorkspaceNote("새 메모");
    if (!text) {
      setNoteMode(false);
      setMessage("메모 추가를 취소했습니다.");
      return;
    }
    const note: WorkspaceNote = {
      id: createId("note"),
      text,
      position: notePlacementPosition(point),
      color: "yellow"
    };
    onChange({ ...project, notes: [...(project.notes ?? []), note] });
    setSelectedNoteId(note.id);
    setSelectedDrawingId("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setNoteMode(false);
    setMessage("작업공간 메모를 추가했습니다.");
  }

  function addWorkspaceNoteFromMenu(point: { x: number; y: number }) {
    addWorkspaceNote(point);
    setWorkspaceMenu(null);
  }

  function editWorkspaceNote(noteId: string) {
    const note = (project.notes ?? []).find((item) => item.id === noteId);
    if (!note) return;
    const text = promptWorkspaceNote("메모 수정", note.text);
    if (text === null) return;
    if (!text) {
      deleteWorkspaceNote(noteId);
      return;
    }
    onChange({ ...project, notes: (project.notes ?? []).map((item) => item.id === noteId ? { ...item, text } : item) });
    setSelectedNoteId(noteId);
    setMessage("메모를 수정했습니다.");
  }

  function cycleWorkspaceNoteColor(noteId: string) {
    onChange({
      ...project,
      notes: (project.notes ?? []).map((note) => note.id === noteId ? { ...note, color: nextWorkspaceNoteColor(note.color) } : note)
    });
    setSelectedNoteId(noteId);
    setMessage("메모 색상을 변경했습니다.");
  }

  function deleteWorkspaceNote(noteId: string) {
    const note = (project.notes ?? []).find((item) => item.id === noteId);
    onChange({ ...project, notes: (project.notes ?? []).filter((item) => item.id !== noteId) });
    if (selectedNoteId === noteId) setSelectedNoteId("");
    setMessage(note ? "메모를 삭제했습니다." : "삭제할 메모가 없습니다.");
  }

  function startDrawingTool(kind: WorkspaceDrawingKind) {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode(kind);
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setFreehandPreview([]);
    closeFloatingMenus();
    setMessage(kind === "freehand" ? "자유선을 그릴 작업공간에서 드래그하세요." : `${workspaceDrawingKindLabel(kind)} 도형을 놓을 위치를 선택하세요.`);
  }

  function addWorkspaceDrawing(kind: WorkspaceDrawingKind, point: { x: number; y: number }) {
    const label = promptWorkspaceDrawingLabel(kind);
    if (label === null) {
      setDrawingMode("");
      setMessage("도형 추가를 취소했습니다.");
      return;
    }
    const placement = drawingPlacement(kind, point);
    const drawing: WorkspaceDrawing = {
      id: createId("draw"),
      kind,
      label,
      ...placement,
      points: kind === "freehand" ? defaultFreehandPoints(placement.width, placement.height) : undefined,
      color: kind === "line" || kind === "freehand" ? "blue" : "amber",
      strokeStyle: kind === "line" || kind === "freehand" ? "solid" : "dashed",
      fill: kind !== "line" && kind !== "freehand"
    };
    onChange({ ...project, drawings: [...(project.drawings ?? []), drawing] });
    setSelectedDrawingId(drawing.id);
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setDrawingMode("");
    setMessage(`${workspaceDrawingKindLabel(kind)} 도형을 추가했습니다.`);
  }

  function addWorkspaceDrawingFromMenu(kind: WorkspaceDrawingKind, point: { x: number; y: number }) {
    addWorkspaceDrawing(kind, point);
    setWorkspaceMenu(null);
  }

  function editWorkspaceDrawingLabel(drawingId: string) {
    const drawing = (project.drawings ?? []).find((item) => item.id === drawingId);
    if (!drawing) return;
    const label = promptWorkspaceDrawingLabel(drawing.kind, drawing.label);
    if (label === null) return;
    onChange({ ...project, drawings: (project.drawings ?? []).map((item) => item.id === drawingId ? { ...item, label } : item) });
    setSelectedDrawingId(drawingId);
    setMessage("도형 레이블을 수정했습니다.");
  }

  function cycleWorkspaceDrawingColor(drawingId: string) {
    onChange({
      ...project,
      drawings: (project.drawings ?? []).map((drawing) => drawing.id === drawingId ? { ...drawing, color: nextWorkspaceDrawingColor(drawing.color) } : drawing)
    });
    setSelectedDrawingId(drawingId);
    setMessage("도형 색상을 변경했습니다.");
  }

  function toggleWorkspaceDrawingStroke(drawingId: string) {
    onChange({
      ...project,
      drawings: (project.drawings ?? []).map((drawing) => drawing.id === drawingId ? { ...drawing, strokeStyle: drawing.strokeStyle === "dashed" ? "solid" : "dashed" } : drawing)
    });
    setSelectedDrawingId(drawingId);
    setMessage("도형 선 스타일을 변경했습니다.");
  }

  function resizeWorkspaceDrawing(drawingId: string, scale: number) {
    onChange({
      ...project,
      drawings: (project.drawings ?? []).map((drawing) => {
        if (drawing.id !== drawingId) return drawing;
        const center = drawingCenter(drawing);
        const minSize = drawingMinSize(drawing.kind);
        const width = Math.max(minSize.width, Math.min(1200, Math.round(drawing.width * scale)));
        const height = Math.max(minSize.height, Math.min(900, Math.round(drawing.height * scale)));
        return { ...drawing, width, height, position: drawingPlacementPosition(center, { width, height }, true) };
      })
    });
    setSelectedDrawingId(drawingId);
    setMessage(scale >= 1 ? "도형 크기를 키웠습니다." : "도형 크기를 줄였습니다.");
  }

  function startDrawingResize(event: React.PointerEvent<SVGRectElement>, drawing: WorkspaceDrawing, handle: DrawingResizeHandle) {
    if (selectedCable || selectedModel || pduMode || complexPduMode || noteMode || drawingMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const point = canvasPoint(event);
    drawingResizeRef.current = {
      id: drawing.id,
      kind: drawing.kind,
      handle,
      startX: point.x,
      startY: point.y,
      startPosition: drawing.position,
      startWidth: drawing.width,
      startHeight: drawing.height,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedDrawingId(drawing.id);
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    closeFloatingMenus();
  }

  function moveDrawingResize(event: React.PointerEvent<Element>) {
    const drag = drawingResizeRef.current;
    if (!drag) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const moved = Math.hypot(dx, dy) > 3;
    drag.moved = drag.moved || moved;
    const minSize = drawingMinSize(drag.kind);
    const canvasLeft = 16;
    const canvasTop = 16;
    const canvasRight = CANVAS_WIDTH - 16;
    const canvasBottom = CANVAS_HEIGHT - 16;
    let left = drag.startPosition.x;
    let top = drag.startPosition.y;
    let right = drag.startPosition.x + drag.startWidth;
    let bottom = drag.startPosition.y + drag.startHeight;

    if (drag.handle.includes("e")) right = Math.max(left + minSize.width, Math.min(canvasRight, right + dx));
    if (drag.handle.includes("s")) bottom = Math.max(top + minSize.height, Math.min(canvasBottom, bottom + dy));
    if (drag.handle.includes("w")) left = Math.min(right - minSize.width, Math.max(canvasLeft, left + dx));
    if (drag.handle.includes("n")) top = Math.min(bottom - minSize.height, Math.max(canvasTop, top + dy));

    const nextPosition = { x: Math.round(left), y: Math.round(top) };
    const nextWidth = Math.round(right - left);
    const nextHeight = Math.round(bottom - top);
    onChange({
      ...project,
      drawings: (project.drawings ?? []).map((drawing) => drawing.id === drag.id ? { ...drawing, position: nextPosition, width: nextWidth, height: nextHeight } : drawing)
    });
  }

  function endDrawingResize() {
    if (drawingResizeRef.current?.moved) {
      suppressClickRef.current = true;
      setMessage("도형 크기를 조절했습니다.");
    }
    drawingResizeRef.current = null;
  }

  function startFreehandDrawing(event: React.PointerEvent<HTMLElement>) {
    if (drawingMode !== "freehand" || selectedCable || selectedModel || pduMode || complexPduMode || noteMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const point = canvasPoint(event);
    freehandDraftRef.current = { pointerId: event.pointerId, points: [point] };
    setFreehandPreview([point]);
    event.currentTarget.setPointerCapture(event.pointerId);
    closeFloatingMenus();
    setMessage("자유선을 그리고 있습니다.");
  }

  function moveFreehandDrawing(event: React.PointerEvent<HTMLElement>) {
    const draft = freehandDraftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const last = draft.points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
    draft.points = [...draft.points, point].slice(-300);
    setFreehandPreview(draft.points);
  }

  function endFreehandDrawing(event: React.PointerEvent<HTMLElement>) {
    const draft = freehandDraftRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    freehandDraftRef.current = null;
    setFreehandPreview([]);
    suppressWorkspaceClickRef.current = true;
    if (draft.points.length < 2) {
      setDrawingMode("");
      setMessage("자유선 추가를 취소했습니다.");
      return;
    }
    const label = promptWorkspaceDrawingLabel("freehand");
    if (label === null) {
      setDrawingMode("");
      setMessage("자유선 추가를 취소했습니다.");
      return;
    }
    const drawing = freehandDrawingFromPoints(draft.points, label);
    onChange({ ...project, drawings: [...(project.drawings ?? []), drawing] });
    setSelectedDrawingId(drawing.id);
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setDrawingMode("");
    setMessage("자유선을 추가했습니다.");
  }

  function deleteWorkspaceDrawing(drawingId: string) {
    const drawing = (project.drawings ?? []).find((item) => item.id === drawingId);
    onChange({ ...project, drawings: (project.drawings ?? []).filter((item) => item.id !== drawingId) });
    if (selectedDrawingId === drawingId) setSelectedDrawingId("");
    setMessage(drawing ? "도형을 삭제했습니다." : "삭제할 도형이 없습니다.");
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
    setMessage(`${device.label} 이름을 ${label}(으)로 변경했습니다.`);
    setRenameDraft(null);
  }

  function toggleDevicePower(deviceId: string) {
    const device = project.devices.find((item) => item.id === deviceId);
    if (!device) return;
    updateDevice(powerDevice(device, !device.powerOn));
    setMessage(`${device.label} 전원을 ${device.powerOn ? "껐습니다" : "켰습니다"}.`);
  }

  function setLinkEndpointAdmin(linkId: string, adminUp: boolean) {
    const link = project.links.find((item) => item.id === linkId);
    if (!link) return;
    const endpointKeys = new Set([
      `${link.endpointA.deviceId}:${link.endpointA.portId}`,
      `${link.endpointB.deviceId}:${link.endpointB.portId}`
    ]);
    const nextProject = recalc({
      ...project,
      devices: project.devices.map((device) => ({
        ...device,
        ports: device.ports.map((port) => endpointKeys.has(`${device.id}:${port.id}`) ? { ...port, adminUp } : port)
      }))
    });
    onChange(nextProject);
    setSelectedLinkId(linkId);
    setMessage(`링크 끝점 포트를 ${adminUp ? "활성화" : "shutdown"}했습니다.`);
  }

  function setSerialClockRate(linkId: string) {
    const link = project.links.find((item) => item.id === linkId);
    if (!link || (link.type !== "serial-dce" && link.type !== "serial-dte")) return;
    const clockEndpoint = link.dceEndpoint === "B" ? link.endpointB : link.endpointA;
    const nextProject = recalc({
      ...project,
      devices: project.devices.map((device) => ({
        ...device,
        ports: device.ports.map((port) => device.id === clockEndpoint.deviceId && port.id === clockEndpoint.portId ? { ...port, clockRate: 64000 } : port)
      }))
    });
    onChange(nextProject);
    setSelectedLinkId(linkId);
    setMessage("Serial DCE clock rate를 64000으로 설정했습니다.");
  }

  function repairLinkVlans(linkId: string) {
    const link = project.links.find((item) => item.id === linkId);
    const pair = link ? linkEndpointPair(project, link) : null;
    if (!link || !pair) return;
    const { aPort, bPort } = pair;
    const patches = new Map<string, Partial<NetworkPort>>();
    const ensureVlansByDevice = new Map<string, number[]>();

    function patchPort(deviceId: string, port: NetworkPort, patch: Partial<NetworkPort>) {
      patches.set(`${deviceId}:${port.id}`, { ...(patches.get(`${deviceId}:${port.id}`) ?? {}), ...patch });
    }
    function ensureDeviceVlan(deviceId: string, vlan: number) {
      ensureVlansByDevice.set(deviceId, [...(ensureVlansByDevice.get(deviceId) ?? []), vlan]);
    }

    if (aPort.mode === "access" && bPort.mode === "access" && aPort.vlan !== bPort.vlan) {
      patchPort(pair.bDevice.id, bPort, { vlan: aPort.vlan });
      ensureDeviceVlan(pair.bDevice.id, aPort.vlan);
    } else if (aPort.mode === "trunk" && bPort.mode === "trunk" && !aPort.allowedVlans.some((vlan) => bPort.allowedVlans.includes(vlan))) {
      const union = Array.from(new Set([...aPort.allowedVlans, ...bPort.allowedVlans, 1].filter(validVlanId))).sort((left, right) => left - right);
      patchPort(pair.aDevice.id, aPort, { allowedVlans: union });
      patchPort(pair.bDevice.id, bPort, { allowedVlans: union });
      union.forEach((vlan) => { ensureDeviceVlan(pair.aDevice.id, vlan); ensureDeviceVlan(pair.bDevice.id, vlan); });
    } else if (aPort.mode === "trunk" && bPort.mode === "access" && !aPort.allowedVlans.includes(bPort.vlan)) {
      const allowedVlans = Array.from(new Set([...aPort.allowedVlans, bPort.vlan].filter(validVlanId))).sort((left, right) => left - right);
      patchPort(pair.aDevice.id, aPort, { allowedVlans });
      ensureDeviceVlan(pair.aDevice.id, bPort.vlan);
    } else if (bPort.mode === "trunk" && aPort.mode === "access" && !bPort.allowedVlans.includes(aPort.vlan)) {
      const allowedVlans = Array.from(new Set([...bPort.allowedVlans, aPort.vlan].filter(validVlanId))).sort((left, right) => left - right);
      patchPort(pair.bDevice.id, bPort, { allowedVlans });
      ensureDeviceVlan(pair.bDevice.id, aPort.vlan);
    }

    if (patches.size === 0) {
      setMessage("이 링크에는 자동 복구할 VLAN 문제가 없습니다.");
      return;
    }
    const nextProject = recalc({
      ...project,
      devices: project.devices.map((device) => {
        const ensuredVlans = ensureVlansByDevice.get(device.id) ?? [];
        return {
          ...device,
          config: ensuredVlans.length ? { ...device.config, vlans: ensureVlanRows(device.config.vlans, ensuredVlans) } : device.config,
          ports: device.ports.map((port) => ({ ...port, ...(patches.get(`${device.id}:${port.id}`) ?? {}) }))
        };
      })
    });
    onChange(nextProject);
    setSelectedLinkId(linkId);
    setMessage("링크 VLAN 설정을 자동 복구했습니다.");
  }

  function setAllDevicePower(powerOn: boolean) {
    if (project.devices.length === 0) {
      setMessage("전원을 제어할 장비가 없습니다.");
      return;
    }
    onChange({ ...project, devices: project.devices.map((device) => device.powerOn === powerOn ? device : powerDevice(device, powerOn)) });
    setMessage(`전체 장비 전원을 ${powerOn ? "켰습니다" : "껐습니다"}.`);
  }

  function powerCycleAllDevices() {
    if (project.devices.length === 0) {
      setMessage("재시작할 장비가 없습니다.");
      return;
    }
    onChange({ ...project, devices: project.devices.map((device) => bootDevice({ ...powerDevice(device, false), powerOn: true })) });
    setMessage("전체 장비 전원을 재시작했습니다.");
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
    if (complexPduSourceId === deviceId) {
      setComplexPduSourceId("");
      setComplexPduMode(false);
    }
    setContextMenu(null);
    setLinkMenu(null);
    setWorkspaceMenu(null);
    setTopMenu(null);
  }

  function placeWorkspaceModel(modelId: string, menu: WorkspaceMenuState | null) {
    if (!menu) return;
    placeDevice(modelId, placementPosition(modelId, { x: menu.canvasX, y: menu.canvasY }));
    setWorkspaceMenu(null);
  }

  function renameProject(name: string) {
    onChange({ ...project, name: name.slice(0, 100) });
  }

  function repairCurrentProject() {
    const result = repairProject(project);
    onChange(result.project);
    setMessage(result.message);
  }

  function resetRuntimeTables() {
    onChange({
      ...project,
      devices: project.devices.map((device) => ({
        ...device,
        runtime: { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
      })),
      simulationEvents: []
    });
    setFocusedEventId("");
    setMessage("ARP, MAC, DHCP 바인딩과 시뮬레이션 이벤트를 초기화했습니다.");
  }

  function autoArrangeTopology() {
    if (project.devices.length === 0) {
      setMessage("정렬할 장비가 없습니다.");
      return;
    }
    const groups: Array<{ kinds: DeviceKind[]; y: number }> = [
      { kinds: ["router", "firewall"], y: 170 },
      { kinds: ["switch", "hub", "wireless"], y: 390 },
      { kinds: ["pc", "server"], y: 620 }
    ];
    const arranged = new Map<string, { x: number; y: number }>();
    for (const group of groups) {
      const devices = project.devices.filter((device) => group.kinds.includes(device.kind));
      const gap = Math.min(260, Math.max(150, (CANVAS_WIDTH - 320) / Math.max(1, devices.length)));
      const startX = Math.max(90, (CANVAS_WIDTH - gap * (devices.length - 1)) / 2);
      devices.forEach((device, index) => arranged.set(device.id, { x: Math.round(startX + index * gap), y: group.y }));
    }
    const nextDevices = project.devices.map((device) => ({ ...device, position: arranged.get(device.id) ?? device.position }));
    applyArrangedDevices(nextDevices, "장비를 계층형 토폴로지로 자동 정렬했습니다.");
  }

  function autoArrangePhysicalWorkspace() {
    if (project.devices.length === 0) {
      setMessage("정렬할 장비가 없습니다.");
      return;
    }
    const rackKinds: DeviceKind[] = ["router", "firewall", "switch", "hub"];
    const benchKinds: DeviceKind[] = ["pc", "server"];
    const rackDevices = project.devices.filter((device) => rackKinds.includes(device.kind));
    const benchDevices = project.devices.filter((device) => benchKinds.includes(device.kind));
    const wirelessDevices = project.devices.filter((device) => device.kind === "wireless");
    const groupedIds = new Set([...rackDevices, ...benchDevices, ...wirelessDevices].map((device) => device.id));
    const remainingDevices = project.devices.filter((device) => !groupedIds.has(device.id));
    const arranged = new Map<string, { x: number; y: number }>();

    placeDevicesInGrid(rackDevices, arranged, { x: 206, y: 292, columns: 2, xGap: 142, yGap: 96 });
    placeDevicesInGrid(benchDevices, arranged, { x: 648, y: 590, columns: 4, xGap: 170, yGap: 92 });
    placeDevicesInGrid(wirelessDevices, arranged, { x: 1518, y: 330, columns: 3, xGap: 164, yGap: 124 });
    placeDevicesInGrid(remainingDevices, arranged, { x: 660, y: 850, columns: 4, xGap: 170, yGap: 92 });

    setWorkspaceMode("physical");
    const nextDevices = project.devices.map((device) => ({ ...device, position: arranged.get(device.id) ?? device.position }));
    applyArrangedDevices(nextDevices, "장비를 물리 작업공간 영역 기준으로 자동 정렬했습니다.");
  }

  function applyArrangedDevices(nextDevices: NetworkDevice[], nextMessage: string) {
    onChange(recalc({ ...project, devices: nextDevices }));
    const workspace = workspaceRef.current;
    const bounds = topologyBounds(nextDevices);
    if (workspace && bounds) {
      const padding = 180;
      const nextZoom = Math.max(0.45, Math.min(1.5, workspace.clientWidth / (bounds.width + padding), workspace.clientHeight / (bounds.height + padding)));
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      setZoom(nextZoom);
      window.requestAnimationFrame(() => {
        workspace.scrollTo({
          left: Math.max(0, centerX * nextZoom - workspace.clientWidth / 2),
          top: Math.max(0, centerY * nextZoom - workspace.clientHeight / 2),
          behavior: "smooth"
        });
        updateViewport();
      });
    }
    setMessage(nextMessage);
  }

  function exportDiagnosticReport() {
    const issues = diagnoseProject(project);
    const issueStats = {
      errors: issues.filter((item) => item.severity === "error").length,
      warnings: issues.filter((item) => item.severity === "warning").length,
      info: issues.filter((item) => item.severity === "info").length
    };
    const lines = [
      `Network Editor Web Diagnostic Report`,
      `Project: ${project.name}`,
      `Generated: ${new Date().toLocaleString()}`,
      ``,
      `Summary`,
      `- Devices: ${project.devices.length}`,
      `- Links: ${project.links.length} (up ${project.links.filter((link) => link.status === "up").length}, down ${project.links.filter((link) => link.status === "down").length}, blocked ${project.links.filter((link) => link.status === "blocked").length})`,
      `- Simulation events: ${project.simulationEvents.length}`,
      `- Issues: ${issues.length} (errors ${issueStats.errors}, warnings ${issueStats.warnings}, info ${issueStats.info})`,
      ``,
      `Devices`,
      ...project.devices.map((device) => `- ${device.label} | ${device.model} | ${device.powerOn ? "power on" : "power off"} | ports ${device.ports.length} | connected ${device.ports.filter((port) => port.linkId).length}`),
      ``,
      `Services`,
      ...project.devices.map((device) => `- ${device.label} | ${enabledServices(device).join(", ") || "none"} | DHCP pools ${device.config.dhcpPools.length} | excluded ${device.config.dhcpExcludedRanges?.length ?? 0} | DNS records ${device.config.dnsRecords.length} | SYSLOG logs ${device.runtime.logs.length}`),
      ``,
      `Links`,
      ...(project.links.length ? project.links.map((link) => `- ${shortCableLabel(link.type)} | ${linkStatusLabel(link.status)} | ${linkLabel(project, link)} | ${linkStatusDetail(project, link)}`) : [`- none`]),
      ``,
      `Issues`,
      ...(issues.length ? issues.map((item) => `- [${item.severity.toUpperCase()}] ${item.title}: ${item.detail}`) : [`- none`])
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-zA-Z0-9_.-]/g, "_") || "network"}-diagnostics.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setMessage("진단 리포트를 내보냈습니다.");
  }

  function exportSimulationEvents(events = project.simulationEvents, scope = "all") {
    if (events.length === 0) {
      setMessage("내보낼 시뮬레이션 이벤트가 없습니다.");
      return;
    }
    const headers = ["time", "type", "status", "source", "target", "lastDevice", "atDevice", "packetId", "info", "osiLayers", "headers"];
    const rows = events.map((event) => [
      new Date(event.time).toISOString(),
      event.type,
      event.status,
      eventDeviceLabel(project, event.sourceDeviceId ?? event.lastDeviceId),
      eventDeviceLabel(project, event.targetDeviceId ?? event.atDeviceId),
      eventDeviceLabel(project, event.lastDeviceId),
      eventDeviceLabel(project, event.atDeviceId),
      event.packetId ?? "",
      event.info,
      event.osiLayers.join(" / "),
      pduHeaderRowsFor(project, event).map((header) => `${header.layer}:${header.field}=${header.value}`).join(" / ")
    ]);
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const fileScope = scope.replace(/[^a-zA-Z0-9_.-]/g, "_") || "all";
    anchor.download = `${project.name.replace(/[^a-zA-Z0-9_.-]/g, "_") || "network"}-simulation-${fileScope}-events.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setMessage(`시뮬레이션 이벤트 CSV를 내보냈습니다 (${scope}, ${events.length}개).`);
  }

  function openActivityWizard() {
    setActivityWindowOpen(true);
    setMessage("Activity Wizard Check Results를 열었습니다.");
  }

  function exportActivityReport(assessmentOverride?: ActivityAssessment) {
    const lines = activityReportLines(project, assessmentOverride);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-zA-Z0-9_.-]/g, "_") || "network"}-activity-check.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setMessage("Activity Wizard Check Results를 내보냈습니다.");
  }

  function nudgeSelected(dx: number, dy: number): boolean {
    if (selectedCable || selectedModel || pduMode || complexPduMode || noteMode || drawingMode || deviceWindowId || activityWindowOpen || connectionDraft) return false;
    if (selectedDeviceId) {
      const device = project.devices.find((item) => item.id === selectedDeviceId);
      if (!device) return false;
      const size = nodeSize(device.kind);
      const x = Math.max(16, Math.min(CANVAS_WIDTH - size.width - 16, device.position.x + dx));
      const y = Math.max(16, Math.min(CANVAS_HEIGHT - size.height - 16, device.position.y + dy));
      onChange(recalc({ ...project, devices: project.devices.map((item) => item.id === selectedDeviceId ? { ...item, position: { x, y } } : item) }));
      setMessage(`${device.label} 위치를 조정했습니다.`);
      return true;
    }
    if (selectedNoteId) {
      const note = (project.notes ?? []).find((item) => item.id === selectedNoteId);
      if (!note) return false;
      const position = notePlacementPosition({ x: note.position.x + dx, y: note.position.y + dy }, false);
      onChange({ ...project, notes: (project.notes ?? []).map((item) => item.id === selectedNoteId ? { ...item, position } : item) });
      setMessage("메모 위치를 조정했습니다.");
      return true;
    }
    if (selectedDrawingId) {
      const drawing = (project.drawings ?? []).find((item) => item.id === selectedDrawingId);
      if (!drawing) return false;
      const position = drawingPlacementPosition({ x: drawing.position.x + dx, y: drawing.position.y + dy }, drawing, false);
      onChange({ ...project, drawings: (project.drawings ?? []).map((item) => item.id === selectedDrawingId ? { ...item, position } : item) });
      setMessage("도형 위치를 조정했습니다.");
      return true;
    }
    return false;
  }

  function updateViewport() {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const next = {
      x: workspace.scrollLeft / zoom,
      y: workspace.scrollTop / zoom,
      width: workspace.clientWidth / zoom,
      height: workspace.clientHeight / zoom
    };
    setViewport((current) => (
      Math.abs(current.x - next.x) < 1 &&
      Math.abs(current.y - next.y) < 1 &&
      Math.abs(current.width - next.width) < 1 &&
      Math.abs(current.height - next.height) < 1
        ? current
        : next
    ));
  }

  function toggleFullscreen() {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setMessage("전체 화면을 종료했습니다.");
      return;
    }
    if (document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen();
      setMessage("전체 화면으로 전환했습니다.");
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

  function jumpToCanvasPoint(point: { x: number; y: number }) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const targetLeft = point.x * zoom - workspace.clientWidth / 2;
    const targetTop = point.y * zoom - workspace.clientHeight / 2;
    workspace.scrollTo({
      left: Math.max(0, Math.min(workspace.scrollWidth - workspace.clientWidth, targetLeft)),
      top: Math.max(0, Math.min(workspace.scrollHeight - workspace.clientHeight, targetTop)),
      behavior: "smooth"
    });
    setMessage("미니맵 위치로 이동했습니다.");
  }

  function focusWorkspaceSearchResult(result: WorkspaceSearchResult) {
    jumpToCanvasPoint(result.point);
    closeFloatingMenus();
    setSelectedDeviceId(result.kind === "device" ? result.id : "");
    setSelectedLinkId(result.kind === "link" ? result.id : "");
    setSelectedNoteId(result.kind === "note" ? result.id : "");
    setSelectedDrawingId(result.kind === "drawing" ? result.id : "");
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setMessage(`${result.label} 검색 결과로 이동했습니다.`);
  }

  function fitTopologyToView() {
    const workspace = workspaceRef.current;
    const bounds = topologyBounds(project.devices);
    if (!workspace || !bounds) {
      setZoom(1);
      setMessage("확대를 100%로 초기화했습니다.");
      return;
    }
    const padding = 180;
    const nextZoom = Math.max(0.45, Math.min(1.5, workspace.clientWidth / (bounds.width + padding), workspace.clientHeight / (bounds.height + padding)));
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      workspace.scrollTo({
        left: Math.max(0, centerX * nextZoom - workspace.clientWidth / 2),
        top: Math.max(0, centerY * nextZoom - workspace.clientHeight / 2),
        behavior: "smooth"
      });
      updateViewport();
    });
    setMessage("토폴로지 전체가 보이도록 맞췄습니다.");
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, device: NetworkDevice) {
    if (selectedCable || selectedModel || pduMode || complexPduMode || noteMode || drawingMode || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".pdu-target")) return;
    event.stopPropagation();
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
    setSelectedNoteId("");
    setSelectedDrawingId("");
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
      setMessage("장비를 이동했습니다.");
    }
    dragRef.current = null;
  }

  function startNoteDrag(event: React.PointerEvent<HTMLElement>, note: WorkspaceNote) {
    if (selectedCable || selectedModel || pduMode || complexPduMode || noteMode || drawingMode || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.stopPropagation();
    event.preventDefault();
    const point = canvasPoint(event);
    noteDragRef.current = {
      id: note.id,
      offsetX: point.x - note.position.x,
      offsetY: point.y - note.position.y,
      startX: point.x,
      startY: point.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedNoteId(note.id);
    setSelectedDrawingId("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    closeFloatingMenus();
  }

  function moveNoteDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = noteDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const moved = Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    const position = notePlacementPosition({ x: point.x - drag.offsetX, y: point.y - drag.offsetY }, false);
    onChange({
      ...project,
      notes: (project.notes ?? []).map((note) => note.id === drag.id ? { ...note, position } : note)
    });
  }

  function endNoteDrag() {
    if (noteDragRef.current?.moved) {
      suppressClickRef.current = true;
      setMessage("메모를 이동했습니다.");
    }
    noteDragRef.current = null;
  }

  function startDrawingDrag(event: React.PointerEvent<SVGElement>, drawing: WorkspaceDrawing) {
    if (selectedCable || selectedModel || pduMode || complexPduMode || noteMode || drawingMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const point = canvasPoint(event);
    drawingDragRef.current = {
      id: drawing.id,
      offsetX: point.x - drawing.position.x,
      offsetY: point.y - drawing.position.y,
      startX: point.x,
      startY: point.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedDrawingId(drawing.id);
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    closeFloatingMenus();
  }

  function moveDrawingDrag(event: React.PointerEvent<Element>) {
    const drag = drawingDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const moved = Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3;
    drag.moved = drag.moved || moved;
    const draggedDrawing = (project.drawings ?? []).find((drawing) => drawing.id === drag.id);
    if (!draggedDrawing) return;
    const position = drawingPlacementPosition({ x: point.x - drag.offsetX, y: point.y - drag.offsetY }, draggedDrawing, false);
    onChange({
      ...project,
      drawings: (project.drawings ?? []).map((drawing) => drawing.id === drag.id ? { ...drawing, position } : drawing)
    });
  }

  function endDrawingDrag() {
    if (drawingDragRef.current?.moved) {
      suppressClickRef.current = true;
      setMessage("도형을 이동했습니다.");
    }
    drawingDragRef.current = null;
  }

  function canStartWorkspacePan(event: React.PointerEvent<HTMLElement>): boolean {
    if (event.button !== 0 || selectedModel || selectedCable || pduMode || complexPduMode || noteMode || drawingMode) return false;
    const target = event.target as HTMLElement | SVGElement | null;
    if (!target || !(target instanceof Element)) return false;
    return !target.closest([
      "button",
      "input",
      "select",
      "textarea",
      ".device-node",
      ".link-group",
      ".selected-link-card",
      ".workspace-tabs",
      ".zoom-hud",
      ".workspace-search",
      ".common-tools-bar",
      ".cable-hud",
      ".placement-hud",
      ".pdu-hud",
      ".selection-hud",
      ".workspace-note",
      ".workspace-drawing",
      ".board-guide",
      ".empty-canvas-starter",
      ".workspace-minimap"
    ].join(","));
  }

  function startWorkspacePan(event: React.PointerEvent<HTMLElement>) {
    if (!canStartWorkspacePan(event)) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop,
      moved: false
    };
    workspace.setPointerCapture(event.pointerId);
    closeFloatingMenus();
    setIsPanning(true);
  }

  function moveWorkspacePan(event: React.PointerEvent<HTMLElement>) {
    const pan = panRef.current;
    const workspace = workspaceRef.current;
    if (!pan || !workspace || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.hypot(dx, dy) > 3) pan.moved = true;
    workspace.scrollLeft = pan.scrollLeft - dx;
    workspace.scrollTop = pan.scrollTop - dy;
  }

  function endWorkspacePan(event: React.PointerEvent<HTMLElement>) {
    const pan = panRef.current;
    const workspace = workspaceRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (workspace?.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
    if (pan.moved) {
      suppressWorkspaceClickRef.current = true;
      setMessage("작업 공간을 이동했습니다.");
    }
    panRef.current = null;
    setIsPanning(false);
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLElement>) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = workspace.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const delta = event.deltaY < 0 ? 0.08 : -0.08;
    setZoom((value) => {
      const next = Math.max(0.45, Math.min(1.9, value + delta));
      if (next === value) return value;
      const canvasX = (workspace.scrollLeft + offsetX) / value;
      const canvasY = (workspace.scrollTop + offsetY) / value;
      window.requestAnimationFrame(() => {
        workspace.scrollLeft = Math.max(0, canvasX * next - offsetX);
        workspace.scrollTop = Math.max(0, canvasY * next - offsetY);
        updateViewport();
      });
      return next;
    });
  }

  function selectMode() {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    closeFloatingMenus();
    setMessage("선택 모드입니다.");
  }

  function deleteSelected() {
    if (selectedNoteId) {
      deleteWorkspaceNote(selectedNoteId);
      return;
    }
    if (selectedDrawingId) {
      deleteWorkspaceDrawing(selectedDrawingId);
      return;
    }
    if (selectedDeviceId) {
      deleteDevice(selectedDeviceId);
      setMessage("장비를 삭제했습니다.");
      return;
    }
    if (selectedLinkId) {
      onChange(removeLink(project, selectedLinkId));
      setSelectedLinkId("");
      setMessage("케이블을 삭제했습니다.");
    }
  }

  function startSimplePduTool() {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setPduMode(true);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    closeFloatingMenus();
    setMessage("Simple PDU 추가: 출발지 장비를 선택하세요.");
  }

  function startComplexPduTool() {
    setSelectedModel("");
    setSelectedCable("");
    setPendingDeviceId("");
    setConnectionDraft(null);
    setComplexPduMode(true);
    setComplexPduSourceId("");
    setPduMode(false);
    setPduSourceId("");
    setNoteMode(false);
    setDrawingMode("");
    setSelectedDeviceId("");
    setSelectedLinkId("");
    setSelectedNoteId("");
    setSelectedDrawingId("");
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    closeFloatingMenus();
    setMessage("Complex PDU 추가: 프로토콜을 고르고 출발지 장비를 선택하세요.");
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
    if (name === "파일") {
      return [
        { label: "저장", action: () => { onSave(project); setMessage("프로젝트 저장을 요청했습니다."); } },
        { label: "JSON 내보내기", action: () => downloadProject(project, "json") },
        { label: "PTWEB 내보내기", action: () => { downloadProject(project, "ptweb"); setMessage(".ptweb 프로젝트 파일을 내보냈습니다. Cisco Packet Tracer .pkt 바이너리 내보내기는 지원하지 않습니다."); } },
        { label: "프로젝트로 돌아가기", action: onBack }
      ];
    }
    if (name === "편집") {
      return [
        { label: "선택 모드", action: selectMode },
        { label: "선택 해제", action: selectMode },
        { label: "메모 추가", action: startNoteTool },
        { label: "사각형 영역 추가", action: () => startDrawingTool("rectangle") },
        { label: "타원 영역 추가", action: () => startDrawingTool("ellipse") },
        { label: "라인 추가", action: () => startDrawingTool("line") },
        { label: "자유선 추가", action: () => startDrawingTool("freehand") },
        { label: "선택 항목 삭제", action: deleteSelected, disabled: !selectedDeviceId && !selectedLinkId && !selectedNoteId && !selectedDrawingId, danger: true }
      ];
    }
    if (name === "옵션") {
      return [
        { label: "실시간 모드", action: () => setTimeMode("realtime"), disabled: timeMode === "realtime" },
        { label: "시뮬레이션 모드", action: () => setTimeMode("simulation"), disabled: timeMode === "simulation" }
      ];
    }
    if (name === "보기") {
      return [
        { label: "논리 작업공간", action: () => setWorkspaceMode("logical"), disabled: workspaceMode === "logical" },
        { label: "물리 작업공간", action: () => setWorkspaceMode("physical"), disabled: workspaceMode === "physical" },
        { label: "물리 기준 자동 정렬", action: autoArrangePhysicalWorkspace, disabled: project.devices.length === 0 },
        { label: "전체 보기", action: fitTopologyToView },
        { label: trayCollapsed ? "하단 도크 펼치기" : "하단 도크 접기", action: () => { setTrayCollapsed((value) => !value); setMessage(trayCollapsed ? "하단 도크를 펼쳤습니다." : "하단 도크를 접었습니다."); } },
        { label: "확대 100%", action: () => { setZoom(1); setMessage("확대를 100%로 초기화했습니다."); } },
        { label: "확대", action: () => setZoom((value) => Math.min(1.9, value + 0.1)) },
        { label: "축소", action: () => setZoom((value) => Math.max(0.45, value - 0.1)) }
      ];
    }
    if (name === "도구") {
      return [
        { label: "프로젝트 복구", action: repairCurrentProject },
        { label: "진단 실행", action: () => setMessage(`프로젝트 수준 이슈 ${diagnoseProject(project).length}개`) },
        { label: "Activity Wizard", action: openActivityWizard },
        { label: "진단 리포트 내보내기", action: exportDiagnosticReport },
        { label: "Activity Check 내보내기", action: exportActivityReport },
        { label: "시뮬레이션 이벤트 CSV 내보내기", action: exportSimulationEvents, disabled: project.simulationEvents.length === 0 },
        { label: "Simple PDU 추가", action: startSimplePduTool, disabled: project.devices.length < 2 },
        { label: "Complex PDU 추가", action: startComplexPduTool, disabled: project.devices.length < 2 },
        { label: "메모 추가", action: startNoteTool },
        { label: "사각형 영역 추가", action: () => startDrawingTool("rectangle") },
        { label: "타원 영역 추가", action: () => startDrawingTool("ellipse") },
        { label: "라인 추가", action: () => startDrawingTool("line") },
        { label: "자유선 추가", action: () => startDrawingTool("freehand") },
        { label: "장비 자동 정렬", action: autoArrangeTopology, disabled: project.devices.length === 0 },
        { label: "물리 기준 자동 정렬", action: autoArrangePhysicalWorkspace, disabled: project.devices.length === 0 },
        { label: "선택 장비에서 전체 Ping", action: () => { void pingFromSelectedToAll(); }, disabled: !selectedDeviceId || project.devices.length < 2 },
        { label: "전체 장비 전원 켜기", action: () => setAllDevicePower(true), disabled: project.devices.length === 0 || project.devices.every((device) => device.powerOn) },
        { label: "전체 장비 전원 끄기", action: () => setAllDevicePower(false), disabled: project.devices.length === 0 || project.devices.every((device) => !device.powerOn) },
        { label: "전체 장비 전원 재시작", action: powerCycleAllDevices, disabled: project.devices.length === 0 },
        { label: "런타임 테이블 초기화", action: resetRuntimeTables, disabled: project.devices.every((device) => !device.runtime.arpTable.length && !device.runtime.macTable.length && !device.runtime.dhcpLeases.length && !device.runtime.logs.length) && project.simulationEvents.length === 0 }
      ];
    }
    if (name === "확장") {
      return [
        { label: "Activity Wizard", action: openActivityWizard },
        { label: "WASM 엔진 상태", action: () => setMessage(engineName) },
        { label: "PTWEB 호환성", action: () => setMessage(".ptweb은 이 앱의 자체 형식입니다. Cisco .pkt 바이너리 내보내기는 지원하지 않습니다.") }
      ];
    }
    if (name === "창") {
      return [
        { label: typeof document !== "undefined" && document.fullscreenElement ? "전체 화면 종료" : "전체 화면", action: toggleFullscreen },
        { label: "선택 장비 열기", action: () => selectedDeviceId && openDeviceWindow(selectedDeviceId), disabled: !selectedDeviceId },
        { label: "선택 장비 CLI 열기", action: () => selectedDeviceId && openDeviceWindow(selectedDeviceId, "cli"), disabled: !selectedDeviceId },
        { label: deviceWindow ? `${deviceWindow.label} 활성화` : "열린 장비 창 없음", action: () => deviceWindow && setMessage(`${deviceWindow.label} 창이 활성화되어 있습니다.`), disabled: !deviceWindow },
        { label: "장비 창 닫기", action: () => { setDeviceWindowId(""); setDeviceWindowTab(undefined); setMessage("장비 창을 닫았습니다."); }, disabled: !deviceWindow },
        { label: "시뮬레이션 패널", action: () => setTimeMode("simulation"), disabled: timeMode === "simulation" }
      ];
    }
    return [
      { label: "정보", action: () => setMessage("Network Editor Web 네트워크 랩입니다.") },
      { label: "형식 안내", action: () => setMessage("여기서는 .ptweb 또는 JSON을 사용합니다. Cisco Packet Tracer .pkt는 독점 바이너리 형식입니다.") }
    ];
  }

  return (
    <main className={`editor-shell packet-shell ${trayCollapsed ? "tray-collapsed" : ""}`} onClick={() => { setContextMenu(null); setLinkMenu(null); setWorkspaceMenu(null); setTopMenu(null); }}>
      <header className="topbar packet-topbar">
        <div className="packet-menubar">
          <button className="icon-button" onClick={onBack} title="프로젝트로 돌아가기" type="button"><ArrowLeft size={18} /></button>
          <input className="project-title-input" value={project.name} onBlur={() => { if (!project.name.trim()) renameProject("제목 없는 네트워크"); }} onChange={(event) => renameProject(event.target.value)} aria-label="프로젝트 이름" />
          <span className="session-chip">{user.username}</span>
        </div>
        <nav className="packet-menu-labels" aria-label="상단 메뉴">
          {packetMenuLabels.map((name) => (
            <button className={topMenu?.name === name ? "active" : ""} key={name} onClick={(event) => openTopMenu(event, name)} type="button">{name}</button>
          ))}
        </nav>
        <div className="packet-toolbar">
          <button className="icon-button" onClick={() => { onSave(project); setMessage("프로젝트 저장을 요청했습니다."); }} title="저장" type="button"><Save size={18} /></button>
          <button className="icon-button" onClick={() => downloadProject(project, "json")} title="JSON 내보내기" type="button"><FileJson size={18} /></button>
          <button className="icon-button" onClick={() => { downloadProject(project, "ptweb"); setMessage(".ptweb 프로젝트 파일을 내보냈습니다. Cisco Packet Tracer .pkt 바이너리 내보내기는 지원하지 않습니다."); }} title="PTWEB 프로젝트 내보내기 (Cisco .pkt 아님)" type="button"><Download size={18} /></button>
          <button className="icon-button" onClick={openActivityWizard} title="Activity Wizard / Check Results" type="button"><CircleHelp size={18} /></button>
          <button className="icon-button" onClick={() => setZoom((value) => Math.min(1.9, value + 0.1))} title="확대" type="button"><ZoomIn size={18} /></button>
          <button className="icon-button" onClick={fitTopologyToView} title="전체 보기" type="button"><Maximize2 size={18} /></button>
          <button
            className={`icon-button ${trayCollapsed ? "active" : ""}`}
            onClick={() => {
              setTrayCollapsed((value) => !value);
              setMessage(trayCollapsed ? "하단 도크를 펼쳤습니다." : "하단 도크를 접었습니다.");
            }}
            title={trayCollapsed ? "하단 도크 펼치기" : "하단 도크 접기"}
            type="button"
          >
            {trayCollapsed ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
          </button>
          <button className="icon-button" onClick={() => { setZoom(1); setMessage("확대를 100%로 초기화했습니다."); }} title="확대 초기화" type="button"><RotateCcw size={18} /></button>
          <button className="icon-button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} title="축소" type="button"><ZoomOut size={18} /></button>
        </div>
      </header>
      <section
        className={`workspace packet-workspace ${selectedModel ? "placing" : ""} ${selectedCable ? "cabling" : ""} ${complexPduMode ? "complex-pdu" : ""} ${noteMode ? "note-mode" : ""} ${drawingMode ? "drawing-mode" : ""} ${isPanning ? "panning" : ""} ${workspaceMode}`}
        onClick={clickWorkspace}
        onContextMenu={(event) => {
          event.preventDefault();
          closeFloatingMenus();
          const point = canvasPoint(event);
          setWorkspaceMenu({ x: event.clientX, y: event.clientY, canvasX: point.x, canvasY: point.y });
          setMessage("작업 공간 메뉴를 열었습니다.");
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropDevice}
        onPointerCancel={endWorkspacePan}
        onPointerDown={startWorkspacePan}
        onPointerMove={moveWorkspacePan}
        onPointerUp={endWorkspacePan}
        onScroll={updateViewport}
        onWheelCapture={zoomWithWheel}
        ref={workspaceRef}
      >
        <div className="workspace-tabs" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className={workspaceMode === "logical" ? "active" : ""} onClick={() => setWorkspaceMode("logical")} type="button">논리</button>
          <button className={workspaceMode === "physical" ? "active" : ""} onClick={() => setWorkspaceMode("physical")} type="button">물리</button>
        </div>
        <div className="zoom-hud" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className="icon-button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} title="축소" type="button"><ZoomOut size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => setZoom((value) => Math.min(1.9, value + 0.1))} title="확대" type="button"><ZoomIn size={16} /></button>
          <button className="icon-button" onClick={fitTopologyToView} title="전체 보기" type="button"><Maximize2 size={16} /></button>
        </div>
        <div className="workspace-search" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <Search size={14} />
          <input value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder="장비, IP, 메모, 도형 검색" aria-label="작업공간 검색" />
          {workspaceSearch.trim() && (
            <div className="workspace-search-results">
              {workspaceSearchResults.length > 0 ? workspaceSearchResults.map((result) => (
                <button key={`${result.kind}:${result.id}`} onClick={() => focusWorkspaceSearchResult(result)} type="button">
                  <strong>{result.label}</strong>
                  <span>{result.detail}</span>
                </button>
              )) : <span className="workspace-search-empty">결과 없음</span>}
            </div>
          )}
        </div>
        <div className="common-tools-bar" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className={!selectedDeviceId && !selectedLinkId && !selectedNoteId && !selectedDrawingId && !selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && !drawingMode ? "active" : ""} onClick={selectMode} title="선택 도구" type="button"><MousePointer2 size={16} /></button>
          <button disabled={pduMode || complexPduMode || Boolean(drawingMode) || !selectedDeviceId} onClick={() => selectedDeviceId && openDeviceWindow(selectedDeviceId)} title="선택 장비 검사" type="button"><Settings size={16} /></button>
          <button disabled={pduMode || complexPduMode || noteMode || Boolean(drawingMode) || (!selectedDeviceId && !selectedLinkId && !selectedNoteId && !selectedDrawingId)} onClick={deleteSelected} title="선택 항목 삭제" type="button"><Trash2 size={16} /></button>
          <button className={pduMode ? "active" : ""} disabled={project.devices.length < 2 || Boolean(selectedCable) || Boolean(selectedModel) || complexPduMode || noteMode || Boolean(drawingMode)} onClick={startSimplePduTool} title="Simple PDU 추가" type="button"><Mail size={16} /></button>
          <button className={complexPduMode ? "active" : ""} disabled={project.devices.length < 2 || Boolean(selectedCable) || Boolean(selectedModel) || pduMode || noteMode || Boolean(drawingMode)} onClick={startComplexPduTool} title="Complex PDU 추가" type="button"><Plus size={16} /></button>
          <button className={noteMode ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode || complexPduMode || Boolean(drawingMode)} onClick={startNoteTool} title="메모 추가" type="button"><Edit3 size={16} /></button>
          <button className={drawingMode === "rectangle" ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode || complexPduMode || noteMode} onClick={() => startDrawingTool("rectangle")} title="사각형 영역 추가" type="button"><Square size={16} /></button>
          <button className={drawingMode === "ellipse" ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode || complexPduMode || noteMode} onClick={() => startDrawingTool("ellipse")} title="타원 영역 추가" type="button"><CircleDot size={16} /></button>
          <button className={drawingMode === "line" ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode || complexPduMode || noteMode} onClick={() => startDrawingTool("line")} title="라인 추가" type="button"><Minus size={16} /></button>
          <button className={drawingMode === "freehand" ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode || complexPduMode || noteMode} onClick={() => startDrawingTool("freehand")} title="자유선 추가" type="button"><PenLine size={16} /></button>
        </div>
        {(selectedCable || pendingDeviceId) && (
          <div className="cable-hud">
            <strong>{selectedCable ? shortCableLabel(selectedCable) : "케이블"}</strong>
            <span>{pendingDeviceId ? `${project.devices.find((device) => device.id === pendingDeviceId)?.label ?? "장비"}에서 시작` : "첫 번째 장비 선택"}</span>
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
            <span>{pduSource ? "목적지 선택" : "출발지 선택"}</span>
            <button className="hud-icon-button" onClick={(event) => { event.stopPropagation(); selectMode(); }} title="PDU 취소" type="button"><X size={14} /></button>
          </div>
        )}
        {complexPduMode && project.devices.length > 1 && !selectedCable && !selectedModel && (
          <div className="pdu-hud complex-pdu-hud" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
            <Plus size={16} />
            <strong>{complexPduSource ? complexPduSource.label : "Complex PDU"}</strong>
            <select aria-label="Complex PDU 프로토콜" value={complexPduProtocol} onChange={(event) => setComplexPduProtocol(event.target.value as ComplexPduProtocol)}>
              {complexPduProtocols.map((protocol) => <option key={protocol.value} value={protocol.value}>{protocol.label}</option>)}
            </select>
            <label className="complex-pdu-count">횟수<input aria-label="Complex PDU 반복 횟수" max={10} min={1} type="number" value={complexPduCount} onChange={(event) => setComplexPduCount(boundedNumber(event.target.value, 1, 10))} /></label>
            <label className="complex-pdu-count">TTL<input aria-label="Complex PDU TTL" max={255} min={1} type="number" value={complexPduTtl} onChange={(event) => setComplexPduTtl(boundedNumber(event.target.value, 1, 255))} /></label>
            <label className="complex-pdu-count">간격<input aria-label="Complex PDU 반복 간격" max={2000} min={0} step={100} type="number" value={complexPduIntervalMs} onChange={(event) => setComplexPduIntervalMs(boundedNumber(event.target.value, 0, 2000))} /></label>
            <span>{complexPduSource ? "목적지 선택" : "출발지 선택"}</span>
            <button className="hud-icon-button" onClick={(event) => { event.stopPropagation(); selectMode(); }} title="PDU 취소" type="button"><X size={14} /></button>
          </div>
        )}
        {noteMode && !selectedCable && !selectedModel && !pduMode && !complexPduMode && (
          <div className="note-hud">
            <Edit3 size={16} />
            <strong>메모 추가</strong>
            <span>작업 공간 위치 선택</span>
            <button className="hud-icon-button" onClick={(event) => { event.stopPropagation(); selectMode(); }} title="메모 취소" type="button"><X size={14} /></button>
          </div>
        )}
        {drawingMode && !selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && (
          <div className="note-hud drawing-hud">
            <WorkspaceDrawingIcon kind={drawingMode} size={16} />
            <strong>{workspaceDrawingKindLabel(drawingMode)} 추가</strong>
            <span>작업 공간 위치 선택</span>
            <button className="hud-icon-button" onClick={(event) => { event.stopPropagation(); selectMode(); }} title="도형 취소" type="button"><X size={14} /></button>
          </div>
        )}
        {!selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && !drawingMode && (
          <div className="board-guide" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
            <span><MousePointer2 size={14} />빈 보드 드래그 이동</span>
            <span><ZoomIn size={14} />휠 확대/축소</span>
            <span><Settings size={14} />우클릭 빠른 메뉴</span>
          </div>
        )}
        {selectedDevice && !selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && !drawingMode && (
          <div className="selection-hud" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
            <span className={`selection-led ${selectedDevice.powerOn ? "on" : "off"}`} />
            <div>
              <strong>{selectedDevice.label}</strong>
              <span>{selectedDevice.model} | 연결 {selectedDevice.ports.filter((port) => port.linkId).length}개</span>
            </div>
            <button className="icon-button" onClick={() => openDeviceWindow(selectedDevice.id, "config")} title="선택 장비 설정" type="button"><Wrench size={16} /></button>
            <button className="icon-button" onClick={() => startCableFromDevice(selectedDevice.id)} title="선택 장비에서 자동 케이블 연결 시작" type="button"><Cable size={16} /></button>
            <button className="icon-button" onClick={() => renameDevice(selectedDevice.id)} title="선택 장비 이름 변경" type="button"><Edit3 size={16} /></button>
            <button className="icon-button" onClick={() => duplicateDevice(selectedDevice.id)} title="선택 장비 복제" type="button"><Copy size={16} /></button>
            <button className="icon-button danger" onClick={() => { deleteDevice(selectedDevice.id); setMessage("장비를 삭제했습니다."); }} title="선택 장비 삭제" type="button"><Trash2 size={16} /></button>
          </div>
        )}
        {selectedDrawing && !selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && !drawingMode && (
          <div className="selection-hud drawing-selection-hud" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
            <WorkspaceDrawingIcon kind={selectedDrawing.kind} size={17} />
            <div>
              <strong>{selectedDrawing.label || workspaceDrawingKindLabel(selectedDrawing.kind)}</strong>
              <span>{workspaceDrawingKindLabel(selectedDrawing.kind)} | {selectedDrawing.width}x{selectedDrawing.height}</span>
            </div>
            <button className="icon-button" onClick={() => editWorkspaceDrawingLabel(selectedDrawing.id)} title="도형 레이블 수정" type="button"><Edit3 size={16} /></button>
            <button className="icon-button" onClick={() => cycleWorkspaceDrawingColor(selectedDrawing.id)} title="도형 색상 변경" type="button"><CircleDot size={16} /></button>
            <button className="icon-button" onClick={() => toggleWorkspaceDrawingStroke(selectedDrawing.id)} title="도형 선 스타일 변경" type="button"><Minus size={16} /></button>
            <button className="icon-button" onClick={() => resizeWorkspaceDrawing(selectedDrawing.id, 0.85)} title="도형 축소" type="button"><Minimize2 size={16} /></button>
            <button className="icon-button" onClick={() => resizeWorkspaceDrawing(selectedDrawing.id, 1.15)} title="도형 확대" type="button"><Maximize2 size={16} /></button>
            <button className="icon-button danger" onClick={() => deleteWorkspaceDrawing(selectedDrawing.id)} title="도형 삭제" type="button"><Trash2 size={16} /></button>
          </div>
        )}
        <div className="canvas-scroll-area" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
          <div
            className="logical-canvas"
            onPointerDown={startFreehandDrawing}
            onPointerMove={(event) => { moveDrag(event); moveNoteDrag(event); moveDrawingDrag(event); moveDrawingResize(event); moveFreehandDrawing(event); }}
            onPointerUp={(event) => { endDrag(); endNoteDrag(); endDrawingDrag(); endDrawingResize(); endFreehandDrawing(event); }}
            onPointerCancel={(event) => { endDrag(); endNoteDrag(); endDrawingDrag(); endDrawingResize(); endFreehandDrawing(event); }}
            ref={canvasRef}
            style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {workspaceMode === "physical" && <PhysicalWorkspaceBackdrop devices={project.devices} />}
            {project.devices.length === 0 && !selectedCable && !selectedModel && !pduMode && !complexPduMode && !noteMode && !drawingMode && (
              <div className="empty-canvas-starter" onClick={(event) => event.stopPropagation()}>
                <Network size={22} />
                <strong>빈 네트워크</strong>
                <span>장비를 고르거나 빈 보드를 우클릭해서 토폴로지를 시작하세요.</span>
                <div>
                  {quickWorkspaceModelIds.slice(0, 4).map((modelId) => {
                    const model = deviceCatalog.find((item) => item.id === modelId);
                    if (!model) return null;
                    return (
                      <button key={model.id} onClick={() => placeDevice(model.id, placementPosition(model.id, { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }))} type="button">
                        <DeviceIcon kind={model.kind} size={15} />
                        {displayKind(model.kind)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <svg className="drawing-layer" aria-label="작업 공간 도형">
              {freehandPreview.length > 1 && (
                <g className="workspace-drawing freehand blue solid outline preview">
                  <polyline className="drawing-shape" points={drawingPointsAttribute(freehandPreview)} />
                </g>
              )}
              {(project.drawings ?? []).map((drawing) => (
                <g
                  className={`workspace-drawing ${drawing.kind} ${drawing.color} ${drawing.strokeStyle} ${drawing.fill ? "filled" : "outline"} ${selectedDrawingId === drawing.id ? "selected" : ""}`}
                  key={drawing.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    closeFloatingMenus();
                    setSelectedDrawingId(drawing.id);
                    setSelectedDeviceId("");
                    setSelectedLinkId("");
                    setSelectedNoteId("");
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    editWorkspaceDrawingLabel(drawing.id);
                  }}
                  onKeyDown={(event) => activateRowOnKeyboard(event, () => editWorkspaceDrawingLabel(drawing.id))}
                  onPointerDown={(event) => startDrawingDrag(event, drawing)}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${drawing.position.x} ${drawing.position.y})`}
                >
                  <title>{drawing.label || workspaceDrawingKindLabel(drawing.kind)}</title>
                  <WorkspaceDrawingShape drawing={drawing} onResizeStart={startDrawingResize} selected={selectedDrawingId === drawing.id} />
                </g>
              ))}
            </svg>
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
                    className={`link-group ${selectedLinkId === link.id ? "selected-link" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectedCable || selectedModel) {
                        setMessage("현재 배치 모드를 끝내거나 취소한 뒤 케이블을 선택하세요.");
                        return;
                      }
                      closeFloatingMenus();
                      setSelectedDeviceId("");
                      setSelectedNoteId("");
                      setSelectedDrawingId("");
                      setSelectedLinkId(link.id);
                      setMessage(linkLabel(project, link));
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (selectedCable || selectedModel) {
                        setMessage("현재 배치 모드를 끝내거나 취소한 뒤 케이블 메뉴를 여세요.");
                        return;
                      }
                      closeFloatingMenus();
                      setSelectedDeviceId("");
                      setSelectedNoteId("");
                      setSelectedDrawingId("");
                      setSelectedLinkId(link.id);
                      setLinkMenu({ linkId: link.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <title>{linkLabel(project, link)} [{linkStatusLabel(link.status)}]</title>
                    {link.type === "wireless" ? <path className="cable-hitbox" d={wirelessPath} /> : <line className="cable-hitbox" x1={x1} x2={x2} y1={y1} y2={y2} />}
                    {link.type === "wireless" ? <path className={`cable-line ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} d={wirelessPath} /> : <line className={`cable-line ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} x1={x1} x2={x2} y1={y1} y2={y2} />}
                    <circle className={`link-light ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} cx={x1} cy={y1} r="5" />
                    <circle className={`link-light ${link.type} ${link.status} ${activeFlow ? "active-flow" : ""}`} cx={x2} cy={y2} r="5" />
                    <text className="cable-label" x={midX} y={labelY}>{canvasLinkLabel(project, link)}</text>
                  </g>
                );
              })}
            </svg>
            {(project.notes ?? []).map((note) => (
              <div
                className={`workspace-note ${note.color} ${selectedNoteId === note.id ? "selected" : ""}`}
                key={note.id}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  closeFloatingMenus();
                  setSelectedNoteId(note.id);
                  setSelectedDrawingId("");
                  setSelectedDeviceId("");
                  setSelectedLinkId("");
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  editWorkspaceNote(note.id);
                }}
                onKeyDown={(event) => activateRowOnKeyboard(event, () => editWorkspaceNote(note.id))}
                onPointerDown={(event) => startNoteDrag(event, note)}
                role="button"
                style={{ left: note.position.x, top: note.position.y }}
                tabIndex={0}
                title="더블클릭으로 메모 수정"
              >
                <span>{note.text}</span>
                {selectedNoteId === note.id && (
                  <div className="workspace-note-actions">
                    <button onClick={(event) => { event.stopPropagation(); editWorkspaceNote(note.id); }} title="메모 수정" type="button"><Edit3 size={13} /></button>
                    <button onClick={(event) => { event.stopPropagation(); cycleWorkspaceNoteColor(note.id); }} title="메모 색상 변경" type="button"><CircleDot size={13} /></button>
                    <button className="danger" onClick={(event) => { event.stopPropagation(); deleteWorkspaceNote(note.id); }} title="메모 삭제" type="button"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
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
                    setMessage("선택한 모델은 빈 작업 공간을 클릭해서 배치하세요.");
                    return;
                  }
                  void clickDevice(device);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedDeviceId(device.id);
                  setSelectedLinkId("");
                  setSelectedNoteId("");
                  setSelectedDrawingId("");
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
                <span className="node-meta">{displayKind(device.kind)} · 연결 {device.ports.filter((port) => port.linkId).length}</span>
                <span className="node-port-strip" aria-hidden="true">
                  {device.ports.filter((port) => port.kind !== "console").slice(0, 14).map((port) => {
                    const link = port.linkId ? project.links.find((item) => item.id === port.linkId) : undefined;
                    const state = !device.powerOn || !port.adminUp ? "shutdown" : link?.status ?? "free";
                    return <i className={`node-port-dot ${state}`} key={port.id} title={`${port.name}: ${state}`} />;
                  })}
                  {device.ports.filter((port) => port.kind !== "console").length > 14 && <b className="node-port-more">+{device.ports.filter((port) => port.kind !== "console").length - 14}</b>}
                </span>
                {pduMode && pduSourceId && pduSourceId !== device.id && <span className="pdu-target" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); void sendPdu(pduSourceId, device.id).then(() => { setPduSourceId(""); setPduMode(false); }); }} title={`${device.label}에 Simple PDU 전송`}><Mail size={14} /></span>}
                {complexPduMode && complexPduSourceId && complexPduSourceId !== device.id && <span className="pdu-target complex" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); void sendComplexPdu(complexPduSourceId, device.id).then(() => { setComplexPduSourceId(""); setComplexPduMode(false); }); }} title={`${device.label}에 Complex PDU 전송`}><Plus size={14} /></span>}
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
        <WorkspaceMiniMap
          project={project}
          selectedDeviceId={selectedDeviceId}
          selectedDrawingId={selectedDrawingId}
          selectedLinkId={selectedLinkId}
          selectedNoteId={selectedNoteId}
          viewport={viewport}
          onJump={jumpToCanvasPoint}
        />
      </section>
      <section className="bottom-tray">
        <Palette
          selectedModel={selectedModel}
          selectedCable={selectedCable}
          onSelect={() => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedNoteId(""); setSelectedDrawingId(""); setSelectedModel(""); setSelectedCable(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setNoteMode(false); setDrawingMode(""); setMessage("선택 모드입니다."); }}
          onModel={(id) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedNoteId(""); setSelectedDrawingId(""); setSelectedModel(id); setSelectedCable(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setNoteMode(false); setDrawingMode(""); setMessage("작업 공간을 클릭하거나 끌어 놓아 장비를 배치하세요."); }}
          onCable={(type) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedNoteId(""); setSelectedDrawingId(""); setSelectedCable(type); setSelectedModel(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setNoteMode(false); setDrawingMode(""); setMessage("연결할 두 장비를 선택하세요."); }}
        />
        <div className="simulation-dock">
          <div className="time-tabs">
            <button className={timeMode === "realtime" ? "active" : ""} onClick={() => setTimeMode("realtime")} type="button">실시간</button>
            <button className={timeMode === "simulation" ? "active" : ""} onClick={() => setTimeMode("simulation")} type="button">시뮬레이션</button>
          </div>
          <EventPanel focusedEventId={latestEvent?.id ?? ""} message={message} mode={timeMode} onClear={() => { setFocusedEventId(""); onChange({ ...project, simulationEvents: [] }); }} onExportEvents={exportSimulationEvents} onFocusEvent={setFocusedEventId} onRemoveLink={(linkId) => { onChange(removeLink(project, linkId)); if (selectedLinkId === linkId) setSelectedLinkId(""); }} onRepair={repairCurrentProject} project={project} />
        </div>
      </section>
      {connectionDraft && (
        <DeviceWindow
          title="연결 도우미"
          subtitle={shortCableLabel(connectionDraft.cable)}
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
      {activityWindowOpen && (
        <DeviceWindow
          title="Activity Wizard"
          subtitle="Instructions / Check Results"
          onClose={() => setActivityWindowOpen(false)}
        >
          <ActivityWizard
            project={project}
            onExport={exportActivityReport}
            onUpdateProject={(nextProject, nextMessage) => { onChange(nextProject); setMessage(nextMessage); }}
            onRunPingSweep={() => { void pingFromSelectedToAll(); }}
            canRunPingSweep={Boolean(selectedDeviceId && project.devices.length > 1)}
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
          onDuplicate={duplicateDevice}
          onConnect={startCableFromDevice}
          onComplexPdu={startComplexPduFromDevice}
          onOpen={openDeviceWindow}
          onPdu={startPduFromDevice}
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
          onOpenDevice={(deviceId) => openDeviceWindow(deviceId)}
          onSetEndpointAdmin={setLinkEndpointAdmin}
          onSetSerialClock={setSerialClockRate}
          onRepairVlans={repairLinkVlans}
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
          onFit={() => { fitTopologyToView(); setWorkspaceMenu(null); }}
          onLogical={() => { setWorkspaceMode("logical"); setWorkspaceMenu(null); }}
          onPhysical={() => { setWorkspaceMode("physical"); setWorkspaceMenu(null); }}
          onPlaceModel={(modelId) => placeWorkspaceModel(modelId, workspaceMenu)}
          onArrange={() => { autoArrangeTopology(); setWorkspaceMenu(null); }}
          onPhysicalArrange={() => { autoArrangePhysicalWorkspace(); setWorkspaceMenu(null); }}
          onNote={() => addWorkspaceNoteFromMenu({ x: workspaceMenu.canvasX, y: workspaceMenu.canvasY })}
          onDrawing={(kind) => addWorkspaceDrawingFromMenu(kind, { x: workspaceMenu.canvasX, y: workspaceMenu.canvasY })}
          onRepair={() => { repairCurrentProject(); setWorkspaceMenu(null); }}
          onSelect={() => {
            setSelectedModel("");
            setSelectedCable("");
            setPendingDeviceId("");
            setConnectionDraft(null);
            setPduMode(false);
            setPduSourceId("");
            setComplexPduMode(false);
            setComplexPduSourceId("");
            setNoteMode(false);
            setDrawingMode("");
            setSelectedDeviceId("");
            setSelectedLinkId("");
            setSelectedNoteId("");
            setSelectedDrawingId("");
            setWorkspaceMenu(null);
            setMessage("선택 모드입니다.");
          }}
          onZoomReset={() => { setZoom(1); setWorkspaceMenu(null); setMessage("확대를 100%로 초기화했습니다."); }}
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
        <span>{saveError || message || "장비, 케이블 또는 PDU 대상을 선택하세요. 휠은 확대/축소, 빈 보드 드래그는 화면 이동입니다."}</span>
        <small className={`save-state ${saveStatus}`} aria-live="polite">{saveStatusLabel(saveStatus, lastSavedAt)}</small>
        <small>{engineName}</small>
      </footer>
    </main>
  );
}

function saveStatusLabel(status: SaveStatus, lastSavedAt: string): string {
  if (status === "saved" && lastSavedAt) return `저장됨 ${lastSavedAt}`;
  return ({ saved: "저장됨", pending: "저장 대기", saving: "저장 중", error: "저장 오류" })[status];
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function enabledServices(device: NetworkDevice): string[] {
  return Object.entries(device.config.services)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name.toUpperCase());
}

function powerDevice(device: NetworkDevice, powerOn: boolean): NetworkDevice {
  if (powerOn) return bootDevice({ ...device, powerOn: true });
  return { ...device, powerOn: false, runtime: { arpTable: [], macTable: [], dhcpLeases: [], logs: [] } };
}

function PhysicalWorkspaceBackdrop({ devices }: { devices: NetworkDevice[] }) {
  const rackDevices = devices.filter((device) => device.kind === "router" || device.kind === "firewall" || device.kind === "switch" || device.kind === "hub");
  const benchDevices = devices.filter((device) => device.kind === "pc" || device.kind === "server");
  const wirelessDevices = devices.filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless"));
  return (
    <div className="physical-backdrop" aria-hidden="true">
      <div className="physical-location-strip">
        <strong>도시 / 캠퍼스 / 사무실 / 배선실</strong>
        <span>장비 {devices.length}개 | 랙 {rackDevices.length}개 | 데스크 {benchDevices.length}개 | 무선 {wirelessDevices.length}개</span>
      </div>
      <div className="physical-rack">
        <span>랙 1</span>
        <PhysicalZoneDeviceList devices={rackDevices} emptyLabel="랙 장비 없음" />
      </div>
      <div className="physical-bench">
        <span>데스크톱 테이블</span>
        <PhysicalZoneDeviceList devices={benchDevices} emptyLabel="호스트 없음" />
      </div>
      <div className="physical-wireless-zone">
        <span>무선 영역</span>
        <PhysicalZoneDeviceList devices={wirelessDevices} emptyLabel="무선 장비 없음" />
      </div>
    </div>
  );
}

function PhysicalZoneDeviceList({ devices, emptyLabel }: { devices: NetworkDevice[]; emptyLabel: string }) {
  const visibleDevices = devices.slice(0, 8);
  return (
    <div className="physical-zone-device-list">
      {visibleDevices.length ? visibleDevices.map((device) => (
        <b className={device.powerOn ? "" : "off"} key={device.id}>{device.label}</b>
      )) : <em>{emptyLabel}</em>}
      {devices.length > visibleDevices.length && <em>+{devices.length - visibleDevices.length} more</em>}
    </div>
  );
}

type ActivityCheckStatus = "pass" | "partial" | "fail" | "todo";

interface ActivityCheck {
  id: string;
  category: string;
  label: string;
  detail: string;
  status: ActivityCheckStatus;
  points: number;
  earned: number;
}

interface ActivityAssessment {
  checks: ActivityCheck[];
  earned: number;
  total: number;
  score: number;
  passed: number;
  partial: number;
  failed: number;
  todo: number;
}

function ActivityWizard({
  project,
  canRunPingSweep,
  onUpdateProject,
  onRunPingSweep,
  onExport
}: {
  project: NetworkProject;
  canRunPingSweep: boolean;
  onUpdateProject: (project: NetworkProject, message: string) => void;
  onRunPingSweep: () => void;
  onExport: (assessment?: ActivityAssessment) => void;
}) {
  const [tab, setTab] = useState<"instructions" | "check">("check");
  const [activeCliChecks, setActiveCliChecks] = useState<Record<string, ActivityCheck>>({});
  const [activeCliRunning, setActiveCliRunning] = useState(false);
  const [activeCliMessage, setActiveCliMessage] = useState("");
  const activity = project.activity ?? { title: "", objectives: [], requirements: [] };
  const objectives = activity.objectives.length ? activity.objectives : defaultActivityObjectives();
  const baseAssessment = useMemo(() => assessActivity(project), [project]);
  const assessment = useMemo(() => mergeActivityAssessment(baseAssessment, activeCliChecks), [baseAssessment, activeCliChecks]);
  const groupedChecks = useMemo(() => {
    const groups = new Map<string, ActivityCheck[]>();
    for (const check of assessment.checks) {
      groups.set(check.category, [...(groups.get(check.category) ?? []), check]);
    }
    return Array.from(groups.entries());
  }, [assessment.checks]);
  const blockers = assessment.checks.filter((check) => check.status === "fail").slice(0, 4);
  const commandOutputAssertionCount = activity.commandOutputAssertions?.length ?? 0;

  useEffect(() => {
    setActiveCliChecks({});
    setActiveCliMessage("");
  }, [project.id, project.updatedAt]);

  function updateActivity(nextActivity: NonNullable<NetworkProject["activity"]>, message: string) {
    onUpdateProject({ ...project, activity: nextActivity }, message);
  }

  function editActivityTitle() {
    const title = window.prompt("Activity title", activity.title || project.name);
    if (title === null) return;
    updateActivity({ ...activity, title: title.trim().slice(0, 100) }, "Activity Wizard 제목을 수정했습니다.");
  }

  function addActivityObjective() {
    const objective = window.prompt("Objective", "Configure and verify the lab requirement.");
    if (objective === null) return;
    const value = objective.trim().slice(0, 180);
    if (!value) return;
    updateActivity({ ...activity, objectives: [...activity.objectives, value].slice(0, 12) }, "Activity Wizard 목표를 추가했습니다.");
  }

  function deleteActivityObjective(index: number) {
    updateActivity({ ...activity, objectives: activity.objectives.filter((_, itemIndex) => itemIndex !== index) }, "Activity Wizard 목표를 삭제했습니다.");
  }

  function addActivityRequirement(kind: ActivityRequirementKind) {
    const template = activityRequirementCatalog.find((item) => item.kind === kind);
    if (!template) return;
    const label = window.prompt("Requirement label", template.label);
    if (label === null) return;
    const target = promptBoundedInteger("Target count", template.defaultTarget, 1, 999);
    if (target === null) return;
    const points = promptBoundedInteger("Points", template.defaultPoints, 1, 100);
    if (points === null) return;
    updateActivity({
      ...activity,
      requirements: [
        ...activity.requirements,
        { id: createId("act_req"), kind, label: label.trim().slice(0, 80) || template.label, target, points }
      ].slice(0, 24)
    }, "Activity Wizard 요구사항을 추가했습니다.");
  }

  function deleteActivityRequirement(id: string) {
    updateActivity({ ...activity, requirements: activity.requirements.filter((requirement) => requirement.id !== id) }, "Activity Wizard 요구사항을 삭제했습니다.");
  }

  function addCommandRule() {
    const command = window.prompt("Startup-config command", "ip route 0.0.0.0 0.0.0.0 192.168.1.1");
    if (command === null) return;
    const normalizedCommand = normalizeCommandRuleText(command);
    if (!normalizedCommand) return;
    const deviceText = window.prompt("Device label/id (blank = any device)", "");
    if (deviceText === null) return;
    const targetDevice = deviceText.trim()
      ? project.devices.find((device) => [device.id, device.label, device.config.hostname].some((value) => value.toLowerCase() === deviceText.trim().toLowerCase()))
      : undefined;
    const points = promptBoundedInteger("Points", 5, 1, 100);
    if (points === null) return;
    updateActivity({
      ...activity,
      commandRules: [
        ...(activity.commandRules ?? []),
        { id: createId("act_cmd"), label: targetDevice ? `${targetDevice.label}: ${normalizedCommand}` : normalizedCommand, deviceId: targetDevice?.id, command: normalizedCommand, points }
      ].slice(0, 40)
    }, "Activity Wizard 명령 채점 규칙을 추가했습니다.");
  }

  function deleteCommandRule(id: string) {
    updateActivity({ ...activity, commandRules: (activity.commandRules ?? []).filter((rule) => rule.id !== id) }, "Activity Wizard 명령 채점 규칙을 삭제했습니다.");
  }

  function addCommandSequence() {
    const rawCommands = window.prompt("Ordered startup-config commands separated by semicolon", "interface GigabitEthernet0/0; ip address 192.168.1.1 255.255.255.0; no shutdown");
    if (rawCommands === null) return;
    const commands = rawCommands.split(";").map(normalizeCommandRuleText).filter(Boolean).slice(0, 20);
    if (!commands.length) return;
    const deviceText = window.prompt("Device label/id (blank = any device)", "");
    if (deviceText === null) return;
    const targetDevice = deviceText.trim()
      ? project.devices.find((device) => [device.id, device.label, device.config.hostname].some((value) => value.toLowerCase() === deviceText.trim().toLowerCase()))
      : undefined;
    const points = promptBoundedInteger("Points", 10, 1, 100);
    if (points === null) return;
    updateActivity({
      ...activity,
      commandSequences: [
        ...(activity.commandSequences ?? []),
        { id: createId("act_seq"), label: targetDevice ? `${targetDevice.label}: ordered config` : "Ordered startup-config", deviceId: targetDevice?.id, commands, points }
      ].slice(0, 24)
    }, "Activity Wizard 명령 순서 채점 규칙을 추가했습니다.");
  }

  function deleteCommandSequence(id: string) {
    updateActivity({ ...activity, commandSequences: (activity.commandSequences ?? []).filter((sequence) => sequence.id !== id) }, "Activity Wizard 명령 순서 채점 규칙을 삭제했습니다.");
  }

  function addCommandOutputAssertion() {
    const rawCommands = window.prompt("CLI commands separated by semicolon", "enable; show version");
    if (rawCommands === null) return;
    const commands = rawCommands.split(";").map(normalizeCommandRuleText).filter(Boolean).slice(0, 20);
    if (!commands.length) return;
    const expectedText = window.prompt("Expected output text", "Configuration register");
    if (expectedText === null || !expectedText.trim()) return;
    const deviceText = window.prompt("Device label/id (blank = any device)", "");
    if (deviceText === null) return;
    const targetDevice = deviceText.trim()
      ? project.devices.find((device) => [device.id, device.label, device.config.hostname].some((value) => value.toLowerCase() === deviceText.trim().toLowerCase()))
      : undefined;
    const points = promptBoundedInteger("Points", 10, 1, 100);
    if (points === null) return;
    updateActivity({
      ...activity,
      commandOutputAssertions: [
        ...(activity.commandOutputAssertions ?? []),
        { id: createId("act_out"), label: targetDevice ? `${targetDevice.label}: ${commands.at(-1)}` : `${commands.at(-1)} output`, deviceId: targetDevice?.id, commands, expectedText: expectedText.trim(), points }
      ].slice(0, 24)
    }, "Activity Wizard 명령 출력 검증을 추가했습니다.");
  }

  function deleteCommandOutputAssertion(id: string) {
    updateActivity({ ...activity, commandOutputAssertions: (activity.commandOutputAssertions ?? []).filter((assertion) => assertion.id !== id) }, "Activity Wizard 명령 출력 검증을 삭제했습니다.");
  }

  function addInterfaceExpectation() {
    const deviceText = window.prompt("Device label/id", project.devices[0]?.label ?? "");
    if (deviceText === null) return;
    const device = project.devices.find((item) => [item.id, item.label, item.config.hostname].some((value) => value.toLowerCase() === deviceText.trim().toLowerCase()));
    if (!device) {
      window.alert("Device not found.");
      return;
    }
    const portText = window.prompt("Port name/id", device.ports.find((port) => port.kind !== "console")?.name ?? device.ports[0]?.name ?? "");
    if (portText === null) return;
    const port = device.ports.find((item) => item.id === portText.trim() || item.name.toLowerCase() === portText.trim().toLowerCase());
    if (!port) {
      window.alert("Port not found.");
      return;
    }
    const ipAddress = window.prompt("Expected IPv4 (blank = skip)", port.ipAddress);
    if (ipAddress === null) return;
    const subnetMask = window.prompt("Expected subnet mask (blank = skip)", port.subnetMask);
    if (subnetMask === null) return;
    const mode = window.prompt("Expected mode access/trunk/routed (blank = skip)", port.mode);
    if (mode === null) return;
    const vlanRaw = window.prompt("Expected VLAN (blank = skip)", port.mode === "access" ? String(port.vlan) : "");
    if (vlanRaw === null) return;
    const points = promptBoundedInteger("Points", 5, 1, 100);
    if (points === null) return;
    const modeText = mode.trim();
    const expectedMode: NetworkPort["mode"] | undefined = modeText === "access" || modeText === "trunk" || modeText === "routed" ? modeText : undefined;
    updateActivity({
      ...activity,
      interfaceExpectations: [
        ...(activity.interfaceExpectations ?? []),
        {
          id: createId("act_int"),
          label: `${device.label} ${port.name}`,
          deviceId: device.id,
          portId: port.id,
          ipAddress: ipAddress.trim() || undefined,
          subnetMask: subnetMask.trim() || undefined,
          mode: expectedMode,
          vlan: vlanRaw.trim() ? boundedNumber(vlanRaw, 1, 4094) : undefined,
          points
        }
      ].slice(0, 80)
    }, "Activity Wizard 인터페이스 기대값을 추가했습니다.");
  }

  function deleteInterfaceExpectation(id: string) {
    updateActivity({ ...activity, interfaceExpectations: (activity.interfaceExpectations ?? []).filter((expectation) => expectation.id !== id) }, "Activity Wizard 인터페이스 기대값을 삭제했습니다.");
  }

  function addHeaderAssertion() {
    const protocol = window.prompt("Protocol (blank = any)", "HTTP");
    if (protocol === null) return;
    const field = window.prompt("Header field", "Ports");
    if (field === null || !field.trim()) return;
    const value = window.prompt("Expected value", "80");
    if (value === null || !value.trim()) return;
    const points = promptBoundedInteger("Points", 5, 1, 100);
    if (points === null) return;
    updateActivity({
      ...activity,
      headerAssertions: [
        ...(activity.headerAssertions ?? []),
        { id: createId("act_hdr"), label: `${protocol.trim() || "Any"} ${field.trim()}=${value.trim()}`, protocol: protocol.trim().toUpperCase() || undefined, field: field.trim(), value: value.trim(), points }
      ].slice(0, 80)
    }, "Activity Wizard PDU 헤더 검증을 추가했습니다.");
  }

  function deleteHeaderAssertion(id: string) {
    updateActivity({ ...activity, headerAssertions: (activity.headerAssertions ?? []).filter((assertion) => assertion.id !== id) }, "Activity Wizard PDU 헤더 검증을 삭제했습니다.");
  }

  async function runActiveCliOutputAssertions() {
    const assertions = activity.commandOutputAssertions ?? [];
    if (!assertions.length) {
      setActiveCliMessage("재검증할 CLI 출력 검증 항목이 없습니다.");
      return;
    }
    setActiveCliRunning(true);
    setActiveCliMessage(`${cliEngine.kind === "remote" ? "Remote" : "Local"} CLI 엔진으로 출력 검증 중...`);
    try {
      const entries: Array<[string, ActivityCheck]> = [];
      for (const assertion of assertions) {
        const check = await assessActivityCommandOutputAssertionWithEngine(project, assertion);
        entries.push([check.id, check]);
      }
      setActiveCliChecks(Object.fromEntries(entries));
      setActiveCliMessage(`${cliEngine.kind === "remote" ? "Remote" : "Local"} CLI 엔진으로 출력 검증 ${entries.length}개를 갱신했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setActiveCliMessage(`CLI 출력 재검증 실패: ${message}`);
    } finally {
      setActiveCliRunning(false);
    }
  }

  function captureAnswerSnapshot() {
    updateActivity({ ...activity, answerSnapshot: captureActivityAnswerSnapshot(project) }, "Activity Wizard 정답 스냅샷을 캡처했습니다.");
  }

  function deleteAnswerSnapshot() {
    const { answerSnapshot: _answerSnapshot, ...rest } = activity;
    updateActivity(rest, "Activity Wizard 정답 스냅샷을 삭제했습니다.");
  }

  return (
    <section className="activity-wizard">
      <div className="activity-tabs" role="tablist" aria-label="Activity Wizard">
        <button className={tab === "instructions" ? "active" : ""} onClick={() => setTab("instructions")} role="tab" type="button">Instructions</button>
        <button className={tab === "check" ? "active" : ""} onClick={() => setTab("check")} role="tab" type="button">Check Results</button>
      </div>
      <div className="activity-summary">
        <div className={`activity-score ${activityScoreClass(assessment.score)}`}>
          <strong>{assessment.score}%</strong>
          <span>{assessment.earned}/{assessment.total} pts</span>
        </div>
        <div className="activity-stat-grid">
          <span className="pass"><strong>{assessment.passed}</strong> 통과</span>
          <span className="partial"><strong>{assessment.partial}</strong> 부분</span>
          <span className="fail"><strong>{assessment.failed}</strong> 실패</span>
          <span><strong>{assessment.todo}</strong> TODO</span>
        </div>
        {commandOutputAssertionCount > 0 && <button className="secondary-action" disabled={activeCliRunning} onClick={() => { void runActiveCliOutputAssertions(); }} type="button">{activeCliRunning ? "CLI 검증 중" : `CLI 엔진 재검증 (${cliEngine.kind})`}</button>}
        <button className="secondary-action" onClick={() => onExport(assessment)} type="button">TXT 내보내기</button>
        {activeCliMessage && <small className="activity-engine-note">{activeCliMessage}</small>}
      </div>
      {tab === "instructions" ? (
        <div className="activity-instructions">
          <header>
            <div>
              <strong>{activity.title || "Lab Objectives"}</strong>
              <small>Packet Tracer Activity Wizard 형식의 현재 프로젝트 목표입니다.</small>
            </div>
            <div className="activity-header-actions">
              <button onClick={editActivityTitle} type="button">제목</button>
              <button onClick={addActivityObjective} type="button">목표 추가</button>
            </div>
          </header>
          <ol>
            {objectives.map((objective, index) => (
              <li key={`${objective}:${index}`}>
                <span>{objective}</span>
                {activity.objectives.length > 0 && <button onClick={() => deleteActivityObjective(index)} type="button">삭제</button>}
              </li>
            ))}
          </ol>
          <section className="activity-authoring">
            <header>
              <div>
                <strong>Instructor Criteria</strong>
                <small>{activity.requirements.length} stored requirements{activity.answerSnapshot ? " / answer snapshot saved" : ""}</small>
              </div>
              <div className="activity-header-actions">
                <button onClick={addCommandRule} type="button">명령 규칙</button>
                <button onClick={addCommandSequence} type="button">명령 순서</button>
                <button onClick={addCommandOutputAssertion} type="button">출력 검증</button>
                <button onClick={addInterfaceExpectation} type="button">인터페이스</button>
                <button onClick={addHeaderAssertion} type="button">헤더 검증</button>
                <button onClick={captureAnswerSnapshot} type="button">정답 캡처</button>
                {activity.answerSnapshot && <button onClick={deleteAnswerSnapshot} type="button">정답 삭제</button>}
              </div>
            </header>
            <div className="activity-requirement-tools">
              {activityRequirementCatalog.map((item) => (
                <button key={item.kind} onClick={() => addActivityRequirement(item.kind)} title={item.detail} type="button">{item.label}</button>
              ))}
            </div>
            {activity.requirements.length > 0 ? (
              <div className="activity-requirement-list">
                {activity.requirements.map((requirement) => {
                  const current = activityRequirementCurrentValue(project, requirement.kind);
                  return (
                    <div key={requirement.id}>
                      <span>{activityStatusLabel(current >= requirement.target ? "pass" : current > 0 ? "partial" : "fail")}</span>
                      <div>
                        <strong>{requirement.label || activityRequirementKindLabel(requirement.kind)}</strong>
                        <small>{activityRequirementKindLabel(requirement.kind)}: {current}/{requirement.target} · {requirement.points} pts</small>
                      </div>
                      <button onClick={() => deleteActivityRequirement(requirement.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="activity-note">
                <strong>TODO</strong>
                <span>강사 기준이 비어 있습니다. 위 항목으로 현재 프로젝트에 저장될 채점 요구사항을 추가합니다.</span>
              </div>
            )}
            {activity.answerSnapshot && (
              <div className="activity-snapshot-summary">
                <strong>Answer Snapshot</strong>
                <span>{new Date(activity.answerSnapshot.capturedAt).toLocaleString()} · 장비 {activity.answerSnapshot.devices.length} · 링크 {activity.answerSnapshot.links.length} · 주석 {activity.answerSnapshot.annotationCount}</span>
              </div>
            )}
            {(activity.commandRules ?? []).length > 0 && (
              <div className="activity-requirement-list">
                {(activity.commandRules ?? []).map((rule) => {
                  const matched = activityCommandRuleMatched(project, rule);
                  return (
                    <div key={rule.id}>
                      <span>{activityStatusLabel(matched ? "pass" : "fail")}</span>
                      <div>
                        <strong>{rule.label || rule.command}</strong>
                        <small>{rule.deviceId ? eventDeviceLabel(project, rule.deviceId) : "Any device"} · {rule.command} · {rule.points} pts</small>
                      </div>
                      <button onClick={() => deleteCommandRule(rule.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
            {(activity.commandSequences ?? []).length > 0 && (
              <div className="activity-requirement-list">
                {(activity.commandSequences ?? []).map((sequence) => {
                  const check = assessActivityCommandSequence(project, sequence);
                  return (
                    <div key={sequence.id}>
                      <span>{activityStatusLabel(check.status)}</span>
                      <div>
                        <strong>{sequence.label}</strong>
                        <small>{check.detail} · {sequence.points} pts</small>
                      </div>
                      <button onClick={() => deleteCommandSequence(sequence.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
            {(activity.commandOutputAssertions ?? []).length > 0 && (
              <div className="activity-requirement-list">
                {(activity.commandOutputAssertions ?? []).map((assertion) => {
                  const check = activeCliChecks[`command-output-${assertion.id}`] ?? assessActivityCommandOutputAssertion(project, assertion);
                  return (
                    <div key={assertion.id}>
                      <span>{activityStatusLabel(check.status)}</span>
                      <div>
                        <strong>{assertion.label}</strong>
                        <small>{check.detail} · {assertion.points} pts</small>
                      </div>
                      <button onClick={() => deleteCommandOutputAssertion(assertion.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
            {(activity.interfaceExpectations ?? []).length > 0 && (
              <div className="activity-requirement-list">
                {(activity.interfaceExpectations ?? []).map((expectation) => {
                  const check = assessActivityInterfaceExpectation(project, expectation);
                  return (
                    <div key={expectation.id}>
                      <span>{activityStatusLabel(check.status)}</span>
                      <div>
                        <strong>{expectation.label}</strong>
                        <small>{check.detail} · {expectation.points} pts</small>
                      </div>
                      <button onClick={() => deleteInterfaceExpectation(expectation.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
            {(activity.headerAssertions ?? []).length > 0 && (
              <div className="activity-requirement-list">
                {(activity.headerAssertions ?? []).map((assertion) => {
                  const check = assessActivityHeaderAssertion(project, assertion);
                  return (
                    <div key={assertion.id}>
                      <span>{activityStatusLabel(check.status)}</span>
                      <div>
                        <strong>{assertion.label}</strong>
                        <small>{check.detail} · {assertion.points} pts</small>
                      </div>
                      <button onClick={() => deleteHeaderAssertion(assertion.id)} type="button">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <div className="activity-note">
            <strong>TODO</strong>
            <span>브라우저 자동 테스트와 시각 회귀 기준선은 TODO입니다. 현재 버전은 정답 스냅샷, 저장된 요구사항, 활성 CLI 엔진 출력, 인터페이스, PDU 헤더, TDR 기준을 함께 점검합니다.</span>
          </div>
        </div>
      ) : (
        <div className="activity-check-results">
          <header>
            <div>
              <strong>Assessment Items</strong>
              <small>{project.devices.length} devices, {project.links.length} links, {project.simulationEvents.length} events</small>
            </div>
            <button disabled={!canRunPingSweep} onClick={onRunPingSweep} type="button">선택 장비 전체 Ping</button>
          </header>
          {blockers.length > 0 && (
            <div className="activity-blockers">
              <strong>미해결 실패 항목</strong>
              {blockers.map((check) => <span key={check.id}>{check.label}: {check.detail}</span>)}
            </div>
          )}
          {groupedChecks.map(([category, checks]) => (
            <div className="activity-category" key={category}>
              <h3>{category}</h3>
              {checks.map((check) => (
                <div className={`activity-check-row ${check.status}`} key={check.id}>
                  <span>{activityStatusLabel(check.status)}</span>
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                  <em>{check.earned}/{check.points}</em>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function assessActivity(project: NetworkProject): ActivityAssessment {
  const issues = diagnoseProject(project);
  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  const validLinks = project.links.filter((link) => linkEndpointPair(project, link));
  const upLinks = project.links.filter((link) => link.status === "up");
  const poweredDevices = project.devices.filter((device) => device.powerOn);
  const hostPorts = project.devices
    .filter((device) => device.kind === "pc" || device.kind === "server")
    .flatMap((device) => device.ports.filter((port) => port.kind !== "console").map((port) => ({ device, port })));
  const addressedHostPorts = hostPorts.filter(({ port }) => isIpv4(port.ipAddress) && isSubnetMask(port.subnetMask) && maskToPrefix(port.subnetMask) > 0);
  const serviceDevices = project.devices.filter((device) => enabledServices(device).length > 0);
  const reachableServiceDevices = serviceDevices.filter((device) => device.powerOn && device.ports.some((port) => port.adminUp && isIpv4(port.ipAddress)));
  const networkDevices = project.devices.filter((device) => device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless");
  const savedNetworkDevices = networkDevices.filter((device) => device.config.startupConfig.length > 0);
  const deliveredEvents = project.simulationEvents.filter((event) => event.status === "delivered");
  const droppedEvents = project.simulationEvents.filter((event) => event.status === "dropped");
  const workspaceAnnotations = (project.notes ?? []).length + (project.drawings ?? []).length;
  const authoredChecks = (project.activity?.requirements ?? []).map((requirement) => assessActivityRequirement(project, requirement));
  const answerSnapshotChecks = project.activity?.answerSnapshot ? assessActivityAnswerSnapshot(project, project.activity.answerSnapshot) : [];
  const commandRuleChecks = (project.activity?.commandRules ?? []).map((rule) => assessActivityCommandRule(project, rule));
  const commandSequenceChecks = (project.activity?.commandSequences ?? []).map((sequence) => assessActivityCommandSequence(project, sequence));
  const commandOutputChecks = (project.activity?.commandOutputAssertions ?? []).map((assertion) => assessActivityCommandOutputAssertion(project, assertion));
  const interfaceExpectationChecks = (project.activity?.interfaceExpectations ?? []).map((expectation) => assessActivityInterfaceExpectation(project, expectation));
  const headerAssertionChecks = (project.activity?.headerAssertions ?? []).map((assertion) => assessActivityHeaderAssertion(project, assertion));

  const checks: ActivityCheck[] = [
    makeActivityCheck(
      "topology-devices",
      "Topology",
      "필수 장비 배치",
      project.devices.length >= 2 ? `${project.devices.length}개 장비가 배치되었습니다.` : `${project.devices.length}개 장비만 배치되었습니다.`,
      project.devices.length >= 2 ? "pass" : project.devices.length === 1 ? "partial" : "fail",
      10,
      project.devices.length >= 2 ? 10 : project.devices.length === 1 ? 4 : 0
    ),
    makeActivityCheck(
      "topology-links",
      "Topology",
      "케이블 끝점 무결성",
      project.links.length === 0 ? "케이블이 없습니다." : `${validLinks.length}/${project.links.length}개 케이블 끝점이 유효합니다.`,
      project.links.length > 0 && validLinks.length === project.links.length ? "pass" : validLinks.length > 0 ? "partial" : "fail",
      10,
      project.links.length > 0 && validLinks.length === project.links.length ? 10 : validLinks.length > 0 ? 5 : 0
    ),
    makeActivityCheck(
      "topology-link-state",
      "Topology",
      "링크 상태",
      project.links.length === 0 ? "up 상태로 검증할 링크가 없습니다." : `${upLinks.length}/${project.links.length}개 링크가 up 상태입니다.`,
      project.links.length > 0 && upLinks.length === project.links.length ? "pass" : upLinks.length > 0 ? "partial" : "fail",
      15,
      project.links.length > 0 && upLinks.length === project.links.length ? 15 : Math.round((upLinks.length / Math.max(1, project.links.length)) * 10)
    ),
    makeActivityCheck(
      "physical-power",
      "Physical",
      "장비 전원",
      project.devices.length === 0 ? "전원을 확인할 장비가 없습니다." : `${poweredDevices.length}/${project.devices.length}개 장비 전원이 켜져 있습니다.`,
      project.devices.length > 0 && poweredDevices.length === project.devices.length ? "pass" : poweredDevices.length > 0 ? "partial" : "fail",
      10,
      project.devices.length > 0 && poweredDevices.length === project.devices.length ? 10 : Math.round((poweredDevices.length / Math.max(1, project.devices.length)) * 6)
    ),
    makeActivityCheck(
      "workspace-annotations",
      "Documentation",
      "작업공간 주석",
      workspaceAnnotations > 0 ? `메모/도형 ${workspaceAnnotations}개가 배치되었습니다.` : "메모 또는 도형 주석이 없습니다.",
      workspaceAnnotations > 0 ? "pass" : "todo",
      5,
      workspaceAnnotations > 0 ? 5 : 0
    ),
    ...authoredChecks,
    ...answerSnapshotChecks,
    ...commandRuleChecks,
    ...commandSequenceChecks,
    ...commandOutputChecks,
    ...interfaceExpectationChecks,
    ...headerAssertionChecks,
    makeActivityCheck(
      "addressing-hosts",
      "Addressing",
      "호스트 IPv4 설정",
      hostPorts.length === 0 ? "PC/서버 데이터 포트가 없습니다." : `${addressedHostPorts.length}/${hostPorts.length}개 호스트 포트에 유효한 IPv4/mask가 있습니다.`,
      hostPorts.length > 0 && addressedHostPorts.length === hostPorts.length ? "pass" : addressedHostPorts.length > 0 ? "partial" : "fail",
      15,
      hostPorts.length > 0 && addressedHostPorts.length === hostPorts.length ? 15 : Math.round((addressedHostPorts.length / Math.max(1, hostPorts.length)) * 8)
    ),
    makeActivityCheck(
      "addressing-diagnostics",
      "Addressing",
      "주소/구성 오류",
      errors === 0 ? `오류 0개, 경고 ${warnings}개입니다.` : `진단 오류 ${errors}개, 경고 ${warnings}개가 남아 있습니다.`,
      errors === 0 && warnings === 0 ? "pass" : errors === 0 ? "partial" : "fail",
      15,
      errors === 0 && warnings === 0 ? 15 : errors === 0 ? 10 : 0
    ),
    makeActivityCheck(
      "services-reachable",
      "Services",
      "서비스 도달성 준비",
      serviceDevices.length === 0 ? "활성화된 서버 서비스가 없습니다." : `${reachableServiceDevices.length}/${serviceDevices.length}개 서비스 장비에 활성 IPv4가 있습니다.`,
      serviceDevices.length === 0 ? "todo" : reachableServiceDevices.length === serviceDevices.length ? "pass" : reachableServiceDevices.length > 0 ? "partial" : "fail",
      10,
      serviceDevices.length === 0 ? 0 : reachableServiceDevices.length === serviceDevices.length ? 10 : Math.round((reachableServiceDevices.length / Math.max(1, serviceDevices.length)) * 6)
    ),
    makeActivityCheck(
      "simulation-delivered",
      "Simulation",
      "PDU 전달 검증",
      project.simulationEvents.length === 0 ? "아직 캡처된 PDU 이벤트가 없습니다." : `전달 ${deliveredEvents.length}개, 드롭 ${droppedEvents.length}개 이벤트가 있습니다.`,
      deliveredEvents.length > 0 && droppedEvents.length === 0 ? "pass" : deliveredEvents.length > 0 ? "partial" : "fail",
      10,
      deliveredEvents.length > 0 && droppedEvents.length === 0 ? 10 : deliveredEvents.length > 0 ? 6 : 0
    ),
    makeActivityCheck(
      "startup-config",
      "CLI",
      "Startup-config 저장",
      networkDevices.length === 0 ? "저장할 네트워크 장비가 없습니다." : `${savedNetworkDevices.length}/${networkDevices.length}개 네트워크 장비에 startup-config가 있습니다.`,
      networkDevices.length === 0 ? "todo" : savedNetworkDevices.length === networkDevices.length ? "pass" : savedNetworkDevices.length > 0 ? "partial" : "fail",
      5,
      networkDevices.length === 0 ? 0 : savedNetworkDevices.length === networkDevices.length ? 5 : savedNetworkDevices.length > 0 ? 3 : 0
    )
  ];
  return summarizeActivityChecks(checks);
}

function makeActivityCheck(id: string, category: string, label: string, detail: string, status: ActivityCheckStatus, points: number, earned: number): ActivityCheck {
  return { id, category, label, detail, status, points, earned: Math.max(0, Math.min(points, earned)) };
}

function mergeActivityAssessment(assessment: ActivityAssessment, replacements: Record<string, ActivityCheck>): ActivityAssessment {
  const entries = Object.entries(replacements);
  if (!entries.length) return assessment;
  const replacementMap = new Map(entries);
  return summarizeActivityChecks(assessment.checks.map((check) => replacementMap.get(check.id) ?? check));
}

function summarizeActivityChecks(checks: ActivityCheck[]): ActivityAssessment {
  const scoredChecks = checks.filter((check) => check.status !== "todo");
  const earned = scoredChecks.reduce((sum, check) => sum + check.earned, 0);
  const total = scoredChecks.reduce((sum, check) => sum + check.points, 0);
  return {
    checks,
    earned,
    total,
    score: total ? Math.round((earned / total) * 100) : 0,
    passed: checks.filter((check) => check.status === "pass").length,
    partial: checks.filter((check) => check.status === "partial").length,
    failed: checks.filter((check) => check.status === "fail").length,
    todo: checks.filter((check) => check.status === "todo").length
  };
}

function captureActivityAnswerSnapshot(project: NetworkProject): NonNullable<NonNullable<NetworkProject["activity"]>["answerSnapshot"]> {
  return {
    capturedAt: new Date().toISOString(),
    devices: project.devices.map((device) => ({ id: device.id, label: device.label, kind: device.kind, model: device.model })),
    links: project.links.map((link) => ({ id: link.id, type: link.type, endpointADeviceId: link.endpointA.deviceId, endpointBDeviceId: link.endpointB.deviceId })),
    annotationCount: (project.notes ?? []).length + (project.drawings ?? []).length,
    serviceDeviceIds: project.devices.filter((device) => enabledServices(device).length > 0).map((device) => device.id),
    startupConfigDeviceIds: project.devices.filter((device) => device.config.startupConfig.length > 0).map((device) => device.id)
  };
}

function assessActivityAnswerSnapshot(project: NetworkProject, snapshot: NonNullable<NonNullable<NetworkProject["activity"]>["answerSnapshot"]>): ActivityCheck[] {
  const expectedDeviceIds = new Set(snapshot.devices.map((device) => device.id));
  const matchedDevices = snapshot.devices.filter((expected) => project.devices.some((device) => device.id === expected.id && device.kind === expected.kind && device.model === expected.model)).length;
  const extraDevices = project.devices.filter((device) => !expectedDeviceIds.has(device.id)).length;
  const deviceTarget = Math.max(1, snapshot.devices.length + extraDevices);
  const deviceEarned = snapshot.devices.length === 0 && extraDevices === 0 ? 10 : Math.round((matchedDevices / deviceTarget) * 10);

  const expectedLinkKeys = new Set(snapshot.links.map((link) => activitySnapshotLinkKey(link.endpointADeviceId, link.endpointBDeviceId, link.type)));
  const currentLinkKeys = new Set(project.links.map((link) => activitySnapshotLinkKey(link.endpointA.deviceId, link.endpointB.deviceId, link.type)));
  const matchedLinks = Array.from(expectedLinkKeys).filter((key) => currentLinkKeys.has(key)).length;
  const extraLinks = Array.from(currentLinkKeys).filter((key) => !expectedLinkKeys.has(key)).length;
  const linkTarget = Math.max(1, expectedLinkKeys.size + extraLinks);
  const linkEarned = expectedLinkKeys.size === 0 && extraLinks === 0 ? 10 : Math.round((matchedLinks / linkTarget) * 10);

  const currentAnnotationCount = (project.notes ?? []).length + (project.drawings ?? []).length;
  const currentServiceIds = new Set(project.devices.filter((device) => enabledServices(device).length > 0).map((device) => device.id));
  const currentStartupIds = new Set(project.devices.filter((device) => device.config.startupConfig.length > 0).map((device) => device.id));
  const matchedServices = snapshot.serviceDeviceIds.filter((id) => currentServiceIds.has(id)).length;
  const matchedStartup = snapshot.startupConfigDeviceIds.filter((id) => currentStartupIds.has(id)).length;

  return [
    makeActivityCheck(
      "answer-devices",
      "Answer Snapshot",
      "정답 장비 일치",
      `장비 ${matchedDevices}/${snapshot.devices.length}개 일치, 추가 ${extraDevices}개`,
      matchedDevices === snapshot.devices.length && extraDevices === 0 ? "pass" : matchedDevices > 0 ? "partial" : "fail",
      10,
      deviceEarned
    ),
    makeActivityCheck(
      "answer-links",
      "Answer Snapshot",
      "정답 링크 일치",
      `링크 ${matchedLinks}/${expectedLinkKeys.size}개 일치, 추가 ${extraLinks}개`,
      matchedLinks === expectedLinkKeys.size && extraLinks === 0 ? "pass" : matchedLinks > 0 ? "partial" : "fail",
      10,
      linkEarned
    ),
    makeActivityCheck(
      "answer-annotations",
      "Answer Snapshot",
      "정답 주석 수",
      `주석 ${currentAnnotationCount}/${snapshot.annotationCount}개`,
      currentAnnotationCount >= snapshot.annotationCount ? "pass" : currentAnnotationCount > 0 ? "partial" : "fail",
      5,
      snapshot.annotationCount === 0 ? 5 : Math.round((Math.min(currentAnnotationCount, snapshot.annotationCount) / snapshot.annotationCount) * 5)
    ),
    makeActivityCheck(
      "answer-services",
      "Answer Snapshot",
      "정답 서비스 장비",
      `서비스 장비 ${matchedServices}/${snapshot.serviceDeviceIds.length}개`,
      matchedServices === snapshot.serviceDeviceIds.length ? "pass" : matchedServices > 0 ? "partial" : "fail",
      5,
      snapshot.serviceDeviceIds.length === 0 ? 5 : Math.round((matchedServices / snapshot.serviceDeviceIds.length) * 5)
    ),
    makeActivityCheck(
      "answer-startup-config",
      "Answer Snapshot",
      "정답 startup-config",
      `startup-config ${matchedStartup}/${snapshot.startupConfigDeviceIds.length}개`,
      matchedStartup === snapshot.startupConfigDeviceIds.length ? "pass" : matchedStartup > 0 ? "partial" : "fail",
      5,
      snapshot.startupConfigDeviceIds.length === 0 ? 5 : Math.round((matchedStartup / snapshot.startupConfigDeviceIds.length) * 5)
    )
  ];
}

function activitySnapshotLinkKey(aDeviceId: string, bDeviceId: string, type: CableType): string {
  return [aDeviceId, bDeviceId].sort().join("<->") + `:${type}`;
}

function assessActivityCommandRule(project: NetworkProject, rule: NonNullable<NonNullable<NetworkProject["activity"]>["commandRules"]>[number]): ActivityCheck {
  const matched = activityCommandRuleMatched(project, rule);
  const deviceLabel = rule.deviceId ? eventDeviceLabel(project, rule.deviceId) : "Any device";
  return makeActivityCheck(
    `command-rule-${rule.id}`,
    "Command Rules",
    rule.label || rule.command,
    matched ? `${deviceLabel} startup-config contains "${rule.command}"` : `${deviceLabel} startup-config missing "${rule.command}"`,
    matched ? "pass" : "fail",
    rule.points,
    matched ? rule.points : 0
  );
}

function activityCommandRuleMatched(project: NetworkProject, rule: NonNullable<NonNullable<NetworkProject["activity"]>["commandRules"]>[number]): boolean {
  const expected = normalizeCommandRuleText(rule.command);
  if (!expected) return false;
  const devices = rule.deviceId ? project.devices.filter((device) => device.id === rule.deviceId) : project.devices;
  return devices.some((device) => device.config.startupConfig.some((line) => normalizeCommandRuleText(line).includes(expected)));
}

function normalizeCommandRuleText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function assessActivityCommandSequence(project: NetworkProject, sequence: NonNullable<NonNullable<NetworkProject["activity"]>["commandSequences"]>[number]): ActivityCheck {
  const devices = sequence.deviceId ? project.devices.filter((device) => device.id === sequence.deviceId) : project.devices;
  const best = devices.reduce((bestMatch, device) => Math.max(bestMatch, orderedCommandMatchCount(device.config.startupConfig, sequence.commands)), 0);
  const total = Math.max(1, sequence.commands.length);
  const deviceLabel = sequence.deviceId ? eventDeviceLabel(project, sequence.deviceId) : "Any device";
  return makeActivityCheck(
    `command-sequence-${sequence.id}`,
    "Command Rules",
    sequence.label,
    `${deviceLabel}: ordered commands ${best}/${sequence.commands.length}`,
    best === sequence.commands.length ? "pass" : best > 0 ? "partial" : "fail",
    sequence.points,
    Math.round((best / total) * sequence.points)
  );
}

function orderedCommandMatchCount(startupConfig: string[], commands: string[]): number {
  const lines = startupConfig.map(normalizeCommandRuleText);
  let cursor = 0;
  let matched = 0;
  for (const command of commands.map(normalizeCommandRuleText)) {
    const index = lines.findIndex((line, lineIndex) => lineIndex >= cursor && line.includes(command));
    if (index < 0) break;
    matched += 1;
    cursor = index + 1;
  }
  return matched;
}

function assessActivityCommandOutputAssertion(project: NetworkProject, assertion: NonNullable<NonNullable<NetworkProject["activity"]>["commandOutputAssertions"]>[number]): ActivityCheck {
  const devices = assertion.deviceId ? project.devices.filter((device) => device.id === assertion.deviceId) : project.devices;
  const expected = assertion.expectedText.trim().toLowerCase();
  const matched = devices.some((device) => runActivityCliCommands(device, assertion.commands).toLowerCase().includes(expected));
  const deviceLabel = assertion.deviceId ? eventDeviceLabel(project, assertion.deviceId) : "Any device";
  return makeActivityCheck(
    `command-output-${assertion.id}`,
    "Command Rules",
    assertion.label,
    matched ? `${deviceLabel}: CLI output contains "${assertion.expectedText}"` : `${deviceLabel}: CLI output missing "${assertion.expectedText}"`,
    matched ? "pass" : "fail",
    assertion.points,
    matched ? assertion.points : 0
  );
}

async function assessActivityCommandOutputAssertionWithEngine(project: NetworkProject, assertion: NonNullable<NonNullable<NetworkProject["activity"]>["commandOutputAssertions"]>[number]): Promise<ActivityCheck> {
  const devices = assertion.deviceId ? project.devices.filter((device) => device.id === assertion.deviceId) : project.devices;
  const expected = assertion.expectedText.trim().toLowerCase();
  let matched = false;
  for (const device of devices) {
    const output = await runActivityCliCommandsWithEngine(device, assertion.commands);
    if (output.toLowerCase().includes(expected)) {
      matched = true;
      break;
    }
  }
  const deviceLabel = assertion.deviceId ? eventDeviceLabel(project, assertion.deviceId) : "Any device";
  const engine = cliEngine.kind === "remote" ? "Remote CLI" : "Local CLI";
  return makeActivityCheck(
    `command-output-${assertion.id}`,
    "Command Rules",
    assertion.label,
    matched ? `${engine} ${deviceLabel}: CLI output contains "${assertion.expectedText}"` : `${engine} ${deviceLabel}: CLI output missing "${assertion.expectedText}"`,
    matched ? "pass" : "fail",
    assertion.points,
    matched ? assertion.points : 0
  );
}

function runActivityCliCommands(sourceDevice: NetworkDevice, commands: string[]): string {
  let device = sourceDevice;
  let session = initialCliSession();
  const output: string[] = [];
  for (const command of commands) {
    const result = runCliCommand(device, session, command);
    device = result.device;
    session = result.session;
    output.push(result.output || "");
  }
  return output.join("\n");
}

async function runActivityCliCommandsWithEngine(sourceDevice: NetworkDevice, commands: string[]): Promise<string> {
  let device = sourceDevice;
  let session = cliEngine.initialSession();
  const output: string[] = [];
  for (const command of commands) {
    const result = await cliEngine.run(device, session, command);
    device = result.device;
    session = result.session;
    output.push(result.output || "");
  }
  return output.join("\n");
}

function assessActivityInterfaceExpectation(project: NetworkProject, expectation: NonNullable<NonNullable<NetworkProject["activity"]>["interfaceExpectations"]>[number]): ActivityCheck {
  const device = project.devices.find((item) => item.id === expectation.deviceId);
  const port = device?.ports.find((item) => item.id === expectation.portId);
  if (!device || !port) {
    return makeActivityCheck(`interface-expectation-${expectation.id}`, "Interface Expectations", expectation.label, "대상 장비 또는 포트가 없습니다.", "fail", expectation.points, 0);
  }
  const expected = [
    expectation.ipAddress ? { label: "IP", ok: port.ipAddress === expectation.ipAddress, value: `${port.ipAddress || "-"}=${expectation.ipAddress}` } : null,
    expectation.subnetMask ? { label: "Mask", ok: port.subnetMask === expectation.subnetMask, value: `${port.subnetMask || "-"}=${expectation.subnetMask}` } : null,
    expectation.mode ? { label: "Mode", ok: port.mode === expectation.mode, value: `${port.mode}=${expectation.mode}` } : null,
    expectation.vlan ? { label: "VLAN", ok: port.vlan === expectation.vlan, value: `${port.vlan}=${expectation.vlan}` } : null
  ].filter((item): item is { label: string; ok: boolean; value: string } => Boolean(item));
  const matched = expected.filter((item) => item.ok).length;
  const total = Math.max(1, expected.length);
  return makeActivityCheck(
    `interface-expectation-${expectation.id}`,
    "Interface Expectations",
    expectation.label || `${device.label} ${port.name}`,
    expected.length ? `${device.label} ${port.name}: ${expected.map((item) => `${item.label} ${item.value}`).join(", ")}` : `${device.label} ${port.name}: 기대값 없음`,
    matched === total ? "pass" : matched > 0 ? "partial" : "fail",
    expectation.points,
    Math.round((matched / total) * expectation.points)
  );
}

function assessActivityHeaderAssertion(project: NetworkProject, assertion: NonNullable<NonNullable<NetworkProject["activity"]>["headerAssertions"]>[number]): ActivityCheck {
  const protocol = assertion.protocol?.trim().toUpperCase();
  const field = assertion.field.trim().toLowerCase();
  const value = assertion.value.trim().toLowerCase();
  const matchingEvent = project.simulationEvents.find((event) =>
    (!protocol || event.type.toUpperCase() === protocol) &&
    pduHeaderRowsFor(project, event).some((header) => header.field.toLowerCase() === field && header.value.toLowerCase().includes(value))
  );
  return makeActivityCheck(
    `header-assertion-${assertion.id}`,
    "PDU Header Assertions",
    assertion.label || `${assertion.field}=${assertion.value}`,
    matchingEvent ? `일치 이벤트: ${matchingEvent.type} ${(matchingEvent.packetId ?? matchingEvent.id).slice(-10)}` : `${protocol || "Any"} ${assertion.field}=${assertion.value} 헤더가 없습니다.`,
    matchingEvent ? "pass" : "fail",
    assertion.points,
    matchingEvent ? assertion.points : 0
  );
}

function assessActivityRequirement(project: NetworkProject, requirement: NonNullable<NetworkProject["activity"]>["requirements"][number]): ActivityCheck {
  const current = activityRequirementCurrentValue(project, requirement.kind);
  const target = Math.max(1, requirement.target);
  const points = Math.max(1, requirement.points);
  const ratio = Math.min(1, current / target);
  const status: ActivityCheckStatus = current >= target ? "pass" : current > 0 ? "partial" : "fail";
  return makeActivityCheck(
    `activity-${requirement.id}`,
    "Instructor Criteria",
    requirement.label || activityRequirementKindLabel(requirement.kind),
    `${activityRequirementKindLabel(requirement.kind)} ${current}/${target}`,
    status,
    points,
    Math.round(points * ratio)
  );
}

function activityRequirementCurrentValue(project: NetworkProject, kind: ActivityRequirementKind): number {
  if (kind === "device-count") return project.devices.length;
  if (kind === "link-count") return project.links.length;
  if (kind === "annotation-count") return (project.notes ?? []).length + (project.drawings ?? []).length;
  if (kind === "delivered-pdu-count") return project.simulationEvents.filter((event) => event.status === "delivered").length;
  if (kind === "saved-config-count") {
    return project.devices.filter((device) => (device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless") && device.config.startupConfig.length > 0).length;
  }
  if (kind === "tdr-normal-count") return project.links.filter((link) => linkCableDiagnosticSummary(project, link).summary === "TDR Normal/Normal").length;
  return project.devices.filter((device) => enabledServices(device).length > 0).length;
}

function activityRequirementKindLabel(kind: ActivityRequirementKind): string {
  return activityRequirementCatalog.find((item) => item.kind === kind)?.label ?? kind;
}

function defaultActivityObjectives(): string[] {
  return [
    "라우터, 스위치, PC/서버를 배치하고 모든 링크를 up 상태로 유지합니다.",
    "메모와 도형으로 서버 영역, VLAN 범위, 시험 TODO 같은 작업공간 주석을 남깁니다.",
    "호스트와 라우팅 장비의 IPv4 주소, subnet mask, gateway, DNS를 일관되게 설정합니다.",
    "DHCP, DNS, HTTP, FTP, EMAIL, TFTP, SYSLOG 같은 서버 서비스를 켜고 도달성을 확인합니다.",
    "Simple PDU, Complex PDU, Desktop 명령, CLI ping/traceroute로 패킷 흐름을 검증합니다.",
    "Physical 탭과 TDR 명령으로 구리 케이블 상태를 점검합니다.",
    "네트워크 장비의 running-config를 startup-config에 저장합니다."
  ];
}

function promptBoundedInteger(title: string, initialValue: number, min: number, max: number): number | null {
  const raw = window.prompt(title, String(initialValue));
  if (raw === null) return null;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function activityStatusLabel(status: ActivityCheckStatus): string {
  return ({ pass: "통과", partial: "부분", fail: "실패", todo: "TODO" })[status];
}

function activityScoreClass(score: number): string {
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
}

function activityReportLines(project: NetworkProject, assessment = assessActivity(project)): string[] {
  return [
    "Network Editor Web Activity Wizard Check Results",
    `Project: ${project.name}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    `Score: ${assessment.score}% (${assessment.earned}/${assessment.total} pts)`,
    `Passed: ${assessment.passed}, Partial: ${assessment.partial}, Failed: ${assessment.failed}, TODO: ${assessment.todo}`,
    "",
    "Assessment Items",
    ...assessment.checks.map((check) => `- [${activityStatusLabel(check.status)}] ${check.category} / ${check.label}: ${check.detail} (${check.earned}/${check.points})`),
    "",
    "TODO",
    "- Add browser-driven checks for live CLI responses and Activity Wizard active CLI engine output assertion UI.",
    "- Add browser visual regression coverage for Activity Wizard authoring panels."
  ];
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
        <button className="icon-button" onClick={() => setMaximized((value) => !value)} title={maximized ? "창 복원" : "창 최대화"} type="button">{maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" onClick={onClose} title="창 닫기" type="button"><X size={17} /></button>
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
  onDuplicate,
  onConnect,
  onComplexPdu,
  onPdu,
  onRename,
  onTogglePower,
  onDelete
}: {
  device: NetworkDevice | null;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (deviceId: string, tab?: DeviceTab) => void;
  onDuplicate: (deviceId: string) => void;
  onConnect: (deviceId: string) => void;
  onComplexPdu: (deviceId: string) => void;
  onPdu: (deviceId: string) => void;
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
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 268));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 420));

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="device-context-menu rich-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <header>
        <DeviceIcon kind={device.kind} size={18} />
        <div>
          <strong>{device.label}</strong>
          <span>{device.model}</span>
        </div>
      </header>
      <div className="context-menu-section">
        <small>열기</small>
        <button onClick={() => run(() => onOpen(device.id))} type="button"><Settings size={15} />검사 창</button>
        {tabs.includes("physical") && <button onClick={() => run(() => onOpen(device.id, "physical"))} type="button"><Cpu size={15} />물리</button>}
        {tabs.includes("config") && <button onClick={() => run(() => onOpen(device.id, "config"))} type="button"><Wrench size={15} />설정</button>}
        {tabs.includes("cli") && <button onClick={() => run(() => onOpen(device.id, "cli"))} type="button"><Terminal size={15} />CLI</button>}
        {tabs.includes("desktop") && <button onClick={() => run(() => onOpen(device.id, "desktop"))} type="button"><Monitor size={15} />데스크톱</button>}
        {tabs.includes("services") && <button onClick={() => run(() => onOpen(device.id, "services"))} type="button"><Server size={15} />서비스</button>}
      </div>
      <div className="context-menu-section">
        <small>수정</small>
        <button onClick={() => run(() => onRename(device.id))} type="button"><Edit3 size={15} />이름 변경</button>
        <button onClick={() => run(() => onDuplicate(device.id))} type="button"><Copy size={15} />복제</button>
      </div>
      <div className="context-menu-section">
        <small>작업</small>
        <button onClick={() => run(() => onConnect(device.id))} type="button"><Cable size={15} />자동 케이블 연결 시작</button>
        <button onClick={() => run(() => onPdu(device.id))} type="button"><Mail size={15} />Simple PDU 보내기</button>
        <button onClick={() => run(() => onComplexPdu(device.id))} type="button"><Plus size={15} />Complex PDU 보내기</button>
        <button onClick={() => run(() => onTogglePower(device.id))} type="button"><Power size={15} />{device.powerOn ? "전원 끄기" : "전원 켜기"}</button>
      </div>
      <div className="context-menu-section danger-zone">
        <button className="danger" onClick={() => run(() => onDelete(device.id))} type="button"><Trash2 size={15} />장비 삭제</button>
      </div>
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
  onFit,
  onLogical,
  onPhysical,
  onPlaceModel,
  onArrange,
  onPhysicalArrange,
  onNote,
  onDrawing,
  onRepair
}: {
  x: number;
  y: number;
  mode: "logical" | "physical";
  onClose: () => void;
  onSelect: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onLogical: () => void;
  onPhysical: () => void;
  onPlaceModel: (modelId: string) => void;
  onArrange: () => void;
  onPhysicalArrange: () => void;
  onNote: () => void;
  onDrawing: (kind: WorkspaceDrawingKind) => void;
  onRepair: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const quickModels = quickWorkspaceModelIds
    .map((modelId) => deviceCatalog.find((model) => model.id === modelId))
    .filter((model): model is NonNullable<typeof model> => Boolean(model));
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 268));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 430));

  return (
    <div className="device-context-menu workspace-context-menu rich-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <header>
        <Network size={18} />
        <div>
          <strong>작업 공간</strong>
          <span>{mode === "logical" ? "논리 토폴로지" : "물리 배치"}</span>
        </div>
      </header>
      <div className="context-menu-section">
        <small>여기에 배치</small>
        {quickModels.map((model) => (
          <button key={model.id} onClick={() => onPlaceModel(model.id)} type="button">
            <DeviceIcon kind={model.kind} size={15} />
            {model.model}
          </button>
        ))}
      </div>
      <div className="context-menu-section">
        <small>작업 공간</small>
        <button onClick={onSelect} type="button"><MousePointer2 size={15} />선택 모드</button>
        <button onClick={onFit} type="button"><Maximize2 size={15} />전체 보기</button>
        <button onClick={onZoomReset} type="button"><RotateCcw size={15} />확대 100%</button>
        <button className={mode === "logical" ? "active" : ""} onClick={onLogical} type="button"><Network size={15} />논리</button>
        <button className={mode === "physical" ? "active" : ""} onClick={onPhysical} type="button"><Cpu size={15} />물리</button>
        <button onClick={onNote} type="button"><Edit3 size={15} />여기에 메모 추가</button>
        <button onClick={() => onDrawing("rectangle")} type="button"><Square size={15} />여기에 사각형 영역</button>
        <button onClick={() => onDrawing("ellipse")} type="button"><CircleDot size={15} />여기에 타원 영역</button>
        <button onClick={() => onDrawing("line")} type="button"><Minus size={15} />여기에 라인</button>
        <button onClick={() => onDrawing("freehand")} type="button"><PenLine size={15} />여기에 자유선</button>
        <button onClick={onArrange} type="button"><Maximize2 size={15} />장비 자동 정렬</button>
        <button onClick={onPhysicalArrange} type="button"><Cpu size={15} />물리 기준 자동 정렬</button>
        <button onClick={onRepair} type="button"><Settings size={15} />프로젝트 복구</button>
      </div>
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
  onOpenDevice,
  onSetEndpointAdmin,
  onSetSerialClock,
  onRepairVlans,
  onRemove
}: {
  link: NetworkLink | null;
  project: NetworkProject;
  x: number;
  y: number;
  onClose: () => void;
  onOpenDevice: (deviceId: string, tab?: DeviceTab) => void;
  onSetEndpointAdmin: (linkId: string, adminUp: boolean) => void;
  onSetSerialClock: (linkId: string) => void;
  onRepairVlans: (linkId: string) => void;
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
  const endpoints = linkEndpointSummaries(project, link);
  const endpointPorts = [link.endpointA, link.endpointB].map((ref) => project.devices.find((device) => device.id === ref.deviceId)?.ports.find((port) => port.id === ref.portId)).filter((port): port is NetworkPort => Boolean(port));
  const allPortsAdminUp = endpointPorts.length === 2 && endpointPorts.every((port) => port.adminUp);
  const serialClockMissing = (link.type === "serial-dce" || link.type === "serial-dte") && endpointPorts.every((port) => !port.clockRate);
  const hasVlanIssue = linkHasVlanIssue(project, link);
  const cableDiagnostic = linkCableDiagnosticSummary(project, link);
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 280));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 380));

  return (
    <div className="device-context-menu link-context-menu rich-context-menu" style={{ left, top }} onClick={(event) => event.stopPropagation()} role="menu">
      <header>
        <Cable size={18} />
        <div>
          <strong>{shortCableLabel(link.type)}</strong>
          <span>{linkStatusLabel(link.status)}</span>
        </div>
      </header>
      <div className="context-menu-section">
        <small>링크</small>
        <span>{linkLabel(project, link)}</span>
        <span>{linkStatusDetail(project, link)}</span>
        <span title={cableDiagnostic.detail}>{cableDiagnostic.summary}</span>
      </div>
      <div className="context-menu-section">
        <small>끝점</small>
        <button onClick={() => { onOpenDevice(link.endpointA.deviceId); onClose(); }} type="button"><Info size={15} />{endpoints[0]?.device ?? "끝점 A"}</button>
        <button onClick={() => { onOpenDevice(link.endpointB.deviceId); onClose(); }} type="button"><Info size={15} />{endpoints[1]?.device ?? "끝점 B"}</button>
        <button onClick={() => { onOpenDevice(link.endpointA.deviceId, "config"); onClose(); }} type="button"><Wrench size={15} />A 포트 설정</button>
        <button onClick={() => { onOpenDevice(link.endpointB.deviceId, "config"); onClose(); }} type="button"><Wrench size={15} />B 포트 설정</button>
      </div>
      <div className="context-menu-section">
        <small>상태</small>
        <button disabled={!allPortsAdminUp} onClick={() => { onSetEndpointAdmin(link.id, false); onClose(); }} type="button"><Power size={15} />링크 비활성화</button>
        <button disabled={allPortsAdminUp || endpointPorts.length !== 2} onClick={() => { onSetEndpointAdmin(link.id, true); onClose(); }} type="button"><Power size={15} />링크 활성화</button>
        {(link.type === "serial-dce" || link.type === "serial-dte") && <button disabled={!serialClockMissing} onClick={() => { onSetSerialClock(link.id); onClose(); }} type="button"><CircleDot size={15} />DCE clock 64000</button>}
        <button disabled={!hasVlanIssue} onClick={() => { onRepairVlans(link.id); onClose(); }} type="button"><Wrench size={15} />VLAN 자동 복구</button>
      </div>
      <div className="context-menu-section danger-zone">
        <button className="danger" onClick={() => onRemove(link.id)} type="button"><Trash2 size={15} />케이블 삭제</button>
      </div>
    </div>
  );
}

function WorkspaceMiniMap({
  project,
  selectedDeviceId,
  selectedDrawingId,
  selectedLinkId,
  selectedNoteId,
  viewport,
  onJump
}: {
  project: NetworkProject;
  selectedDeviceId: string;
  selectedDrawingId: string;
  selectedLinkId: string;
  selectedNoteId: string;
  viewport: CanvasViewport;
  onJump: (point: { x: number; y: number }) => void;
}) {
  const devicesById = useMemo(() => new Map(project.devices.map((device) => [device.id, device])), [project.devices]);
  const viewportWidth = clampPercent(viewport.width / CANVAS_WIDTH);
  const viewportHeight = clampPercent(viewport.height / CANVAS_HEIGHT);
  const viewportStyle: CSSProperties = {
    left: `${clampPercent(viewport.x / CANVAS_WIDTH, 0, Math.max(0, 100 - viewportWidth))}%`,
    top: `${clampPercent(viewport.y / CANVAS_HEIGHT, 0, Math.max(0, 100 - viewportHeight))}%`,
    width: `${viewportWidth}%`,
    height: `${viewportHeight}%`
  };

  function jumpFromStage(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onJump({
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT
    });
  }

  function jumpFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onJump({
      x: viewport.x + viewport.width / 2 || CANVAS_WIDTH / 2,
      y: viewport.y + viewport.height / 2 || CANVAS_HEIGHT / 2
    });
  }

  return (
    <aside className="workspace-minimap" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} aria-label="작업 공간 미니맵">
      <header className="minimap-head">
        <div>
          <strong>미니맵</strong>
          <small>{project.devices.length} 장비 / {project.links.length} 링크 / {(project.notes ?? []).length + (project.drawings ?? []).length} 주석</small>
        </div>
        <span>클릭 이동</span>
      </header>
      <div className="minimap-stage" onClick={jumpFromStage} onKeyDown={jumpFromKeyboard} role="button" tabIndex={0} aria-label="미니맵 현재 화면 중앙으로 이동">
        <svg className="minimap-links" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {project.links.map((link) => {
            const a = devicesById.get(link.endpointA.deviceId);
            const b = devicesById.get(link.endpointB.deviceId);
            if (!a || !b) return null;
            const ac = nodeCenter(a);
            const bc = nodeCenter(b);
            return (
              <line
                className={`minimap-link ${link.status} ${selectedLinkId === link.id ? "selected" : ""}`}
                key={link.id}
                x1={ac.x}
                x2={bc.x}
                y1={ac.y}
                y2={bc.y}
              />
            );
          })}
        </svg>
        {(project.drawings ?? []).map((drawing) => {
          const center = drawingCenter(drawing);
          return (
            <button
              className={`minimap-drawing ${drawing.kind} ${drawing.color} ${selectedDrawingId === drawing.id ? "selected" : ""}`}
              key={drawing.id}
              onClick={(event) => {
                event.stopPropagation();
                onJump(center);
              }}
              style={{
                left: `${(drawing.position.x / CANVAS_WIDTH) * 100}%`,
                top: `${(drawing.position.y / CANVAS_HEIGHT) * 100}%`,
                width: `${Math.max(1.4, (drawing.width / CANVAS_WIDTH) * 100)}%`,
                height: `${Math.max(1.1, (drawing.height / CANVAS_HEIGHT) * 100)}%`
              }}
              title={`${drawing.label || workspaceDrawingKindLabel(drawing.kind)}로 이동`}
              type="button"
            />
          );
        })}
        {(project.notes ?? []).map((note) => (
          <button
            className={`minimap-note ${note.color} ${selectedNoteId === note.id ? "selected" : ""}`}
            key={note.id}
            onClick={(event) => {
              event.stopPropagation();
              onJump({ x: note.position.x + 110, y: note.position.y + 44 });
            }}
            style={{ left: `${((note.position.x + 110) / CANVAS_WIDTH) * 100}%`, top: `${((note.position.y + 44) / CANVAS_HEIGHT) * 100}%` }}
            title={`메모: ${note.text}`}
            type="button"
          />
        ))}
        {project.devices.map((device) => {
          const center = nodeCenter(device);
          return (
            <button
              className={`minimap-device ${device.kind} ${device.powerOn ? "" : "off"} ${selectedDeviceId === device.id ? "selected" : ""}`}
              key={device.id}
              onClick={(event) => {
                event.stopPropagation();
                onJump(center);
              }}
              style={{ left: `${(center.x / CANVAS_WIDTH) * 100}%`, top: `${(center.y / CANVAS_HEIGHT) * 100}%` }}
              title={`${device.label}로 이동`}
              type="button"
            />
          );
        })}
        <span className="minimap-viewport" style={viewportStyle} />
        {!project.devices.length && !(project.notes ?? []).length && !(project.drawings ?? []).length && <span className="minimap-empty">장비 없음</span>}
      </div>
    </aside>
  );
}

function SelectedLinkCard({ link, project, onRemove }: { link: NetworkLink; project: NetworkProject; onRemove: (linkId: string) => void }) {
  const point = linkMidpoint(project, link);
  if (!point) return null;
  const endpoints = linkEndpointSummaries(project, link);
  const cableDiagnostic = linkCableDiagnosticSummary(project, link);
  return (
    <div
      className={`selected-link-card ${link.status}`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      style={{ left: point.x, top: point.y }}
    >
      <header>
        <strong>{shortCableLabel(link.type)}</strong>
        <small>{linkStatusLabel(link.status)}</small>
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
      <em title={cableDiagnostic.detail}>{cableDiagnostic.summary}</em>
      <button className="danger" onClick={() => onRemove(link.id)} type="button"><Trash2 size={14} />케이블 삭제</button>
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
    <div className="rename-dialog" onClick={(event) => { event.stopPropagation(); onCancel(); }} role="dialog" aria-modal="true" aria-label="장비 이름 변경">
      <form onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <header>
          <Edit3 size={16} />
          <strong>장비 이름 변경</strong>
        </header>
        <input autoFocus maxLength={32} value={value} onChange={(event) => onChange(event.target.value)} />
        <div className="button-row">
          <button className="primary-action" type="submit">변경</button>
          <button className="secondary-action" onClick={onCancel} type="button">취소</button>
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

function WorkspaceDrawingIcon({ kind, size = 18 }: { kind: WorkspaceDrawingKind; size?: number }) {
  if (kind === "rectangle") return <Square size={size} />;
  if (kind === "line") return <Minus size={size} />;
  if (kind === "freehand") return <PenLine size={size} />;
  return <CircleDot size={size} />;
}

function WorkspaceDrawingShape({ drawing, selected, onResizeStart }: { drawing: WorkspaceDrawing; selected: boolean; onResizeStart?: (event: React.PointerEvent<SVGRectElement>, drawing: WorkspaceDrawing, handle: DrawingResizeHandle) => void }) {
  const label = drawing.label.trim().slice(0, 42);
  const labelX = drawing.kind === "line" ? drawing.width / 2 : drawing.width / 2;
  const labelY = drawing.kind === "line" || drawing.kind === "freehand" ? drawing.height / 2 - 8 : Math.min(drawing.height - 14, 24);
  const handles = selected ? drawingResizeHandles(drawing) : [];
  const freehandPoints = drawing.points ?? defaultFreehandPoints(drawing.width, drawing.height);
  return (
    <>
      {drawing.kind === "rectangle" && <rect className="drawing-shape" width={drawing.width} height={drawing.height} rx={8} />}
      {drawing.kind === "ellipse" && <ellipse className="drawing-shape" cx={drawing.width / 2} cy={drawing.height / 2} rx={drawing.width / 2} ry={drawing.height / 2} />}
      {drawing.kind === "line" && (
        <>
          <line className="drawing-hitbox" x1={0} x2={drawing.width} y1={0} y2={drawing.height} />
          <line className="drawing-shape" x1={0} x2={drawing.width} y1={0} y2={drawing.height} />
        </>
      )}
      {drawing.kind === "freehand" && (
        <>
          <polyline className="drawing-hitbox" points={drawingPointsAttribute(freehandPoints)} />
          <polyline className="drawing-shape" points={drawingPointsAttribute(freehandPoints)} />
        </>
      )}
      {selected && <rect className="drawing-selection-outline" x={-6} y={-6} width={drawing.width + 12} height={drawing.height + 12} rx={10} />}
      {label && <text className="drawing-label" x={labelX} y={labelY}>{label}</text>}
      {handles.map((handle) => (
        <rect
          aria-label={`도형 ${handle.id} 크기 조절`}
          className={`drawing-resize-handle ${handle.id}`}
          height={12}
          key={handle.id}
          onPointerDown={(event) => onResizeStart?.(event, drawing, handle.id)}
          role="button"
          rx={3}
          tabIndex={-1}
          width={12}
          x={handle.x - 6}
          y={handle.y - 6}
        />
      ))}
    </>
  );
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

function drawingDefaultSize(kind: WorkspaceDrawingKind): { width: number; height: number } {
  if (kind === "freehand") return { width: 260, height: 130 };
  if (kind === "line") return { width: 280, height: 120 };
  if (kind === "ellipse") return { width: 280, height: 156 };
  return { width: 320, height: 184 };
}

function drawingMinSize(kind: WorkspaceDrawingKind): { width: number; height: number } {
  if (kind === "freehand") return { width: 28, height: 8 };
  if (kind === "line") return { width: 28, height: 8 };
  return { width: 48, height: 32 };
}

function freehandDrawingFromPoints(points: Array<{ x: number; y: number }>, label: string): WorkspaceDrawing {
  const minSize = drawingMinSize("freehand");
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)));
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)));
  const maxX = Math.min(CANVAS_WIDTH, Math.max(...points.map((point) => point.x)));
  const maxY = Math.min(CANVAS_HEIGHT, Math.max(...points.map((point) => point.y)));
  const width = Math.max(minSize.width, Math.round(maxX - minX));
  const height = Math.max(minSize.height, Math.round(maxY - minY));
  const position = {
    x: Math.max(0, Math.min(CANVAS_WIDTH - width, Math.round(minX))),
    y: Math.max(0, Math.min(CANVAS_HEIGHT - height, Math.round(minY)))
  };
  return {
    id: createId("draw"),
    kind: "freehand",
    label,
    position,
    width,
    height,
    points: points.map((point) => ({
      x: Math.max(0, Math.min(width, Math.round(point.x - position.x))),
      y: Math.max(0, Math.min(height, Math.round(point.y - position.y)))
    })).slice(-300),
    color: "blue",
    strokeStyle: "solid",
    fill: false
  };
}

function defaultFreehandPoints(width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x: 0, y: Math.round(height * 0.62) },
    { x: Math.round(width * 0.24), y: Math.round(height * 0.28) },
    { x: Math.round(width * 0.52), y: Math.round(height * 0.7) },
    { x: Math.round(width * 0.78), y: Math.round(height * 0.38) },
    { x: width, y: Math.round(height * 0.58) }
  ];
}

function drawingPointsAttribute(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(" ");
}

function drawingResizeHandles(drawing: WorkspaceDrawing): Array<{ id: DrawingResizeHandle; x: number; y: number }> {
  return [
    { id: "nw", x: 0, y: 0 },
    { id: "ne", x: drawing.width, y: 0 },
    { id: "se", x: drawing.width, y: drawing.height },
    { id: "sw", x: 0, y: drawing.height }
  ];
}

function drawingPlacement(kind: WorkspaceDrawingKind, point: { x: number; y: number }): { position: { x: number; y: number }; width: number; height: number } {
  const size = drawingDefaultSize(kind);
  return {
    ...size,
    position: drawingPlacementPosition(point, { width: size.width, height: size.height }, true)
  };
}

function drawingPlacementPosition(point: { x: number; y: number }, drawing: Pick<WorkspaceDrawing, "width" | "height">, center = true): { x: number; y: number } {
  const x = center ? point.x - drawing.width / 2 : point.x;
  const y = center ? point.y - drawing.height / 2 : point.y;
  return {
    x: Math.max(16, Math.min(CANVAS_WIDTH - drawing.width - 16, Math.round(x))),
    y: Math.max(16, Math.min(CANVAS_HEIGHT - drawing.height - 16, Math.round(y)))
  };
}

function drawingCenter(drawing: WorkspaceDrawing): { x: number; y: number } {
  return { x: drawing.position.x + drawing.width / 2, y: drawing.position.y + drawing.height / 2 };
}

function workspaceSearchResultsFor(project: NetworkProject, query: string): WorkspaceSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const deviceResults: WorkspaceSearchResult[] = project.devices
    .filter((device) => workspaceDeviceSearchText(device).includes(needle))
    .map((device) => ({
      id: device.id,
      kind: "device" as const,
      label: device.label,
      detail: `${device.model} | ${displayKind(device.kind)} | ${primaryDeviceIp(device) || "IP 없음"}`,
      point: nodeCenter(device)
    }));
  const linkResults: WorkspaceSearchResult[] = project.links
    .filter((link) => linkSearchText(project, link).toLowerCase().includes(needle))
    .flatMap((link) => {
      const point = linkMidpoint(project, link);
      if (!point) return [];
      return [{
        id: link.id,
        kind: "link" as const,
        label: shortCableLabel(link.type),
        detail: `${linkLabel(project, link)} | ${linkStatusLabel(link.status)}`,
        point
      }];
    });
  const noteResults: WorkspaceSearchResult[] = (project.notes ?? [])
    .filter((note) => note.text.toLowerCase().includes(needle))
    .map((note) => ({
      id: note.id,
      kind: "note" as const,
      label: "메모",
      detail: note.text,
      point: { x: note.position.x + 110, y: note.position.y + 44 }
    }));
  const drawingResults: WorkspaceSearchResult[] = (project.drawings ?? [])
    .filter((drawing) => workspaceDrawingSearchText(drawing).includes(needle))
    .map((drawing) => ({
      id: drawing.id,
      kind: "drawing" as const,
      label: drawing.label || workspaceDrawingKindLabel(drawing.kind),
      detail: `${workspaceDrawingKindLabel(drawing.kind)} | ${workspaceDrawingColorLabel(drawing.color)}`,
      point: drawingCenter(drawing)
    }));
  return [...deviceResults, ...linkResults, ...noteResults, ...drawingResults].slice(0, 10);
}

function workspaceDeviceSearchText(device: NetworkDevice): string {
  return [
    device.label,
    device.model,
    device.config.hostname,
    displayKind(device.kind),
    ...enabledServices(device),
    ...device.ports.flatMap((port) => [port.name, port.ipAddress, port.gateway, port.dnsServer, port.description])
  ].join(" ").toLowerCase();
}

function notePlacementPosition(point: { x: number; y: number }, center = true): { x: number; y: number } {
  const width = 220;
  const height = 108;
  const x = center ? point.x - width / 2 : point.x;
  const y = center ? point.y - 22 : point.y;
  return {
    x: Math.max(16, Math.min(CANVAS_WIDTH - width - 16, Math.round(x))),
    y: Math.max(16, Math.min(CANVAS_HEIGHT - height - 16, Math.round(y)))
  };
}

function workspaceDrawingKindLabel(kind: WorkspaceDrawingKind): string {
  if (kind === "rectangle") return "사각형 영역";
  if (kind === "ellipse") return "타원 영역";
  if (kind === "freehand") return "자유선";
  return "라인";
}

function workspaceDrawingColorLabel(color: WorkspaceDrawing["color"]): string {
  return ({ amber: "노랑", blue: "파랑", green: "초록", rose: "분홍" })[color];
}

function workspaceDrawingSearchText(drawing: WorkspaceDrawing): string {
  return [
    drawing.label,
    drawing.kind,
    workspaceDrawingKindLabel(drawing.kind),
    drawing.color,
    workspaceDrawingColorLabel(drawing.color),
    drawing.strokeStyle
  ].join(" ").toLowerCase();
}

function promptWorkspaceNote(title: string, initialValue = "TODO: lab note"): string | null {
  if (typeof window === "undefined") return initialValue;
  const value = window.prompt(title, initialValue);
  if (value === null) return null;
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function promptWorkspaceDrawingLabel(kind: WorkspaceDrawingKind, initialValue = workspaceDrawingKindLabel(kind)): string | null {
  if (typeof window === "undefined") return initialValue;
  const value = window.prompt("도형 레이블", initialValue);
  if (value === null) return null;
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function nextWorkspaceNoteColor(color: WorkspaceNote["color"]): WorkspaceNote["color"] {
  const colors: Array<WorkspaceNote["color"]> = ["yellow", "blue", "green", "rose"];
  const index = colors.indexOf(color);
  return colors[(index + 1) % colors.length];
}

function nextWorkspaceDrawingColor(color: WorkspaceDrawing["color"]): WorkspaceDrawing["color"] {
  const colors: Array<WorkspaceDrawing["color"]> = ["amber", "blue", "green", "rose"];
  const index = colors.indexOf(color);
  return colors[(index + 1) % colors.length];
}

function topologyBounds(devices: NetworkDevice[]): { x: number; y: number; width: number; height: number } | null {
  if (!devices.length) return null;
  const boxes = devices.map((device) => {
    const size = nodeSize(device.kind);
    return {
      left: device.position.x,
      top: device.position.y,
      right: device.position.x + size.width,
      bottom: device.position.y + size.height
    };
  });
  const left = Math.max(0, Math.min(...boxes.map((box) => box.left)) - 80);
  const top = Math.max(0, Math.min(...boxes.map((box) => box.top)) - 80);
  const right = Math.min(CANVAS_WIDTH, Math.max(...boxes.map((box) => box.right)) + 80);
  const bottom = Math.min(CANVAS_HEIGHT, Math.max(...boxes.map((box) => box.bottom)) + 80);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function placeDevicesInGrid(devices: NetworkDevice[], target: Map<string, { x: number; y: number }>, layout: { x: number; y: number; columns: number; xGap: number; yGap: number }) {
  devices.forEach((device, index) => {
    const size = nodeSize(device.kind);
    const column = index % Math.max(1, layout.columns);
    const row = Math.floor(index / Math.max(1, layout.columns));
    target.set(device.id, {
      x: Math.max(24, Math.min(CANVAS_WIDTH - size.width - 24, layout.x + column * layout.xGap)),
      y: Math.max(24, Math.min(CANVAS_HEIGHT - size.height - 24, layout.y + row * layout.yGap))
    });
  });
}

function cloneDeviceForDuplicate(device: NetworkDevice, position: { x: number; y: number }, existing: NetworkDevice[]): NetworkDevice {
  const usedLabels = new Set(existing.map((item) => item.label.toLowerCase()));
  const usedHostnames = new Set(existing.map((item) => item.config.hostname.toLowerCase()));
  const label = uniqueDeviceName(`${cleanDeviceName(device.label) || devicePrefix(device)}_copy`, usedLabels);
  const hostname = uniqueDeviceName(`${cleanHostname(device.config.hostname) || label}_copy`, usedHostnames);
  return {
    ...device,
    id: createId("dev"),
    label,
    position,
    ports: device.ports.map((port, index) => ({
      ...port,
      id: createId("port"),
      macAddress: createCloneMac(index),
      linkId: undefined
    })),
    modules: device.modules.map((module) => ({ ...module })),
    config: cloneDeviceConfig(device.config, hostname),
    runtime: { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
  };
}

function cloneDeviceConfig(config: NetworkDevice["config"], hostname: string): NetworkDevice["config"] {
  const next = structuredClone(config);
  return {
    ...next,
    hostname,
    staticRoutes: next.staticRoutes.map((route) => ({ ...route, id: createId("route") })),
    dhcpPools: next.dhcpPools.map((pool) => ({ ...pool, id: createId("pool") })),
    dhcpExcludedRanges: next.dhcpExcludedRanges?.map((range) => ({ ...range, id: createId("dhcp_exclude") })) ?? [],
    dnsRecords: next.dnsRecords.map((record) => ({ ...record, id: createId("dns") })),
    nameServers: [...(next.nameServers ?? [])],
    accessRules: next.accessRules.map((rule) => ({ ...rule, id: createId("acl"), hits: 0 })),
    natRules: next.natRules.map((rule) => ({ ...rule, id: createId("nat"), hits: 0 })),
    stpRootPrimaryVlans: [...(next.stpRootPrimaryVlans ?? [])],
    localUsers: next.localUsers?.map((user) => ({ ...user, id: createId("user") })) ?? [],
    lineConfigs: next.lineConfigs?.map((line) => ({ ...line, id: createId("line") })) ?? [],
    routingProtocols: next.routingProtocols?.map((protocol) => ({ ...protocol, id: createId("routing") })) ?? []
  };
}

function createCloneMac(seed: number): string {
  const bytes = new Uint8Array(3);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    const value = Math.floor(Math.random() * 0xffffff);
    bytes[0] = (value >> 16) & 255;
    bytes[1] = (value >> 8) & 255;
    bytes[2] = value & 255;
  }
  return `02:00:${bytes[0].toString(16).padStart(2, "0")}:${bytes[1].toString(16).padStart(2, "0")}:${bytes[2].toString(16).padStart(2, "0")}:${(seed & 255).toString(16).padStart(2, "0")}`;
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

function canvasLinkLabel(_project: NetworkProject, link: NetworkLink): string {
  return `${shortCableLabel(link.type)} · ${linkStatusLabel(link.status)}`;
}

function shortCableLabel(type: CableType): string {
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

function linkStatusLabel(status: NetworkLink["status"]): string {
  return ({ up: "정상", down: "다운", blocked: "차단" })[status];
}

function eventStatusLabel(status: SimulationEvent["status"]): string {
  return ({ forwarded: "전송 중", delivered: "전달됨", dropped: "드롭됨" })[status];
}

function osiFilterLabel(filter: string): string {
  return filter === "all" ? "전체" : filter.replace("Layer ", "L");
}

function eventPanelExportScope(eventFilter: string, osiFilter: string, search: string): string {
  const parts = [
    eventFilter === "all" ? "" : eventFilter,
    osiFilter === "all" ? "" : osiFilter.toLowerCase().replace(/\s+/g, "-"),
    search.trim() ? "search" : ""
  ].filter(Boolean);
  return parts.join("-") || "all";
}

function eventSearchText(project: NetworkProject, event: SimulationEvent): string {
  return [
    event.type,
    event.status,
    event.info,
    event.osiLayers.join(" "),
    pduHeaderRowsFor(project, event).map((header) => `${header.layer} ${header.field} ${header.value}`).join(" "),
    eventDeviceLabel(project, event.lastDeviceId),
    eventDeviceLabel(project, event.atDeviceId),
    eventDeviceLabel(project, event.sourceDeviceId ?? ""),
    eventDeviceLabel(project, event.targetDeviceId ?? "")
  ].join(" ").toLowerCase();
}

function complexPduProtocolLabel(protocol: ComplexPduProtocol): string {
  return complexPduProtocols.find((item) => item.value === protocol)?.label ?? protocol.toUpperCase();
}

function complexPduOptionSuffix(ttl: number, intervalMs: number): string {
  const parts = [`TTL ${ttl}`];
  if (intervalMs > 0) parts.push(`${intervalMs}ms interval`);
  return ` (${parts.join(", ")})`;
}

function annotateComplexPduEvents(project: NetworkProject, fromIndex: number, ttl: number, intervalMs: number, repeatIndex: number, repeatCount: number): NetworkProject {
  const suffix = complexPduOptionSuffix(ttl, intervalMs);
  const prefix = repeatCount > 1 ? `[${repeatIndex + 1}/${repeatCount}] ` : "";
  return {
    ...project,
    simulationEvents: project.simulationEvents.map((event, index) => index < fromIndex ? event : { ...event, info: `${prefix}${event.info}${suffix}` })
  };
}

function waitForInterval(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function complexPduServiceEnabled(device: NetworkDevice, protocol: ComplexPduProtocol): boolean {
  if (protocol === "icmp") return true;
  if (protocol === "dns") return device.config.services.dns;
  if (protocol === "http") return device.config.services.http;
  if (protocol === "ftp") return device.config.services.ftp;
  if (protocol === "email") return device.config.services.email;
  if (protocol === "tftp") return device.config.services.tftp;
  if (protocol === "syslog") return device.config.services.syslog;
  return false;
}

function linkStatusDetail(project: NetworkProject, link: NetworkLink): string {
  const aDevice = project.devices.find((device) => device.id === link.endpointA.deviceId);
  const bDevice = project.devices.find((device) => device.id === link.endpointB.deviceId);
  const aPort = aDevice?.ports.find((port) => port.id === link.endpointA.portId);
  const bPort = bDevice?.ports.find((port) => port.id === link.endpointB.portId);
  if (!aDevice || !bDevice || !aPort || !bPort) return "끝점 장비 또는 포트를 찾을 수 없습니다.";
  if (!aDevice.powerOn || !bDevice.powerOn) return "한쪽 끝점 장비의 전원이 꺼져 있습니다.";
  if (!aPort.adminUp || !bPort.adminUp) return "한쪽 끝점 포트가 shutdown 상태입니다.";
  if (link.type === "console") return "콘솔 케이블은 터미널/CLI 접속에 사용할 수 있습니다.";
  if (aPort.kind === "serial" && bPort.kind === "serial" && !aPort.clockRate && !bPort.clockRate) return "Serial 링크에는 DCE clock rate가 필요합니다.";
  if (aPort.kind === "wireless" && bPort.kind === "wireless") {
    const distance = Math.hypot(aDevice.position.x - bDevice.position.x, aDevice.position.y - bDevice.position.y);
    const range = Math.min(aDevice.config.wireless.range || 180, bDevice.config.wireless.range || 180);
    if (aDevice.config.wireless.ssid !== bDevice.config.wireless.ssid || aDevice.config.wireless.auth !== bDevice.config.wireless.auth) return "무선 SSID 또는 인증 방식이 서로 다릅니다.";
    if (aDevice.config.wireless.auth === "wpa2-psk" && aDevice.config.wireless.key !== bDevice.config.wireless.key) return "무선 키가 서로 다릅니다.";
    if (distance > range) return `무선 끝점이 범위를 벗어났습니다 (${Math.round(distance)} > ${range}).`;
  }
  if (aPort.mode === "trunk" && bPort.mode === "trunk" && !aPort.allowedVlans.some((vlan) => bPort.allowedVlans.includes(vlan))) return "Trunk 허용 VLAN 목록이 겹치지 않습니다.";
  if (aPort.mode === "access" && bPort.mode === "access" && aPort.vlan !== bPort.vlan) return `Access VLAN이 일치하지 않습니다 (${aPort.vlan} != ${bPort.vlan}).`;
  if (aPort.mode === "trunk" && bPort.mode === "access" && !aPort.allowedVlans.includes(bPort.vlan)) return `Trunk가 access VLAN ${bPort.vlan}을 허용하지 않습니다.`;
  if (bPort.mode === "trunk" && aPort.mode === "access" && !bPort.allowedVlans.includes(aPort.vlan)) return `Trunk가 access VLAN ${aPort.vlan}을 허용하지 않습니다.`;
  return "링크가 정상 동작 중입니다.";
}

function linkSearchText(project: NetworkProject, link: NetworkLink): string {
  const tdr = linkCableDiagnosticSummary(project, link);
  return [
    link.type,
    shortCableLabel(link.type),
    link.status,
    linkStatusLabel(link.status),
    linkLabel(project, link),
    linkStatusDetail(project, link),
    tdr.summary,
    tdr.detail
  ].join(" ").toLowerCase();
}

function linkEndpointPair(project: NetworkProject, link: NetworkLink): { aDevice: NetworkDevice; aPort: NetworkPort; bDevice: NetworkDevice; bPort: NetworkPort } | null {
  const aDevice = project.devices.find((device) => device.id === link.endpointA.deviceId);
  const bDevice = project.devices.find((device) => device.id === link.endpointB.deviceId);
  const aPort = aDevice?.ports.find((port) => port.id === link.endpointA.portId);
  const bPort = bDevice?.ports.find((port) => port.id === link.endpointB.portId);
  return aDevice && aPort && bDevice && bPort ? { aDevice, aPort, bDevice, bPort } : null;
}

function linkCableDiagnosticSummary(project: NetworkProject, link: NetworkLink): { summary: string; detail: string } {
  const pair = linkEndpointPair(project, link);
  if (!pair) return { summary: "TDR missing", detail: "끝점 장비 또는 포트를 찾을 수 없습니다." };
  const aStatus = cableTdrStatus(pair.aDevice, pair.aPort, link);
  const bStatus = cableTdrStatus(pair.bDevice, pair.bPort, link);
  return {
    summary: `TDR ${aStatus}/${bStatus}`,
    detail: `${pair.aDevice.label} ${pair.aPort.name}: ${aStatus}; ${pair.bDevice.label} ${pair.bPort.name}: ${bStatus}`
  };
}

function cableTdrStatus(device: NetworkDevice, port: NetworkPort, link: NetworkLink): string {
  if (!copperTdrCapable(port)) return "N/A";
  if (!device.powerOn || !port.adminUp) return "Not completed";
  if (!port.linkId) return "Open";
  if (link.status === "blocked") return "Blocked";
  if (link.status === "down") return "Check";
  return "Normal";
}

function copperTdrCapable(port: NetworkPort): boolean {
  return port.kind === "ethernet" || port.kind === "fast-ethernet" || port.kind === "gigabit-ethernet";
}

function linkHasVlanIssue(project: NetworkProject, link: NetworkLink): boolean {
  const pair = linkEndpointPair(project, link);
  if (!pair) return false;
  const { aPort, bPort } = pair;
  if (aPort.mode === "access" && bPort.mode === "access") return aPort.vlan !== bPort.vlan;
  if (aPort.mode === "trunk" && bPort.mode === "trunk") return !aPort.allowedVlans.some((vlan) => bPort.allowedVlans.includes(vlan));
  if (aPort.mode === "trunk" && bPort.mode === "access") return !aPort.allowedVlans.includes(bPort.vlan);
  if (bPort.mode === "trunk" && aPort.mode === "access") return !bPort.allowedVlans.includes(aPort.vlan);
  return false;
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
  if (!device || !port) return { side, device: "누락된 장비", port: "누락된 포트", mode: "알 수 없음", state: "다운" };
  return {
    side,
    device: device.label,
    port: port.name,
    mode: portModeSummary(port),
    state: `${device.powerOn ? "전원 켜짐" : "전원 꺼짐"} / ${port.adminUp ? "up" : "shutdown"}`
  };
}

function portModeSummary(port: NetworkPort): string {
  if (port.mode === "trunk") return `trunk ${port.allowedVlans.join(",") || "1"}`;
  if (port.mode === "access") return `access vlan ${port.vlan}`;
  return port.ipAddress ? `routed ${port.ipAddress}` : "routed";
}

function clampPercent(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value * 100));
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
    return <EventPanel message="연결 끝점 장비가 누락되었습니다." onClear={onCancel} project={project} />;
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
        <strong>연결 도우미</strong>
        <small>{draft.cable}</small>
      </header>
      <p>{error}</p>
      <PortPicker cable={draft.cable} device={aDevice} label="첫 번째 끝점" onChange={setAPortId} peerDevice={bDevice} peerPort={bDevice.ports.find((port) => port.id === bPortId)} project={project} value={aPortId} />
      <PortPicker cable={draft.cable} device={bDevice} label="두 번째 끝점" onChange={setBPortId} peerDevice={aDevice} peerPort={aDevice.ports.find((port) => port.id === aPortId)} project={project} value={bPortId} />
      <div className="button-row">
        <button className="primary-action" disabled={!aPortId || !bPortId} onClick={connect} type="button">선택 포트 연결</button>
        <button className="secondary-action" onClick={onCancel} type="button">취소</button>
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
        <option value="">포트 선택</option>
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
    .flatMap((item) => {
      const token = item.trim();
      const range = token.match(/^(\d+)-(\d+)$/);
      if (!range) return [boundedNumber(token, 1, 4094)];
      const start = boundedNumber(range[1], 1, 4094);
      const end = boundedNumber(range[2], 1, 4094);
      if (end < start || end - start > 512) return [];
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    })
    .filter((item, index, list) => list.indexOf(item) === index);
  return ids.length > 0 ? ids : [1];
}

function parseIpList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .slice(0, 8);
}

function ensureVlanRows(vlans: Array<{ id: number; name: string }>, ids: number[]): Array<{ id: number; name: string }> {
  const byId = new Map(vlans.filter((vlan) => validVlanId(vlan.id)).map((vlan) => [vlan.id, vlan.name]));
  byId.set(1, byId.get(1) || "default");
  for (const id of ids.filter(validVlanId)) byId.set(id, byId.get(id) || `VLAN${id}`);
  return Array.from(byId.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
}

function modePatch(mode: NetworkPort["mode"]): Partial<NetworkPort> {
  if (mode === "routed") return { mode };
  return { mode, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "", helperAddresses: [], natRole: undefined, accessGroupIn: "", accessGroupOut: "" };
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
  return { project: next, message: changes ? `프로젝트 복구를 적용했습니다 (${changes}개 수정).` : "복구할 프로젝트 문제가 없습니다." };
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
  return ({ physical: "물리", config: "설정", cli: "CLI", desktop: "데스크톱", services: "서비스" })[tab];
}

function isConfigNoticeError(value: string): boolean {
  return value.includes("형식") || value.includes("유효한") || value.includes("사이") || value.includes("이미");
}

function isServiceNoticeError(value: string): boolean {
  return value.includes("형식") || value.includes("유효한") || value.includes("입력") || value.includes("크거나") || value.includes("안에");
}

function Palette({ selectedModel, selectedCable, onSelect, onModel, onCable }: { selectedModel: string; selectedCable: CableType | ""; onSelect: () => void; onModel: (id: string) => void; onCable: (type: CableType) => void }) {
  const [kind, setKind] = useState<DeviceKind>("router");
  const models = useMemo(() => deviceCatalog.filter((device) => device.kind === kind), [kind]);
  return (
    <section className="palette packet-palette">
      <div className="palette-toolbar">
        <button className={!selectedModel && !selectedCable ? "active" : ""} onClick={onSelect} title="선택" type="button"><MousePointer2 size={15} /></button>
        <span>장비 선택</span>
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
        <div className="palette-toolbar"><Cable size={15} /><span>연결</span></div>
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
        <button className="icon-button danger" onClick={() => onDelete(device.id)} title="장비 삭제" type="button"><Trash2 size={17} /></button>
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
  const [selectedPortId, setSelectedPortId] = useState(device.ports[0]?.id ?? "");
  const [notice, setNotice] = useState("");
  const model = getDeviceModel(device.modelId);
  const selectedPort = device.ports.find((port) => port.id === selectedPortId) ?? device.ports[0];
  const selectedLink = selectedPort?.linkId ? project.links.find((link) => link.id === selectedPort.linkId) : undefined;
  const selectedPortState = selectedPort ? physicalPortState(project, device, selectedPort) : "down";
  const selectedPeer = selectedPort ? physicalPortPeer(project, device, selectedPort) : null;
  const compatibleModules = Array.from(new Set(model.modules.flatMap((slot) => slot.accepts)))
    .map((moduleId) => getModuleSpec(moduleId))
    .filter((module): module is ModuleSpec => Boolean(module));

  useEffect(() => {
    if (!device.ports.some((port) => port.id === selectedPortId)) setSelectedPortId(device.ports[0]?.id ?? "");
  }, [device.id, device.ports.length, selectedPortId]);

  function selectCompatibleModule(moduleId: string) {
    const slot = model.modules.find((candidate) => candidate.accepts.includes(moduleId) && !device.modules.some((module) => module.slotId === candidate.id));
    if (!slot) {
      setNotice("사용 가능한 호환 슬롯이 없습니다.");
      return;
    }
    setSlotSelections((current) => ({ ...current, [slot.id]: moduleId }));
    setNotice(`${slot.label}에 ${moduleId} 모듈을 선택했습니다. 장비 전원을 끈 뒤 설치하세요.`);
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
    onUpdate(powerDevice(device, powerOn));
  }

  function updatePort(portId: string, patch: Partial<NetworkPort>) {
    onUpdate({ ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) });
  }

  return (
    <section className="panel-section physical-panel">
      <aside className="physical-module-list">
        <header>
          <strong>모듈</strong>
          <small>{compatibleModules.length ? "빈 슬롯에 장착할 모듈을 선택하세요." : "확장 모듈이 없습니다."}</small>
        </header>
        {compatibleModules.map((module) => (
          <button key={module.id} onClick={() => selectCompatibleModule(module.id)} type="button">
            <strong>{module.label}</strong>
            <span>{module.description}</span>
            <small>포트 {module.ports.length}개</small>
          </button>
        ))}
      </aside>
      <div className="physical-chassis-pane">
        <label className="toggle"><input checked={device.powerOn} onChange={(event) => setPower(event.target.checked)} type="checkbox" />전원</label>
        <div className={`physical-front-panel ${device.powerOn ? "powered" : "off"}`}>
          <div>
            <strong>{device.model}</strong>
            <small>장착 모듈 {device.modules.length}개</small>
          </div>
          <div className="physical-port-map">
            {device.ports.map((port) => (
              <button
                className={`physical-port ${port.kind} ${port.id === selectedPort?.id ? "selected" : ""} ${port.linkId ? "connected" : ""} ${port.adminUp ? "" : "shutdown"}`}
                key={port.id}
                onClick={() => setSelectedPortId(port.id)}
                title={`${port.name} / ${port.kind} / ${portConnectionLabel(project, device, port)}`}
                type="button"
              >
                <span>{shortPortName(port.name)}</span>
              </button>
            ))}
          </div>
        </div>
        {selectedPort && (
          <div className="physical-port-inspector">
            <header>
              <div>
                <strong>{selectedPort.name}</strong>
                <small>{selectedPort.kind}{selectedPort.moduleId ? ` | ${selectedPort.moduleId}` : ""}</small>
              </div>
              <span className={`port-state-pill ${selectedPortState}`}>{physicalPortStateLabel(selectedPortState)}</span>
            </header>
            <div className="physical-cable-trace">
              <div>
                <span>케이블</span>
                <strong>{selectedLink ? shortCableLabel(selectedLink.type) : "미연결"}</strong>
              </div>
              <div>
                <span>상대 포트</span>
                <strong>{selectedPeer ? `${selectedPeer.device.label} ${selectedPeer.port.name}` : "없음"}</strong>
              </div>
              <div>
                <span>상태 진단</span>
                <strong>{selectedLink ? linkStatusDetail(project, selectedLink) : "포트에 연결된 링크가 없습니다."}</strong>
              </div>
            </div>
            <dl className="physical-port-details">
              <div><dt>Layer 1</dt><dd>{device.powerOn ? "전원 켜짐" : "전원 꺼짐"} / {selectedPort.adminUp ? "no shutdown" : "shutdown"}</dd></div>
              <div><dt>Layer 2</dt><dd>{physicalLayer2Label(selectedPort)}</dd></div>
              <div><dt>Layer 3</dt><dd>{physicalLayer3Label(selectedPort)}</dd></div>
              <div><dt>속도/듀플렉스</dt><dd>{selectedPort.speed ?? "auto"} / {selectedPort.duplex ?? "auto"}</dd></div>
              <div><dt>MTU</dt><dd>{selectedPort.mtu ?? 1500}</dd></div>
              <div><dt>TDR</dt><dd>{physicalPortTdrLabel(project, device, selectedPort)}</dd></div>
              <div><dt>Serial</dt><dd>{physicalSerialLabel(project, device, selectedPort)}</dd></div>
            </dl>
            <div className="button-row">
              <button className="secondary-action" onClick={() => updatePort(selectedPort.id, { adminUp: !selectedPort.adminUp })} type="button">{selectedPort.adminUp ? "Shutdown" : "No shutdown"}</button>
              {selectedPort.kind === "serial" && <button className="secondary-action" onClick={() => updatePort(selectedPort.id, { clockRate: selectedPort.clockRate ? undefined : 64000 })} type="button">{selectedPort.clockRate ? "Clock 제거" : "DCE clock 64000"}</button>}
              {selectedPort.linkId ? <button className="secondary-action danger" onClick={() => onProjectChange(removeLink(project, selectedPort.linkId!), `${device.label} ${selectedPort.name} 연결을 해제했습니다.`)} type="button">케이블 분리</button> : <small>케이블 연결은 작업공간 케이블 도구에서 시작하세요.</small>}
            </div>
          </div>
        )}
        {model.modules.length > 0 && (
          <div className="module-rack">
            <header>
              <strong>모듈 슬롯</strong>
              <small>{device.powerOn ? "모듈 변경 전 전원을 끄세요" : "모듈 변경 가능"}</small>
            </header>
            {model.modules.map((slot) => {
              const installed = device.modules.find((module) => module.slotId === slot.id);
              const installedSpec = installed ? getModuleSpec(installed.moduleId) : null;
              return (
                <div className="module-slot" key={slot.id}>
                  <div>
                    <strong>{slot.label}</strong>
                    <span>{installedSpec ? `${installedSpec.label}: ${installedSpec.description}` : "비어 있음"}</span>
                  </div>
                  {installed ? (
                    <button className="secondary-action" disabled={device.powerOn} onClick={() => remove(slot.id)} type="button">제거</button>
                  ) : (
                    <>
                      <select disabled={device.powerOn} value={slotSelections[slot.id] ?? slot.accepts[0]} onChange={(event) => setSlotSelections({ ...slotSelections, [slot.id]: event.target.value })}>
                        {slot.accepts.map((moduleId) => {
                          const spec = getModuleSpec(moduleId);
                          return <option key={moduleId} value={moduleId}>{spec?.label ?? moduleId}</option>;
                        })}
                      </select>
                      <button className="secondary-action" disabled={device.powerOn} onClick={() => install(slot.id)} type="button">장착</button>
                    </>
                  )}
                </div>
              );
            })}
            {notice && <small className={notice.includes("없") || notice.includes("끄") || notice.includes("해제") || notice.includes("지원하지") ? "module-notice warning" : "module-notice"}>{notice}</small>}
          </div>
        )}
        <div className="port-table physical-port-table">{device.ports.map((port) => (
          <div key={port.id}>
            <strong>{port.name}</strong>
            <span>{port.kind}</span>
            <span>{port.adminUp ? "up" : "shutdown"}</span>
            <span>{port.mode === "trunk" ? `trunk ${port.allowedVlans.join(",")}` : port.mode === "access" ? `vlan ${port.vlan}` : port.ipAddress || "routed"}</span>
            <span>{`${port.duplex ?? "auto"}/${port.speed ?? "auto"}`}</span>
            <span>{`MTU ${port.mtu ?? 1500}`}</span>
            <span>{portConnectionLabel(project, device, port)}</span>
            {port.linkId ? <button className="secondary-action" onClick={() => onProjectChange(removeLink(project, port.linkId!), `${device.label} ${port.name} 연결을 해제했습니다.`)} type="button">연결 해제</button> : <small>비어 있음</small>}
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
  if (!port.linkId) return "비어 있음";
  const link = project.links.find((item) => item.id === port.linkId);
  if (!link) return "끊어진 링크";
  const peerRef = link.endpointA.deviceId === device.id && link.endpointA.portId === port.id ? link.endpointB : link.endpointA;
  const peer = project.devices.find((item) => item.id === peerRef.deviceId);
  const peerPort = peer?.ports.find((item) => item.id === peerRef.portId);
  return peer && peerPort ? `${peer.label} ${peerPort.name}` : "누락된 상대";
}

function physicalPortPeer(project: NetworkProject, device: NetworkDevice, port: NetworkPort): { device: NetworkDevice; port: NetworkPort } | null {
  if (!port.linkId) return null;
  const link = project.links.find((item) => item.id === port.linkId);
  if (!link) return null;
  const peerRef = link.endpointA.deviceId === device.id && link.endpointA.portId === port.id ? link.endpointB : link.endpointA;
  const peer = project.devices.find((item) => item.id === peerRef.deviceId);
  const peerPort = peer?.ports.find((item) => item.id === peerRef.portId);
  return peer && peerPort ? { device: peer, port: peerPort } : null;
}

function physicalPortState(project: NetworkProject, device: NetworkDevice, port: NetworkPort): NetworkLink["status"] {
  if (!device.powerOn || !port.adminUp || !port.linkId) return "down";
  const link = project.links.find((item) => item.id === port.linkId);
  return link?.status ?? "down";
}

function physicalPortStateLabel(status: NetworkLink["status"]): string {
  if (status === "up") return "Link up";
  if (status === "blocked") return "Blocked";
  return "Link down";
}

function physicalLayer2Label(port: NetworkPort): string {
  if (port.kind === "console") return "Console";
  if (port.kind === "wireless") return `SSID VLAN ${port.vlan}`;
  if (port.mode === "trunk") return `trunk native ${port.nativeVlan ?? 1}, allowed ${port.allowedVlans.join(",") || "none"}`;
  if (port.mode === "access") return `access VLAN ${port.vlan}`;
  return "routed";
}

function physicalLayer3Label(port: NetworkPort): string {
  if (port.ipAddress && port.subnetMask) return `${port.ipAddress} / ${port.subnetMask}`;
  if (port.ipCapable) return "IP 미설정";
  return "L3 비활성";
}

function physicalPortTdrLabel(project: NetworkProject, device: NetworkDevice, port: NetworkPort): string {
  const link = port.linkId ? project.links.find((item) => item.id === port.linkId) : undefined;
  return cableTdrStatus(device, port, link ?? { id: "", type: "auto", endpointA: { deviceId: device.id, portId: port.id }, endpointB: { deviceId: "", portId: "" }, status: "down", createdAt: 0 });
}

function physicalSerialLabel(project: NetworkProject, device: NetworkDevice, port: NetworkPort): string {
  if (port.kind !== "serial") return "해당 없음";
  const link = port.linkId ? project.links.find((item) => item.id === port.linkId) : undefined;
  const endpoint = link?.endpointB.deviceId === device.id && link.endpointB.portId === port.id ? "B" : "A";
  const role = link?.dceEndpoint === endpoint ? "DCE" : "DTE";
  if (!link) return port.clockRate ? `clock ${port.clockRate}` : "미연결";
  return role === "DCE" ? `DCE ${port.clockRate ? `clock ${port.clockRate}` : "clock 필요"}` : "DTE";
}

function ConfigTab({ device, onUpdate, onDhcp }: { device: NetworkDevice; onUpdate: (device: NetworkDevice) => void; onDhcp: () => void }) {
  const dataPorts = device.ports.filter((item) => item.kind !== "console");
  const [selectedPortId, setSelectedPortId] = useState(dataPorts[0]?.id ?? "");
  const [routeDraft, setRouteDraft] = useState({ network: "", mask: "", nextHop: "" });
  const [vlanDraft, setVlanDraft] = useState({ id: "10", name: "Users" });
  const [aclDraft, setAclDraft] = useState<Omit<AccessRule, "id" | "hits">>({ action: "permit", protocol: "ip", source: "any", destination: "any", interfaceName: "" });
  const [natDraft, setNatDraft] = useState<Omit<NatRule, "id" | "hits">>({ insideLocal: "", insideGlobal: "", outsideInterface: "" });
  const [configNotice, setConfigNotice] = useState("");
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
    const network = routeDraft.network.trim();
    const mask = routeDraft.mask.trim();
    const nextHop = routeDraft.nextHop.trim();
    if (!isIpv4(network) || !isSubnetMask(mask) || !isIpv4(nextHop)) {
      setConfigNotice("정적 라우트는 유효한 IPv4 네트워크, 연속 subnet mask, 다음 홉을 사용해야 합니다.");
      return;
    }
    onUpdate({
      ...device,
      config: {
        ...device.config,
        staticRoutes: [...device.config.staticRoutes, { id: createId("route"), network, mask, nextHop }]
      }
    });
    setConfigNotice(`${network} 정적 라우트를 추가했습니다.`);
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
    if (!Number.isInteger(id) || id < 1 || id > 4094) {
      setConfigNotice("VLAN ID는 1부터 4094 사이여야 합니다.");
      return;
    }
    if (device.config.vlans.some((vlan) => vlan.id === id)) {
      setConfigNotice(`VLAN ${id}는 이미 존재합니다.`);
      return;
    }
    onUpdate({ ...device, config: { ...device.config, vlans: [...device.config.vlans, { id, name: vlanDraft.name.trim() || `VLAN${id}` }].sort((a, b) => a.id - b.id) } });
    setConfigNotice(`VLAN ${id}를 추가했습니다.`);
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
        <button onClick={() => scrollConfig("interface")} type="button">인터페이스</button>
        {(device.kind === "router" || device.kind === "switch" || device.kind === "firewall") && <button onClick={() => scrollConfig("routes")} type="button">라우팅</button>}
        {(device.kind === "switch" || device.kind === "router" || device.kind === "firewall") && <button onClick={() => scrollConfig("vlans")} type="button">VLAN</button>}
        {(device.kind === "wireless" || device.ports.some((item) => item.kind === "wireless")) && <button onClick={() => scrollConfig("wireless")} type="button">무선</button>}
        {device.kind === "firewall" && <button onClick={() => scrollConfig("security")} type="button">보안</button>}
        <button onClick={() => scrollConfig("runtime")} type="button">런타임</button>
      </div>
      {configNotice && <strong className={isConfigNoticeError(configNotice) ? "form-error" : "module-notice"} role={isConfigNoticeError(configNotice) ? "alert" : "status"}>{configNotice}</strong>}
      <label id={`${device.id}-config-interface`}>호스트명<input value={device.config.hostname} onChange={(event) => onUpdate({ ...device, label: event.target.value, config: { ...device.config, hostname: event.target.value } })} /></label>
      {port && (
        <div className="config-group">
          <header><strong>인터페이스</strong><select value={port.id} onChange={(event) => setSelectedPortId(event.target.value)}>{dataPorts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></header>
          <label className="toggle"><input checked={port.adminUp} onChange={(event) => updatePort(port.id, { adminUp: event.target.checked })} type="checkbox" />관리 상태 켜짐</label>
          <label>설명<input value={port.description} onChange={(event) => updatePort(port.id, { description: event.target.value.slice(0, 80) })} placeholder="Link to CoreSwitch Gi0/1" /></label>
          {isIpCapable(device, port) ? (
            <>
              <label>IP<input value={port.ipAddress} onChange={(event) => updatePort(port.id, { ipAddress: event.target.value.trim() })} placeholder="192.168.1.1" /></label>
              <label>마스크<input value={port.subnetMask} onChange={(event) => updatePort(port.id, { subnetMask: event.target.value.trim() })} placeholder="255.255.255.0" /></label>
              <label>게이트웨이<input value={port.gateway} onChange={(event) => updatePort(port.id, { gateway: event.target.value.trim() })} placeholder="192.168.1.254" /></label>
              <label>DNS<input value={port.dnsServer} onChange={(event) => updatePort(port.id, { dnsServer: event.target.value.trim() })} placeholder="8.8.8.8" /></label>
              {(device.kind === "router" || device.kind === "switch" || device.kind === "firewall") && <label>DHCP Helper<input value={(port.helperAddresses ?? []).join(",")} onChange={(event) => updatePort(port.id, { helperAddresses: parseIpList(event.target.value) })} placeholder="10.10.10.10" /></label>}
            </>
          ) : <small>Layer 2 스위치 포트는 인터페이스 IP 대신 VLAN 설정을 사용합니다.</small>}
          <label>모드<select value={port.mode} onChange={(event) => updatePort(port.id, modePatch(event.target.value as NetworkPort["mode"]))}>
            <option value="access">access</option>
            <option value="trunk">trunk</option>
            <option value="routed">routed</option>
          </select></label>
          {port.mode === "access" && <label>Access VLAN<input value={port.vlan} onChange={(event) => updatePort(port.id, { vlan: boundedNumber(event.target.value, 1, 4094) })} type="number" /></label>}
          {port.mode === "trunk" && <label>허용 VLAN<input value={port.allowedVlans.join(",")} onChange={(event) => updatePort(port.id, { allowedVlans: parseVlanList(event.target.value) })} placeholder="1,10,20" /></label>}
          <label>Duplex<select value={port.duplex ?? "auto"} onChange={(event) => updatePort(port.id, { duplex: event.target.value as NetworkPort["duplex"] })}>
            <option value="auto">auto</option>
            <option value="full">full</option>
            <option value="half">half</option>
          </select></label>
          <label>Speed<input value={port.speed ?? "auto"} onChange={(event) => updatePort(port.id, { speed: event.target.value.trim() || "auto" })} placeholder="auto" /></label>
          <label>MTU<input value={port.mtu ?? 1500} onChange={(event) => updatePort(port.id, { mtu: boundedNumber(event.target.value, 576, 9216) })} type="number" /></label>
          <label>Bandwidth<input value={port.bandwidth ?? ""} onChange={(event) => updatePort(port.id, { bandwidth: event.target.value ? boundedNumber(event.target.value, 1, 10000000) : undefined })} placeholder="100000" type="number" /></label>
          {port.kind === "serial" && <label>클럭 레이트<input value={port.clockRate ?? ""} onChange={(event) => updatePort(port.id, { clockRate: event.target.value ? boundedNumber(event.target.value, 1200, 8000000) : undefined })} placeholder="64000" type="number" /></label>}
        </div>
      )}
      {(device.kind === "pc" || device.kind === "server") && <button className="secondary-action" onClick={onDhcp} type="button">DHCP 갱신</button>}
      {(device.kind === "router" || device.kind === "switch" || device.kind === "firewall") && (
        <div className="config-group" id={`${device.id}-config-routes`}>
          <header><strong>정적 라우트</strong><small>{device.config.staticRoutes.length}</small></header>
          <div className="inline-grid">
            <input value={routeDraft.network} onChange={(event) => setRouteDraft({ ...routeDraft, network: event.target.value })} placeholder="네트워크" />
            <input value={routeDraft.mask} onChange={(event) => setRouteDraft({ ...routeDraft, mask: event.target.value })} placeholder="마스크" />
            <input value={routeDraft.nextHop} onChange={(event) => setRouteDraft({ ...routeDraft, nextHop: event.target.value })} placeholder="다음 홉" />
            <button className="secondary-action" onClick={addRoute} type="button">추가</button>
          </div>
          {device.config.staticRoutes.map((route) => (
            <div className="editable-route-row" key={route.id}>
              <label>네트워크<input value={route.network} onChange={(event) => updateRoute(route.id, { network: event.target.value.trim() })} /></label>
              <label>마스크<input value={route.mask} onChange={(event) => updateRoute(route.id, { mask: event.target.value.trim() })} /></label>
              <label>다음 홉<input value={route.nextHop} onChange={(event) => updateRoute(route.id, { nextHop: event.target.value.trim() })} /></label>
              <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.filter((item) => item.id !== route.id) } })} type="button">삭제</button>
            </div>
          ))}
        </div>
      )}
      {(device.kind === "switch" || device.kind === "router" || device.kind === "firewall") && (
        <div className="config-group" id={`${device.id}-config-vlans`}>
          <header><strong>VLAN 데이터베이스</strong><small>{device.config.vlans.length}</small></header>
          <div className="inline-grid narrow">
            <input value={vlanDraft.id} onChange={(event) => setVlanDraft({ ...vlanDraft, id: event.target.value })} placeholder="ID" type="number" />
            <input value={vlanDraft.name} onChange={(event) => setVlanDraft({ ...vlanDraft, name: event.target.value })} placeholder="이름" />
            <button className="secondary-action" onClick={addVlan} type="button">추가</button>
          </div>
          {device.config.vlans.map((vlan) => (
            <div className="editable-vlan-row" key={vlan.id}>
              <strong>{vlan.id}</strong>
              <label>이름<input value={vlan.name} onChange={(event) => updateVlanName(vlan.id, event.target.value)} /></label>
              {vlan.id !== 1 && <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, vlans: device.config.vlans.filter((item) => item.id !== vlan.id) }, ports: device.ports.map((item) => item.vlan === vlan.id ? { ...item, vlan: 1, allowedVlans: item.allowedVlans.filter((allowed) => allowed !== vlan.id) } : item) })} type="button">삭제</button>}
            </div>
          ))}
        </div>
      )}
      {(device.kind === "wireless" || device.ports.some((item) => item.kind === "wireless")) && (
        <div className="config-group" id={`${device.id}-config-wireless`}>
          <header><strong>무선</strong><small>{device.config.wireless.ssid}</small></header>
          <label>SSID<input value={device.config.wireless.ssid} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, ssid: event.target.value } } })} /></label>
          <label>보안<select value={device.config.wireless.auth} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, auth: event.target.value as "open" | "wpa2-psk" } } })}><option value="open">open</option><option value="wpa2-psk">wpa2-psk</option></select></label>
          <label>키<input value={device.config.wireless.key} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, key: event.target.value } } })} /></label>
          <label>채널<input value={device.config.wireless.channel} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, channel: boundedNumber(event.target.value, 1, 11) } } })} type="number" /></label>
          <label>범위<input value={device.config.wireless.range} onChange={(event) => onUpdate({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, range: boundedNumber(event.target.value, 20, 1000) } } })} type="number" /></label>
        </div>
      )}
      {device.kind === "firewall" && (
        <>
          <div className="config-group" id={`${device.id}-config-security`}>
            <header><strong>접근 규칙</strong><small>{device.config.accessRules.length}</small></header>
            <div className="inline-grid services">
              <select value={aclDraft.action} onChange={(event) => setAclDraft({ ...aclDraft, action: event.target.value as AccessRule["action"] })}><option value="permit">permit</option><option value="deny">deny</option></select>
              <select value={aclDraft.protocol} onChange={(event) => setAclDraft({ ...aclDraft, protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="ftp">ftp</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select>
              <input value={aclDraft.source} onChange={(event) => setAclDraft({ ...aclDraft, source: event.target.value })} placeholder="출발지" />
              <input value={aclDraft.destination} onChange={(event) => setAclDraft({ ...aclDraft, destination: event.target.value })} placeholder="목적지" />
              <input value={aclDraft.interfaceName} onChange={(event) => setAclDraft({ ...aclDraft, interfaceName: event.target.value })} placeholder="인터페이스" />
              <button className="secondary-action" onClick={addAccessRule} type="button">ACL 추가</button>
            </div>
            {device.config.accessRules.map((rule) => (
              <div className="editable-acl-row" key={rule.id}>
                <label>동작<select value={rule.action} onChange={(event) => updateAccessRule(rule.id, { action: event.target.value as AccessRule["action"] })}><option value="permit">permit</option><option value="deny">deny</option></select></label>
                <label>프로토콜<select value={rule.protocol} onChange={(event) => updateAccessRule(rule.id, { protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="ftp">ftp</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select></label>
                <label>출발지<input value={rule.source} onChange={(event) => updateAccessRule(rule.id, { source: event.target.value.trim() })} /></label>
                <label>목적지<input value={rule.destination} onChange={(event) => updateAccessRule(rule.id, { destination: event.target.value.trim() })} /></label>
                <label>인터페이스<input value={rule.interfaceName} onChange={(event) => updateAccessRule(rule.id, { interfaceName: event.target.value.trim() })} /></label>
                <small>{rule.hits}회 적중</small>
                <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, accessRules: device.config.accessRules.filter((item) => item.id !== rule.id) } })} type="button">삭제</button>
              </div>
            ))}
          </div>
          <div className="config-group">
            <header><strong>NAT 규칙</strong><small>{device.config.natRules.length}</small></header>
            <div className="inline-grid narrow">
              <input value={natDraft.insideLocal} onChange={(event) => setNatDraft({ ...natDraft, insideLocal: event.target.value })} placeholder="내부 로컬" />
              <input value={natDraft.insideGlobal} onChange={(event) => setNatDraft({ ...natDraft, insideGlobal: event.target.value })} placeholder="내부 글로벌" />
              <input value={natDraft.outsideInterface} onChange={(event) => setNatDraft({ ...natDraft, outsideInterface: event.target.value })} placeholder="외부 인터페이스" />
              <button className="secondary-action" onClick={addNatRule} type="button">NAT 추가</button>
            </div>
            {device.config.natRules.map((rule) => (
              <div className="editable-nat-row" key={rule.id}>
                <label>내부 로컬<input value={rule.insideLocal} onChange={(event) => updateNatRule(rule.id, { insideLocal: event.target.value.trim() })} /></label>
                <label>내부 글로벌<input value={rule.insideGlobal} onChange={(event) => updateNatRule(rule.id, { insideGlobal: event.target.value.trim() })} /></label>
                <label>외부 인터페이스<input value={rule.outsideInterface} onChange={(event) => updateNatRule(rule.id, { outsideInterface: event.target.value.trim() })} /></label>
                <small>{rule.hits}회 적중</small>
                <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, natRules: device.config.natRules.filter((item) => item.id !== rule.id) } })} type="button">삭제</button>
              </div>
            ))}
          </div>
        </>
      )}
      <RuntimeTablesPanel device={device} onUpdate={onUpdate} />
    </section>
  );
}

function RuntimeTablesPanel({ device, onUpdate }: { device: NetworkDevice; onUpdate: (device: NetworkDevice) => void }) {
  const runtime = device.runtime;
  const totalEntries = runtime.arpTable.length + runtime.macTable.length + runtime.dhcpLeases.length + runtime.logs.length;
  const recentLogs = runtime.logs.slice(-5).reverse();

  function updateRuntime(patch: Partial<NetworkDevice["runtime"]>) {
    onUpdate({ ...device, runtime: { ...device.runtime, ...patch } });
  }

  return (
    <div className="config-group runtime-tables" id={`${device.id}-config-runtime`}>
      <header>
        <strong>런타임 테이블</strong>
        <button className="secondary-action" disabled={totalEntries === 0} onClick={() => updateRuntime({ arpTable: [], macTable: [], dhcpLeases: [], logs: [] })} type="button">전체 비우기</button>
      </header>
      <div className="runtime-summary-row">
        <span><strong>{runtime.arpTable.length}</strong> ARP</span>
        <span><strong>{runtime.macTable.length}</strong> MAC</span>
        <span><strong>{runtime.dhcpLeases.length}</strong> DHCP</span>
        <span><strong>{runtime.logs.length}</strong> 로그</span>
      </div>
      <div className="runtime-table-grid">
        <section className="runtime-table">
          <header><strong>ARP</strong><button className="secondary-action" disabled={!runtime.arpTable.length} onClick={() => updateRuntime({ arpTable: [] })} type="button">비우기</button></header>
          {runtime.arpTable.slice(0, 6).map((entry) => (
            <div key={`${entry.ipAddress}-${entry.macAddress}`}><span>{entry.ipAddress}</span><span>{entry.macAddress}</span><small>{entry.portName || "-"}</small></div>
          ))}
          {!runtime.arpTable.length && <p>학습된 ARP 항목이 없습니다.</p>}
        </section>
        <section className="runtime-table">
          <header><strong>MAC Address Table</strong><button className="secondary-action" disabled={!runtime.macTable.length} onClick={() => updateRuntime({ macTable: [] })} type="button">비우기</button></header>
          {runtime.macTable.slice(0, 6).map((entry) => (
            <div key={`${entry.vlan}-${entry.macAddress}-${entry.portName}`}><span>VLAN {entry.vlan}</span><span>{entry.macAddress}</span><small>{entry.type} / {entry.portName}</small></div>
          ))}
          {!runtime.macTable.length && <p>학습된 MAC 항목이 없습니다.</p>}
        </section>
        <section className="runtime-table">
          <header><strong>DHCP Binding</strong><button className="secondary-action" disabled={!runtime.dhcpLeases.length} onClick={() => updateRuntime({ dhcpLeases: [] })} type="button">비우기</button></header>
          {runtime.dhcpLeases.slice(0, 6).map((lease) => (
            <div key={`${lease.ipAddress}-${lease.deviceId}`}><span>{lease.ipAddress}</span><span>{lease.macAddress}</span><small>{new Date(lease.expiresAt).toLocaleTimeString()}</small></div>
          ))}
          {!runtime.dhcpLeases.length && <p>활성 DHCP 바인딩이 없습니다.</p>}
        </section>
        <section className="runtime-table">
          <header><strong>SYSLOG</strong><button className="secondary-action" disabled={!runtime.logs.length} onClick={() => updateRuntime({ logs: [] })} type="button">비우기</button></header>
          {recentLogs.map((log) => (
            <div className={log.level} key={log.id}><span>{new Date(log.createdAt).toLocaleTimeString()}</span><span>{log.level}</span><small>{log.message}</small></div>
          ))}
          {!recentLogs.length && <p>수집된 로그가 없습니다.</p>}
        </section>
      </div>
    </div>
  );
}

const cliCommandHints = [
  { command: "power on", detail: "장비 부팅" },
  { command: "power cycle", detail: "전원 재시작" },
  { command: "setup", detail: "초기 설정 대화상자" },
  { command: "enable", detail: "관리자 EXEC 모드" },
  { command: "clock set 12:34:56 Jun 19 2026", detail: "장비 시간 설정" },
  { command: "configure terminal", detail: "전역 설정 모드" },
  { command: "hostname ", detail: "장비 이름 변경" },
  { command: "interface ", detail: "인터페이스 진입" },
  { command: "description ", detail: "인터페이스 설명" },
  { command: "ip address ", detail: "IP와 마스크 설정" },
  { command: "duplex full", detail: "포트 duplex 설정" },
  { command: "speed 100", detail: "포트 속도 설정" },
  { command: "mtu 1500", detail: "인터페이스 MTU" },
  { command: "bandwidth 100000", detail: "인터페이스 대역폭" },
  { command: "no shutdown", detail: "인터페이스 활성화" },
  { command: "shutdown", detail: "인터페이스 비활성화" },
  { command: "switchport mode access", detail: "access 모드" },
  { command: "switchport mode trunk", detail: "trunk 모드" },
  { command: "switchport access vlan ", detail: "VLAN 지정" },
  { command: "switchport trunk allowed vlan ", detail: "허용 VLAN 설정" },
  { command: "spanning-tree vlan 1 root primary", detail: "VLAN STP root primary" },
  { command: "ip route ", detail: "정적 라우트" },
  { command: "ip name-server 8.8.8.8", detail: "DNS 서버 설정" },
  { command: "ip dhcp pool ", detail: "DHCP 풀" },
  { command: "network ", detail: "DHCP 네트워크" },
  { command: "default-router ", detail: "DHCP 게이트웨이" },
  { command: "dns-server ", detail: "DHCP DNS" },
  { command: "show running-config", detail: "현재 설정" },
  { command: "show startup-config", detail: "저장 설정" },
  { command: "show version", detail: "IOS/하드웨어 정보" },
  { command: "show clock", detail: "장비 시간" },
  { command: "show boot", detail: "부팅 이미지와 NVRAM 상태" },
  { command: "show platform", detail: "섀시/포트 상태" },
  { command: "show environment", detail: "전원/온도/팬 상태" },
  { command: "show tech-support", detail: "종합 진단 출력" },
  { command: "show ip interface brief", detail: "인터페이스 요약" },
  { command: "show interfaces status", detail: "포트 상태/속도 요약" },
  { command: "show interfaces counters", detail: "포트 카운터" },
  { command: "show interfaces trunk", detail: "trunk 목록" },
  { command: "test cable-diagnostics tdr interface ", detail: "케이블 TDR 진단 시작" },
  { command: "show cable-diagnostics tdr", detail: "케이블 TDR 결과" },
  { command: "show vlan brief", detail: "VLAN 테이블" },
  { command: "show mac address-table", detail: "MAC 테이블" },
  { command: "show cdp neighbors", detail: "직접 연결 이웃" },
  { command: "show ip route", detail: "라우팅 테이블" },
  { command: "show arp", detail: "ARP 테이블" },
  { command: "show hosts", detail: "DNS 서버와 호스트 테이블" },
  { command: "clear arp ", detail: "ARP 항목 삭제" },
  { command: "clear mac address-table dynamic", detail: "동적 MAC 테이블 삭제" },
  { command: "clear mac address-table dynamic interface ", detail: "포트별 MAC 삭제" },
  { command: "clear ip dhcp binding ", detail: "DHCP 바인딩 삭제" },
  { command: "ping ", detail: "ICMP 테스트" },
  { command: "traceroute ", detail: "경로 추적" },
  { command: "write memory", detail: "startup-config 저장" },
  { command: "copy running-config startup-config", detail: "설정 저장" },
  { command: "exit", detail: "현재 모드 나가기" },
  { command: "end", detail: "관리자 모드로 이동" },
  { command: "help", detail: "명령 목록" }
];

function initialCliLines(device: NetworkDevice): string[] {
  if (device.powerOn) {
    const base = bootBanner(device).split("\n");
    const session = initialConsoleSession(device);
    if (session.pendingAction === "console-username") return [...base, "", "User Access Verification", "", "Username:"];
    if (session.pendingAction === "console-password") return [...base, "", "User Access Verification", "", "Password:"];
    return base;
  }
  return [
    `${device.model} console`,
    "Power is off. Console is attached, but the device is not running.",
    "Type power on to boot the device, or turn on power from the Physical tab."
  ];
}

function initialCliSessionForDevice(device: NetworkDevice): CliSession {
  if (!device.powerOn) return cliEngine.initialSession();
  if (device.config.startupConfig.length === 0) return { ...cliEngine.initialSession(), pendingAction: "initial-config" };
  return initialConsoleSession(device);
}

function CliTab({ device, project, onUpdate, onProjectChange }: { device: NetworkDevice; project: NetworkProject; onUpdate: (device: NetworkDevice) => void; onProjectChange: (project: NetworkProject, message: string) => void }) {
  const [lines, setLines] = useState<string[]>(() => initialCliLines(device));
  const [input, setInput] = useState("");
  const [session, setSession] = useState<CliSession>(() => initialCliSessionForDevice(device));
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const [completionItems, setCompletionItems] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const visibleHints = cliCommandHints.filter((hint) => `${hint.command} ${hint.detail}`.toLowerCase().includes(helpQuery.trim().toLowerCase()));

  useEffect(() => {
    setLines(initialCliLines(device));
    setInput("");
    setSession(initialCliSessionForDevice(device));
    setHelpOpen(false);
    setHelpQuery("");
    setCompletionItems([]);
    setHistory([]);
    setHistoryIndex(null);
  }, [device.id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  async function run(commandOverride?: string) {
    const prompt = cliEngine.prompt(device, session);
    const commandText = commandOverride ?? input;
    const normalizedInput = commandText.trim().toLowerCase().replace(/\s+/g, " ");
    const submittedInput = commandText;
    const sensitiveInput = session.pendingAction === "enable-password" || session.pendingAction === "console-password";
    setHistoryIndex(null);
    if (submittedInput.trim() && !sensitiveInput) {
      setHistory((items) => [...items, submittedInput].slice(-80));
    }
    setCompletionItems([]);
    if (normalizedInput.startsWith("ping ") || normalizedInput.startsWith("traceroute ") || normalizedInput.startsWith("tracert ")) {
      const output = await runCliPacketCommand(project, device, commandText, onProjectChange);
      setLines((items) => [...items, `${prompt} ${submittedInput}`, output].filter(Boolean));
      setInput("");
      return;
    }
    if (device.powerOn && isCdpNeighborsCommand(normalizedInput)) {
      setLines((items) => [...items, `${prompt} ${submittedInput}`, showCdpNeighbors(project, device, isCdpDetailCommand(normalizedInput))].filter(Boolean));
      setInput("");
      return;
    }
    const result = await cliEngine.run(device, session, commandText);
    setSession(result.session);
    onUpdate(result.device);
    setLines((items) => [...items, sensitiveInput ? "" : `${prompt} ${submittedInput}`, result.output].filter(Boolean));
    setInput("");
  }

  function completeInput() {
    const matches = cliEngine.completions(device, session, input);
    if (matches.length === 1) {
      const next = matches[0].endsWith(" ") ? matches[0] : `${matches[0]} `;
      setInput(next);
      setCompletionItems([]);
      setHelpOpen(false);
      return;
    }
    setCompletionItems(matches);
    setHelpOpen(false);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void run("end");
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      if (session.pendingAction) {
        void run("no");
      } else {
        const prompt = cliEngine.prompt(device, session);
        setLines((items) => [...items, `${prompt} ${input}^C`]);
        setInput("");
        setCompletionItems([]);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      completeInput();
      return;
    }
    if (event.key === "ArrowUp") {
      if (history.length === 0) return;
      event.preventDefault();
      const nextIndex = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      setCompletionItems([]);
      return;
    }
    if (event.key === "ArrowDown") {
      if (history.length === 0 || historyIndex === null) return;
      event.preventDefault();
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        setInput("");
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
      setCompletionItems([]);
      return;
    }
    if (event.key === "Escape") {
      setCompletionItems([]);
    }
  }

  return (
    <section className="terminal cli-terminal">
      <header className="terminal-header">
        <Terminal size={16} />
        <span>{device.config.hostname}</span>
        <button className="terminal-help-button" onClick={() => setHelpOpen((value) => !value)} title="CLI 명령 도움말" type="button"><CircleHelp size={15} /></button>
      </header>
      {helpOpen ? (
        <div className="cli-help-panel">
          <input value={helpQuery} onChange={(event) => setHelpQuery(event.target.value)} placeholder="명령 검색" />
          <div className="cli-help-list">
            {visibleHints.map((hint) => (
              <button key={hint.command} onClick={() => { setInput(hint.command); setHelpOpen(false); }} type="button">
                <strong>{hint.command}</strong>
                <span>{hint.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ) : completionItems.length > 0 && (
        <div className="cli-completion-panel">
          <strong>입력 가능한 명령</strong>
          <div>
            {completionItems.map((item) => (
              <button key={item} onClick={() => { setInput(item.endsWith(" ") ? item : `${item} `); setCompletionItems([]); }} type="button">{item || "확인"}</button>
            ))}
          </div>
        </div>
      )}
      <div ref={outputRef} className="terminal-output">{lines.map((line, index) => <pre key={index}>{line}</pre>)}</div>
      <form className="cli-input-row" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <span>{cliEngine.prompt(device, session)}</span>
        <input
          aria-label="CLI 명령"
          type={session.pendingAction === "enable-password" || session.pendingAction === "console-password" ? "password" : "text"}
          value={input}
          onChange={(event) => { setInput(event.target.value); setCompletionItems([]); }}
          onKeyDown={handleInputKeyDown}
          placeholder="show ip interface brief"
        />
      </form>
      <small>{cliEngine.prompt(device, session)} | Tab 자동완성, ↑/↓ 기록, ?, help, sh route, conf t, interface, vlan, ip route, show run, write memory</small>
    </section>
  );
}

async function runCliPacketCommand(project: NetworkProject, device: NetworkDevice, command: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<string> {
  const lower = command.trim().toLowerCase();
  const targetText = command.trim().split(/\s+/).slice(1).join(" ");
  const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
  if (!resolved.target) return `% ${targetText} 대상을 찾을 수 없습니다: ${resolved.error}`;
  const before = resolved.project.simulationEvents.length;
  const result = await simulatePing(resolved.project, device.id, resolved.target.id);
  onProjectChange(result.project, result.message);
  if (lower.startsWith("traceroute ") || lower.startsWith("tracert ")) {
    const newEvents = result.project.simulationEvents.slice(before);
    const hops = newEvents
      .map((event) => result.project.devices.find((item) => item.id === event.atDeviceId)?.label ?? event.atDeviceId)
      .filter((label, index, list) => list.indexOf(label) === index);
    return [`${resolved.target.label} 경로 추적`, ...hops.map((hop, index) => `${index + 1}  ${hop}`), result.success ? "추적 완료." : result.message].join("\n");
  }
  return result.success
    ? `중단하려면 escape sequence를 입력하세요.\n${resolved.target.label}에 100바이트 ICMP Echo 5개를 보냅니다.\n!!!!!\n성공률 100%\n${result.message}`
    : `중단하려면 escape sequence를 입력하세요.\n${resolved.target.label}에 100바이트 ICMP Echo 5개를 보냅니다.\n.....\n성공률 0%\n${result.message}`;
}

function showCdpNeighbors(project: NetworkProject, device: NetworkDevice, detail = false): string {
  const rows = project.links
    .filter((link) => link.status === "up" && (link.endpointA.deviceId === device.id || link.endpointB.deviceId === device.id))
    .map((link) => {
      const localRef = link.endpointA.deviceId === device.id ? link.endpointA : link.endpointB;
      const peerRef = link.endpointA.deviceId === device.id ? link.endpointB : link.endpointA;
      const localPort = endpointLabel(project, localRef.deviceId, localRef.portId);
      const peer = project.devices.find((item) => item.id === peerRef.deviceId);
      const peerPort = endpointLabel(project, peerRef.deviceId, peerRef.portId);
      if (detail) {
        return [
          "-------------------------",
          `Device ID: ${peer?.label ?? peerRef.deviceId}`,
          `Entry address(es): ${primaryDeviceIp(peer) || "unassigned"}`,
          `Platform: ${peer?.model ?? "unknown"}, Capabilities: ${peer?.kind ?? "device"}`,
          `Interface: ${localPort}, Port ID (outgoing port): ${peerPort}`,
          "Holdtime: 120 sec",
          `Version: ${peer?.model ?? "Network Editor Web"}`
        ].join("\n");
      }
      return `${(peer?.label ?? peerRef.deviceId).padEnd(18)}${localPort.padEnd(22)}${(peer?.model ?? "").padEnd(22)}${peerPort}`;
    });
  if (!rows.length) return "CDP 이웃이 없습니다.";
  return detail ? rows.join("\n\n") : ["장비 ID           로컬 인터페이스        플랫폼                포트 ID", ...rows].join("\n");
}

function isCdpNeighborsCommand(value: string): boolean {
  const [verb, feature, target] = value.split(/\s+/);
  return Boolean((verb === "show" || verb === "sho" || verb === "sh") && feature === "cdp" && target && "neighbors".startsWith(target));
}

function isCdpDetailCommand(value: string): boolean {
  return value.split(/\s+/)[3]?.startsWith("det") ?? false;
}

function primaryDeviceIp(device: NetworkDevice | undefined): string {
  return device?.ports.find((port) => port.ipAddress)?.ipAddress ?? "";
}

function endpointLabel(project: NetworkProject, deviceId: string, portId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.ports.find((port) => port.id === portId)?.name ?? portId;
}

function remoteAccessState(device: NetworkDevice, protocol: "ssh" | "telnet"): { enabled: boolean; reason: string } {
  if (!device.powerOn) return { enabled: false, reason: "대상 장비 전원이 꺼져 있습니다." };
  const vtyLines = (device.config.lineConfigs ?? []).filter((line) => line.kind === "vty");
  if (!vtyLines.length) return { enabled: false, reason: "VTY line이 설정되지 않았습니다." };
  if (protocol === "ssh") {
    if (!device.config.domainName) return { enabled: false, reason: "ip domain-name이 설정되지 않았습니다." };
    if (!device.config.rsaKeyGenerated) return { enabled: false, reason: "RSA 키가 생성되지 않았습니다." };
    if (!(device.config.localUsers ?? []).length) return { enabled: false, reason: "로컬 사용자 계정이 없습니다." };
    if (!vtyLines.some((line) => line.loginLocal && transportAllows(line.transportInput, "ssh"))) return { enabled: false, reason: "VTY login local 또는 transport input ssh가 없습니다." };
    return { enabled: true, reason: "SSH 사용 가능" };
  }
  if (!vtyLines.some((line) => (line.login || line.loginLocal) && transportAllows(line.transportInput, "telnet"))) return { enabled: false, reason: "VTY login 또는 transport input telnet이 없습니다." };
  return { enabled: true, reason: "Telnet 사용 가능" };
}

function transportAllows(transportInput: string, protocol: "ssh" | "telnet"): boolean {
  const tokens = transportInput.toLowerCase().split(/[,\s]+/).filter(Boolean);
  return tokens.includes("all") || tokens.includes(protocol);
}

const desktopQuickCommands = ["help", "ipconfig /all", "ipconfig /displaydns", "ipconfig /flushdns", "ipconfig /renew", "ipconfig /release", "arp -a", "route print", "netstat -r", "ping -n 4 www.lab.local", "tracert www.lab.local", "nslookup www.lab.local", "web www.lab.local", "ftp www.lab.local", "mail www.lab.local admin@lab.local test", "ssh 192.168.1.1", "telnet 192.168.1.1", "tftp www.lab.local", "syslog www.lab.local link-check"];

type DesktopApp = "ip" | "prompt" | "browser" | "terminal" | "ftp" | "email" | "tftp" | "syslog";

function DesktopTab({ device, project, onProjectChange, onUpdate }: { device: NetworkDevice; project: NetworkProject; onProjectChange: (project: NetworkProject, message: string) => void; onUpdate: (device: NetworkDevice) => void }) {
  const dataPorts = device.ports.filter((port) => port.kind !== "console");
  const [activeApp, setActiveApp] = useState<DesktopApp>("prompt");
  const [selectedPortId, setSelectedPortId] = useState(dataPorts[0]?.id ?? "");
  const [output, setOutput] = useState("명령 프롬프트");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const consoleTargets = useMemo(() => desktopConsoleTargets(project, device), [device.id, project.devices, project.links]);
  const [terminalTargetId, setTerminalTargetId] = useState("");
  const terminalTarget = consoleTargets.find((target) => target.id === terminalTargetId) ?? consoleTargets[0] ?? null;
  const [terminalLines, setTerminalLines] = useState<string[]>(["Terminal"]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalSession, setTerminalSession] = useState<CliSession>(() => cliEngine.initialSession());
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState<number | null>(null);
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);
  const [browserTarget, setBrowserTarget] = useState("www.lab.local");
  const [browserOutput, setBrowserOutput] = useState("웹 브라우저");
  const [ftpTarget, setFtpTarget] = useState("www.lab.local");
  const [ftpAction, setFtpAction] = useState("ls");
  const [ftpOutput, setFtpOutput] = useState("FTP Client");
  const [emailTarget, setEmailTarget] = useState("www.lab.local");
  const [emailRecipient, setEmailRecipient] = useState("admin@lab.local");
  const [emailMessage, setEmailMessage] = useState(`${device.label} mail test`);
  const [emailOutput, setEmailOutput] = useState("Email Client");
  const [tftpTarget, setTftpTarget] = useState("www.lab.local");
  const [tftpOutput, setTftpOutput] = useState("TFTP Client");
  const [syslogTarget, setSyslogTarget] = useState("www.lab.local");
  const [syslogMessage, setSyslogMessage] = useState(`${device.label} link-check`);
  const [syslogOutput, setSyslogOutput] = useState("SYSLOG Client");
  const selectedPort = dataPorts.find((port) => port.id === selectedPortId) ?? dataPorts[0];

  useEffect(() => {
    if (!dataPorts.some((port) => port.id === selectedPortId)) setSelectedPortId(dataPorts[0]?.id ?? "");
  }, [device.id, dataPorts.length, selectedPortId]);

  useEffect(() => {
    if (!consoleTargets.some((target) => target.id === terminalTargetId)) setTerminalTargetId(consoleTargets[0]?.id ?? "");
  }, [consoleTargets, terminalTargetId]);

  useEffect(() => {
    if (!terminalTarget) {
      setTerminalLines(["Terminal", "Console 케이블 대상이 없습니다. PC RS232와 장비 Console 포트를 Console 케이블로 연결하세요."]);
      setTerminalSession(cliEngine.initialSession());
      setTerminalInput("");
      setTerminalHistory([]);
      setTerminalHistoryIndex(null);
      return;
    }
    setTerminalLines([`Connected from ${device.label} RS232 to ${terminalTarget.label} console`, ...initialCliLines(terminalTarget)]);
    setTerminalSession(initialCliSessionForDevice(terminalTarget));
    setTerminalInput("");
    setTerminalHistory([]);
    setTerminalHistoryIndex(null);
  }, [device.label, terminalTarget?.id]);

  useEffect(() => {
    if (terminalOutputRef.current) terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
  }, [terminalLines]);

  function updateDesktopPort(portId: string, patch: Partial<NetworkPort>) {
    onUpdate({ ...device, ports: device.ports.map((port) => port.id === portId ? { ...port, ...patch } : port) });
  }

  async function runDesktopCommand() {
    const command = input.trim();
    if (!command) return;
    setHistory((items) => [...items, command].slice(-60));
    setHistoryIndex(null);
    const nextOutput = await desktopCommand(project, device, command, onProjectChange);
    setOutput((current) => `${current}\n\n> ${command}\n${nextOutput}`);
    setInput("");
  }

  async function runTerminalCommand() {
    if (!terminalTarget) return;
    const prompt = cliEngine.prompt(terminalTarget, terminalSession);
    const commandText = terminalInput;
    const normalizedInput = commandText.trim().toLowerCase().replace(/\s+/g, " ");
    const sensitiveInput = terminalSession.pendingAction === "enable-password" || terminalSession.pendingAction === "console-password";
    setTerminalHistoryIndex(null);
    if (commandText.trim() && !sensitiveInput) {
      setTerminalHistory((items) => [...items, commandText].slice(-80));
    }
    if (normalizedInput.startsWith("ping ") || normalizedInput.startsWith("traceroute ") || normalizedInput.startsWith("tracert ")) {
      const outputText = await runCliPacketCommand(project, terminalTarget, commandText, onProjectChange);
      setTerminalLines((items) => [...items, `${prompt} ${commandText}`, outputText].filter(Boolean));
      setTerminalInput("");
      return;
    }
    if (terminalTarget.powerOn && isCdpNeighborsCommand(normalizedInput)) {
      setTerminalLines((items) => [...items, `${prompt} ${commandText}`, showCdpNeighbors(project, terminalTarget, isCdpDetailCommand(normalizedInput))].filter(Boolean));
      setTerminalInput("");
      return;
    }
    const result = await cliEngine.run(terminalTarget, terminalSession, commandText);
    setTerminalSession(result.session);
    onProjectChange({
      ...project,
      devices: project.devices.map((item) => item.id === result.device.id ? result.device : item)
    }, `${device.label} Terminal에서 ${result.device.label} CLI를 실행했습니다.`);
    setTerminalLines((items) => [...items, sensitiveInput ? "" : `${prompt} ${commandText}`, result.output].filter(Boolean));
    setTerminalInput("");
  }

  function handleTerminalKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!terminalTarget) return;
    if (event.key === "Tab") {
      event.preventDefault();
      const matches = cliEngine.completions(terminalTarget, terminalSession, terminalInput);
      if (matches.length === 1) {
        setTerminalInput(matches[0].endsWith(" ") ? matches[0] : `${matches[0]} `);
      } else if (matches.length > 1) {
        setTerminalLines((items) => [...items, `Completions: ${matches.join(", ")}`]);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (!terminalHistory.length) return;
      event.preventDefault();
      const nextIndex = terminalHistoryIndex === null ? terminalHistory.length - 1 : Math.max(0, terminalHistoryIndex - 1);
      setTerminalHistoryIndex(nextIndex);
      setTerminalInput(terminalHistory[nextIndex]);
      return;
    }
    if (event.key === "ArrowDown") {
      if (!terminalHistory.length || terminalHistoryIndex === null) return;
      event.preventDefault();
      const nextIndex = terminalHistoryIndex + 1;
      if (nextIndex >= terminalHistory.length) {
        setTerminalHistoryIndex(null);
        setTerminalInput("");
      } else {
        setTerminalHistoryIndex(nextIndex);
        setTerminalInput(terminalHistory[nextIndex]);
      }
    }
  }

  function chooseCommand(command: string) {
    setInput(command);
    setActiveApp("prompt");
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      if (!history.length) return;
      event.preventDefault();
      const nextIndex = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }
    if (event.key === "ArrowDown") {
      if (!history.length || historyIndex === null) return;
      event.preventDefault();
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        setInput("");
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    }
  }

  async function runBrowser() {
    const target = browserTarget.trim();
    if (!target) return;
    const nextOutput = await desktopCommand(project, device, `http ${target}`, onProjectChange);
    setBrowserOutput(nextOutput);
  }

  async function runDesktopAppCommand(command: string, updateOutput: (value: string) => void) {
    const normalized = command.trim();
    if (!normalized) return;
    const nextOutput = await desktopCommand(project, device, normalized, onProjectChange);
    updateOutput(nextOutput);
  }

  async function runFtpApp() {
    await runDesktopAppCommand(`ftp ${ftpTarget.trim()} ${ftpAction.trim() || "ls"}`, setFtpOutput);
  }

  async function runEmailApp() {
    await runDesktopAppCommand(`email ${emailTarget.trim()} ${emailRecipient.trim()} ${emailMessage.trim()}`, setEmailOutput);
  }

  async function runTftpApp() {
    await runDesktopAppCommand(`tftp ${tftpTarget.trim()}`, setTftpOutput);
  }

  async function runSyslogApp() {
    await runDesktopAppCommand(`syslog ${syslogTarget.trim()} ${syslogMessage.trim()}`, setSyslogOutput);
  }

  return (
    <section className="desktop-panel">
      <div className="desktop-app-bar">
        <button className={activeApp === "ip" ? "active" : ""} onClick={() => setActiveApp("ip")} type="button"><Settings size={15} />IP 설정</button>
        <button className={activeApp === "prompt" ? "active" : ""} onClick={() => setActiveApp("prompt")} type="button"><Terminal size={15} />명령 프롬프트</button>
        <button className={activeApp === "terminal" ? "active" : ""} onClick={() => setActiveApp("terminal")} type="button"><Terminal size={15} />Terminal</button>
        <button className={activeApp === "browser" ? "active" : ""} onClick={() => setActiveApp("browser")} type="button"><Monitor size={15} />웹 브라우저</button>
        <button className={activeApp === "ftp" ? "active" : ""} onClick={() => setActiveApp("ftp")} type="button"><Server size={15} />FTP</button>
        <button className={activeApp === "email" ? "active" : ""} onClick={() => setActiveApp("email")} type="button"><Mail size={15} />Email</button>
        <button className={activeApp === "tftp" ? "active" : ""} onClick={() => setActiveApp("tftp")} type="button"><Download size={15} />TFTP</button>
        <button className={activeApp === "syslog" ? "active" : ""} onClick={() => setActiveApp("syslog")} type="button"><Info size={15} />Syslog</button>
      </div>
      {activeApp === "ip" && (
        <div className="desktop-ip-config">
          <header>
            <strong>IP 설정</strong>
            <select value={selectedPort?.id ?? ""} onChange={(event) => setSelectedPortId(event.target.value)}>
              {dataPorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}
            </select>
          </header>
          {selectedPort ? (
            <>
              <label>IPv4 주소<input value={selectedPort.ipAddress} onChange={(event) => updateDesktopPort(selectedPort.id, { ipAddress: event.target.value.trim() })} placeholder="192.168.1.10" /></label>
              <label>서브넷 마스크<input value={selectedPort.subnetMask} onChange={(event) => updateDesktopPort(selectedPort.id, { subnetMask: event.target.value.trim() })} placeholder="255.255.255.0" /></label>
              <label>기본 게이트웨이<input value={selectedPort.gateway} onChange={(event) => updateDesktopPort(selectedPort.id, { gateway: event.target.value.trim() })} placeholder="192.168.1.1" /></label>
              <label>DNS 서버<input value={selectedPort.dnsServer} onChange={(event) => updateDesktopPort(selectedPort.id, { dnsServer: event.target.value.trim() })} placeholder="192.168.1.10" /></label>
              <button className="secondary-action" onClick={() => { const result = requestDhcp(project, device.id); onProjectChange(result.project, result.message); }} type="button">DHCP</button>
            </>
          ) : <p className="empty-state">설정 가능한 네트워크 어댑터가 없습니다.</p>}
        </div>
      )}
      {activeApp === "prompt" && (
        <section className="terminal desktop-terminal">
          <div className="desktop-command-palette">
            {desktopQuickCommands.map((command) => <button key={command} onClick={() => chooseCommand(command)} type="button">{command}</button>)}
          </div>
          <pre>{output}</pre>
          <form className="desktop-input-row" onSubmit={(event) => { event.preventDefault(); void runDesktopCommand(); }}>
            <span>{device.config.hostname || device.label}&gt;</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handlePromptKeyDown} placeholder="ipconfig | ping 192.168.1.1 | tracert www.lab.local | http www.lab.local" />
          </form>
          <small>프로젝트 장비 {project.devices.length}개 | ipconfig, arp -a, route print, ping, tracert, nslookup, http, ftp, email, ssh, telnet, tftp, syslog</small>
        </section>
      )}
      {activeApp === "browser" && (
        <section className="desktop-browser">
          <form onSubmit={(event) => { event.preventDefault(); void runBrowser(); }}>
            <input value={browserTarget} onChange={(event) => setBrowserTarget(event.target.value)} placeholder="www.lab.local 또는 192.168.1.10" />
            <button className="secondary-action" type="submit">이동</button>
          </form>
          <pre>{browserOutput}</pre>
        </section>
      )}
      {activeApp === "terminal" && (
        <section className="terminal desktop-console-app">
          <header>
            <strong>Terminal</strong>
            <select value={terminalTarget?.id ?? ""} onChange={(event) => setTerminalTargetId(event.target.value)} disabled={!consoleTargets.length}>
              {consoleTargets.length ? consoleTargets.map((target) => <option key={target.id} value={target.id}>{target.label} Console</option>) : <option value="">Console 대상 없음</option>}
            </select>
          </header>
          <div ref={terminalOutputRef} className="terminal-output">{terminalLines.map((line, index) => <pre key={index}>{line}</pre>)}</div>
          <form className="cli-input-row" onSubmit={(event) => { event.preventDefault(); void runTerminalCommand(); }}>
            <span>{terminalTarget ? cliEngine.prompt(terminalTarget, terminalSession) : "Terminal>"}</span>
            <input
              disabled={!terminalTarget}
              type={terminalSession.pendingAction === "enable-password" || terminalSession.pendingAction === "console-password" ? "password" : "text"}
              value={terminalInput}
              onChange={(event) => setTerminalInput(event.target.value)}
              onKeyDown={handleTerminalKeyDown}
              placeholder="show ip interface brief"
            />
          </form>
          <small>Console 케이블로 연결된 장비 CLI입니다. Tab 자동완성, ↑/↓ 기록을 지원합니다.</small>
        </section>
      )}
      {activeApp === "ftp" && (
        <section className="desktop-service-app">
          <form onSubmit={(event) => { event.preventDefault(); void runFtpApp(); }}>
            <label>서버<input value={ftpTarget} onChange={(event) => setFtpTarget(event.target.value)} placeholder="www.lab.local" /></label>
            <label>명령<input value={ftpAction} onChange={(event) => setFtpAction(event.target.value)} placeholder="ls 또는 get readme.txt" /></label>
            <button className="secondary-action" type="submit">연결</button>
          </form>
          <pre>{ftpOutput}</pre>
        </section>
      )}
      {activeApp === "email" && (
        <section className="desktop-service-app">
          <form onSubmit={(event) => { event.preventDefault(); void runEmailApp(); }}>
            <label>서버<input value={emailTarget} onChange={(event) => setEmailTarget(event.target.value)} placeholder="www.lab.local" /></label>
            <label>받는 사람<input value={emailRecipient} onChange={(event) => setEmailRecipient(event.target.value)} placeholder="admin@lab.local" /></label>
            <label className="wide">메시지<input value={emailMessage} onChange={(event) => setEmailMessage(event.target.value)} placeholder="Packet Tracer lab test" /></label>
            <button className="secondary-action" type="submit">보내기</button>
          </form>
          <pre>{emailOutput}</pre>
        </section>
      )}
      {activeApp === "tftp" && (
        <section className="desktop-service-app compact">
          <form onSubmit={(event) => { event.preventDefault(); void runTftpApp(); }}>
            <label>서버<input value={tftpTarget} onChange={(event) => setTftpTarget(event.target.value)} placeholder="www.lab.local" /></label>
            <button className="secondary-action" type="submit">조회</button>
          </form>
          <pre>{tftpOutput}</pre>
        </section>
      )}
      {activeApp === "syslog" && (
        <section className="desktop-service-app">
          <form onSubmit={(event) => { event.preventDefault(); void runSyslogApp(); }}>
            <label>서버<input value={syslogTarget} onChange={(event) => setSyslogTarget(event.target.value)} placeholder="www.lab.local" /></label>
            <label className="wide">메시지<input value={syslogMessage} onChange={(event) => setSyslogMessage(event.target.value)} placeholder="link-check" /></label>
            <button className="secondary-action" type="submit">전송</button>
          </form>
          <pre>{syslogOutput}</pre>
        </section>
      )}
    </section>
  );
}

async function desktopCommand(project: NetworkProject, device: NetworkDevice, command: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<string> {
  const lower = command.toLowerCase();
  if (lower === "help" || lower === "?") {
    return [
      "지원 명령:",
      "  ipconfig /all | ipconfig /displaydns | ipconfig /flushdns | ipconfig /renew | ipconfig /release",
      "  arp -a | route print | netstat -r",
      "  ping [-n 횟수] <ip|이름> | tracert <ip|이름> | nslookup <이름|ip>",
      "  http|web|browser <ip|이름> | ftp <ip|이름> [ls|get 파일] | email|mail <서버> <받는사람> [메시지]",
      "  ssh <ip|이름> | telnet <ip|이름> | tftp <ip|이름> | syslog <ip|이름> <메시지>"
    ].join("\n");
  }
  if (lower === "ipconfig" || lower === "ipconfig /all") {
    return device.ports
      .filter((port) => port.kind !== "console")
      .map((port) => [
        `${port.name}:`,
        `  IPv4 주소 . . . . . . . . . . . : ${port.ipAddress || "0.0.0.0"}`,
        `  서브넷 마스크 . . . . . . . . . : ${port.subnetMask || "0.0.0.0"}`,
        `  기본 게이트웨이 . . . . . . . . : ${port.gateway || "0.0.0.0"}`,
        `  DNS 서버 . . . . . . . . . . . . : ${port.dnsServer || "0.0.0.0"}`
      ].join("\n"))
      .join("\n");
  }
  if (lower === "ipconfig /displaydns") {
    const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
    if (!dnsServerIp) return "DNS 확인자 캐시에 표시할 서버가 없습니다.";
    const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
    if (!server) return `DNS 서버 ${dnsServerIp}을(를) 찾을 수 없습니다.`;
    return [
      "Windows IP Configuration",
      "",
      "DNS Resolver Cache",
      `Server: ${server.label} (${dnsServerIp})`,
      "",
      ...(server.config.dnsRecords.length ? server.config.dnsRecords.flatMap((record) => [
        `Record Name . . . . . : ${record.name}`,
        `Record Type . . . . . : A`,
        `A (Host) Record . . . : ${record.value}`,
        ""
      ]) : ["캐시된 DNS 레코드가 없습니다."])
    ].join("\n").trimEnd();
  }
  if (lower === "ipconfig /flushdns") {
    return "Windows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.";
  }
  if (lower === "ipconfig /renew") {
    const result = requestDhcp(project, device.id);
    onProjectChange(result.project, result.message);
    return result.message;
  }
  if (lower === "ipconfig /release") {
    const released = releaseDhcp(project, device.id);
    onProjectChange(released.project, released.message);
    return released.message;
  }
  if (lower === "arp -a") {
    return device.runtime.arpTable.map((entry) => `${entry.ipAddress.padEnd(16)}${entry.macAddress.padEnd(20)}${entry.portName}`).join("\n") || "ARP 항목이 없습니다.";
  }
  if (lower === "route print" || lower === "netstat -r") {
    const routes = device.ports
      .filter((port) => port.ipAddress && port.subnetMask && isIpv4(port.ipAddress) && isIpv4(port.subnetMask))
      .flatMap((port) => [
        `${networkAddress(port.ipAddress, port.subnetMask)}/${maskToPrefix(port.subnetMask)} 직접 연결 ${port.name}`,
        `${port.ipAddress}/32 직접 연결 ${port.name}`,
        ...(port.gateway ? [`0.0.0.0/0 via ${port.gateway} dev ${port.name}`] : [])
      ]);
    return routes.join("\n") || "설치된 라우트가 없습니다.";
  }
  if (lower.startsWith("ping ")) {
    const parsed = parseDesktopPingCommand(command);
    if (!parsed.targetText.trim()) return "사용법: ping [-n 횟수] <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, parsed.targetText, onProjectChange);
    if (!resolved.target) return `Ping 대상 ${parsed.targetText.trim()}을(를) 찾을 수 없습니다: ${resolved.error}`;
    let nextProject = resolved.project;
    let received = 0;
    const targetAddress = primaryDeviceIp(resolved.target) || parsed.targetText.trim();
    const replies: string[] = [];
    for (let index = 0; index < parsed.count; index += 1) {
      const result = await simulatePing(nextProject, device.id, resolved.target.id);
      nextProject = result.project;
      if (result.success) {
        received += 1;
        replies.push(`Reply from ${targetAddress}: bytes=32 time<1ms TTL=128`);
      } else {
        replies.push(`Request timed out. ${result.message}`);
      }
    }
    const lost = parsed.count - received;
    onProjectChange(nextProject, received === parsed.count ? `Ping ${resolved.target.label} 성공 (${received}/${parsed.count}).` : `Ping ${resolved.target.label} 손실 ${lost}/${parsed.count}.`);
    return [
      `Pinging ${resolved.target.label} [${targetAddress}] with 32 bytes of data:`,
      "",
      ...replies,
      "",
      `Ping statistics for ${targetAddress}:`,
      `    Packets: Sent = ${parsed.count}, Received = ${received}, Lost = ${lost} (${Math.round((lost / parsed.count) * 100)}% loss)`
    ].join("\n");
  }
  if (lower.startsWith("tracert ") || lower.startsWith("traceroute ")) {
    const targetText = command.split(/\s+/).slice(1).join(" ");
    if (!targetText.trim()) return "사용법: tracert <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return `대상 ${targetText}을(를) 찾을 수 없습니다: ${resolved.error}`;
    const before = resolved.project.simulationEvents.length;
    const result = await simulatePing(resolved.project, device.id, resolved.target.id);
    onProjectChange(result.project, result.message);
    const hops = result.project.simulationEvents
      .slice(before)
      .map((event) => result.project.devices.find((item) => item.id === event.atDeviceId)?.label ?? event.atDeviceId)
      .filter((label, index, list) => list.indexOf(label) === index);
    return [
      `${resolved.target.label} 경로 추적`,
      ...hops.map((hop, index) => `${String(index + 1).padStart(2)}    <1 ms    ${hop}`),
      result.success ? "추적 완료." : `추적 실패: ${result.message}`
    ].join("\n");
  }
  if (lower.startsWith("nslookup ")) {
    const name = cleanHost(command.slice("nslookup ".length));
    if (!name) return "사용법: nslookup <이름>";
    const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
    if (!dnsServerIp) return "DNS 요청 실패: DNS 서버가 설정되지 않았습니다.";
    const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
    if (!server) return `DNS 요청 실패: 서버 ${dnsServerIp}을(를) 찾을 수 없습니다.`;
    const reachability = await simulatePing(project, device.id, server.id);
    if (!reachability.success) {
      const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${name} DNS 질의 시간 초과: ${reachability.message}`, "dropped");
      onProjectChange(nextProject, reachability.message);
      return `${name} DNS 요청 시간이 초과되었습니다: ${reachability.message}`;
    }
    if (isIpv4(name)) {
      const reverse = server.config.dnsRecords.find((item) => item.value === name);
      if (!reverse) {
        const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${name} PTR 질의가 NXDOMAIN을 반환했습니다.`, "dropped");
        onProjectChange(nextProject, "PTR 레코드를 찾을 수 없습니다.");
        return `서버: ${server.label}\n주소: ${dnsServerIp}\n*** ${name} PTR 레코드가 없습니다.`;
      }
      onProjectChange(appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${name}을(를) ${reverse.name}(으)로 역조회했습니다.`, "delivered"), `DNS가 ${name}을(를) 역조회했습니다.`);
      return `서버: ${server.label}\n주소: ${dnsServerIp}\n이름: ${reverse.name}\n주소: ${name}`;
    }
    const record = server.config.dnsRecords.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!record) {
      const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${name} DNS 질의가 NXDOMAIN을 반환했습니다.`, "dropped");
      onProjectChange(nextProject, "DNS 레코드를 찾을 수 없습니다.");
      return `서버: ${server.label}\n이름: ${name}\n*** 주소 레코드가 없습니다.`;
    }
    onProjectChange(appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${record.name}을(를) ${record.value}(으)로 확인했습니다.`, "delivered"), `DNS가 ${record.name}을(를) 확인했습니다.`);
    return `서버: ${server.label}\n이름: ${record.name}\n주소: ${record.value}`;
  }
  if (lower.startsWith("http ") || lower.startsWith("web ") || lower.startsWith("browser ")) {
    const targetText = command.split(/\s+/).slice(1).join(" ");
    if (!targetText.trim()) return "사용법: http <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "HTTP", `HTTP 요청 실패: ${result.message}`, "dropped"), result.message);
      return `HTTP 요청 실패: ${result.message}`;
    }
    if (!target.config.services.http) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, "HTTP", `${target.label}이(가) HTTP 연결을 거부했습니다.`, "dropped");
      onProjectChange(nextProject, `${target.label}이(가) HTTP 연결을 거부했습니다.`);
      return `${target.label}이(가) HTTP 연결을 거부했습니다.`;
    }
    const loggedProject = appendServerLog(result.project, target.id, "info", `HTTP GET from ${device.label}`);
    onProjectChange(appendDesktopEvent(loggedProject, device.id, target.id, "HTTP", `GET ${target.label} 요청이 200 OK를 반환했습니다.`, "delivered"), "HTTP 200 OK.");
    return `HTTP/1.1 200 OK\n서버: ${target.label}\n\n${target.label} 웹 서비스가 실행 중입니다.`;
  }
  if (lower.startsWith("ftp ")) {
    const [, targetText = "", ...actionParts] = command.split(/\s+/);
    if (!targetText.trim()) return "사용법: ftp <ip|이름> [ls|get 파일]";
    const action = actionParts.join(" ").trim() || "ls";
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "FTP", `FTP 연결 실패: ${result.message}`, "dropped"), result.message);
      return `FTP 연결 실패: ${result.message}`;
    }
    if (!target.config.services.ftp) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, "FTP", `${target.label} FTP 서비스가 꺼져 있습니다.`, "dropped");
      onProjectChange(nextProject, `${target.label} FTP 서비스가 꺼져 있습니다.`);
      return `${target.label} FTP 서비스가 꺼져 있습니다.`;
    }
    const actionLower = action.toLowerCase();
    const loggedProject = appendServerLog(result.project, target.id, "info", actionLower.startsWith("get ") ? `FTP GET ${action.slice(4).trim() || "readme.txt"} from ${device.label}` : `FTP LIST from ${device.label}`);
    const nextProject = appendDesktopEvent(loggedProject, device.id, target.id, "FTP", `${target.label} FTP ${actionLower.startsWith("get ") ? "파일 다운로드" : "디렉터리 조회"}를 완료했습니다.`, "delivered");
    onProjectChange(nextProject, "FTP 세션 완료.");
    if (actionLower.startsWith("get ")) {
      const fileName = action.slice(4).trim() || "readme.txt";
      return `Connected to ${target.label}.\n220 PTWeb FTP Service ready\nUser: anonymous\n230 User logged in\nftp> get ${fileName}\n150 Opening data connection for ${fileName}\n226 Transfer complete`;
    }
    return `Connected to ${target.label}.\n220 PTWeb FTP Service ready\nUser: anonymous\n230 User logged in\nftp> ${action}\n200 PORT command successful\n150 Opening ASCII mode data connection\n  readme.txt\n  running-config.txt\n  network-backup.ptweb\n226 Transfer complete`;
  }
  if (lower.startsWith("email ") || lower.startsWith("mail ")) {
    const [, targetText = "", recipient = "", ...messageParts] = command.split(/\s+/);
    if (!targetText.trim() || !recipient.trim()) return "사용법: email|mail <서버 ip|이름> <받는사람> [메시지]";
    const message = messageParts.join(" ").trim() || `${device.label} mail test`;
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "EMAIL", `EMAIL 전송 실패: ${result.message}`, "dropped"), result.message);
      return `EMAIL 전송 실패: ${result.message}`;
    }
    if (!target.config.services.email) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, "EMAIL", `${target.label} EMAIL 서비스가 꺼져 있습니다.`, "dropped");
      onProjectChange(nextProject, `${target.label} EMAIL 서비스가 꺼져 있습니다.`);
      return `${target.label} EMAIL 서비스가 꺼져 있습니다.`;
    }
    const loggedProject = appendServerLog(result.project, target.id, "info", `EMAIL from ${device.label} to ${recipient}: ${message}`);
    onProjectChange(appendDesktopEvent(loggedProject, device.id, target.id, "EMAIL", `${recipient}에게 EMAIL 메시지를 전송했습니다.`, "delivered"), "EMAIL 메시지를 전송했습니다.");
    return [
      `Connected to ${target.label}.`,
      "220 PTWeb ESMTP ready",
      `MAIL FROM:<${device.label.toLowerCase()}@ptweb.local>`,
      "250 Sender OK",
      `RCPT TO:<${recipient}>`,
      "250 Recipient OK",
      "DATA",
      `Subject: Packet Tracer lab test`,
      "",
      message,
      ".",
      "250 Message accepted for delivery"
    ].join("\n");
  }
  if (lower.startsWith("ssh ") || lower.startsWith("telnet ")) {
    const protocol = lower.startsWith("ssh ") ? "ssh" : "telnet";
    const targetText = command.split(/\s+/).slice(1).join(" ");
    if (!targetText.trim()) return `사용법: ${protocol} <ip|이름>`;
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, protocol.toUpperCase(), `${protocol.toUpperCase()} 연결 실패: ${result.message}`, "dropped"), result.message);
      return `${protocol.toUpperCase()} 연결 실패: ${result.message}`;
    }
    const access = remoteAccessState(target, protocol);
    if (!access.enabled) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, protocol.toUpperCase(), `${target.label} ${protocol.toUpperCase()} 접속 거부: ${access.reason}`, "dropped");
      onProjectChange(nextProject, `${target.label} ${protocol.toUpperCase()} 접속이 거부되었습니다.`);
      return `Connecting to ${target.label}...\n% ${access.reason}`;
    }
    onProjectChange(appendDesktopEvent(result.project, device.id, target.id, protocol.toUpperCase(), `${device.label}에서 ${target.label}(으)로 ${protocol.toUpperCase()} 세션을 열었습니다.`, "delivered"), `${protocol.toUpperCase()} 세션이 열렸습니다.`);
    return [
      `Connecting to ${target.label} (${primaryDeviceIp(target) || targetText})...`,
      protocol === "ssh" ? `SSH-${target.config.sshVersion ?? "2"}.0-PTWEB` : "Trying 23 ... Open",
      "User Access Verification",
      "",
      "Username: admin",
      "Password:",
      `${target.config.hostname || target.label}#`,
      `${protocol.toUpperCase()} session established.`
    ].join("\n");
  }
  if (lower.startsWith("tftp ")) {
    const targetText = command.split(/\s+/)[1] ?? "";
    if (!targetText.trim()) return "사용법: tftp <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "TFTP", `TFTP 연결 실패: ${result.message}`, "dropped"), result.message);
      return `TFTP 연결 실패: ${result.message}`;
    }
    if (!target.config.services.tftp) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, "TFTP", `${target.label} TFTP 서비스가 꺼져 있습니다.`, "dropped");
      onProjectChange(nextProject, `${target.label} TFTP 서비스가 꺼져 있습니다.`);
      return `${target.label} TFTP 서비스가 꺼져 있습니다.`;
    }
    const loggedProject = appendServerLog(result.project, target.id, "info", `TFTP directory read from ${device.label}`);
    onProjectChange(appendDesktopEvent(loggedProject, device.id, target.id, "TFTP", `${target.label} TFTP 디렉터리를 조회했습니다.`, "delivered"), "TFTP 조회 완료.");
    return `TFTP ${target.label}\nDirectory of tftp:///${target.label}\n  running-config.txt\n  startup-config.txt\n  network-backup.ptweb`;
  }
  if (lower.startsWith("syslog ")) {
    const [, targetText = "", ...messageParts] = command.split(/\s+/);
    if (!targetText.trim()) return "사용법: syslog <ip|이름> <메시지>";
    const logMessage = messageParts.join(" ").trim() || `${device.label} connectivity test`;
    const resolved = await resolveDesktopNetworkTarget(project, device, targetText, onProjectChange);
    if (!resolved.target) return resolved.error;
    const { target, project: resolvedProject } = resolved;
    const result = await simulatePing(resolvedProject, device.id, target.id);
    if (!result.success) {
      onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "SYSLOG", `SYSLOG 전송 실패: ${result.message}`, "dropped"), result.message);
      return `SYSLOG 전송 실패: ${result.message}`;
    }
    if (!target.config.services.syslog) {
      const nextProject = appendDesktopEvent(result.project, device.id, target.id, "SYSLOG", `${target.label} SYSLOG 서비스가 꺼져 있습니다.`, "dropped");
      onProjectChange(nextProject, `${target.label} SYSLOG 서비스가 꺼져 있습니다.`);
      return `${target.label} SYSLOG 서비스가 꺼져 있습니다.`;
    }
    const loggedProject = appendServerLog(result.project, target.id, "info", `${device.label}: ${logMessage}`);
    onProjectChange(appendDesktopEvent(loggedProject, device.id, target.id, "SYSLOG", `${target.label}에 SYSLOG 메시지를 기록했습니다.`, "delivered"), "SYSLOG 메시지를 기록했습니다.");
    return `SYSLOG sent to ${target.label}: ${logMessage}`;
  }
  return "알 수 없는 데스크톱 명령입니다. help, ipconfig, arp -a, route print, netstat -r, ping [-n 횟수] <ip|이름>, tracert <ip|이름>, nslookup <이름|ip>, http/web <ip|이름>, ftp <ip|이름>, email/mail <ip|이름> <받는사람>, ssh <ip|이름>, telnet <ip|이름>, tftp <ip|이름>, syslog <ip|이름> <메시지>를 사용하세요.";
}

function parseDesktopPingCommand(command: string): { count: number; targetText: string } {
  const tokens = command.trim().split(/\s+/).slice(1);
  if (tokens[0]?.toLowerCase() === "-n") {
    return { count: boundedNumber(tokens[1] ?? "4", 1, 10), targetText: tokens.slice(2).join(" ") };
  }
  if (tokens[0]?.toLowerCase().startsWith("-n") && tokens[0].length > 2) {
    return { count: boundedNumber(tokens[0].slice(2), 1, 10), targetText: tokens.slice(1).join(" ") };
  }
  return { count: 4, targetText: tokens.join(" ") };
}

function resolveDesktopTarget(project: NetworkProject, value: string): NetworkDevice | null {
  const host = cleanHost(value);
  const ip = isIpv4(host) ? host : "";
  if (ip) {
    const byIp = project.devices.find((device) => device.ports.some((port) => port.ipAddress === ip));
    if (byIp) return byIp;
  }
  return project.devices.find((device) => device.label.toLowerCase() === host.toLowerCase() || device.config.hostname.toLowerCase() === host.toLowerCase()) ?? null;
}

function releaseDhcp(project: NetworkProject, deviceId: string): { project: NetworkProject; message: string } {
  const time = Date.now();
  const packetId = createId("packet");
  const releasedLeases = project.devices.flatMap((device) =>
    device.runtime.dhcpLeases
      .filter((lease) => lease.deviceId === deviceId)
      .map((lease) => ({ serverId: device.id, ipAddress: lease.ipAddress }))
  );
  const targetId = releasedLeases[0]?.serverId ?? deviceId;
  const hasLease = releasedLeases.length > 0;
  const releaseStatus: SimulationEvent["status"] = hasLease ? "delivered" : "dropped";
  const releasedText = releasedLeases.map((lease) => lease.ipAddress).join(", ") || "client address";
  const releaseEvent: SimulationEvent = withPduHeaders(project, { id: createId("evt"), time, lastDeviceId: deviceId, atDeviceId: targetId, sourceDeviceId: deviceId, targetDeviceId: targetId, packetId, type: "DHCP", info: hasLease ? `DHCPRELEASE sent by client for ${releasedText}.` : "DHCPRELEASE skipped: no active DHCP lease.", status: releaseStatus, osiLayers: ["Layer 7", "Layer 3"] });
  const nextProject = {
    ...project,
    devices: project.devices.map((device) => {
      const runtime = { ...device.runtime, dhcpLeases: device.runtime.dhcpLeases.filter((lease) => lease.deviceId !== deviceId) };
      if (device.id === deviceId) {
        return {
          ...device,
          ports: hasLease ? device.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" } : port) : device.ports,
          runtime
        };
      }
      return { ...device, runtime };
    }),
    simulationEvents: [
      ...project.simulationEvents,
      releaseEvent
    ]
  };
  return { project: nextProject, message: hasLease ? "DHCP 임대를 해제했습니다." : "활성 DHCP 임대가 없습니다." };
}

function appendDesktopEvent(project: NetworkProject, sourceId: string, targetId: string, type: string, info: string, status: "forwarded" | "delivered" | "dropped", packetId = createId("packet")): NetworkProject {
  const event = withPduHeaders(project, { id: createId("evt"), time: Date.now(), lastDeviceId: sourceId, atDeviceId: targetId, sourceDeviceId: sourceId, targetDeviceId: targetId, packetId, type, info, status, osiLayers: ["Layer 7", "Layer 4", "Layer 3"] });
  return {
    ...project,
    simulationEvents: [...project.simulationEvents, event]
  };
}

function withPduHeaders(project: NetworkProject, event: SimulationEvent): SimulationEvent {
  return event.headers?.length ? event : { ...event, headers: inferredPduHeaders(project, event) };
}

function appendServerLog(project: NetworkProject, deviceId: string, level: "info" | "warning" | "error", message: string): NetworkProject {
  return {
    ...project,
    devices: project.devices.map((device) => device.id === deviceId
      ? { ...device, runtime: { ...device.runtime, logs: [...device.runtime.logs, { id: createId("log"), level, message, createdAt: Date.now() }].slice(-100) } }
      : device)
  };
}

async function resolveDesktopNetworkTarget(project: NetworkProject, device: NetworkDevice, value: string, onProjectChange: (project: NetworkProject, message: string) => void): Promise<{ target: NetworkDevice | null; project: NetworkProject; error: string }> {
  const host = cleanHost(value);
  if (isIpv4(host)) {
    return { target: resolveDesktopTarget(project, host), project, error: `${host}을(를) 확인할 수 없습니다.` };
  }
  const direct = project.devices.find((item) => item.label.toLowerCase() === host.toLowerCase() || item.config.hostname.toLowerCase() === host.toLowerCase());
  if (direct) return { target: direct, project, error: "" };
  const dnsServerIp = device.ports.find((port) => port.dnsServer)?.dnsServer ?? "";
  if (!dnsServerIp) return { target: null, project, error: `${host}을(를) 확인할 수 없습니다: DNS 서버가 설정되지 않았습니다.` };
  const server = project.devices.find((item) => item.config.services.dns && item.ports.some((port) => port.ipAddress === dnsServerIp));
  if (!server) return { target: null, project, error: `${host}을(를) 확인할 수 없습니다: DNS 서버 ${dnsServerIp}을(를) 찾을 수 없습니다.` };
  const dnsReachability = await simulatePing(project, device.id, server.id);
  if (!dnsReachability.success) {
    const nextProject = appendDesktopEvent(dnsReachability.project, device.id, server.id, "DNS", `${host} DNS 질의 실패: ${dnsReachability.message}`, "dropped");
    onProjectChange(nextProject, dnsReachability.message);
    return { target: null, project: nextProject, error: `${host}을(를) 확인할 수 없습니다: DNS 서버에 도달할 수 없습니다(${dnsReachability.message}).` };
  }
  const record = server.config.dnsRecords.find((item) => item.name.toLowerCase() === host.toLowerCase());
  if (!record) {
    const nextProject = appendDesktopEvent(dnsReachability.project, device.id, server.id, "DNS", `${host} DNS 질의가 NXDOMAIN을 반환했습니다.`, "dropped");
    onProjectChange(nextProject, "DNS 레코드를 찾을 수 없습니다.");
    return { target: null, project: nextProject, error: `${host}을(를) 확인할 수 없습니다: DNS 레코드가 없습니다.` };
  }
  const nextProject = appendDesktopEvent(dnsReachability.project, device.id, server.id, "DNS", `${host}을(를) ${record.value}(으)로 확인했습니다.`, "delivered");
  onProjectChange(nextProject, `DNS가 ${host}을(를) 확인했습니다.`);
  return { target: resolveDesktopTarget(nextProject, record.value), project: nextProject, error: `DNS 레코드 ${record.value}와 일치하는 장비가 없습니다.` };
}

function cleanHost(value: string): string {
  return value.trim().replace(/^(https?|ftp|tftp):\/\//i, "").split("/")[0].trim();
}

function ServicesTab({ device, onUpdate }: { device: NetworkDevice; onUpdate: (device: NetworkDevice) => void }) {
  type ServiceName = keyof NetworkDevice["config"]["services"];
  type RuntimeLog = NetworkDevice["runtime"]["logs"][number];
  const [poolDraft, setPoolDraft] = useState({
    name: "LAN",
    network: "192.168.1.0",
    mask: "255.255.255.0",
    defaultGateway: "192.168.1.1",
    dnsServer: "192.168.1.10",
    startIp: "192.168.1.100",
    maxLeases: "50"
  });
  const [excludeDraft, setExcludeDraft] = useState({ startIp: "192.168.1.1", endIp: "192.168.1.20" });
  const [recordDraft, setRecordDraft] = useState({ name: "www.lab.local", value: "192.168.1.10" });
  const [servicePane, setServicePane] = useState<ServiceName>("dhcp");
  const [serviceNotice, setServiceNotice] = useState("");
  const [serviceLogSearch, setServiceLogSearch] = useState("");
  const serviceOrder: ServiceName[] = ["dhcp", "dns", "http", "ftp", "email", "tftp", "syslog"];
  const serviceKeys = serviceOrder.filter((service) => service in device.config.services);
  const serviceLogQuery = serviceLogSearch.trim().toLowerCase();
  const rawHttpLogs = serviceLogs("HTTP");
  const rawFtpLogs = serviceLogs("FTP");
  const rawEmailLogs = serviceLogs("EMAIL");
  const rawTftpLogs = serviceLogs("TFTP");
  const httpLogs = filterLogs(rawHttpLogs);
  const ftpLogs = filterLogs(rawFtpLogs);
  const emailLogs = filterLogs(rawEmailLogs);
  const tftpLogs = filterLogs(rawTftpLogs);
  const syslogLogs = filterLogs(device.runtime.logs);

  function serviceLogs(prefix: string) {
    return device.runtime.logs.filter((log) => log.message.startsWith(prefix));
  }

  function filterLogs(logs: RuntimeLog[]) {
    if (!serviceLogQuery) return logs;
    return logs.filter((log) => [
      log.level,
      log.message,
      new Date(log.createdAt).toLocaleString()
    ].some((value) => value.toLowerCase().includes(serviceLogQuery)));
  }

  function toggleService(service: ServiceName, enabled: boolean) {
    setServiceNotice(`${service.toUpperCase()} 서비스를 ${enabled ? "켰습니다" : "껐습니다"}.`);
    onUpdate({ ...device, config: { ...device.config, services: { ...device.config.services, [service]: enabled } } });
  }

  function clearServiceLogs(prefix: string) {
    onUpdate({ ...device, runtime: { ...device.runtime, logs: device.runtime.logs.filter((log) => !log.message.startsWith(prefix)) } });
    setServiceNotice(`${prefix} 로그를 비웠습니다.`);
  }

  function exportServiceLogs(service: string, logs: RuntimeLog[]) {
    if (!logs.length) {
      setServiceNotice("내보낼 로그가 없습니다.");
      return;
    }
    const headers = ["time", "service", "level", "message"];
    const rows = logs.map((log) => [new Date(log.createdAt).toISOString(), service, log.level, log.message]);
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${device.label.replace(/[^a-zA-Z0-9_.-]/g, "_") || "device"}-${service.toLowerCase()}-logs.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setServiceNotice(`${service} 로그 CSV를 내보냈습니다 (${logs.length}개).`);
  }

  function exportDhcpLeases() {
    if (!device.runtime.dhcpLeases.length) {
      setServiceNotice("내보낼 DHCP 바인딩이 없습니다.");
      return;
    }
    const headers = ["ipAddress", "macAddress", "deviceId", "expiresAt"];
    const rows = device.runtime.dhcpLeases.map((lease) => [
      lease.ipAddress,
      lease.macAddress,
      lease.deviceId,
      new Date(lease.expiresAt).toISOString()
    ]);
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${device.label.replace(/[^a-zA-Z0-9_.-]/g, "_") || "device"}-dhcp-bindings.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setServiceNotice(`DHCP 바인딩 CSV를 내보냈습니다 (${device.runtime.dhcpLeases.length}개).`);
  }

  function exportDnsRecords() {
    if (!device.config.dnsRecords.length) {
      setServiceNotice("내보낼 DNS 레코드가 없습니다.");
      return;
    }
    const headers = ["name", "address"];
    const rows = device.config.dnsRecords.map((record) => [record.name, record.value]);
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${device.label.replace(/[^a-zA-Z0-9_.-]/g, "_") || "device"}-dns-records.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setServiceNotice(`DNS 레코드 CSV를 내보냈습니다 (${device.config.dnsRecords.length}개).`);
  }

  function clearDhcpLease(ipAddress: string, clientDeviceId: string) {
    onUpdate({
      ...device,
      runtime: {
        ...device.runtime,
        dhcpLeases: device.runtime.dhcpLeases.filter((lease) => lease.ipAddress !== ipAddress || lease.deviceId !== clientDeviceId)
      }
    });
    setServiceNotice(`${ipAddress} DHCP 바인딩을 해제했습니다.`);
  }

  function renderLogTools(service: string, logs: RuntimeLog[]) {
    return (
      <div className="service-log-toolbar">
        <input aria-label={`${service} 로그 검색`} value={serviceLogSearch} onChange={(event) => setServiceLogSearch(event.target.value)} placeholder="로그 검색" />
        <small>{serviceLogQuery ? `${logs.length}개 일치` : `${logs.length}개`}</small>
        <button className="secondary-action" disabled={!logs.length} onClick={() => exportServiceLogs(service, logs)} type="button">CSV</button>
        <button className="secondary-action" disabled={!serviceLogQuery} onClick={() => setServiceLogSearch("")} type="button">검색 해제</button>
      </div>
    );
  }

  function renderLogRows(logs: RuntimeLog[], emptyMessage: string, limit = 8) {
    if (logs.length === 0) return <p className="empty-state">{serviceLogQuery ? "현재 검색과 일치하는 로그가 없습니다." : emptyMessage}</p>;
    return logs.slice(-limit).reverse().map((log) => (
      <div className={`diagnostic-row ${log.level}`} key={log.id}>
        <strong>{new Date(log.createdAt).toLocaleTimeString()}</strong>
        <span>{log.message}</span>
      </div>
    ));
  }

  function addPool() {
    const name = poolDraft.name.trim();
    const network = poolDraft.network.trim();
    const mask = poolDraft.mask.trim();
    const defaultGateway = poolDraft.defaultGateway.trim();
    const dnsServer = poolDraft.dnsServer.trim();
    const startIp = poolDraft.startIp.trim();
    if (!name) {
      setServiceNotice("DHCP 풀 이름을 입력하세요.");
      return;
    }
    if (device.config.dhcpPools.some((pool) => pool.name.toLowerCase() === name.toLowerCase())) {
      setServiceNotice("같은 이름의 DHCP 풀이 이미 있습니다.");
      return;
    }
    if (!isIpv4(network) || !isSubnetMask(mask) || maskToPrefix(mask) === 0 || !isIpv4(startIp)) {
      setServiceNotice("DHCP 네트워크, 연속 subnet mask, 시작 IP는 유효한 IPv4 값이어야 합니다.");
      return;
    }
    if (!ipInSubnet(startIp, network, mask)) {
      setServiceNotice("DHCP 시작 IP는 풀 네트워크 안에 있어야 합니다.");
      return;
    }
    if (defaultGateway && !isIpv4(defaultGateway)) {
      setServiceNotice("DHCP 기본 게이트웨이는 IPv4 형식이어야 합니다.");
      return;
    }
    if (defaultGateway && !ipInSubnet(defaultGateway, network, mask)) {
      setServiceNotice("DHCP 기본 게이트웨이는 풀 네트워크 안에 있어야 합니다.");
      return;
    }
    if (dnsServer && !isIpv4(dnsServer)) {
      setServiceNotice("DHCP DNS 서버는 IPv4 형식이어야 합니다.");
      return;
    }
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dhcpPools: [
          ...device.config.dhcpPools,
          {
            id: createId("pool"),
            name,
            network,
            mask,
            defaultGateway,
            dnsServer,
            startIp,
            maxLeases: boundedNumber(poolDraft.maxLeases, 1, 4096),
            enabled: true
          }
        ]
      }
    });
    setServiceNotice(`${name} DHCP 풀을 추가했습니다.`);
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

  function addExcludedRange() {
    if (!isIpv4(excludeDraft.startIp.trim()) || (excludeDraft.endIp.trim() && !isIpv4(excludeDraft.endIp.trim()))) {
      setServiceNotice("DHCP 제외 주소는 IPv4 형식이어야 합니다.");
      return;
    }
    if (excludeDraft.endIp.trim() && ipToNumber(excludeDraft.endIp.trim()) < ipToNumber(excludeDraft.startIp.trim())) {
      setServiceNotice("DHCP 제외 끝 IP는 시작 IP보다 크거나 같아야 합니다.");
      return;
    }
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dhcpExcludedRanges: [
          ...(device.config.dhcpExcludedRanges ?? []),
          { id: createId("dhcp_exclude"), startIp: excludeDraft.startIp.trim(), endIp: excludeDraft.endIp.trim() || undefined }
        ]
      }
    });
    setServiceNotice(`${excludeDraft.startIp.trim()} DHCP 제외 주소를 추가했습니다.`);
  }

  function addRecord() {
    if (!recordDraft.name.trim()) {
      setServiceNotice("DNS 이름을 입력하세요.");
      return;
    }
    if (device.config.dnsRecords.some((record) => record.name.toLowerCase() === recordDraft.name.trim().toLowerCase())) {
      setServiceNotice("같은 이름의 DNS 레코드가 이미 있습니다.");
      return;
    }
    if (!isIpv4(recordDraft.value.trim())) {
      setServiceNotice("DNS 레코드 주소는 IPv4 형식이어야 합니다.");
      return;
    }
    onUpdate({
      ...device,
      config: {
        ...device.config,
        dnsRecords: [...device.config.dnsRecords, { id: createId("dns"), name: recordDraft.name.trim(), value: recordDraft.value.trim() }]
      }
    });
    setServiceNotice(`${recordDraft.name.trim()} DNS 레코드를 추가했습니다.`);
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
              <small>{device.config.services[service] ? "켜짐" : "꺼짐"}</small>
            </button>
          ))}
        </aside>
        <div className="services-detail">
          {serviceNotice && <strong className={isServiceNoticeError(serviceNotice) ? "form-error" : "module-notice"} role={isServiceNoticeError(serviceNotice) ? "alert" : "status"}>{serviceNotice}</strong>}
          {servicePane === "dhcp" && (
            <div className="config-group">
              <header><strong>DHCP</strong><label className="toggle"><input checked={device.config.services.dhcp} onChange={(event) => toggleService("dhcp", event.target.checked)} type="checkbox" />서비스</label><div className="service-header-actions"><button className="secondary-action" disabled={!device.runtime.dhcpLeases.length} onClick={exportDhcpLeases} type="button">CSV</button><button className="secondary-action" disabled={!device.runtime.dhcpLeases.length} onClick={() => onUpdate({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } })} type="button">바인딩 비우기</button></div></header>
              <div className="service-draft-grid dhcp-draft">
                <label>풀 이름<input value={poolDraft.name} onChange={(event) => setPoolDraft({ ...poolDraft, name: event.target.value })} placeholder="LAN" /></label>
                <label>네트워크<input value={poolDraft.network} onChange={(event) => setPoolDraft({ ...poolDraft, network: event.target.value })} placeholder="192.168.1.0" /></label>
                <label>서브넷 마스크<input value={poolDraft.mask} onChange={(event) => setPoolDraft({ ...poolDraft, mask: event.target.value })} placeholder="255.255.255.0" /></label>
                <label>기본 게이트웨이<input value={poolDraft.defaultGateway} onChange={(event) => setPoolDraft({ ...poolDraft, defaultGateway: event.target.value })} placeholder="192.168.1.1" /></label>
                <label>DNS 서버<input value={poolDraft.dnsServer} onChange={(event) => setPoolDraft({ ...poolDraft, dnsServer: event.target.value })} placeholder="192.168.1.10" /></label>
                <label>시작 IP<input value={poolDraft.startIp} onChange={(event) => setPoolDraft({ ...poolDraft, startIp: event.target.value })} placeholder="192.168.1.100" /></label>
                <label>최대 사용자<input value={poolDraft.maxLeases} onChange={(event) => setPoolDraft({ ...poolDraft, maxLeases: event.target.value })} placeholder="50" type="number" /></label>
                <button className="secondary-action" onClick={addPool} type="button">풀 추가</button>
              </div>
              {device.config.dhcpPools.map((pool) => (
                <div className="editable-service-row" key={pool.id}>
                  <label className="toggle"><input checked={pool.enabled} onChange={(event) => updatePool(pool.id, { enabled: event.target.checked })} type="checkbox" />활성</label>
                  <label>이름<input value={pool.name} onChange={(event) => updatePool(pool.id, { name: event.target.value.slice(0, 40) })} /></label>
                  <label>네트워크<input value={pool.network} onChange={(event) => updatePool(pool.id, { network: event.target.value.trim() })} /></label>
                  <label>마스크<input value={pool.mask} onChange={(event) => updatePool(pool.id, { mask: event.target.value.trim() })} /></label>
                  <label>게이트웨이<input value={pool.defaultGateway} onChange={(event) => updatePool(pool.id, { defaultGateway: event.target.value.trim() })} /></label>
                  <label>DNS<input value={pool.dnsServer} onChange={(event) => updatePool(pool.id, { dnsServer: event.target.value.trim() })} /></label>
                  <label>시작 IP<input value={pool.startIp} onChange={(event) => updatePool(pool.id, { startIp: event.target.value.trim() })} /></label>
                  <label>임대 수<input value={pool.maxLeases} min={1} onChange={(event) => updatePool(pool.id, { maxLeases: boundedNumber(event.target.value, 1, 4096) })} type="number" /></label>
                  <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.filter((item) => item.id !== pool.id) } })} type="button">삭제</button>
                </div>
              ))}
              <div className="service-draft-grid dns-draft">
                <label>제외 시작 IP<input value={excludeDraft.startIp} onChange={(event) => setExcludeDraft({ ...excludeDraft, startIp: event.target.value })} placeholder="192.168.1.1" /></label>
                <label>제외 끝 IP<input value={excludeDraft.endIp} onChange={(event) => setExcludeDraft({ ...excludeDraft, endIp: event.target.value })} placeholder="192.168.1.20" /></label>
                <button className="secondary-action" onClick={addExcludedRange} type="button">제외 추가</button>
              </div>
              {(device.config.dhcpExcludedRanges ?? []).map((range) => (
                <div className="compact-row" key={range.id}>
                  <span>제외 {range.startIp}{range.endIp ? ` - ${range.endIp}` : ""}</span>
                  <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, dhcpExcludedRanges: (device.config.dhcpExcludedRanges ?? []).filter((item) => item.id !== range.id) } })} type="button">삭제</button>
                </div>
              ))}
              {device.runtime.dhcpLeases.length === 0 && <p className="empty-state">활성 DHCP 바인딩이 없습니다.</p>}
              {device.runtime.dhcpLeases.map((lease) => (
                <div className="compact-row" key={`${lease.deviceId}-${lease.ipAddress}`}>
                  <span>{lease.ipAddress} {lease.macAddress}</span>
                  <small>{new Date(lease.expiresAt).toLocaleString()}</small>
                  <button className="secondary-action" onClick={() => clearDhcpLease(lease.ipAddress, lease.deviceId)} type="button">해제</button>
                </div>
              ))}
            </div>
          )}
          {servicePane === "dns" && (
            <div className="config-group">
              <header><strong>DNS</strong><label className="toggle"><input checked={device.config.services.dns} onChange={(event) => toggleService("dns", event.target.checked)} type="checkbox" />서비스</label><div className="service-header-actions"><small>레코드 {device.config.dnsRecords.length}개</small><button className="secondary-action" disabled={!device.config.dnsRecords.length} onClick={exportDnsRecords} type="button">CSV</button></div></header>
              <div className="service-draft-grid dns-draft">
                <label>이름<input value={recordDraft.name} onChange={(event) => setRecordDraft({ ...recordDraft, name: event.target.value })} placeholder="www.lab.local" /></label>
                <label>주소<input value={recordDraft.value} onChange={(event) => setRecordDraft({ ...recordDraft, value: event.target.value })} placeholder="192.168.1.10" /></label>
                <button className="secondary-action" onClick={addRecord} type="button">추가</button>
              </div>
              {device.config.dnsRecords.map((record) => (
                <div className="editable-record-row" key={record.id}>
                  <label>이름<input value={record.name} onChange={(event) => updateRecord(record.id, { name: event.target.value.trim() })} /></label>
                  <label>IPv4<input value={record.value} onChange={(event) => updateRecord(record.id, { value: event.target.value.trim() })} /></label>
                  <button className="secondary-action" onClick={() => onUpdate({ ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.filter((item) => item.id !== record.id) } })} type="button">삭제</button>
                </div>
              ))}
            </div>
          )}
          {servicePane === "http" && (
            <div className="config-group">
              <header><strong>HTTP</strong><label className="toggle"><input checked={device.config.services.http} onChange={(event) => toggleService("http", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" disabled={!rawHttpLogs.length} onClick={() => clearServiceLogs("HTTP")} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.http ? "HTTP 켜짐" : "HTTP 꺼짐"}</strong><span>서버에 도달 가능할 때 웹 브라우저와 `http` 데스크톱 명령이 이 서비스를 사용합니다.</span></div>
              {renderLogTools("HTTP", httpLogs)}
              {renderLogRows(httpLogs, "HTTP 요청 로그가 없습니다.")}
            </div>
          )}
          {servicePane === "ftp" && (
            <div className="config-group">
              <header><strong>FTP</strong><label className="toggle"><input checked={device.config.services.ftp} onChange={(event) => toggleService("ftp", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" disabled={!rawFtpLogs.length} onClick={() => clearServiceLogs("FTP")} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.ftp ? "FTP 켜짐" : "FTP 꺼짐"}</strong><span>데스크톱 `ftp 서버` 명령과 FTP Complex PDU가 이 서비스를 검사합니다.</span></div>
              <div className="compact-row"><span>readme.txt / running-config.txt / network-backup.ptweb</span><small>가상 FTP 디렉터리</small></div>
              {renderLogTools("FTP", ftpLogs)}
              {renderLogRows(ftpLogs, "FTP 전송 로그가 없습니다.")}
            </div>
          )}
          {servicePane === "email" && (
            <div className="config-group">
              <header><strong>EMAIL</strong><label className="toggle"><input checked={device.config.services.email} onChange={(event) => toggleService("email", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" disabled={!rawEmailLogs.length} onClick={() => clearServiceLogs("EMAIL")} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.email ? "EMAIL 켜짐" : "EMAIL 꺼짐"}</strong><span>데스크톱 `email 서버 사용자 메시지` 명령과 EMAIL Complex PDU가 이 서비스를 검사합니다.</span></div>
              <div className="compact-row"><span>admin@lab.local / user@lab.local</span><small>가상 메일박스</small></div>
              {renderLogTools("EMAIL", emailLogs)}
              {renderLogRows(emailLogs, "수신된 EMAIL 메시지가 없습니다.")}
            </div>
          )}
          {servicePane === "tftp" && (
            <div className="config-group">
              <header><strong>TFTP</strong><label className="toggle"><input checked={device.config.services.tftp} onChange={(event) => toggleService("tftp", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" disabled={!rawTftpLogs.length} onClick={() => clearServiceLogs("TFTP")} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.tftp ? "TFTP 켜짐" : "TFTP 꺼짐"}</strong><span>데스크톱 `tftp 서버` 명령이 도달성과 서비스 상태를 검사하고 이벤트에 기록합니다.</span></div>
              {renderLogTools("TFTP", tftpLogs)}
              {renderLogRows(tftpLogs, "TFTP 요청 로그가 없습니다.")}
            </div>
          )}
          {servicePane === "syslog" && (
            <div className="config-group">
              <header><strong>SYSLOG</strong><label className="toggle"><input checked={device.config.services.syslog} onChange={(event) => toggleService("syslog", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" onClick={() => onUpdate({ ...device, runtime: { ...device.runtime, logs: [] } })} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.syslog ? "SYSLOG 켜짐" : "SYSLOG 꺼짐"}</strong><span>데스크톱 `syslog 서버 메시지` 명령이 이 장비의 런타임 로그에 기록됩니다.</span></div>
              {renderLogTools("SYSLOG", syslogLogs)}
              {renderLogRows(syslogLogs, "수신된 SYSLOG 메시지가 없습니다.", 12)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type PduDetailTab = "osi" | "inbound" | "outbound";
type LinkListFilter = "all" | NetworkLink["status"] | CableType;

function EventPanel({
  project,
  message,
  mode = "simulation",
  focusedEventId,
  onClear,
  onExportEvents,
  onFocusEvent,
  onRemoveLink,
  onRepair
}: {
  project: NetworkProject;
  message: string;
  mode?: "realtime" | "simulation";
  focusedEventId?: string;
  onClear: () => void;
  onExportEvents?: (events?: SimulationEvent[], scope?: string) => void;
  onFocusEvent?: (eventId: string) => void;
  onRemoveLink?: (linkId: string) => void;
  onRepair?: () => void;
}) {
  const issues = diagnoseProject(project);
  const issueStats = {
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
    info: issues.filter((item) => item.severity === "info").length
  };
  const [issueFilter, setIssueFilter] = useState<"all" | NetworkIssueSeverity>("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState<LinkListFilter>("all");
  const [linkSearch, setLinkSearch] = useState("");
  const issueSearchQuery = issueSearch.trim().toLowerCase();
  const linkSearchQuery = linkSearch.trim().toLowerCase();
  const visibleIssues = issues.filter((item) =>
    (issueFilter === "all" || item.severity === issueFilter) &&
    (!issueSearchQuery || `${item.title} ${item.detail}`.toLowerCase().includes(issueSearchQuery))
  );
  const visibleLinks = project.links.filter((link) =>
    (linkFilter === "all" || link.status === linkFilter || link.type === linkFilter) &&
    (!linkSearchQuery || linkSearchText(project, link).includes(linkSearchQuery))
  );
  const [eventFilter, setEventFilter] = useState("all");
  const [osiFilter, setOsiFilter] = useState("all");
  const [eventSearch, setEventSearch] = useState("");
  const [pduDetailTab, setPduDetailTab] = useState<PduDetailTab>("osi");
  const [userPacketFilter, setUserPacketFilter] = useState("all");
  const [selectedPacketOnly, setSelectedPacketOnly] = useState(false);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [captureDelayMs, setCaptureDelayMs] = useState(450);
  const playTimer = useRef<number | null>(null);
  const eventSearchQuery = eventSearch.trim().toLowerCase();
  const baseFilteredEvents = project.simulationEvents.filter((event) =>
    (eventFilter === "all" || event.type.toLowerCase() === eventFilter || event.status === eventFilter) &&
    (osiFilter === "all" || event.osiLayers.includes(osiFilter)) &&
    (!eventSearchQuery || eventSearchText(project, event).includes(eventSearchQuery))
  );
  const userPackets = userCreatedPacketRows(project);
  const userPacketProtocols = Array.from(new Set(userPackets.map((packet) => packet.protocol))).sort();
  const visibleUserPackets = userPacketFilter === "all" ? userPackets : userPackets.filter((packet) => packet.protocol.toLowerCase() === userPacketFilter);
  const activeEventId = focusedEventId ?? "";
  const baseSelectedEvent = baseFilteredEvents.find((event) => event.id === activeEventId) ?? baseFilteredEvents.at(-1);
  const selectedPacketKey = baseSelectedEvent ? baseSelectedEvent.packetId ?? baseSelectedEvent.id : "";
  const filteredEvents = selectedPacketOnly && selectedPacketKey
    ? baseFilteredEvents.filter((event) => (event.packetId ?? event.id) === selectedPacketKey)
    : baseFilteredEvents;
  const focusedIndex = filteredEvents.findIndex((event) => event.id === activeEventId);
  const selectedEvent = filteredEvents.find((event) => event.id === activeEventId) ?? filteredEvents.at(-1) ?? baseSelectedEvent;
  const selectedPacketEvents = selectedPacketKey
    ? project.simulationEvents.filter((event) => (event.packetId ?? event.id) === selectedPacketKey)
    : [];
  const visiblePacketEvents = selectedPacketEvents.slice(-8);
  const selectedPacketIndex = selectedEvent ? selectedPacketEvents.findIndex((event) => event.id === selectedEvent.id) : -1;
  const previousPacketEvent = selectedPacketIndex > 0 ? selectedPacketEvents[selectedPacketIndex - 1] : undefined;
  const nextPacketEvent = selectedPacketIndex >= 0 ? selectedPacketEvents[selectedPacketIndex + 1] : undefined;
  const pduOsiRows = selectedEvent ? pduOsiRowsFor(selectedEvent) : [];
  const pduDetailRows = selectedEvent ? pduDetailRowsFor(project, selectedEvent, previousPacketEvent, nextPacketEvent, pduDetailTab) : [];
  const pduHeaderRows = selectedEvent ? pduHeaderRowsFor(project, selectedEvent) : [];
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
  const capturePositionLabel = filteredEvents.length === 0
    ? "0/0"
    : focusedIndex >= 0
      ? `${focusedIndex + 1}/${filteredEvents.length}`
      : `대기/${filteredEvents.length}`;
  useEffect(() => () => stopAutoCapture(), []);
  useEffect(() => {
    stopAutoCapture();
  }, [eventFilter, osiFilter, eventSearchQuery, selectedPacketOnly, project.simulationEvents.length, captureDelayMs]);

  function stopAutoCapture() {
    if (playTimer.current) {
      window.clearTimeout(playTimer.current);
      playTimer.current = null;
    }
    setAutoPlaying(false);
  }

  function focusRelative(delta: number) {
    stopAutoCapture();
    if (!onFocusEvent) return;
    if (filteredEvents.length === 0) return;
    const start = focusedIndex >= 0 ? focusedIndex : filteredEvents.length - 1;
    const nextIndex = Math.max(0, Math.min(filteredEvents.length - 1, start + delta));
    onFocusEvent(filteredEvents[nextIndex].id);
  }

  function focusEdge(edge: "first" | "last") {
    stopAutoCapture();
    if (!onFocusEvent || filteredEvents.length === 0) return;
    onFocusEvent(edge === "first" ? filteredEvents[0].id : filteredEvents[filteredEvents.length - 1].id);
  }

  function captureForward() {
    stopAutoCapture();
    if (!onFocusEvent || filteredEvents.length === 0) return;
    const nextIndex = focusedIndex >= 0 ? Math.min(filteredEvents.length - 1, focusedIndex + 1) : 0;
    onFocusEvent(filteredEvents[nextIndex].id);
  }
  function autoCapturePlay() {
    if (!onFocusEvent || filteredEvents.length === 0) return;
    if (autoPlaying) {
      stopAutoCapture();
      return;
    }
    setAutoPlaying(true);
    let index = focusedIndex >= 0 ? Math.min(focusedIndex + 1, filteredEvents.length - 1) : 0;
    const playNext = () => {
      onFocusEvent(filteredEvents[index].id);
      if (index >= filteredEvents.length - 1) {
        playTimer.current = null;
        setAutoPlaying(false);
        return;
      }
      index += 1;
      playTimer.current = window.setTimeout(playNext, captureDelayMs);
    };
    playNext();
  }
  return (
    <section className={`event-panel ${mode}`}>
      {mode === "simulation" ? (
        <>
          <header><strong>시뮬레이션 이벤트</strong><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">전체</option><option value="icmp">ICMP</option><option value="arp">ARP</option><option value="switch">SWITCH</option><option value="hub">HUB</option><option value="dhcp">DHCP</option><option value="dns">DNS</option><option value="http">HTTP</option><option value="ftp">FTP</option><option value="email">EMAIL</option><option value="tftp">TFTP</option><option value="syslog">SYSLOG</option><option value="ssh">SSH</option><option value="telnet">TELNET</option><option value="delivered">전달됨</option><option value="forwarded">전송 중</option><option value="dropped">드롭됨</option></select><select aria-label="OSI 레이어 필터" value={osiFilter} onChange={(event) => setOsiFilter(event.target.value)}><option value="all">전체 OSI</option><option value="Layer 1">Layer 1</option><option value="Layer 2">Layer 2</option><option value="Layer 3">Layer 3</option><option value="Layer 4">Layer 4</option><option value="Layer 5">Layer 5</option><option value="Layer 6">Layer 6</option><option value="Layer 7">Layer 7</option></select><input aria-label="시뮬레이션 이벤트 검색" className="event-search-input" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} placeholder="검색" /><button disabled={eventFilter === "all" && osiFilter === "all" && !eventSearchQuery && !selectedPacketOnly} onClick={() => { stopAutoCapture(); setEventFilter("all"); setOsiFilter("all"); setEventSearch(""); setSelectedPacketOnly(false); }} type="button">필터 해제</button><button className={selectedPacketOnly ? "active" : ""} disabled={!selectedPacketKey} onClick={() => { stopAutoCapture(); setSelectedPacketOnly((value) => !value); }} type="button">선택 패킷만</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex <= 0} onClick={() => focusEdge("first")} type="button">처음</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex <= 0} onClick={() => focusRelative(-1)} type="button">이전</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex === filteredEvents.length - 1} onClick={captureForward} type="button">캡처/전송</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex === filteredEvents.length - 1} onClick={() => focusEdge("last")} type="button">끝</button><button className={autoPlaying ? "active" : ""} disabled={!onFocusEvent || filteredEvents.length === 0} onClick={autoCapturePlay} type="button">{autoPlaying ? "정지" : "자동 재생"}</button><label className="capture-speed-control">속도<select value={captureDelayMs} onChange={(event) => setCaptureDelayMs(Number(event.target.value))}><option value={900}>느림</option><option value={450}>보통</option><option value={180}>빠름</option></select></label><button disabled={!onExportEvents || filteredEvents.length === 0} onClick={() => onExportEvents?.(filteredEvents, eventPanelExportScope(eventFilter, osiFilter, eventSearch))} type="button">CSV</button><button onClick={() => { stopAutoCapture(); onClear(); }} type="button">비우기</button></header>
          <div className="sim-status-strip">
            <span><strong>{eventStats.total}</strong> 이벤트</span>
            <span className="forwarded"><strong>{eventStats.forwarded}</strong> 전송 중</span>
            <span className="delivered"><strong>{eventStats.delivered}</strong> 전달됨</span>
            <span className="dropped"><strong>{eventStats.dropped}</strong> 드롭됨</span>
            <span><strong>{filteredEvents.length}</strong> 표시</span>
            <span><strong>{osiFilterLabel(osiFilter)}</strong> OSI</span>
            <span><strong>{eventSearchQuery ? "적용" : "전체"}</strong> 검색</span>
            <span className="capture-position"><strong>{capturePositionLabel}</strong> 캡처 위치</span>
            <span className={selectedPacketOnly ? "selected-packet" : ""}><strong>{selectedPacketOnly ? selectedPacketEvents.length : "전체"}</strong> 패킷 범위</span>
          </div>
          <div className="simulation-layout">
            <div className="simulation-main">
              {message && <p>{message}</p>}
              <div className="event-table">
                <div className="event-table-head"><span>시간</span><span>이전 장비</span><span>현재 장비</span><span>종류</span><span>정보</span><span>상태</span></div>
                {filteredEvents.slice(-12).reverse().map((event) => (
                  <div
                    className={`event-row ${event.status} ${activeEventId === event.id ? "selected" : ""}`}
                    key={event.id}
                    onClick={() => onFocusEvent?.(event.id)}
                    onKeyDown={(keyEvent) => activateRowOnKeyboard(keyEvent, () => onFocusEvent?.(event.id))}
                    role="button"
                    tabIndex={onFocusEvent ? 0 : -1}
                    aria-current={activeEventId === event.id ? "true" : undefined}
                    aria-disabled={!onFocusEvent}
                    aria-label={`${event.type} ${eventStatusLabel(event.status)} 이벤트, ${eventDeviceLabel(project, event.lastDeviceId)}에서 ${eventDeviceLabel(project, event.atDeviceId)}: ${event.info}`}
                  >
                    <span>{new Date(event.time).toLocaleTimeString()}</span>
                    <span>{eventDeviceLabel(project, event.lastDeviceId)}</span>
                    <span>{eventDeviceLabel(project, event.atDeviceId)}</span>
                    <span>{event.type}</span>
                    <span>{event.info}</span>
                    <small>{eventStatusLabel(event.status)}</small>
                  </div>
                ))}
                {filteredEvents.length === 0 && <p className="event-empty-state">시뮬레이션 이벤트가 없습니다.</p>}
              </div>
            </div>
            <aside className="simulation-side">
              <div className="user-packet-window">
                <header><strong>사용자 생성 패킷</strong><small>표시 {visibleUserPackets.length}/{userPackets.length}개</small><select aria-label="사용자 생성 패킷 필터" value={userPacketFilter} onChange={(event) => setUserPacketFilter(event.target.value)}><option value="all">전체</option>{userPacketProtocols.map((protocol) => <option key={protocol} value={protocol.toLowerCase()}>{protocol}</option>)}</select></header>
                <div className="user-packet-head"><span>프로토콜</span><span>출발지</span><span>목적지</span><span>상태</span></div>
                {visibleUserPackets.map((packet) => (
                  <button
                    className={`${packet.status} ${activeEventId === packet.id ? "selected" : ""}`}
                    key={packet.id}
                    onClick={() => onFocusEvent?.(packet.id)}
                    type="button"
                    aria-pressed={activeEventId === packet.id}
                    aria-label={`${packet.protocol} 사용자 패킷, ${packet.source}에서 ${packet.destination}, ${eventStatusLabel(packet.status)}`}
                  >
                    <span>{packet.protocol}{packet.count > 1 ? ` x${packet.count}` : ""}</span>
                    <span>{packet.source}</span>
                    <span>{packet.destination}</span>
                    <small>{eventStatusLabel(packet.status)}</small>
                  </button>
                ))}
                {userPackets.length === 0 ? <p className="event-empty-state">아직 사용자 생성 패킷이 없습니다.</p> : visibleUserPackets.length === 0 && <p className="event-empty-state">현재 필터와 일치하는 사용자 생성 패킷이 없습니다.</p>}
              </div>
              {selectedEvent && (
                <div className={`pdu-info-panel ${selectedEvent.status}`}>
                  <header><strong>PDU 정보</strong><small>{selectedEvent.type} / {eventStatusLabel(selectedEvent.status)}</small>{onExportEvents && <button disabled={selectedPacketEvents.length === 0} onClick={() => onExportEvents(selectedPacketEvents, `packet-${(selectedEvent.packetId ?? selectedEvent.id).slice(-10)}`)} type="button">CSV</button>}</header>
                  <p>{selectedEvent.info}</p>
                  <dl className="pdu-meta-grid">
                    <div><dt>출발지</dt><dd>{eventDeviceLabel(project, selectedEvent.sourceDeviceId ?? selectedEvent.lastDeviceId)}</dd></div>
                    <div><dt>목적지</dt><dd>{eventDeviceLabel(project, selectedEvent.targetDeviceId ?? selectedEvent.atDeviceId)}</dd></div>
                    <div><dt>현재</dt><dd>{eventDeviceLabel(project, selectedEvent.atDeviceId)}</dd></div>
                    <div><dt>패킷</dt><dd>{(selectedEvent.packetId ?? selectedEvent.id).slice(-10)}</dd></div>
                  </dl>
                  {pduHeaderRows.length > 0 && (
                    <div className="pdu-header-table" role="table" aria-label="PDU 헤더">
                      <div className="head" role="row"><strong>Layer</strong><strong>Field</strong><strong>Value</strong></div>
                      {pduHeaderRows.map((header, index) => (
                        <div key={`${header.layer}:${header.field}:${index}`} role="row">
                          <span>{header.layer}</span>
                          <span>{header.field}</span>
                          <small>{header.value}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pdu-detail-tabs" role="tablist" aria-label="PDU 상세">
                    {(["osi", "inbound", "outbound"] as const).map((tab) => (
                      <button
                        aria-selected={pduDetailTab === tab}
                        className={pduDetailTab === tab ? "active" : ""}
                        key={tab}
                        onClick={() => setPduDetailTab(tab)}
                        role="tab"
                        type="button"
                      >
                        {pduDetailTabLabel(tab)}
                      </button>
                    ))}
                  </div>
                  {pduDetailTab === "osi" ? (
                    <div className="pdu-osi-table" role="table" aria-label="OSI 모델 상세">
                      {pduOsiRows.map((row) => (
                        <div className={row.active ? "active" : ""} key={row.layer} role="row">
                          <strong>{row.layer}</strong>
                          <span>{row.description}</span>
                          <small>{row.status}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <dl className="pdu-detail-list">
                      {pduDetailRows.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {selectedPacketEvents.length > 1 && (
                    <ol className="pdu-hop-list">
                      {selectedPacketEvents.length > visiblePacketEvents.length && <li className="more"><span>이전 {selectedPacketEvents.length - visiblePacketEvents.length}단계 더 있음</span></li>}
                      {visiblePacketEvents.map((event, index) => (
                        <li
                          aria-current={event.id === activeEventId ? "true" : undefined}
                          aria-label={`${event.type} ${eventStatusLabel(event.status)} 단계, ${eventDeviceLabel(project, event.lastDeviceId)}에서 ${eventDeviceLabel(project, event.atDeviceId)}`}
                          className={`${event.status} ${event.id === activeEventId ? "selected" : ""}`}
                          key={event.id}
                          onClick={() => onFocusEvent?.(event.id)}
                          onKeyDown={(keyEvent) => activateRowOnKeyboard(keyEvent, () => onFocusEvent?.(event.id))}
                          role="button"
                          tabIndex={onFocusEvent ? 0 : -1}
                        >
                          <b>{selectedPacketEvents.length - visiblePacketEvents.length + index + 1}</b>
                          <span>{eventDeviceLabel(project, event.lastDeviceId)} -&gt; {eventDeviceLabel(project, event.atDeviceId)}</span>
                          <small>{event.type} / {eventStatusLabel(event.status)}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="pdu-layer-list">{(selectedEvent.osiLayers?.length ? selectedEvent.osiLayers : ["Layer 2", "Layer 3"]).map((layer) => <span key={layer}>{layer}</span>)}</div>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        <>
          <header><strong>실시간 상태</strong><small>활성 {project.links.filter((link) => link.status === "up").length}개 / 링크 {project.links.length}개</small></header>
          <div className="sim-status-strip">
            <span><strong>{project.devices.length}</strong> 장비</span>
            <span><strong>{linkStats.total}</strong> 케이블</span>
            <span className="delivered"><strong>{linkStats.up}</strong> 활성</span>
            <span className="dropped"><strong>{linkStats.down}</strong> 다운</span>
            <span className="forwarded"><strong>{linkStats.blocked}</strong> 차단</span>
          </div>
          {message && <p>{message}</p>}
        </>
      )}
      <header><strong>네트워크 진단</strong><small>오류 {issueStats.errors} / 경고 {issueStats.warnings} / 정보 {issueStats.info}</small><select aria-label="진단 심각도 필터" value={issueFilter} onChange={(event) => setIssueFilter(event.target.value as "all" | NetworkIssueSeverity)}><option value="all">전체</option><option value="error">오류</option><option value="warning">경고</option><option value="info">정보</option></select><input aria-label="진단 검색" className="event-search-input" value={issueSearch} onChange={(event) => setIssueSearch(event.target.value)} placeholder="진단 검색" />{(issueFilter !== "all" || issueSearchQuery) && <button onClick={() => { setIssueFilter("all"); setIssueSearch(""); }} type="button">필터 해제</button>}{onRepair && issues.length > 0 && <button className="secondary-action" onClick={onRepair} type="button">복구</button>}</header>
      {issues.length > 0 && (
        <div className="sim-status-strip diagnostic-summary-strip">
          <span className="dropped"><strong>{issueStats.errors}</strong> 오류</span>
          <span className="warning"><strong>{issueStats.warnings}</strong> 경고</span>
          <span><strong>{issueStats.info}</strong> 정보</span>
          <span><strong>{issues.length}</strong> 전체</span>
          <span><strong>{visibleIssues.length}</strong> 표시</span>
        </div>
      )}
      {issues.length === 0 ? <p className="empty-state">프로젝트 수준 문제가 감지되지 않았습니다.</p> : visibleIssues.length === 0 ? <p className="event-empty-state">현재 필터와 일치하는 진단 이슈가 없습니다.</p> : visibleIssues.slice(0, 10).map((item) => (
        <div className={`diagnostic-row ${item.severity}`} key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.detail}</span>
        </div>
      ))}
      {visibleIssues.length > 10 && <p className="event-empty-state">추가 이슈 {visibleIssues.length - 10}개가 더 있습니다. 진단 리포트에서 전체 목록을 확인하세요.</p>}
      {onRemoveLink && project.links.length > 0 && (
        <>
          <header><strong>케이블</strong><small>링크 {project.links.length}개 / 표시 {visibleLinks.length}개</small><select aria-label="케이블 필터" value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as LinkListFilter)}><option value="all">전체</option><option value="up">정상</option><option value="down">다운</option><option value="blocked">차단</option><option value="auto">자동</option><option value="copper-straight">구리 직결</option><option value="copper-cross">구리 크로스</option><option value="fiber">광케이블</option><option value="serial-dce">Serial DCE</option><option value="serial-dte">Serial DTE</option><option value="wireless">무선</option><option value="console">콘솔</option></select><input aria-label="케이블 검색" className="event-search-input" value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="케이블 검색" />{(linkFilter !== "all" || linkSearchQuery) && <button onClick={() => { setLinkFilter("all"); setLinkSearch(""); }} type="button">필터 해제</button>}</header>
          {visibleLinks.length === 0 && <p className="event-empty-state">현재 필터와 일치하는 케이블이 없습니다.</p>}
          {visibleLinks.map((link) => {
            const cableDiagnostic = linkCableDiagnosticSummary(project, link);
            return (
              <div className={`event-row cable-row ${link.status}`} key={link.id}>
                <span className="cable-row-kind"><i className={`cable-swatch ${link.type}`} />{shortCableLabel(link.type)}</span>
                <span>{linkLabel(project, link)}</span>
                <small title={linkStatusDetail(project, link)}>{linkStatusLabel(link.status)}: {linkStatusDetail(project, link)}</small>
                <span className="cable-row-test" title={cableDiagnostic.detail}>{cableDiagnostic.summary}</span>
                <button className="secondary-action" onClick={() => onRemoveLink(link.id)} type="button">삭제</button>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

const pduLayerOrder = ["Layer 7", "Layer 6", "Layer 5", "Layer 4", "Layer 3", "Layer 2", "Layer 1"];

function pduDetailTabLabel(tab: PduDetailTab): string {
  return ({ osi: "OSI 모델", inbound: "Inbound PDU", outbound: "Outbound PDU" })[tab];
}

function pduOsiRowsFor(event: SimulationEvent): Array<{ layer: string; description: string; status: string; active: boolean }> {
  const activeLayers = new Set(event.osiLayers.length > 0 ? event.osiLayers : ["Layer 2", "Layer 3"]);
  return pduLayerOrder.map((layer) => {
    const active = activeLayers.has(layer);
    return {
      layer,
      active,
      description: active ? pduLayerDescription(event, layer) : "이 이벤트에서 처리되지 않음",
      status: active ? pduLayerStatus(event.status) : "대기"
    };
  });
}

function pduLayerDescription(event: SimulationEvent, layer: string): string {
  const protocol = event.type.toUpperCase();
  if (layer === "Layer 7") return `${protocol} 애플리케이션 메시지를 확인합니다.`;
  if (layer === "Layer 6") return "표현 형식, 인코딩, 암호화 상태를 확인합니다.";
  if (layer === "Layer 5") return "세션 생성, 유지, 종료 상태를 확인합니다.";
  if (layer === "Layer 4") return `${protocol} 세션과 포트 흐름을 유지합니다.`;
  if (layer === "Layer 3") return "IPv4 목적지, 게이트웨이, 라우팅 결정을 확인합니다.";
  if (layer === "Layer 2") return "MAC 주소, VLAN, 프레임 전달 상태를 확인합니다.";
  if (layer === "Layer 1") return "케이블, 링크 상태, 포트 신호를 확인합니다.";
  return `${protocol} PDU를 처리합니다.`;
}

function pduLayerStatus(status: SimulationEvent["status"]): string {
  return ({ forwarded: "처리/전송", delivered: "처리 완료", dropped: "드롭" })[status];
}

function pduHeaderRowsFor(project: NetworkProject, event: SimulationEvent): NonNullable<SimulationEvent["headers"]> {
  const headers = event.headers?.length ? event.headers : inferredPduHeaders(project, event);
  return headers.map((header) => ({ ...header, value: pduHeaderValue(project, header.value) }));
}

function inferredPduHeaders(project: NetworkProject, event: SimulationEvent): NonNullable<SimulationEvent["headers"]> {
  const protocol = event.type.toUpperCase();
  const source = project.devices.find((device) => device.id === (event.sourceDeviceId ?? event.lastDeviceId));
  const target = project.devices.find((device) => device.id === (event.targetDeviceId ?? event.atDeviceId));
  const sourceAddress = primaryDeviceIp(source) || source?.label || event.sourceDeviceId || event.lastDeviceId;
  const targetAddress = primaryDeviceIp(target) || target?.label || event.targetDeviceId || event.atDeviceId;
  if (protocol === "ARP" || protocol === "SWITCH" || protocol === "HUB") {
    return [
      { layer: "Layer 2", field: "Frame type", value: protocol },
      { layer: "Layer 2", field: "Source", value: source?.label ?? event.lastDeviceId },
      { layer: "Layer 2", field: "Destination", value: target?.label ?? event.atDeviceId },
      { layer: "Layer 2", field: "Action", value: eventStatusLabel(event.status) }
    ];
  }
  const transport = pduTransportForProtocol(protocol);
  return [
    { layer: "Layer 2", field: "EtherType", value: "IPv4" },
    { layer: "Layer 3", field: "Source", value: sourceAddress },
    { layer: "Layer 3", field: "Destination", value: targetAddress },
    { layer: "Layer 3", field: "Protocol", value: transport.protocol === "ICMP" ? "ICMP" : "IP" },
    { layer: "Layer 4", field: "Protocol", value: transport.protocol },
    ...(transport.ports ? [{ layer: "Layer 4", field: "Ports", value: transport.ports }] : []),
    { layer: "Layer 7", field: "Application", value: protocol },
    { layer: "Packet", field: "Disposition", value: eventStatusLabel(event.status) }
  ];
}

function pduHeaderValue(project: NetworkProject, value: string): string {
  const device = project.devices.find((item) => item.id === value);
  if (!device) return value;
  const ip = primaryDeviceIp(device);
  return ip ? `${device.label} (${ip})` : device.label;
}

function pduTransportForProtocol(protocol: string): { protocol: string; ports?: string } {
  if (protocol === "ICMP") return { protocol: "ICMP" };
  if (protocol === "DHCP") return { protocol: "UDP", ports: "67/68" };
  if (protocol === "DNS") return { protocol: "UDP", ports: "53" };
  if (protocol === "HTTP") return { protocol: "TCP", ports: "80" };
  if (protocol === "FTP") return { protocol: "TCP", ports: "21" };
  if (protocol === "EMAIL") return { protocol: "TCP", ports: "25" };
  if (protocol === "TFTP") return { protocol: "UDP", ports: "69" };
  if (protocol === "SYSLOG") return { protocol: "UDP", ports: "514" };
  if (protocol === "SSH") return { protocol: "TCP", ports: "22" };
  if (protocol === "TELNET") return { protocol: "TCP", ports: "23" };
  return { protocol: "IP" };
}

function pduDetailRowsFor(
  project: NetworkProject,
  event: SimulationEvent,
  previousEvent: SimulationEvent | undefined,
  nextEvent: SimulationEvent | undefined,
  tab: PduDetailTab
): Array<{ label: string; value: string }> {
  const source = eventDeviceLabel(project, event.sourceDeviceId ?? event.lastDeviceId);
  const target = eventDeviceLabel(project, event.targetDeviceId ?? event.atDeviceId);
  const current = eventDeviceLabel(project, event.atDeviceId);
  const previous = eventDeviceLabel(project, event.lastDeviceId);
  const packetId = event.packetId ?? event.id;

  if (tab === "inbound") {
    return [
      { label: "수신 장비", value: current },
      { label: "직전 장비", value: previousEvent ? eventDeviceLabel(project, previousEvent.atDeviceId) : previous },
      { label: "원본 출발지", value: source },
      { label: "최종 목적지", value: target },
      { label: "프로토콜", value: event.type.toUpperCase() },
      { label: "수신 결과", value: eventStatusLabel(event.status) },
      { label: "Inbound 요약", value: event.info }
    ];
  }

  if (tab === "outbound") {
    const nextHop = nextEvent ? eventDeviceLabel(project, nextEvent.atDeviceId) : event.status === "delivered" ? "목적지 도착" : "다음 홉 없음";
    const nextAction = nextEvent?.info ?? (event.status === "dropped" ? "현재 장비에서 PDU가 드롭되었습니다." : "현재 이벤트가 이 패킷의 마지막 단계입니다.");
    return [
      { label: "송신 장비", value: current },
      { label: "다음 홉", value: nextHop },
      { label: "프레임 방향", value: `${previous} -> ${current}${nextEvent ? ` -> ${eventDeviceLabel(project, nextEvent.atDeviceId)}` : ""}` },
      { label: "원본 출발지", value: source },
      { label: "최종 목적지", value: target },
      { label: "Outbound 동작", value: nextAction },
      { label: "사용 레이어", value: (event.osiLayers.length > 0 ? event.osiLayers : ["Layer 2", "Layer 3"]).join(", ") }
    ];
  }

  return [
    { label: "패킷 ID", value: packetId },
    { label: "프로토콜", value: event.type.toUpperCase() },
    { label: "상태", value: eventStatusLabel(event.status) }
  ];
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

function userCreatedPacketRows(project: NetworkProject): Array<{ id: string; protocol: string; source: string; destination: string; status: SimulationEvent["status"]; count: number }> {
  const protocols = new Set(["ICMP", "DHCP", "DNS", "HTTP", "FTP", "EMAIL", "TFTP", "SYSLOG", "SSH", "TELNET"]);
  const seenPackets = new Set<string>();
  const packetCounts = new Map<string, number>();
  for (const event of project.simulationEvents.filter((event) => protocols.has(event.type.toUpperCase()))) {
    const key = event.packetId ?? event.id;
    packetCounts.set(key, (packetCounts.get(key) ?? 0) + 1);
  }
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
      status: event.status,
      count: packetCounts.get(event.packetId ?? event.id) ?? 1
    }));
}

function eventDeviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? deviceId;
}
