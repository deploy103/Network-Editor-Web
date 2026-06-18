import { useCallback, useEffect, useRef, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { Editor } from "./components/Editor";
import { LandingPage } from "./components/LandingPage";
import { ProjectHome } from "./components/ProjectHome";
import { createRoutedSampleProject } from "./data/sampleProject";
import { createBlankProject, currentUser, deleteProject, importProject, loadProjects, logout, saveProject } from "./storage/repository";
import type { NetworkProject, User } from "./types/network";

type AppRoute =
  | { name: "home" }
  | { name: "auth"; mode: "login" | "signup" }
  | { name: "projects" }
  | { name: "editor"; projectId: string };

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
          setHomeError(selected ? "" : "프로젝트를 찾을 수 없습니다.");
        } else {
          setProject(null);
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
      if (pendingSave.current) void saveProject(pendingSave.current);
    }
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => window.removeEventListener("beforeunload", flushBeforeUnload);
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
      setRefreshKey((value) => value + 1);
      navigate(`/projects/${encodeURIComponent(imported.id)}`);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 가져오지 못했습니다.");
    }
  }

  function persistProject(next: NetworkProject) {
    setSaveError("");
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
    void saveProject(next)
      .then((saved) => {
        setSaveError("");
        if (saveSeq.current === seq) setProject((current) => current && current.id === saved.id ? saved : current);
      })
      .catch((error) => setSaveError(error instanceof Error ? error.message : "프로젝트 저장에 실패했습니다."));
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
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSave.current = null;
    setProject(next);
    runSave(next);
  }

  function signOut() {
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
