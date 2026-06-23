export type ImportPreview = { raw: string; fileName: string; name: string; devices: number; links: number };

export function readImportPreview(raw: string, fileName: string): ImportPreview {
  if (raw.length > 5_000_000 || raw.includes("\u0000")) {
    throw new Error("JSON/PTWEB 프로젝트 파일만 미리볼 수 있습니다.");
  }
  const text = raw.replace(/^\uFEFF/, "").trimStart();
  try {
    const parsed = text.startsWith("PTWEB1\n") ? JSON.parse(text.slice("PTWEB1\n".length))?.project : JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.devices) || !Array.isArray(parsed.links)) {
      throw new Error("JSON/PTWEB 프로젝트 구조를 확인할 수 없습니다.");
    }
    return {
      raw,
      fileName,
      name: String(parsed.name || "가져온 네트워크").slice(0, 100),
      devices: parsed.devices.length,
      links: parsed.links.length
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("구조")) throw error;
    throw new Error("JSON/PTWEB 프로젝트 파일만 미리볼 수 있습니다.");
  }
}
