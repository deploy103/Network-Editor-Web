import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Cable, CircleDot, CircleHelp, Copy, Cpu, Download, Edit3, FileJson, Info, Mail, Maximize2, Minimize2, Monitor, MousePointer2, Network, Plus, Power, Router, RotateCcw, Save, Server, Settings, Shield, Terminal, Trash2, Wifi, Wrench, X, ZoomIn, ZoomOut } from "lucide-react";
import { cableCatalog, canPortUseCable, createDevice, deviceCatalog, displayKind, getDeviceModel, getModuleSpec, installModule, removeModule } from "../data/deviceCatalog";
import { bootBanner, bootDevice, initialConsoleSession, type CliSession } from "../engine/cli";
import { cliEngine } from "../engine/cliEngine";
import { diagnoseProject } from "../engine/diagnostics";
import { ipInSubnet, ipToNumber, isIpv4, isSubnetMask, maskToPrefix, networkAddress } from "../engine/ip";
import { downloadProject } from "../exporters/packetTracerExport";
import { requestDhcp } from "../engine/simulation";
import { addLink, linkLabel, recalc, removeLink, validateConnection } from "../engine/topology";
import { createId } from "../utils/id";
import { engineLabel, simulatePing } from "../wasm/engine";
import type { AccessRule, CableType, DeviceKind, DeviceTab, ModuleSpec, NatRule, NetworkDevice, NetworkLink, NetworkPort, NetworkProject, SimulationEvent, User } from "../types/network";

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1600;
const packetMenuLabels = ["파일", "편집", "옵션", "보기", "도구", "확장", "창", "도움말"] as const;
const quickWorkspaceModelIds = ["router-1941", "switch-2960", "pc-pt", "server-pt", "ap-pt"] as const;
const complexPduProtocols = [
  { value: "icmp", label: "ICMP Echo" },
  { value: "dns", label: "DNS Query" },
  { value: "http", label: "HTTP GET" },
  { value: "tftp", label: "TFTP Read" },
  { value: "syslog", label: "SYSLOG" }
] as const;

type ComplexPduProtocol = typeof complexPduProtocols[number]["value"];
type PacketMenuName = typeof packetMenuLabels[number];
type PacketMenuItem = { label: string; action: () => void; disabled?: boolean; danger?: boolean };
type WorkspaceMenuState = { x: number; y: number; canvasX: number; canvasY: number };
type CanvasViewport = { x: number; y: number; width: number; height: number };
type SaveStatus = "saved" | "pending" | "saving" | "error";

function activateRowOnKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export function Editor({ project, user, saveError, saveStatus, lastSavedAt, onBack, onChange, onSave }: { project: NetworkProject; user: User; saveError: string; saveStatus: SaveStatus; lastSavedAt: string; onBack: () => void; onChange: (project: NetworkProject) => void; onSave: (project: NetworkProject) => void }) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const suppressWorkspaceClickRef = useRef(false);
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
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [topMenu, setTopMenu] = useState<{ name: PacketMenuName; x: number; y: number } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{ deviceId: string; value: string } | null>(null);
  const [message, setMessage] = useState("");
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
  const [engineName, setEngineName] = useState("엔진 로딩 중");
  const [focusedEventId, setFocusedEventId] = useState("");
  const deviceWindow = project.devices.find((device) => device.id === deviceWindowId) ?? null;
  const selectedDevice = project.devices.find((device) => device.id === selectedDeviceId) ?? null;
  const selectedLink = project.links.find((link) => link.id === selectedLinkId) ?? null;
  const pduSource = project.devices.find((device) => device.id === pduSourceId) ?? null;
  const complexPduSource = project.devices.find((device) => device.id === complexPduSourceId) ?? null;
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
    if (pduSourceId && !project.devices.some((device) => device.id === pduSourceId)) {
      setPduSourceId("");
      setPduMode(false);
    }
    if (complexPduSourceId && !project.devices.some((device) => device.id === complexPduSourceId)) {
      setComplexPduSourceId("");
      setComplexPduMode(false);
    }
  }, [deviceWindowId, selectedDeviceId, selectedLinkId, pduSourceId, complexPduSourceId, project.devices, project.links]);

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
        setSelectedDeviceId("");
        setSelectedLinkId("");
        setDeviceWindowId("");
        setDeviceWindowTab(undefined);
        setContextMenu(null);
        setLinkMenu(null);
        setWorkspaceMenu(null);
        setTopMenu(null);
        setMessage("선택을 해제했습니다.");
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
        if (selectedDeviceId) {
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
  }, [selectedDeviceId, selectedLinkId, pduMode, complexPduMode, project, onSave]);

  function placeDevice(modelId: string, position?: { x: number; y: number }) {
    const next = createDevice(modelId, position ?? { x: 160 + project.devices.length * 28, y: 140 + project.devices.length * 22 }, project.devices);
    onChange({ ...project, devices: [...project.devices, next] });
    setSelectedDeviceId(next.id);
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
    if (complexPduProtocol === "icmp") {
      let nextProject = project;
      let success = 0;
      let dropped = 0;
      let lastMessage = "";
      for (let index = 0; index < repeatCount; index += 1) {
        const result = await simulatePing(nextProject, sourceId, targetId);
        nextProject = result.project;
        lastMessage = result.message;
        if (result.success) success += 1;
        else dropped += 1;
      }
      onChange(nextProject);
      setMessage(`Complex PDU ${protocolLabel} ${repeatCount}회 완료: 성공 ${success}개, 실패 ${dropped}개. ${lastMessage}`);
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
      const reachability = await simulatePing(nextProject, sourceId, targetId);
      nextProject = reachability.project;
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
      lastInfo = info;
      nextProject = appendDesktopEvent(nextProject, sourceId, targetId, complexPduProtocol.toUpperCase(), info, status, complexPacketId);
      if (complexPduProtocol === "syslog" && status === "delivered") {
        nextProject = appendServerLog(nextProject, targetId, "info", `${source.label}: Complex PDU syslog test ${index + 1}/${repeatCount}`);
      }
      if (status === "delivered") delivered += 1;
      else dropped += 1;
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
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setPduMode(true);
    setPduSourceId(deviceId);
    setComplexPduMode(false);
    setComplexPduSourceId("");
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
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setComplexPduMode(true);
    setComplexPduSourceId(deviceId);
    setPduMode(false);
    setPduSourceId("");
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
    setDeviceWindowId("");
    setDeviceWindowTab(undefined);
    setPduMode(false);
    setPduSourceId("");
    setComplexPduMode(false);
    setComplexPduSourceId("");
    setMessage(`${device.label}에서 자동 케이블 연결을 시작했습니다. 연결할 장비를 선택하세요.`);
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
    onChange(recalc({
      ...project,
      devices: nextDevices
    }));
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
    setMessage("장비를 계층형 토폴로지로 자동 정렬했습니다.");
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

  function exportSimulationEvents() {
    if (project.simulationEvents.length === 0) {
      setMessage("내보낼 시뮬레이션 이벤트가 없습니다.");
      return;
    }
    const headers = ["time", "type", "status", "source", "target", "lastDevice", "atDevice", "packetId", "info", "osiLayers"];
    const rows = project.simulationEvents.map((event) => [
      new Date(event.time).toISOString(),
      event.type,
      event.status,
      eventDeviceLabel(project, event.sourceDeviceId ?? event.lastDeviceId),
      eventDeviceLabel(project, event.targetDeviceId ?? event.atDeviceId),
      eventDeviceLabel(project, event.lastDeviceId),
      eventDeviceLabel(project, event.atDeviceId),
      event.packetId ?? "",
      event.info,
      event.osiLayers.join(" / ")
    ]);
    const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-zA-Z0-9_.-]/g, "_") || "network"}-simulation-events.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 0);
    setMessage("시뮬레이션 이벤트 CSV를 내보냈습니다.");
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
    if (selectedCable || selectedModel || pduMode || complexPduMode || event.button !== 0) return;
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

  function canStartWorkspacePan(event: React.PointerEvent<HTMLElement>): boolean {
    if (event.button !== 0 || selectedModel || selectedCable || pduMode || complexPduMode) return false;
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
      ".common-tools-bar",
      ".cable-hud",
      ".placement-hud",
      ".pdu-hud",
      ".selection-hud",
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
    setSelectedDeviceId("");
    setSelectedLinkId("");
    closeFloatingMenus();
    setMessage("선택 모드입니다.");
  }

  function deleteSelected() {
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
    setSelectedDeviceId("");
    setSelectedLinkId("");
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
    setSelectedDeviceId("");
    setSelectedLinkId("");
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
        { label: "선택 항목 삭제", action: deleteSelected, disabled: !selectedDeviceId && !selectedLinkId, danger: true }
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
        { label: "진단 리포트 내보내기", action: exportDiagnosticReport },
        { label: "시뮬레이션 이벤트 CSV 내보내기", action: exportSimulationEvents, disabled: project.simulationEvents.length === 0 },
        { label: "Simple PDU 추가", action: startSimplePduTool, disabled: project.devices.length < 2 },
        { label: "Complex PDU 추가", action: startComplexPduTool, disabled: project.devices.length < 2 },
        { label: "장비 자동 정렬", action: autoArrangeTopology, disabled: project.devices.length === 0 },
        { label: "선택 장비에서 전체 Ping", action: () => { void pingFromSelectedToAll(); }, disabled: !selectedDeviceId || project.devices.length < 2 },
        { label: "런타임 테이블 초기화", action: resetRuntimeTables, disabled: project.devices.every((device) => !device.runtime.arpTable.length && !device.runtime.macTable.length && !device.runtime.dhcpLeases.length && !device.runtime.logs.length) && project.simulationEvents.length === 0 }
      ];
    }
    if (name === "확장") {
      return [
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
        className={`workspace packet-workspace ${selectedModel ? "placing" : ""} ${selectedCable ? "cabling" : ""} ${complexPduMode ? "complex-pdu" : ""} ${isPanning ? "panning" : ""} ${workspaceMode}`}
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
        <div className="common-tools-bar" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
          <button className={!selectedDeviceId && !selectedLinkId && !selectedCable && !selectedModel && !pduMode && !complexPduMode ? "active" : ""} onClick={selectMode} title="선택 도구" type="button"><MousePointer2 size={16} /></button>
          <button disabled={pduMode || complexPduMode || !selectedDeviceId} onClick={() => selectedDeviceId && openDeviceWindow(selectedDeviceId)} title="선택 장비 검사" type="button"><Settings size={16} /></button>
          <button disabled={pduMode || complexPduMode || (!selectedDeviceId && !selectedLinkId)} onClick={deleteSelected} title="선택 항목 삭제" type="button"><Trash2 size={16} /></button>
          <button className={pduMode ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || complexPduMode} onClick={startSimplePduTool} title="Simple PDU 추가" type="button"><Mail size={16} /></button>
          <button className={complexPduMode ? "active" : ""} disabled={Boolean(selectedCable) || Boolean(selectedModel) || pduMode} onClick={startComplexPduTool} title="Complex PDU 추가" type="button"><Plus size={16} /></button>
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
            <span>{complexPduSource ? "목적지 선택" : "출발지 선택"}</span>
          </div>
        )}
        {!selectedCable && !selectedModel && !pduMode && !complexPduMode && (
          <div className="board-guide" onClick={(event) => { event.stopPropagation(); closeFloatingMenus(); }}>
            <span><MousePointer2 size={14} />빈 보드 드래그 이동</span>
            <span><ZoomIn size={14} />휠 확대/축소</span>
            <span><Settings size={14} />우클릭 빠른 메뉴</span>
          </div>
        )}
        {selectedDevice && !selectedCable && !selectedModel && !pduMode && !complexPduMode && (
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
            {project.devices.length === 0 && !selectedCable && !selectedModel && !pduMode && !complexPduMode && (
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
          selectedLinkId={selectedLinkId}
          viewport={viewport}
          onJump={jumpToCanvasPoint}
        />
      </section>
      <section className="bottom-tray">
        <Palette
          selectedModel={selectedModel}
          selectedCable={selectedCable}
          onSelect={() => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedModel(""); setSelectedCable(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setMessage("선택 모드입니다."); }}
          onModel={(id) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedModel(id); setSelectedCable(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setMessage("작업 공간을 클릭하거나 끌어 놓아 장비를 배치하세요."); }}
          onCable={(type) => { closeFloatingMenus(); setSelectedLinkId(""); setSelectedCable(type); setSelectedModel(""); setPendingDeviceId(""); setConnectionDraft(null); setPduMode(false); setPduSourceId(""); setComplexPduMode(false); setComplexPduSourceId(""); setMessage("연결할 두 장비를 선택하세요."); }}
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
            setSelectedDeviceId("");
            setSelectedLinkId("");
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
  const routers = devices.filter((device) => device.kind === "router" || device.kind === "firewall").length;
  const switches = devices.filter((device) => device.kind === "switch" || device.kind === "hub").length;
  const hosts = devices.filter((device) => device.kind === "pc" || device.kind === "server").length;
  const wireless = devices.filter((device) => device.kind === "wireless" || device.ports.some((port) => port.kind === "wireless")).length;
  return (
    <div className="physical-backdrop" aria-hidden="true">
      <div className="physical-location-strip">
        <strong>도시 / 캠퍼스 / 사무실 / 배선실</strong>
        <span>장비 {devices.length}개 | 라우터/방화벽 {routers}개 | 스위치/허브 {switches}개 | 호스트 {hosts}개 | 무선 {wireless}개</span>
      </div>
      <div className="physical-rack">
        <span>랙 1</span>
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="physical-bench">
        <span>데스크톱 테이블</span>
        <i />
        <i />
        <i />
      </div>
      <div className="physical-wireless-zone">
        <span>무선 영역</span>
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
        <button onClick={onArrange} type="button"><Maximize2 size={15} />장비 자동 정렬</button>
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
  onRemove
}: {
  link: NetworkLink | null;
  project: NetworkProject;
  x: number;
  y: number;
  onClose: () => void;
  onOpenDevice: (deviceId: string) => void;
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
  const left = typeof window === "undefined" ? x : Math.min(x, Math.max(8, window.innerWidth - 280));
  const top = typeof window === "undefined" ? y : Math.min(y, Math.max(8, window.innerHeight - 330));

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
      </div>
      <div className="context-menu-section">
        <small>끝점</small>
        <button onClick={() => { onOpenDevice(link.endpointA.deviceId); onClose(); }} type="button"><Info size={15} />{endpoints[0]?.device ?? "끝점 A"}</button>
        <button onClick={() => { onOpenDevice(link.endpointB.deviceId); onClose(); }} type="button"><Info size={15} />{endpoints[1]?.device ?? "끝점 B"}</button>
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
  selectedLinkId,
  viewport,
  onJump
}: {
  project: NetworkProject;
  selectedDeviceId: string;
  selectedLinkId: string;
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
          <small>{project.devices.length} 장비 / {project.links.length} 링크</small>
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
        {!project.devices.length && <span className="minimap-empty">장비 없음</span>}
      </div>
    </aside>
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

function complexPduProtocolLabel(protocol: ComplexPduProtocol): string {
  return complexPduProtocols.find((item) => item.value === protocol)?.label ?? protocol.toUpperCase();
}

function complexPduServiceEnabled(device: NetworkDevice, protocol: ComplexPduProtocol): boolean {
  if (protocol === "icmp") return true;
  if (protocol === "dns") return device.config.services.dns;
  if (protocol === "http") return device.config.services.http;
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
  const [notice, setNotice] = useState("");
  const model = getDeviceModel(device.modelId);
  const compatibleModules = Array.from(new Set(model.modules.flatMap((slot) => slot.accepts)))
    .map((moduleId) => getModuleSpec(moduleId))
    .filter((module): module is ModuleSpec => Boolean(module));

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
              <select value={aclDraft.protocol} onChange={(event) => setAclDraft({ ...aclDraft, protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select>
              <input value={aclDraft.source} onChange={(event) => setAclDraft({ ...aclDraft, source: event.target.value })} placeholder="출발지" />
              <input value={aclDraft.destination} onChange={(event) => setAclDraft({ ...aclDraft, destination: event.target.value })} placeholder="목적지" />
              <input value={aclDraft.interfaceName} onChange={(event) => setAclDraft({ ...aclDraft, interfaceName: event.target.value })} placeholder="인터페이스" />
              <button className="secondary-action" onClick={addAccessRule} type="button">ACL 추가</button>
            </div>
            {device.config.accessRules.map((rule) => (
              <div className="editable-acl-row" key={rule.id}>
                <label>동작<select value={rule.action} onChange={(event) => updateAccessRule(rule.id, { action: event.target.value as AccessRule["action"] })}><option value="permit">permit</option><option value="deny">deny</option></select></label>
                <label>프로토콜<select value={rule.protocol} onChange={(event) => updateAccessRule(rule.id, { protocol: event.target.value as AccessRule["protocol"] })}><option value="ip">ip</option><option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="http">http</option><option value="dns">dns</option><option value="dhcp">dhcp</option></select></label>
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
    </section>
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
  { command: "show vlan brief", detail: "VLAN 테이블" },
  { command: "show mac address-table", detail: "MAC 테이블" },
  { command: "show cdp neighbors", detail: "직접 연결 이웃" },
  { command: "show ip route", detail: "라우팅 테이블" },
  { command: "show arp", detail: "ARP 테이블" },
  { command: "show hosts", detail: "DNS 서버와 호스트 테이블" },
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

const desktopQuickCommands = ["ipconfig /all", "ipconfig /renew", "arp -a", "route print", "ping www.lab.local", "tracert www.lab.local", "nslookup www.lab.local", "http www.lab.local", "tftp www.lab.local", "syslog www.lab.local link-check"];

function DesktopTab({ device, project, onProjectChange, onUpdate }: { device: NetworkDevice; project: NetworkProject; onProjectChange: (project: NetworkProject, message: string) => void; onUpdate: (device: NetworkDevice) => void }) {
  const dataPorts = device.ports.filter((port) => port.kind !== "console");
  const [activeApp, setActiveApp] = useState<"ip" | "prompt" | "browser">("prompt");
  const [selectedPortId, setSelectedPortId] = useState(dataPorts[0]?.id ?? "");
  const [output, setOutput] = useState("명령 프롬프트");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [browserTarget, setBrowserTarget] = useState("www.lab.local");
  const [browserOutput, setBrowserOutput] = useState("웹 브라우저");
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
    setHistory((items) => [...items, command].slice(-60));
    setHistoryIndex(null);
    const nextOutput = await desktopCommand(project, device, command, onProjectChange);
    setOutput((current) => `${current}\n\n> ${command}\n${nextOutput}`);
    setInput("");
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

  return (
    <section className="desktop-panel">
      <div className="desktop-app-bar">
        <button className={activeApp === "ip" ? "active" : ""} onClick={() => setActiveApp("ip")} type="button"><Settings size={15} />IP 설정</button>
        <button className={activeApp === "prompt" ? "active" : ""} onClick={() => setActiveApp("prompt")} type="button"><Terminal size={15} />명령 프롬프트</button>
        <button className={activeApp === "browser" ? "active" : ""} onClick={() => setActiveApp("browser")} type="button"><Monitor size={15} />웹 브라우저</button>
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
          <small>프로젝트 장비 {project.devices.length}개 | ipconfig, arp -a, route print, ping, tracert, nslookup, http, tftp, syslog</small>
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
        `  IPv4 주소 . . . . . . . . . . . : ${port.ipAddress || "0.0.0.0"}`,
        `  서브넷 마스크 . . . . . . . . . : ${port.subnetMask || "0.0.0.0"}`,
        `  기본 게이트웨이 . . . . . . . . : ${port.gateway || "0.0.0.0"}`,
        `  DNS 서버 . . . . . . . . . . . . : ${port.dnsServer || "0.0.0.0"}`
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
    onProjectChange(released, "DHCP 임대를 해제했습니다.");
    return "DHCP 임대를 해제했습니다.";
  }
  if (lower === "arp -a") {
    return device.runtime.arpTable.map((entry) => `${entry.ipAddress.padEnd(16)}${entry.macAddress.padEnd(20)}${entry.portName}`).join("\n") || "ARP 항목이 없습니다.";
  }
  if (lower === "route print") {
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
    if (!command.slice(5).trim()) return "사용법: ping <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, command.slice(5), onProjectChange);
    if (!resolved.target) return `Ping 대상 ${command.slice(5).trim()}을(를) 찾을 수 없습니다: ${resolved.error}`;
    const result = await simulatePing(resolved.project, device.id, resolved.target.id);
    onProjectChange(result.project, result.message);
    return result.success ? result.message : `요청 시간이 초과되었습니다. ${result.message}`;
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
    const record = server.config.dnsRecords.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!record) {
      const nextProject = appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${name} DNS 질의가 NXDOMAIN을 반환했습니다.`, "dropped");
      onProjectChange(nextProject, "DNS 레코드를 찾을 수 없습니다.");
      return `서버: ${server.label}\n이름: ${name}\n*** 주소 레코드가 없습니다.`;
    }
    onProjectChange(appendDesktopEvent(reachability.project, device.id, server.id, "DNS", `${record.name}을(를) ${record.value}(으)로 확인했습니다.`, "delivered"), `DNS가 ${record.name}을(를) 확인했습니다.`);
    return `서버: ${server.label}\n이름: ${record.name}\n주소: ${record.value}`;
  }
  if (lower.startsWith("http ")) {
    if (!command.slice(5).trim()) return "사용법: http <ip|이름>";
    const resolved = await resolveDesktopNetworkTarget(project, device, command.slice(5), onProjectChange);
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
    onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "HTTP", `GET ${target.label} 요청이 200 OK를 반환했습니다.`, "delivered"), "HTTP 200 OK.");
    return `HTTP/1.1 200 OK\n서버: ${target.label}\n\n${target.label} 웹 서비스가 실행 중입니다.`;
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
    onProjectChange(appendDesktopEvent(result.project, device.id, target.id, "TFTP", `${target.label} TFTP 디렉터리를 조회했습니다.`, "delivered"), "TFTP 조회 완료.");
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
  return "알 수 없는 데스크톱 명령입니다. ipconfig, arp -a, route print, ping <ip|이름>, tracert <ip|이름>, nslookup <이름>, http <ip|이름>, tftp <ip|이름>, syslog <ip|이름> <메시지>를 사용하세요.";
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
  const releasedLeases = project.devices.flatMap((device) =>
    device.runtime.dhcpLeases
      .filter((lease) => lease.deviceId === deviceId)
      .map((lease) => ({ serverId: device.id, ipAddress: lease.ipAddress }))
  );
  const targetId = releasedLeases[0]?.serverId ?? deviceId;
  const releasedText = releasedLeases.map((lease) => lease.ipAddress).join(", ") || "client address";
  return {
    ...project,
    devices: project.devices.map((device) => {
      const runtime = { ...device.runtime, dhcpLeases: device.runtime.dhcpLeases.filter((lease) => lease.deviceId !== deviceId) };
      if (device.id === deviceId) {
        return {
          ...device,
          ports: device.ports.map((port) => port.kind !== "console" ? { ...port, ipAddress: "", subnetMask: "", gateway: "", dnsServer: "" } : port),
          runtime
        };
      }
      return { ...device, runtime };
    }),
    simulationEvents: [
      ...project.simulationEvents,
      { id: createId("evt"), time, lastDeviceId: deviceId, atDeviceId: targetId, sourceDeviceId: deviceId, targetDeviceId: targetId, packetId, type: "DHCP", info: `DHCPRELEASE sent by client for ${releasedText}.`, status: "delivered", osiLayers: ["Layer 7", "Layer 3"] }
    ]
  };
}

function appendDesktopEvent(project: NetworkProject, sourceId: string, targetId: string, type: string, info: string, status: "forwarded" | "delivered" | "dropped", packetId = createId("packet")): NetworkProject {
  return {
    ...project,
    simulationEvents: [...project.simulationEvents, { id: createId("evt"), time: Date.now(), lastDeviceId: sourceId, atDeviceId: targetId, sourceDeviceId: sourceId, targetDeviceId: targetId, packetId, type, info, status, osiLayers: ["Layer 7", "Layer 4", "Layer 3"] }]
  };
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
  const [excludeDraft, setExcludeDraft] = useState({ startIp: "192.168.1.1", endIp: "192.168.1.20" });
  const [recordDraft, setRecordDraft] = useState({ name: "www.lab.local", value: "192.168.1.10" });
  const [servicePane, setServicePane] = useState<ServiceName>("dhcp");
  const [serviceNotice, setServiceNotice] = useState("");
  const serviceKeys = Object.keys(device.config.services) as ServiceName[];

  function toggleService(service: ServiceName, enabled: boolean) {
    setServiceNotice(`${service.toUpperCase()} 서비스를 ${enabled ? "켰습니다" : "껐습니다"}.`);
    onUpdate({ ...device, config: { ...device.config, services: { ...device.config.services, [service]: enabled } } });
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
              <header><strong>DHCP</strong><label className="toggle"><input checked={device.config.services.dhcp} onChange={(event) => toggleService("dhcp", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" onClick={() => onUpdate({ ...device, runtime: { ...device.runtime, dhcpLeases: [] } })} type="button">바인딩 비우기</button></header>
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
              <header><strong>DNS</strong><label className="toggle"><input checked={device.config.services.dns} onChange={(event) => toggleService("dns", event.target.checked)} type="checkbox" />서비스</label><small>레코드 {device.config.dnsRecords.length}개</small></header>
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
              <header><strong>HTTP</strong><label className="toggle"><input checked={device.config.services.http} onChange={(event) => toggleService("http", event.target.checked)} type="checkbox" />서비스</label></header>
              <div className="diagnostic-row info"><strong>{device.config.services.http ? "HTTP 켜짐" : "HTTP 꺼짐"}</strong><span>서버에 도달 가능할 때 웹 브라우저와 `http` 데스크톱 명령이 이 서비스를 사용합니다.</span></div>
            </div>
          )}
          {servicePane === "tftp" && (
            <div className="config-group">
              <header><strong>TFTP</strong><label className="toggle"><input checked={device.config.services.tftp} onChange={(event) => toggleService("tftp", event.target.checked)} type="checkbox" />서비스</label></header>
              <div className="diagnostic-row info"><strong>{device.config.services.tftp ? "TFTP 켜짐" : "TFTP 꺼짐"}</strong><span>데스크톱 `tftp 서버` 명령이 도달성과 서비스 상태를 검사하고 이벤트에 기록합니다.</span></div>
            </div>
          )}
          {servicePane === "syslog" && (
            <div className="config-group">
              <header><strong>SYSLOG</strong><label className="toggle"><input checked={device.config.services.syslog} onChange={(event) => toggleService("syslog", event.target.checked)} type="checkbox" />서비스</label><button className="secondary-action" onClick={() => onUpdate({ ...device, runtime: { ...device.runtime, logs: [] } })} type="button">로그 비우기</button></header>
              <div className="diagnostic-row info"><strong>{device.config.services.syslog ? "SYSLOG 켜짐" : "SYSLOG 꺼짐"}</strong><span>데스크톱 `syslog 서버 메시지` 명령이 이 장비의 런타임 로그에 기록됩니다.</span></div>
              {device.runtime.logs.length === 0 ? <p className="empty-state">수신된 SYSLOG 메시지가 없습니다.</p> : device.runtime.logs.slice(-12).reverse().map((log) => (
                <div className={`diagnostic-row ${log.level}`} key={log.id}>
                  <strong>{new Date(log.createdAt).toLocaleTimeString()}</strong>
                  <span>{log.message}</span>
                </div>
              ))}
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
  onExportEvents?: () => void;
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
  const [eventFilter, setEventFilter] = useState("all");
  const [autoPlaying, setAutoPlaying] = useState(false);
  const playTimer = useRef<number | null>(null);
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
  useEffect(() => () => stopAutoCapture(), []);
  useEffect(() => {
    stopAutoCapture();
  }, [eventFilter, project.simulationEvents.length]);

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
      playTimer.current = window.setTimeout(playNext, 450);
    };
    playNext();
  }
  return (
    <section className={`event-panel ${mode}`}>
      {mode === "simulation" ? (
        <>
          <header><strong>시뮬레이션 이벤트</strong><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">전체</option><option value="icmp">ICMP</option><option value="arp">ARP</option><option value="switch">SWITCH</option><option value="hub">HUB</option><option value="dhcp">DHCP</option><option value="dns">DNS</option><option value="http">HTTP</option><option value="tftp">TFTP</option><option value="syslog">SYSLOG</option><option value="delivered">전달됨</option><option value="forwarded">전송 중</option><option value="dropped">드롭됨</option></select><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex <= 0} onClick={() => focusRelative(-1)} type="button">이전</button><button disabled={!onFocusEvent || filteredEvents.length === 0 || focusedIndex === filteredEvents.length - 1} onClick={captureForward} type="button">캡처/전송</button><button className={autoPlaying ? "active" : ""} disabled={!onFocusEvent || filteredEvents.length === 0} onClick={autoCapturePlay} type="button">{autoPlaying ? "정지" : "자동 재생"}</button><button disabled={!onExportEvents || project.simulationEvents.length === 0} onClick={onExportEvents} type="button">CSV</button><button onClick={() => { stopAutoCapture(); onClear(); }} type="button">비우기</button></header>
          <div className="sim-status-strip">
            <span><strong>{eventStats.total}</strong> 이벤트</span>
            <span className="forwarded"><strong>{eventStats.forwarded}</strong> 전송 중</span>
            <span className="delivered"><strong>{eventStats.delivered}</strong> 전달됨</span>
            <span className="dropped"><strong>{eventStats.dropped}</strong> 드롭됨</span>
            <span><strong>{filteredEvents.length}</strong> 표시</span>
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
                <header><strong>사용자 생성 패킷</strong><small>최근 {userPackets.length}개</small></header>
                <div className="user-packet-head"><span>프로토콜</span><span>출발지</span><span>목적지</span><span>상태</span></div>
                {userPackets.map((packet) => (
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
                {userPackets.length === 0 && <p className="event-empty-state">아직 사용자 생성 패킷이 없습니다.</p>}
              </div>
              {selectedEvent && (
                <div className={`pdu-info-panel ${selectedEvent.status}`}>
                  <header><strong>PDU 정보</strong><small>{selectedEvent.type} / {eventStatusLabel(selectedEvent.status)}</small></header>
                  <p>{selectedEvent.info}</p>
                  <dl className="pdu-meta-grid">
                    <div><dt>출발지</dt><dd>{eventDeviceLabel(project, selectedEvent.sourceDeviceId ?? selectedEvent.lastDeviceId)}</dd></div>
                    <div><dt>목적지</dt><dd>{eventDeviceLabel(project, selectedEvent.targetDeviceId ?? selectedEvent.atDeviceId)}</dd></div>
                    <div><dt>현재</dt><dd>{eventDeviceLabel(project, selectedEvent.atDeviceId)}</dd></div>
                    <div><dt>패킷</dt><dd>{(selectedEvent.packetId ?? selectedEvent.id).slice(-10)}</dd></div>
                  </dl>
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
      <header><strong>네트워크 진단</strong><small>오류 {issueStats.errors} / 경고 {issueStats.warnings} / 정보 {issueStats.info}</small>{onRepair && issues.length > 0 && <button className="secondary-action" onClick={onRepair} type="button">복구</button>}</header>
      {issues.length > 0 && (
        <div className="sim-status-strip diagnostic-summary-strip">
          <span className="dropped"><strong>{issueStats.errors}</strong> 오류</span>
          <span className="warning"><strong>{issueStats.warnings}</strong> 경고</span>
          <span><strong>{issueStats.info}</strong> 정보</span>
          <span><strong>{issues.length}</strong> 전체</span>
        </div>
      )}
      {issues.length === 0 ? <p className="empty-state">프로젝트 수준 문제가 감지되지 않았습니다.</p> : issues.slice(0, 10).map((item) => (
        <div className={`diagnostic-row ${item.severity}`} key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.detail}</span>
        </div>
      ))}
      {issues.length > 10 && <p className="event-empty-state">추가 이슈 {issues.length - 10}개가 더 있습니다. 진단 리포트에서 전체 목록을 확인하세요.</p>}
      {onRemoveLink && project.links.length > 0 && (
        <>
          <header><strong>케이블</strong><small>링크 {project.links.length}개</small></header>
          {project.links.map((link) => (
            <div className={`event-row cable-row ${link.status}`} key={link.id}>
              <span className="cable-row-kind"><i className={`cable-swatch ${link.type}`} />{shortCableLabel(link.type)}</span>
              <span>{linkLabel(project, link)}</span>
              <small title={linkStatusDetail(project, link)}>{linkStatusLabel(link.status)}: {linkStatusDetail(project, link)}</small>
              <button className="secondary-action" onClick={() => onRemoveLink(link.id)} type="button">삭제</button>
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

function userCreatedPacketRows(project: NetworkProject): Array<{ id: string; protocol: string; source: string; destination: string; status: SimulationEvent["status"]; count: number }> {
  const protocols = new Set(["ICMP", "DHCP", "DNS", "HTTP", "TFTP", "SYSLOG"]);
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
