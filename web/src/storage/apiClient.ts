import type { NetworkProject, User } from "../types/network";
import { normalizeProject } from "./normalizeProject";

const API_URL = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const SESSION_KEY = "new-network-editor-api-session";
const SESSION_COOKIE_KEY = "new-network-editor-session";
const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

interface ApiSession {
  token: string;
  user: User;
  remember?: boolean;
  createdAt?: number;
  lastActivityAt?: number;
}

export function isApiEnabled(): boolean {
  return API_URL.length > 0;
}

export function currentApiUser(): User | null {
  const session = readSession();
  if (!session || sessionExpired(session)) {
    apiLogout();
    return null;
  }
  return session.user;
}

export function apiLogout(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  clearSessionCookie();
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
  writeSession(session, false);
  return session.user;
}

export async function apiLogin(username: string, password: string, remember = false): Promise<User> {
  const session = await request<ApiSession>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  writeSession(session, remember);
  return session.user;
}

export function markApiSessionActive(): User | null {
  const session = readSession();
  if (!session || sessionExpired(session)) {
    apiLogout();
    return null;
  }
  writeSession(session, Boolean(session.remember), session.createdAt);
  return session.user;
}

export async function apiProjects(): Promise<NetworkProject[]> {
  const response = await authorizedRequest<{ projects: NetworkProject[] }>("/api/projects", { method: "GET" });
  return response.projects.map(normalizeProject);
}

export async function apiSaveProject(project: NetworkProject): Promise<NetworkProject> {
  const next = normalizeProject({ ...project, name: project.name.trim() || "제목 없는 네트워크", updatedAt: new Date().toISOString() });
  await authorizedRequest<{ id: string }>("/api/projects", { method: "PUT", body: JSON.stringify(next) });
  return next;
}

export async function apiDeleteProject(projectId: string): Promise<void> {
  await authorizedRequest<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

async function authorizedRequest<T>(path: string, init: RequestInit): Promise<T> {
  const session = readSession();
  if (!session || sessionExpired(session)) {
    apiLogout();
    throw new Error("API session expired. Please log in again.");
  }
  writeSession(session, Boolean(session.remember), session.createdAt);
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
  return parseSession(sessionStorage.getItem(SESSION_KEY)) ?? parseSession(localStorage.getItem(SESSION_KEY));
}

function writeSession(session: ApiSession, remember: boolean, createdAt = Date.now()): void {
  const next = { ...session, remember, createdAt, lastActivityAt: Date.now() };
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(next));
  writeSessionCookie(next);
}

function parseSession(raw: string | null): ApiSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ApiSession;
    return parsed.token && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

function sessionExpired(session: ApiSession): boolean {
  return tokenExpired(session.token) || Date.now() - (session.lastActivityAt ?? Date.now()) >= SESSION_IDLE_TIMEOUT_MS;
}

function writeSessionCookie(session: ApiSession): void {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(1, Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000));
  document.cookie = `${SESSION_COOKIE_KEY}=${encodeURIComponent(session.user.id)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
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
