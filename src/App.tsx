import { useMemo, useState } from "react";
import type { AppUser, NetworkProject } from "./types/network";
import { getCurrentUser, logout } from "./auth/authStore";
import { getProjectsForUser, saveProject } from "./storage/localStore";
import AuthScreen from "./components/AuthScreen";
import LandingPage from "./components/LandingPage";
import ProjectHome from "./components/ProjectHome";
import Editor from "./components/Editor";

type View = "landing" | "auth" | "home" | "editor";
type AuthMode = "login" | "register";

export default function App() {
  const [user, setUser] = useState<AppUser | null>(() => getCurrentUser());
  const [view, setView] = useState<View>("landing");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [activeProject, setActiveProject] = useState<NetworkProject | null>(null);
  const [revision, setRevision] = useState(0);
  const projects = useMemo(() => (user ? getProjectsForUser(user.id) : []), [user, activeProject, revision]);

  function showLogin() {
    setAuthMode("login");
    setView("auth");
  }

  function showRegister() {
    setAuthMode("register");
    setView("auth");
  }

  if (view === "landing" || !user) {
    if (view === "auth" && !user) {
      return (
        <AuthScreen
          initialMode={authMode}
          onBack={() => setView("landing")}
          onAuthenticated={(nextUser) => {
            setUser(nextUser);
            setView("home");
          }}
        />
      );
    }

    return (
      <LandingPage
        user={user}
        onOpenWorkspace={() => setView(user ? "home" : "landing")}
        onLogin={showLogin}
        onRegister={showRegister}
      />
    );
  }

  if (view === "auth" && !user) {
    return (
      <AuthScreen
        initialMode={authMode}
        onBack={() => setView("landing")}
        onAuthenticated={(nextUser) => {
          setUser(nextUser);
          setView("home");
        }}
      />
    );
  }

  if (view === "editor" && activeProject) {
    return (
      <Editor
        user={user}
        project={activeProject}
        onBack={(project) => {
          const saved = saveProject(project);
          setActiveProject(saved);
          setView("home");
        }}
        onProjectChange={(project) => {
          const saved = saveProject(project);
          setActiveProject(saved);
        }}
      />
    );
  }

  return (
    <ProjectHome
      user={user}
      projects={projects}
      onLogout={() => {
        logout();
        setUser(null);
        setActiveProject(null);
        setView("landing");
      }}
      onOpenProject={(project) => {
        setActiveProject(project);
        setView("editor");
      }}
      onProjectCreated={(project) => {
        const saved = saveProject(project);
        setActiveProject(saved);
        setView("editor");
      }}
      onProjectsChanged={() => setRevision((value) => value + 1)}
    />
  );
}
