import type { NetworkProject, User } from "../types/network";
import { normalizeProject } from "./normalizeProject";

const API_URL = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const SESSION_KEY = "new-network-editor-api-session";

interface ApiSession {
  token: string;
  user: User;
}

export function isApiEnabled(): boolean {
  return API_URL.length > 0;
}

export function currentApiUser(): User | null {
  const session = readSession();
  if (!session || tokenExpired(session.token)) {
    apiLogout();
    return null;
  }
  return session.user;
}

export function apiLogout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function apiSignup(input: {
  name: string;
  username: string;
  email: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
}): Promise<User> {
  const session = await request<ApiSession>("/api/signup", { method: "POST", body: JSON.stringify(input) });
  writeSession(session);
  return session.user;
}

export async function apiLogin(username: string, password: string): Promise<User> {
  const session = await request<ApiSession>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  writeSession(session);
  return session.user;
}

export async function apiProjects(): Promise<NetworkProject[]> {
  const response = await authorizedRequest<{ projects: NetworkProject[] }>("/api/projects", { method: "GET" });
  return response.projects.map(normalizeProject);
}

export async function apiSaveProject(project: NetworkProject): Promise<NetworkProject> {
  const next = normalizeProject({ ...project, name: project.name.trim() || "Untitled Network", updatedAt: new Date().toISOString() });
  await authorizedRequest<{ id: string }>("/api/projects", { method: "PUT", body: JSON.stringify(next) });
  return next;
}

export async function apiDeleteProject(projectId: string): Promise<void> {
  await authorizedRequest<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

async function authorizedRequest<T>(path: string, init: RequestInit): Promise<T> {
  const session = readSession();
  if (!session || tokenExpired(session.token)) {
    apiLogout();
    throw new Error("API session expired. Please log in again.");
  }
  return request<T>(path, init, session.token);
}

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    let message = `API request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function readSession(): ApiSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as ApiSession : null;
  } catch {
    return null;
  }
}

function writeSession(session: ApiSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function tokenExpired(token: string): boolean {
  const [, expiresRaw] = token.split(".");
  if (!expiresRaw) return true;
  try {
    const padded = expiresRaw.padEnd(Math.ceil(expiresRaw.length / 4) * 4, "=").replace(/-/g, "+").replace(/_/g, "/");
    return Date.now() >= Date.parse(atob(padded));
  } catch {
    return true;
  }
}
