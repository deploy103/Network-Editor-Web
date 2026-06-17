import type { NetworkProject } from "../types/network";
import { normalizeProject } from "../utils/normalizeProject";

export function downloadText(filename: string, text: string, mimeType = "application/json"): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportProjectJson(project: NetworkProject): void {
  const payload = {
    format: "network-editor-web-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
  };
  downloadText(`${project.name.replace(/[^a-z0-9가-힣_-]+/gi, "_")}.network.json`, JSON.stringify(payload, null, 2));
}

export function importProjectJson(text: string): NetworkProject {
  const payload = JSON.parse(text) as { project?: NetworkProject };
  if (!payload.project?.id || !payload.project.devices || !payload.project.links) {
    throw new Error("지원하지 않는 프로젝트 파일입니다.");
  }
  return normalizeProject(payload.project);
}
