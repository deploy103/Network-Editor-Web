import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileJson, Save } from "lucide-react";
import type { AppUser, CableTool, LinkEndpoint, NetworkDevice, NetworkProject } from "../types/network";
import { createDevice, getDeviceSpec } from "../data/deviceCatalog";
import { addLink, chooseAutoCableBetweenDevices, chooseAutoCableForEndpoints, chooseAutoCableFromDeviceToEndpoint, chooseAutoCableFromEndpointToDevice, findAutoEndpoint, removeDevice, removeLink, updateDevice, validateConnection } from "../engine/topology";
import { exportPacketTracerLikeFile } from "../exporters/packetTracerExport";
import { exportProjectJson } from "../exporters/projectExport";
import Palette from "./Palette";
import Workspace from "./Workspace";
import Inspector from "./Inspector";
import SimulationPanel from "./SimulationPanel";

type ConnectionNotice = {
  title: string;
  message: string;
  tone: "info" | "success" | "error";
};

interface Props {
  user: AppUser;
  project: NetworkProject;
  onBack: (project: NetworkProject) => void;
  onProjectChange: (project: NetworkProject) => void;
}

export default function Editor({ user, project, onBack, onProjectChange }: Props) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(project.devices[0]?.id);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>();
  const [activeCable, setActiveCable] = useState<CableTool | undefined>();
  const [pendingEndpoint, setPendingEndpoint] = useState<LinkEndpoint | undefined>();
  const [pendingAutoDeviceId, setPendingAutoDeviceId] = useState<string | undefined>();
  const [connectionNotice, setConnectionNotice] = useState<ConnectionNotice | null>(null);

  function commit(next: NetworkProject) {
    onProjectChange(next);
  }

  function clearCableMode() {
    setActiveCable(undefined);
    setPendingEndpoint(undefined);
    setPendingAutoDeviceId(undefined);
    setConnectionNotice(null);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if (event.key === "Escape") {
        clearCableMode();
        return;
      }
      if (typing || (event.key !== "Delete" && event.key !== "Backspace")) return;
      if (selectedLinkId) {
        event.preventDefault();
        removeSelectedLink(selectedLinkId);
        setConnectionNotice({ title: "링크 삭제됨", message: "선택한 링크를 제거했습니다.", tone: "info" });
        return;
      }
      if (selectedDeviceId) {
        event.preventDefault();
        const device = project.devices.find((entry) => entry.id === selectedDeviceId);
        commit(removeDevice(project, selectedDeviceId));
        setSelectedDeviceId(undefined);
        setConnectionNotice({ title: "장비 삭제됨", message: `${device?.label ?? "선택한 장비"}와 연결된 링크를 제거했습니다.`, tone: "info" });
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [project, selectedDeviceId, selectedLinkId]);

  function addDevice(catalogId: string) {
    const spec = getDeviceSpec(catalogId);
    const count =
      project.devices.filter((device) => (spec.type === "pc" ? device.catalogId === spec.id || (!device.catalogId && device.type === spec.type) : device.type === spec.type)).length + 1;
    const device = createDevice(catalogId, 120 + (project.devices.length % 4) * 150, 120 + Math.floor(project.devices.length / 4) * 130, count);
    commit({ ...project, devices: [...project.devices, device] });
    setSelectedDeviceId(device.id);
    setSelectedLinkId(undefined);
  }

  function changeDevice(device: NetworkDevice) {
    commit(updateDevice(project, device));
  }

  function removeSelectedLink(linkId: string) {
    commit(removeLink(project, linkId));
    if (selectedLinkId === linkId) setSelectedLinkId(undefined);
  }

  function handlePortClick(endpoint: LinkEndpoint) {
    if (!activeCable) return;
    if (activeCable === "auto") {
      if (pendingAutoDeviceId) {
        const choice = chooseAutoCableFromDeviceToEndpoint(project, pendingAutoDeviceId, endpoint);
        if (!choice.ok || !choice.type || !choice.a || !choice.b) {
          setConnectionNotice({ title: "Auto 연결 실패", message: choice.message, tone: "error" });
          return;
        }
        commit(addLink(project, choice.type, choice.a, choice.b));
        setConnectionNotice({ title: "Auto 케이블 연결됨", message: choice.message, tone: "success" });
        setPendingAutoDeviceId(undefined);
        setPendingEndpoint(undefined);
        setActiveCable(undefined);
        setSelectedLinkId(undefined);
        return;
      }
      if (!pendingEndpoint) {
        setPendingEndpoint(endpoint);
        setConnectionNotice({ title: "첫 번째 포트 선택", message: "두 번째 장비나 포트를 선택하면 Auto가 케이블 타입을 결정합니다.", tone: "info" });
        return;
      }
      const choice = chooseAutoCableForEndpoints(project, pendingEndpoint, endpoint);
      if (!choice.ok || !choice.type || !choice.a || !choice.b) {
        setConnectionNotice({ title: "Auto 연결 실패", message: choice.message, tone: "error" });
        return;
      }
      commit(addLink(project, choice.type, choice.a, choice.b));
      setConnectionNotice({ title: "Auto 케이블 연결됨", message: choice.message, tone: "success" });
      setPendingEndpoint(undefined);
      setActiveCable(undefined);
      setSelectedLinkId(undefined);
      return;
    }
    if (!pendingEndpoint) {
      setPendingEndpoint(endpoint);
      setConnectionNotice({ title: "첫 번째 포트 선택", message: "두 번째 장비나 포트를 선택하면 연결합니다.", tone: "info" });
      return;
    }
    const validation = validateConnection(project, activeCable, pendingEndpoint, endpoint);
    if (!validation.ok) {
      setConnectionNotice({ title: "연결할 수 없음", message: validation.message, tone: "error" });
      return;
    }
    commit(addLink(project, activeCable, pendingEndpoint, endpoint));
    setConnectionNotice({ title: "케이블 연결됨", message: validation.message, tone: "success" });
    setPendingEndpoint(undefined);
    setActiveCable(undefined);
    setSelectedLinkId(undefined);
  }

  function handleDeviceCableClick(deviceId: string) {
    if (!activeCable) return;
    if (activeCable === "auto") {
      if (pendingEndpoint) {
        const choice = chooseAutoCableFromEndpointToDevice(project, pendingEndpoint, deviceId);
        if (!choice.ok || !choice.type || !choice.a || !choice.b) {
          setConnectionNotice({ title: "Auto 연결 실패", message: choice.message, tone: "error" });
          return;
        }
        commit(addLink(project, choice.type, choice.a, choice.b));
        setSelectedDeviceId(deviceId);
        setSelectedLinkId(undefined);
        setPendingEndpoint(undefined);
        setPendingAutoDeviceId(undefined);
        setActiveCable(undefined);
        setConnectionNotice({ title: "Auto 케이블 연결됨", message: choice.message, tone: "success" });
        return;
      }
      if (!pendingAutoDeviceId) {
        const device = project.devices.find((entry) => entry.id === deviceId);
        setPendingAutoDeviceId(deviceId);
        setSelectedDeviceId(deviceId);
        setConnectionNotice({ title: "첫 번째 장비 선택", message: `${device?.label ?? "선택한 장비"}에서 시작합니다. 두 번째 장비를 클릭하면 Auto가 포트와 케이블을 고릅니다.`, tone: "info" });
        return;
      }
      const choice = chooseAutoCableBetweenDevices(project, pendingAutoDeviceId, deviceId);
      if (!choice.ok || !choice.type || !choice.a || !choice.b) {
        setConnectionNotice({ title: "Auto 연결 실패", message: choice.message, tone: "error" });
        return;
      }
      commit(addLink(project, choice.type, choice.a, choice.b));
      setSelectedDeviceId(deviceId);
      setSelectedLinkId(undefined);
      setPendingEndpoint(undefined);
      setPendingAutoDeviceId(undefined);
      setActiveCable(undefined);
      setConnectionNotice({ title: "Auto 케이블 연결됨", message: choice.message, tone: "success" });
      return;
    }
    const result = findAutoEndpoint(project, activeCable, deviceId, pendingEndpoint);
    if (!result.endpoint) {
      setConnectionNotice({ title: "자동 연결 실패", message: result.message, tone: "error" });
      return;
    }
    if (!pendingEndpoint) {
      setPendingEndpoint(result.endpoint);
      setSelectedDeviceId(deviceId);
      setConnectionNotice({ title: "첫 번째 포트 자동 선택", message: `${result.message}. 두 번째 장비를 선택하세요.`, tone: "info" });
      return;
    }
    const validation = validateConnection(project, activeCable, pendingEndpoint, result.endpoint);
    if (!validation.ok) {
      setConnectionNotice({ title: "연결할 수 없음", message: validation.message, tone: "error" });
      return;
    }
    commit(addLink(project, activeCable, pendingEndpoint, result.endpoint));
    setSelectedDeviceId(deviceId);
    setSelectedLinkId(undefined);
    setPendingEndpoint(undefined);
    setActiveCable(undefined);
    setConnectionNotice({ title: "케이블 연결됨", message: validation.message, tone: "success" });
  }

  const selectedDevice = project.devices.find((device) => device.id === selectedDeviceId);
  const selectedSimulationEvent = project.simulation.events.find((event) => event.id === project.simulation.selectedEventId) ?? project.simulation.events.at(-1);

  return (
    <main className="editor-shell">
      <header className="editor-topbar">
        <div className="title-cluster">
          <button className="icon-button" onClick={() => onBack(project)} title="프로젝트 홈">
            <ArrowLeft size={18} />
          </button>
          <input className="project-name-input" value={project.name} onChange={(event) => commit({ ...project, name: event.target.value })} />
          <span className="session-chip">{user.username}</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => commit(project)} title="저장">
            <Save size={18} />
          </button>
          <button className="icon-button" onClick={() => exportProjectJson(project)} title="JSON 내보내기">
            <FileJson size={18} />
          </button>
          <button className="icon-button" onClick={() => exportPacketTracerLikeFile(project)} title=".pkt 내보내기">
            <Download size={18} />
          </button>
        </div>
      </header>
      <div className="editor-grid">
        <Palette
          project={project}
          activeCable={activeCable}
          selectedLinkId={selectedLinkId}
          onAddDevice={addDevice}
          onSelectCable={(type) => {
            if (activeCable === type) {
              clearCableMode();
              return;
            }
            setActiveCable(type);
            setPendingEndpoint(undefined);
            setPendingAutoDeviceId(undefined);
            setConnectionNotice({
              title: type === "auto" ? "Auto 케이블 선택됨" : "케이블 선택됨",
              message: type === "auto" ? "장비 본체 두 개를 차례로 클릭하면 Auto가 포트와 케이블 타입을 고릅니다." : "장비 본체를 차례로 클릭하면 사용 가능한 포트를 자동으로 연결합니다.",
              tone: "info",
            });
          }}
          onSelectLink={(linkId) => {
            setSelectedLinkId(linkId);
            if (linkId) setSelectedDeviceId(undefined);
          }}
          onRemoveLink={removeSelectedLink}
        />
        <Workspace
          project={project}
          selectedDeviceId={selectedDeviceId}
          selectedLinkId={selectedLinkId}
          activeCable={activeCable}
          pendingEndpoint={pendingEndpoint}
          pendingAutoDeviceId={pendingAutoDeviceId}
          selectedEvent={selectedSimulationEvent}
          onSelectDevice={(deviceId) => {
            setSelectedDeviceId(deviceId);
            if (deviceId) setSelectedLinkId(undefined);
          }}
          onSelectLink={(linkId) => {
            setSelectedLinkId(linkId);
            if (linkId) setSelectedDeviceId(undefined);
          }}
          onRemoveLink={removeSelectedLink}
          onMoveDevice={(deviceId, x, y) => {
            const device = project.devices.find((entry) => entry.id === deviceId);
            if (device) commit(updateDevice(project, { ...device, x, y }));
          }}
          onPortClick={handlePortClick}
          onDeviceCableClick={handleDeviceCableClick}
        />
        <Inspector
          project={project}
          device={selectedDevice}
          onChangeDevice={changeDevice}
          onRemoveDevice={(deviceId) => {
            commit(removeDevice(project, deviceId));
            setSelectedDeviceId(undefined);
          }}
          onProjectChange={commit}
        />
        <SimulationPanel project={project} onProjectChange={commit} />
      </div>
      {connectionNotice?.tone === "error" && (
        <div className="connection-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
          <div className="connection-dialog">
            <strong id="connection-dialog-title">{connectionNotice.title}</strong>
            <p>{connectionNotice.message}</p>
            <div>
              <button onClick={() => setConnectionNotice(null)}>확인</button>
            </div>
          </div>
        </div>
      )}
      {connectionNotice && connectionNotice.tone !== "error" && (
        <div className={`connection-toast ${connectionNotice.tone}`} role="status">
          <strong>{connectionNotice.title}</strong>
          <span>{connectionNotice.message}</span>
          <button onClick={() => setConnectionNotice(null)}>닫기</button>
        </div>
      )}
    </main>
  );
}
