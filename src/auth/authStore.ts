import type { AppUser, AuthSession } from "../types/network";
import { makeId, nowIso } from "../utils/ids";
import { getSession, getUsers, saveSession, saveUsers } from "../storage/localStore";

const builtInCredentialModules = import.meta.glob("../../id.txt", { query: "?raw", import: "default", eager: true });
const builtInCredentialsText = String(builtInCredentialModules["../../id.txt"] ?? "");

export interface RegisterInput {
  name: string;
  username: string;
  email: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

function assertPassword(password: string, confirmPassword?: string): string | null {
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (!/[!@#$%^&*(),.?":{}|<>_\-\\/[\\];'`~+=]/.test(password)) return "비밀번호에는 특수문자가 하나 이상 필요합니다.";
  if (confirmPassword !== undefined && password !== confirmPassword) return "비밀번호 확인이 일치하지 않습니다.";
  return null;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: 120_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

function makeSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function builtInCredentials(): { username: string; password: string } | null {
  const values = new Map<string, string>();

  for (const line of builtInCredentialsText.split(/\r?\n/)) {
    const [rawKey, ...rawValue] = line.split(":");
    if (!rawKey || !rawValue.length) continue;
    values.set(rawKey.trim().toLowerCase(), rawValue.join(":").trim());
  }

  const username = values.get("id") || values.get("username") || values.get("아이디");
  const password = values.get("pw") || values.get("password") || values.get("비밀번호");

  if (!username || !password) return null;
  return { username: username.toLowerCase(), password };
}

async function ensureBuiltInUser(): Promise<AppUser | null> {
  const credentials = builtInCredentials();
  if (!credentials) return null;

  const users = getUsers();
  const existing = users.find((user) => user.username === credentials.username);
  const passwordSalt = makeSalt();
  const passwordHash = await hashPassword(credentials.password, passwordSalt);

  if (existing) {
    const existingHash = await hashPassword(credentials.password, existing.passwordSalt);
    if (existingHash === existing.passwordHash) return existing;

    const updated = { ...existing, passwordSalt, passwordHash };
    saveUsers(users.map((user) => (user.id === existing.id ? updated : user)));
    return updated;
  }

  const user: AppUser = {
    id: makeId("user"),
    name: credentials.username,
    username: credentials.username,
    email: `${credentials.username}@local.account`,
    birthDate: "2000-01-01",
    passwordSalt,
    passwordHash,
    createdAt: nowIso(),
  };

  saveUsers([...users, user]);
  return user;
}

export async function registerUser(input: RegisterInput): Promise<{ user: AppUser; session: AuthSession }> {
  await ensureBuiltInUser();
  const users = getUsers();
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  if (!input.name.trim()) throw new Error("이름을 입력하세요.");
  if (!username) throw new Error("아이디를 입력하세요.");
  if (!email || !email.includes("@")) throw new Error("이메일 형식을 확인하세요.");
  if (!input.birthDate) throw new Error("생년월일을 입력하세요.");
  if (users.some((user) => user.username === username)) throw new Error("이미 사용 중인 아이디입니다.");
  if (users.some((user) => user.email === email)) throw new Error("이미 등록된 이메일입니다.");

  const passwordError = assertPassword(input.password, input.confirmPassword);
  if (passwordError) throw new Error(passwordError);

  const passwordSalt = makeSalt();
  const user: AppUser = {
    id: makeId("user"),
    name: input.name.trim(),
    username,
    email,
    birthDate: input.birthDate,
    passwordSalt,
    passwordHash: await hashPassword(input.password, passwordSalt),
    createdAt: nowIso(),
  };

  saveUsers([...users, user]);
  const session = { userId: user.id, username: user.username, signedInAt: nowIso() };
  saveSession(session);
  return { user, session };
}

export async function loginUser(input: LoginInput): Promise<{ user: AppUser; session: AuthSession }> {
  await ensureBuiltInUser();
  const username = input.username.trim().toLowerCase();
  const user = getUsers().find((entry) => entry.username === username);
  if (!user) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");

  const passwordHash = await hashPassword(input.password, user.passwordSalt);
  if (passwordHash !== user.passwordHash) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");

  const session = { userId: user.id, username: user.username, signedInAt: nowIso() };
  saveSession(session);
  return { user, session };
}

export function logout(): void {
  saveSession(null);
}

export function getCurrentUser(): AppUser | null {
  const session = getSession();
  if (!session) return null;
  return getUsers().find((user) => user.id === session.userId) ?? null;
}
