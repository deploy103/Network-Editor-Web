import type { NetworkProject } from "../types/network";
import { downloadText } from "./projectExport";

export function exportPacketTracerLikeFile(project: NetworkProject): void {
  const payload = {
    warning:
      "This is a Network Editor Web topology export using the .pkt extension. Cisco Packet Tracer .pkt is proprietary; full binary compatibility is not implemented.",
    format: "network-editor-web-pkt-surrogate",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
  };

  downloadText(`${project.name.replace(/[^a-z0-9가-힣_-]+/gi, "_")}.pkt`, JSON.stringify(payload, null, 2), "application/octet-stream");
}
