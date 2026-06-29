import { runningConfig } from "./cli";
import type { NetworkDevice, NetworkProject } from "../types/network";

export type ConfigDriftStatus = "in-sync" | "unsaved" | "drifted" | "not-applicable";
export type ConfigDiffOp = "context" | "add" | "remove";

export interface ConfigDiffLine {
  op: ConfigDiffOp;
  line: string;
  runningLineNumber?: number;
  startupLineNumber?: number;
}

export interface ConfigDiffHunk {
  runningStart: number;
  startupStart: number;
  lines: ConfigDiffLine[];
}

export interface DeviceConfigDrift {
  deviceId: string;
  label: string;
  hostname: string;
  kind: string;
  model: string;
  status: ConfigDriftStatus;
  runningLineCount: number;
  startupLineCount: number;
  matchingLineCount: number;
  addedLineCount: number;
  removedLineCount: number;
  changedLineCount: number;
  runningOnlyCommands: string[];
  startupOnlyCommands: string[];
  hunks: ConfigDiffHunk[];
}

export interface ProjectConfigDriftReport {
  devices: DeviceConfigDrift[];
  totals: {
    inSync: number;
    unsaved: number;
    drifted: number;
    notApplicable: number;
    addedLines: number;
    removedLines: number;
    changedLines: number;
  };
}

interface LcsCell {
  length: number;
  direction?: "diag" | "up" | "left";
}

export function analyzeConfigDrift(project: NetworkProject): ProjectConfigDriftReport {
  const devices = project.devices.map(analyzeDeviceConfigDrift);
  return {
    devices,
    totals: {
      inSync: devices.filter((device) => device.status === "in-sync").length,
      unsaved: devices.filter((device) => device.status === "unsaved").length,
      drifted: devices.filter((device) => device.status === "drifted").length,
      notApplicable: devices.filter((device) => device.status === "not-applicable").length,
      addedLines: devices.reduce((sum, device) => sum + device.addedLineCount, 0),
      removedLines: devices.reduce((sum, device) => sum + device.removedLineCount, 0),
      changedLines: devices.reduce((sum, device) => sum + device.changedLineCount, 0)
    }
  };
}

export function buildConfigDriftReportText(project: NetworkProject): string {
  return buildConfigDriftReportLines(project).join("\n");
}

