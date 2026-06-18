import { createId } from "../utils/id";
import { normalizeProject } from "./normalizeProject";
import type { NetworkLink, NetworkProject, User } from "../types/network";

export { createId };

const USERS_KEY = "new-network-editor-users";
const PROJECTS_KEY = "new-network-editor-projects";
const SESSION_KEY = "new-network-editor-session";

export function nowIso(): string {
  return new Date().toISOString();
}

export async function signup(input: {
  name: string;
  username: string;
  email: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
}): Promise<User> {
  const validation = validateSignup(input);
  if (validation) throw new Error(validation);
  const users = loadUsers();
  if (users.some((user) => user.username.toLowerCase() === input.username.toLowerCase() || user.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("이미 존재하는 아이디 또는 이메일입니다.");
  }
  const user: User & { passwordHash: string } = {
    id: createId("user"),
    name: clean(input.name, 80),
    username: clean(input.username, 40),
    email: clean(input.email, 120),
    birthDate: clean(input.birthDate, 10),
    passwordHash: await hashPassword(input.password)
  };
  saveUsers([...users, user]);
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export async function login(username: string, password: string): Promise<User> {
  const user = loadUsers().find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  if (!user.passwordHash.startsWith("pbkdf2$")) {
    const upgraded = { ...user, passwordHash: await hashPassword(password) };
    saveUsers(loadUsers().map((item) => item.id === user.id ? upgraded : item));
  }
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export function currentUser(): User | null {
  const id = localStorage.getItem(SESSION_KEY);
  const user = loadUsers().find((item) => item.id === id);
  return user ? publicUser(user) : null;
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function createBlankProject(ownerId: string): NetworkProject {
  const now = nowIso();
  return {
    id: createId("project"),
    ownerId,
    name: "새 네트워크",
    devices: [],
    links: [],
    simulationEvents: [],
    createdAt: now,
    updatedAt: now
  };
}

export function loadProjects(ownerId: string): NetworkProject[] {
  return loadAllProjects()
    .filter((project) => project.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProject(project: NetworkProject): NetworkProject {
  const next = normalizeProject({ ...project, name: clean(project.name || "제목 없는 네트워크", 100), updatedAt: nowIso() });
  const projects = loadAllProjects();
  const exists = projects.some((item) => item.id === next.id);
  const stored = exists ? projects.map((item) => (item.id === next.id ? next : item)) : [...projects, next];
  if (JSON.stringify(next).length > 5_000_000) {
    throw new Error("프로젝트가 너무 큽니다.");
  }
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(stored));
  return next;
}

export function deleteProject(ownerId: string, projectId: string): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(loadAllProjects().filter((item) => !(item.ownerId === ownerId && item.id === projectId))));
}

export function exportProject(project: NetworkProject): string {
  return JSON.stringify(project, null, 2);
}

export function importProject(raw: string, ownerId: string): NetworkProject {
  if (raw.length > 5_000_000 || raw.includes("\u0000")) {
    throw new Error("JSON/PTWEB 프로젝트 파일만 가져올 수 있습니다. Cisco Packet Tracer .pkt 바이너리는 지원하지 않습니다.");
  }
  const parsed = parseProjectImport(raw);
  if (!Array.isArray(parsed.devices) || !Array.isArray(parsed.links)) {
    throw new Error("프로젝트 구조가 올바르지 않습니다.");
  }
  return normalizeImportedProject(parsed, ownerId);
}

function parseProjectImport(raw: string): NetworkProject {
  try {
    if (raw.startsWith("PTWEB1\n")) {
      const envelope = JSON.parse(raw.slice("PTWEB1\n".length)) as { project?: NetworkProject };
      if (!envelope.project) {
        throw new Error("PTWEB 프로젝트가 비어 있습니다.");
      }
      return envelope.project;
    }
    return JSON.parse(raw) as NetworkProject;
  } catch (error) {
    if (error instanceof Error && error.message === "PTWEB 프로젝트가 비어 있습니다.") throw error;
    throw new Error("JSON/PTWEB 프로젝트 파일만 가져올 수 있습니다. Cisco Packet Tracer .pkt 바이너리는 지원하지 않습니다.");
  }
}

function normalizeImportedProject(project: NetworkProject, ownerId: string): NetworkProject {
  const validDeviceIds = new Set(project.devices.map((device) => device.id));
  const portKeys = new Set(project.devices.flatMap((device) => device.ports.map((port) => `${device.id}:${port.id}`)));
  const seenLinks = new Set<string>();
  const links = project.links.map(normalizeImportedLinkShape).filter((link) => {
    const valid = Boolean(
      link.id &&
      !seenLinks.has(link.id) &&
      validDeviceIds.has(link.endpointA.deviceId) &&
      validDeviceIds.has(link.endpointB.deviceId) &&
      portKeys.has(`${link.endpointA.deviceId}:${link.endpointA.portId}`) &&
      portKeys.has(`${link.endpointB.deviceId}:${link.endpointB.portId}`)
    );
    if (valid) seenLinks.add(link.id);
    return valid;
  });
  const linkByPort = new Map<string, NetworkLink>();
  for (const link of links) {
    linkByPort.set(`${link.endpointA.deviceId}:${link.endpointA.portId}`, link);
    linkByPort.set(`${link.endpointB.deviceId}:${link.endpointB.portId}`, link);
  }
  const now = nowIso();
  return normalizeProject({
    ...project,
    id: createId("project"),
    ownerId,
    name: clean(project.name || "가져온 네트워크", 100),
    links,
    devices: project.devices.map((device) => ({
      ...device,
      ports: device.ports.map((port) => ({ ...port, linkId: linkByPort.get(`${device.id}:${port.id}`)?.id }))
    })),
    updatedAt: now,
    createdAt: now
  });
}

function normalizeImportedLinkShape(link: NetworkLink): NetworkLink {
  const legacy = link as NetworkLink & {
    a?: { deviceId: string; portId: string };
    b?: { deviceId: string; portId: string };
  };
  return {
    ...link,
    endpointA: link.endpointA ?? legacy.a ?? { deviceId: "", portId: "" },
    endpointB: link.endpointB ?? legacy.b ?? { deviceId: "", portId: "" }
  };
}

function validateSignup(input: { name: string; username: string; email: string; birthDate: string; password: string; confirmPassword: string }): string {
  if (!input.name || !input.username || !input.email || !input.birthDate) return "필수 정보를 모두 입력하세요.";
  if (!input.email.includes("@")) return "이메일 형식이 올바르지 않습니다.";
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(input.username)) return "아이디는 3~40자의 영문, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) || Number.isNaN(Date.parse(input.birthDate))) return "생년월일 형식이 올바르지 않습니다.";
  if (input.password.length < 8 || !/[^a-zA-Z0-9]/.test(input.password)) return "비밀번호는 8자 이상이고 특수문자를 포함해야 합니다.";
  if (input.password !== input.confirmPassword) return "비밀번호 확인이 일치하지 않습니다.";
  return "";
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 160_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: arrayBuffer(salt), iterations }, key, 256);
  return `pbkdf2$${iterations}$${base64(salt)}$${base64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const [, iterationsRaw, saltRaw, digestRaw] = stored.split("$");
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 100_000 || !saltRaw || !digestRaw) return false;
    const salt = fromBase64(saltRaw);
    const expected = fromBase64(digestRaw);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: arrayBuffer(salt), iterations }, key, expected.byteLength * 8);
    return constantTimeEqual(new Uint8Array(bits), expected);
  }
  return stored === await legacyHashPassword(password);
}

async function legacyHashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`network-editor:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function loadUsers(): Array<User & { passwordHash: string }> {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveUsers(users: Array<User & { passwordHash: string }>): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users.slice(0, 200)));
}

function loadAllProjects(): NetworkProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]") as NetworkProject[];
    return Array.isArray(parsed) ? parsed.map(normalizeProject) : [];
  } catch {
    return [];
  }
}

function publicUser(user: User): User {
  return { id: user.id, name: user.name, username: user.username, email: user.email, birthDate: user.birthDate };
}

function clean(value: string, limit: number): string {
  return value.replace(/[<>]/g, "").trim().slice(0, limit);
}
