import type { AppUser, AuthSession, NetworkProject } from "../types/network";
import { makeId, nowIso } from "../utils/ids";
import { normalizeProject } from "../utils/normalizeProject";

const USERS_KEY = "network-lab.users";
const SESSION_KEY = "network-lab.session";
const PROJECTS_KEY = "network-lab.projects";

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getUsers(): AppUser[] {
  return readJson<AppUser[]>(USERS_KEY, []);
}

export function saveUsers(users: AppUser[]): void {
  writeJson(USERS_KEY, users);
}

export function getSession(): AuthSession | null {
  return readJson<AuthSession | null>(SESSION_KEY, null);
}

export function saveSession(session: AuthSession | null): void {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  writeJson(SESSION_KEY, session);
}

export function getProjects(): NetworkProject[] {
  return readJson<NetworkProject[]>(PROJECTS_KEY, []).map(normalizeProject);
}

export function getProjectsForUser(userId: string): NetworkProject[] {
  return getProjects()
    .filter((project) => project.ownerUserId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProject(project: NetworkProject): NetworkProject {
  const projects = getProjects();
  const updated = normalizeProject({ ...project, updatedAt: nowIso() });
  const index = projects.findIndex((entry) => entry.id === updated.id);

  if (index >= 0) {
    projects[index] = updated;
  } else {
    projects.push(updated);
  }

  writeJson(PROJECTS_KEY, projects);
  return updated;
}

export function deleteProject(projectId: string): void {
  writeJson(
    PROJECTS_KEY,
    getProjects().filter((project) => project.id !== projectId),
  );
}

export function createEmptyProject(ownerUserId: string, name = "New Network"): NetworkProject {
  const scenarioId = makeId("scenario");

  return {
    id: makeId("project"),
    ownerUserId,
    name,
    description: "",
    devices: [],
    links: [],
    simulation: {
      mode: "realtime",
      time: 0,
      activeScenarioId: scenarioId,
      scenarios: [
        {
          id: scenarioId,
          name: "Scenario 0",
          description: "",
          pdus: [],
        },
      ],
      events: [],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