export function buildConfigDriftReportLines(project: NetworkProject): string[] {
  const report = analyzeConfigDrift(project);
  const statusRows = [
    ["In sync", String(report.totals.inSync)],
    ["Unsaved", String(report.totals.unsaved)],
    ["Drifted", String(report.totals.drifted)],
    ["Not applicable", String(report.totals.notApplicable)]
  ];
  const deviceRows = report.devices.map((device) => [
    device.label,
    device.hostname,
    device.kind,
    device.status,
    String(device.runningLineCount),
    String(device.startupLineCount),
    `+${device.addedLineCount}/-${device.removedLineCount}`
  ]);
  return [
    "Network Editor Web Configuration Drift Report",
    `Project: ${project.name}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Summary",
    `- In sync: ${report.totals.inSync}`,
    `- Unsaved: ${report.totals.unsaved}`,
    `- Drifted: ${report.totals.drifted}`,
    `- Not applicable: ${report.totals.notApplicable}`,
    `- Running-only lines: ${report.totals.addedLines}`,
    `- Startup-only lines: ${report.totals.removedLines}`,
    `- Changed lines: ${report.totals.changedLines}`,
    "",
    "Status Summary",
    ...table(["Status", "Devices"], statusRows),
    "",
    "Device Status",
    ...table(["Device", "Hostname", "Kind", "Status", "Running", "Startup", "Delta"], deviceRows),
    "",
    ...report.devices.flatMap(renderDeviceDrift)
  ];
}

export function analyzeDeviceConfigDrift(device: NetworkDevice): DeviceConfigDrift {
  if (!isConfigurableDevice(device)) {
    return {
      deviceId: device.id,
      label: device.label,
      hostname: device.config.hostname,
      kind: device.kind,
      model: device.model,
      status: "not-applicable",
      runningLineCount: 0,
      startupLineCount: 0,
      matchingLineCount: 0,
      addedLineCount: 0,
      removedLineCount: 0,
      changedLineCount: 0,
      runningOnlyCommands: [],
      startupOnlyCommands: [],
      hunks: []
    };
  }

  const runningLines = normalizeConfigLines(runningConfig(device));
  const startupLines = normalizeConfigLines(device.config.startupConfig);
  if (!startupLines.length) {
    return {
      deviceId: device.id,
      label: device.label,
      hostname: device.config.hostname,
      kind: device.kind,
      model: device.model,
      status: "unsaved",
      runningLineCount: runningLines.length,
      startupLineCount: 0,
      matchingLineCount: 0,
      addedLineCount: runningLines.length,
      removedLineCount: 0,
      changedLineCount: runningLines.length,
      runningOnlyCommands: importantCommands(runningLines).slice(0, 24),
      startupOnlyCommands: [],
      hunks: buildUnsavedHunks(runningLines)
    };
  }

  const diffLines = diffConfigLines(runningLines, startupLines);
  const addedLineCount = diffLines.filter((line) => line.op === "add").length;
  const removedLineCount = diffLines.filter((line) => line.op === "remove").length;
  const matchingLineCount = diffLines.filter((line) => line.op === "context").length;
  const status: ConfigDriftStatus = addedLineCount === 0 && removedLineCount === 0 ? "in-sync" : "drifted";
  const runningOnlyCommands = importantCommands(diffLines.filter((line) => line.op === "add").map((line) => line.line));
  const startupOnlyCommands = importantCommands(diffLines.filter((line) => line.op === "remove").map((line) => line.line));
  return {
    deviceId: device.id,
    label: device.label,
    hostname: device.config.hostname,
    kind: device.kind,
    model: device.model,
    status,
    runningLineCount: runningLines.length,
    startupLineCount: startupLines.length,
    matchingLineCount,
    addedLineCount,
    removedLineCount,
    changedLineCount: addedLineCount + removedLineCount,
    runningOnlyCommands,
    startupOnlyCommands,
    hunks: status === "in-sync" ? [] : buildHunks(diffLines)
  };
}

function renderDeviceDrift(device: DeviceConfigDrift): string[] {
  if (device.status === "not-applicable") {
    return [`## ${device.label}`, "", "This endpoint does not maintain IOS-style startup-config.", ""];
  }
  if (device.status === "in-sync") {
    return [`## ${device.label}`, "", "startup-config is in sync with running-config.", ""];
  }
  const summary = device.status === "unsaved"
    ? "startup-config is not saved."
    : `running-config differs from startup-config (+${device.addedLineCount}/-${device.removedLineCount}).`;
  return [
    `## ${device.label}`,
    "",
    summary,
    "",
    ...(device.runningOnlyCommands.length ? ["Running-only commands", ...device.runningOnlyCommands.map((line) => `+ ${line}`), ""] : []),
    ...(device.startupOnlyCommands.length ? ["Startup-only commands", ...device.startupOnlyCommands.map((line) => `- ${line}`), ""] : []),
    ...device.hunks.flatMap(renderHunk),
    ""
  ];
}

function renderHunk(hunk: ConfigDiffHunk): string[] {
  return [
    `@@ running:${hunk.runningStart} startup:${hunk.startupStart} @@`,
    ...hunk.lines.map((line) => `${diffPrefix(line.op)}${line.line}`)
  ];
}

function diffPrefix(op: ConfigDiffOp): string {
  if (op === "add") return "+ ";
  if (op === "remove") return "- ";
  return "  ";
}

function isConfigurableDevice(device: NetworkDevice): boolean {
  return device.kind === "router" || device.kind === "switch" || device.kind === "firewall" || device.kind === "wireless";
}

function normalizeConfigLines(source: string | string[]): string[] {
  const rawLines = Array.isArray(source) ? source : source.split(/\r?\n/);
  return rawLines
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim())
    .filter((line) => !line.startsWith("Building configuration"))
    .filter((line) => !line.startsWith("Current configuration"))
    .filter((line) => !line.startsWith("Using ") || !line.includes(" out of "))
    .map((line) => line === "end" ? "end" : line);
}

