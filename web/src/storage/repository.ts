import { apiDeleteProject, apiLogin, apiLogout, apiProjects, apiSaveProject, apiSignup, currentApiUser, isApiEnabled, markApiSessionActive } from "./apiClient";
import * as local from "./localStore";
import type { NetworkProject, User } from "../types/network";

export function createBlankProject(ownerId: string): NetworkProject {
  return local.createBlankProject(ownerId);
}

export function currentUser(): User | null {
  if (isApiEnabled()) return currentApiUser();
  return local.currentUser();
}

export async function signup(input: {
  name: string;
  username: string;
  email: string;
  birthDate: string;
  password: string;
  confirmPassword: string;
}): Promise<User> {
  if (isApiEnabled()) return apiSignup(input);
  return local.signup(input);
}

export async function login(username: string, password: string, remember = false): Promise<User> {
  if (isApiEnabled()) return apiLogin(username, password, remember);
  return local.login(username, password, remember);
}

export function logout(): void {
  if (isApiEnabled()) {
    apiLogout();
    return;
  }
  local.logout();
}

export function markSessionActive(): User | null {
  if (isApiEnabled()) return markApiSessionActive();
  return local.markSessionActive();
}

export async function loadProjects(ownerId: string): Promise<NetworkProject[]> {
  if (isApiEnabled()) return apiProjects();
  return local.loadProjects(ownerId);
}

export async function saveProject(project: NetworkProject): Promise<NetworkProject> {
  if (isApiEnabled()) return apiSaveProject(project);
  return local.saveProject(project);
}

export async function importProject(raw: string, ownerId: string): Promise<NetworkProject> {
  const imported = local.importProject(raw, ownerId);
  return saveProject(imported);
}

export async function deleteProject(ownerId: string, projectId: string): Promise<void> {
  if (isApiEnabled()) {
    await apiDeleteProject(projectId);
    return;
  }
  local.deleteProject(ownerId, projectId);
}
