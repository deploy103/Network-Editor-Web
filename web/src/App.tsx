import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { Editor } from "./components/Editor";
import { LandingPage } from "./components/LandingPage";
import { ProjectHome } from "./components/ProjectHome";
import { createRoutedSampleProject } from "./data/sampleProject";
import { createBlankProject, currentUser, deleteProject, importProject, loadProjects, logout, saveProject } from "./storage/repository";
import type { NetworkProject, User } from "./types/network";
import { createId } from "./utils/id";

type AppRoute =
  | { name: "home" }
  | { name: "auth"; mode: "login" | "signup" }
  | { name: "projects" }
  | { name: "editor"; projectId: string };
type SaveStatus = "saved" | "pending" | "saving" | "error";

function readRoute(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/login") return { name: "auth", mode: "login" };
  if (path === "/signup") return { name: "auth", mode: "signup" };
  if (path === "/projects") return { name: "projects" };
  const editorMatch = path.match(/^\/projects\/([^/]+)$/);
  if (editorMatch?.[1]) return { name: "editor", projectId: decodeURIComponent(editorMatch[1]) };
  return { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => readRoute());
  const [user, setUser] = useState<User | null>(() => currentUser());
  const [project, setProject] = useState<NetworkProject | null>(null);
  const [projects, setProjects] = useState<NetworkProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const saveSeq = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<NetworkProject | null>(null);

  const navigate = useCallback((path: string, replace = false) => {
    const nextPath = path || "/";
    if (window.location.pathname !== nextPath) {
      if (replace) window.history.replaceState(null, "", nextPath);
      else window.history.pushState(null, "", nextPath);
    } else if (replace) {
      window.history.replaceState(null, "", nextPath);
    }
    setRoute(readRoute());
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    function handlePopState() {
      setRoute(readRoute());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (user && route.name === "auth") {
      navigate("/projects", true);
    }
  }, [navigate, route.name, user]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setProjects([]);
      setProject(null);
      return;
    }
    if (route.name !== "projects" && route.name !== "editor") return;

    setProjectsLoading(true);
    void loadProjects(user.id)
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
        if (route.name === "editor") {
          const selected = items.find((item) => item.id === route.projectId) ?? null;
          setProject(selected);
          setSaveStatus("saved");
          setLastSavedAt(selected ? new Date(selected.updatedAt).toLocaleTimeString() : "");
          setHomeError(selected ? "" : "프로젝트를 찾을 수 없습니다.");
        } else {
          setProject(null);
          setSaveStatus("saved");
          setHomeError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProjects([]);
          setProject(null);
          setHomeError(error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, route.name, route.name === "editor" ? route.projectId : "", refreshKey]);

  useEffect(() => {
    function flushBeforeUnload() {
      flushPendingSave();
    }
    function flushWhenHidden() {
      if (document.visibilityState === "hidden") flushPendingSave();
    }
    window.addEventListener("beforeunload", flushBeforeUnload);
    window.addEventListener("pagehide", flushBeforeUnload);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      window.removeEventListener("pagehide", flushBeforeUnload);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  async function createProject() {
    if (!user) {
      navigate("/login");
      return;
    }
    setHomeError("");
    try {
      const saved = await saveProject(createBlankProject(user.id));
      setProject(saved);
      setSaveStatus("saved");
      setLastSavedAt(new Date(saved.updatedAt).toLocaleTimeString());
      setRefreshKey((value) => value + 1);
      navigate(`/projects/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
    }
  }

  async function createSampleProject() {
    if (!user) {
      navigate("/login");
      return;
    }
    setHomeError("");
    try {
      const saved = await saveProject(createRoutedSampleProject(user.id));
      setProject(saved);
      setSaveStatus("saved");
      setLastSavedAt(new Date(saved.updatedAt).toLocaleTimeString());
      setRefreshKey((value) => value + 1);
      navigate(`/projects/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "샘플 프로젝트를 만들지 못했습니다.");
    }
  }

  async function removeProject(projectId: string) {
    if (!user) return;
    setHomeError("");
    try {
      await deleteProject(user.id, projectId);
      setProjects((items) => items.filter((item) => item.id !== projectId));
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 삭제하지 못했습니다.");
      throw error;
    }
  }

  async function duplicateProject(projectId: string) {
    if (!user) {
      navigate("/login");
      return;
    }
    const source = projects.find((item) => item.id === projectId);
    if (!source) {
      setHomeError("복제할 프로젝트를 찾을 수 없습니다.");
      return;
    }
    setHomeError("");
    const now = new Date().toISOString();
    try {
      const saved = await saveProject(cloneProjectForDuplicate(source, user.id, copyProjectName(source.name, projects.map((item) => item.name)), now));
      setProject(saved);
      setSaveStatus("saved");
      setLastSavedAt(new Date(saved.updatedAt).toLocaleTimeString());
      setRefreshKey((value) => value + 1);
      navigate(`/projects/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 복제하지 못했습니다.");
    }
  }

  async function importProjectFile(raw: string) {
    if (!user) {
      navigate("/login");
      return;
    }
    setHomeError("");
    try {
      const imported = await importProject(raw, user.id);
      setProject(imported);
      setSaveStatus("saved");
      setLastSavedAt(new Date(imported.updatedAt).toLocaleTimeString());
      setRefreshKey((value) => value + 1);
      navigate(`/projects/${encodeURIComponent(imported.id)}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 가져오지 못했습니다.");
    }
  }

  function persistProject(next: NetworkProject) {
    setSaveError("");
    setSaveStatus("pending");
    setProject(next);
    pendingSave.current = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const queued = pendingSave.current;
      pendingSave.current = null;
      saveTimer.current = null;
      if (queued) runSave(queued);
    }, 350);
  }

  function runSave(next: NetworkProject) {
    const seq = saveSeq.current + 1;
    saveSeq.current = seq;
    setSaveStatus("saving");
    void saveProject(next)
      .then((saved) => {
        if (saveSeq.current === seq) {
          setSaveError("");
          setProject((current) => current && current.id === saved.id ? saved : current);
          setSaveStatus("saved");
          setLastSavedAt(new Date(saved.updatedAt).toLocaleTimeString());
        }
      })
      .catch((error) => {
        if (saveSeq.current !== seq) return;
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "프로젝트 저장에 실패했습니다.");
      });
  }

  function flushPendingSave() {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const queued = pendingSave.current;
    pendingSave.current = null;
    if (queued) runSave(queued);
  }

  function saveProjectNow(next: NetworkProject) {
    setSaveError("");
    setSaveStatus("saving");
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSave.current = null;
    setProject(next);
    runSave(next);
  }

  function signOut() {
    flushPendingSave();
    logout();
    setUser(null);
    setProject(null);
    setProjects([]);
    navigate("/", true);
  }

  if (!user) {
    if (route.name === "auth") {
      return (
        <AuthScreen
          initialMode={route.mode}
          onAuthenticated={(nextUser) => {
            setUser(nextUser);
            navigate("/projects", true);
          }}
          onBack={() => navigate("/")}
          onModeChange={(mode) => navigate(mode === "login" ? "/login" : "/signup")}
        />
      );
    }
    return <LandingPage user={null} onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} onWorkspace={() => navigate("/login")} onLogout={signOut} />;
  }

  if (route.name === "home" || route.name === "auth") {
    return <LandingPage user={user} onLogin={() => navigate("/projects")} onSignup={() => navigate("/projects")} onWorkspace={() => navigate("/projects")} onLogout={signOut} />;
  }

  if (route.name === "projects") {
    return (
      <ProjectHome
        user={user}
        projects={projects}
        error={projectsLoading ? "프로젝트를 불러오는 중입니다." : homeError}
        onOpen={(item) => {
          setHomeError("");
          setProject(item);
          navigate(`/projects/${encodeURIComponent(item.id)}`);
        }}
        onCreate={createProject}
        onCreateSample={createSampleProject}
        onDuplicate={duplicateProject}
        onImport={importProjectFile}
        onDelete={removeProject}
        onLogout={signOut}
      />
    );
  }

  if (!project) {
    return (
      <ProjectHome
        user={user}
        projects={projects}
        error={projectsLoading ? "프로젝트를 불러오는 중입니다." : homeError || "프로젝트를 열 수 없습니다."}
        onOpen={(item) => {
          setHomeError("");
          setProject(item);
          navigate(`/projects/${encodeURIComponent(item.id)}`);
        }}
        onCreate={createProject}
        onCreateSample={createSampleProject}
        onDuplicate={duplicateProject}
        onImport={importProjectFile}
        onDelete={removeProject}
        onLogout={signOut}
      />
    );
  }

  return (
    <Editor
      project={project}
      saveError={saveError}
      saveStatus={saveStatus}
      lastSavedAt={lastSavedAt}
      onBack={() => {
        flushPendingSave();
        setProject(null);
        setRefreshKey((value) => value + 1);
        navigate("/projects");
      }}
      onChange={persistProject}
      onSave={saveProjectNow}
      user={user}
    />
  );
}

