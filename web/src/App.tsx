import { useEffect, useRef, useState } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { Editor } from "./components/Editor";
import { ProjectHome } from "./components/ProjectHome";
import { createRoutedSampleProject } from "./data/sampleProject";
import { createBlankProject, currentUser, deleteProject, importProject, loadProjects, logout, saveProject } from "./storage/repository";
import type { NetworkProject, User } from "./types/network";

export function App() {
  const [user, setUser] = useState<User | null>(() => currentUser());
  const [project, setProject] = useState<NetworkProject | null>(null);
  const [projects, setProjects] = useState<NetworkProject[]>([]);
  const [homeError, setHomeError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const saveSeq = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<NetworkProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user || project) {
      if (!user) setProjects([]);
      return;
    }
    void loadProjects(user.id)
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setProjects([]);
          setHomeError(error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, project, refreshKey]);

  useEffect(() => {
    function flushBeforeUnload() {
      if (pendingSave.current) void saveProject(pendingSave.current);
    }
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => window.removeEventListener("beforeunload", flushBeforeUnload);
  }, []);

  async function createProject() {
    if (!user) return;
    setHomeError("");
    try {
      const saved = await saveProject(createBlankProject(user.id));
      setProject(saved);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
    }
  }

  async function createSampleProject() {
    if (!user) return;
    setHomeError("");
    try {
      const saved = await saveProject(createRoutedSampleProject(user.id));
      setProject(saved);
      setRefreshKey((value) => value + 1);
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
    if (!user) return;
    setHomeError("");
    try {
      const imported = await importProject(raw, user.id);
      setProject(imported);
      setRefreshKey((value) => value + 1);
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

  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  if (!project) {
    return (
      <ProjectHome
        user={user}
        projects={projects}
        error={homeError}
        onOpen={(item) => {
          setHomeError("");
          setProject(item);
        }}
        onCreate={createProject}
        onCreateSample={createSampleProject}
        onImport={importProjectFile}
        onDelete={removeProject}
        onLogout={() => {
          logout();
          setUser(null);
          setProject(null);
          setProjects([]);
        }}
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
      }}
      onChange={persistProject}
      onSave={saveProjectNow}
      user={user}
    />
  );
}
