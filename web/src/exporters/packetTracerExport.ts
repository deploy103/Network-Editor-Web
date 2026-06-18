import type { NetworkProject } from "../types/network";

export function downloadProject(project: NetworkProject, extension: "json" | "ptweb"): void {
  const content = extension === "ptweb" ? buildPacketTracerWebExport(project) : JSON.stringify(project, null, 2);
  const blob = new Blob([content], { type: extension === "ptweb" ? "application/x-ptweb" : "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName(project.name)}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

export function buildPacketTracerWebExport(project: NetworkProject): string {
  return `PTWEB1\n${JSON.stringify({
    format: "PTWEB",
    formatVersion: 1,
    compatibility: "Network Editor Web project file. This is not Cisco Packet Tracer 6.1 proprietary .pkt.",
    warning: "Import this file back into Network Editor Web. Cisco Packet Tracer .pkt binary export is not implemented.",
    project
  }, null, 2)}`;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "network";
}