function copyProjectName(name: string, existingNames: string[]): string {
  const base = `${name || "제목 없는 네트워크"} 복사본`.slice(0, 90);
  const used = new Set(existingNames.map((item) => item.toLowerCase()));
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} ${index}`.slice(0, 100);
    index += 1;
  }
  return candidate;
}

function cloneProjectForDuplicate(source: NetworkProject, ownerId: string, name: string, now: string): NetworkProject {
  const deviceIdMap = new Map<string, string>();
  const portIdMap = new Map<string, string>();
  const linkIdMap = new Map<string, string>();
  const devices = source.devices.map((device) => {
    const nextDeviceId = createId("dev");
    deviceIdMap.set(device.id, nextDeviceId);
    return {
      ...structuredClone(device),
      id: nextDeviceId,
      ports: device.ports.map((port) => {
        const nextPortId = createId("port");
        portIdMap.set(`${device.id}:${port.id}`, nextPortId);
        return { ...port, id: nextPortId, linkId: undefined };
      }),
      runtime: { arpTable: [], macTable: [], dhcpLeases: [], logs: [] }
    };
  });
  const links = source.links.flatMap((link) => {
    const endpointADeviceId = deviceIdMap.get(link.endpointA.deviceId);
    const endpointBDeviceId = deviceIdMap.get(link.endpointB.deviceId);
    const endpointAPortId = portIdMap.get(`${link.endpointA.deviceId}:${link.endpointA.portId}`);
    const endpointBPortId = portIdMap.get(`${link.endpointB.deviceId}:${link.endpointB.portId}`);
    if (!endpointADeviceId || !endpointBDeviceId || !endpointAPortId || !endpointBPortId) return [];
    const nextLinkId = createId("link");
    linkIdMap.set(link.id, nextLinkId);
    return [{
      ...link,
      id: nextLinkId,
      endpointA: { deviceId: endpointADeviceId, portId: endpointAPortId },
      endpointB: { deviceId: endpointBDeviceId, portId: endpointBPortId },
      createdAt: Date.now()
    }];
  });
  return {
    ...source,
    id: createId("project"),
    ownerId,
    name,
    devices: devices.map((device, index) => ({
      ...device,
      ports: device.ports.map((port, portIndex) => {
        const oldPort = source.devices[index]?.ports[portIndex];
        return { ...port, linkId: oldPort?.linkId ? linkIdMap.get(oldPort.linkId) : undefined };
      })
    })),
    links,
    notes: (source.notes ?? []).map((note) => ({ ...note, id: createId("note") })),
    drawings: (source.drawings ?? []).map((drawing) => ({ ...drawing, id: createId("draw") })),
    activity: source.activity ? {
      ...source.activity,
      requirements: source.activity.requirements.map((requirement) => ({ ...requirement, id: createId("act_req") })),
      commandRules: (source.activity.commandRules ?? []).map((rule) => ({ ...rule, id: createId("act_cmd"), deviceId: rule.deviceId ? deviceIdMap.get(rule.deviceId) : undefined })),
      commandSequences: (source.activity.commandSequences ?? []).map((sequence) => ({ ...sequence, id: createId("act_seq"), deviceId: sequence.deviceId ? deviceIdMap.get(sequence.deviceId) : undefined })),
      commandOutputAssertions: (source.activity.commandOutputAssertions ?? []).map((assertion) => ({ ...assertion, id: createId("act_out"), deviceId: assertion.deviceId ? deviceIdMap.get(assertion.deviceId) : undefined })),
      interfaceExpectations: (source.activity.interfaceExpectations ?? []).flatMap((expectation) => {
        const deviceId = deviceIdMap.get(expectation.deviceId);
        const portId = portIdMap.get(`${expectation.deviceId}:${expectation.portId}`);
        return deviceId && portId ? [{ ...expectation, id: createId("act_int"), deviceId, portId }] : [];
      }),
      headerAssertions: (source.activity.headerAssertions ?? []).map((assertion) => ({ ...assertion, id: createId("act_hdr") })),
      answerSnapshot: source.activity.answerSnapshot ? {
        ...source.activity.answerSnapshot,
        devices: source.activity.answerSnapshot.devices.flatMap((device) => {
          const id = deviceIdMap.get(device.id);
          return id ? [{ ...device, id }] : [];
        }),
        links: source.activity.answerSnapshot.links.flatMap((link) => {
          const id = linkIdMap.get(link.id);
          const endpointADeviceId = deviceIdMap.get(link.endpointADeviceId);
          const endpointBDeviceId = deviceIdMap.get(link.endpointBDeviceId);
          return id && endpointADeviceId && endpointBDeviceId ? [{ ...link, id, endpointADeviceId, endpointBDeviceId }] : [];
        }),
        serviceDeviceIds: source.activity.answerSnapshot.serviceDeviceIds.flatMap((id) => deviceIdMap.get(id) ?? []),
        startupConfigDeviceIds: source.activity.answerSnapshot.startupConfigDeviceIds.flatMap((id) => deviceIdMap.get(id) ?? [])
      } : undefined
    } : undefined,
    simulationEvents: [],
    createdAt: now,
    updatedAt: now
  };
}