function diffConfigLines(runningLines: string[], startupLines: string[]): ConfigDiffLine[] {
  const table = buildLcsTable(runningLines, startupLines);
  const output: ConfigDiffLine[] = [];
  let runningIndex = runningLines.length;
  let startupIndex = startupLines.length;
  while (runningIndex > 0 || startupIndex > 0) {
    const cell = table[runningIndex][startupIndex];
    if (runningIndex > 0 && startupIndex > 0 && cell.direction === "diag") {
      output.push({
        op: "context",
        line: runningLines[runningIndex - 1],
        runningLineNumber: runningIndex,
        startupLineNumber: startupIndex
      });
      runningIndex -= 1;
      startupIndex -= 1;
      continue;
    }
    if (runningIndex > 0 && (startupIndex === 0 || cell.direction === "up")) {
      output.push({
        op: "add",
        line: runningLines[runningIndex - 1],
        runningLineNumber: runningIndex
      });
      runningIndex -= 1;
      continue;
    }
    if (startupIndex > 0) {
      output.push({
        op: "remove",
        line: startupLines[startupIndex - 1],
        startupLineNumber: startupIndex
      });
      startupIndex -= 1;
    }
  }
  return output.reverse();
}

function buildLcsTable(runningLines: string[], startupLines: string[]): LcsCell[][] {
  const table: LcsCell[][] = Array.from({ length: runningLines.length + 1 }, () => Array.from({ length: startupLines.length + 1 }, () => ({ length: 0 })));
  for (let i = 1; i <= runningLines.length; i += 1) {
    for (let j = 1; j <= startupLines.length; j += 1) {
      if (runningLines[i - 1] === startupLines[j - 1]) {
        table[i][j] = { length: table[i - 1][j - 1].length + 1, direction: "diag" };
      } else if (table[i - 1][j].length >= table[i][j - 1].length) {
        table[i][j] = { length: table[i - 1][j].length, direction: "up" };
      } else {
        table[i][j] = { length: table[i][j - 1].length, direction: "left" };
      }
    }
  }
  return table;
}

function buildUnsavedHunks(runningLines: string[]): ConfigDiffHunk[] {
  return [{
    runningStart: 1,
    startupStart: 1,
    lines: runningLines.map((line, index) => ({ op: "add" as const, line, runningLineNumber: index + 1 }))
  }];
}

function buildHunks(diffLines: ConfigDiffLine[], contextRadius = 3): ConfigDiffHunk[] {
  const changedIndexes = diffLines
    .map((line, index) => line.op === "context" ? -1 : index)
    .filter((index) => index >= 0);
  if (!changedIndexes.length) return [];
  const windows: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextRadius);
    const end = Math.min(diffLines.length - 1, index + contextRadius);
    const last = windows.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows.map((window) => {
    const lines = diffLines.slice(window.start, window.end + 1);
    const firstRunning = lines.find((line) => line.runningLineNumber)?.runningLineNumber ?? 1;
    const firstStartup = lines.find((line) => line.startupLineNumber)?.startupLineNumber ?? 1;
    return { runningStart: firstRunning, startupStart: firstStartup, lines };
  });
}

function importantCommands(lines: string[]): string[] {
  const interestingPrefixes = [
    "hostname ",
    "interface ",
    " ip address ",
    " encapsulation dot1Q ",
    " switchport ",
    " ip route ",
    "router ",
    " network ",
    " access-list ",
    "ip access-list ",
    "ip prefix-list ",
    "route-map ",
    " match ",
    " set ",
    "ip nat ",
    "nat ",
    "ip dhcp ",
    " service ",
    "no service ",
    "standby ",
    "vrrp ",
    "ip sla ",
    "track ",
    "line ",
    " username ",
    "enable "
  ];
  const normalized = lines
    .map((line) => line.trimEnd())
    .filter((line) => line && line !== "!" && line !== "end")
    .filter((line) => interestingPrefixes.some((prefix) => line.startsWith(prefix) || line.trimStart().startsWith(prefix.trimStart())));
  return Array.from(new Set(normalized)).slice(0, 40);
}

function table(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return ["- none"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => sanitize(row[index] ?? "").length)));
  return [
    `| ${headers.map((header, index) => header.padEnd(widths[index])).join(" | ")} |`,
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell, index) => sanitize(cell).padEnd(widths[index])).join(" | ")} |`)
  ];
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "/").trim() || "-";
}
