import { cliCompletions, cliPrompt, initialCliSession, runCliCommand, type CliResult, type CliSession } from "./cli";
import type { NetworkDevice } from "../types/network";

export type CliEngineKind = "local-ts" | "remote";

const REMOTE_CLI_ENGINE_URL = String(import.meta.env.VITE_CLI_ENGINE_URL ?? "").replace(/\/+$/, "");

export interface CliEngine {
  kind: CliEngineKind;
  initialSession: () => CliSession;
  prompt: (device: NetworkDevice, session: CliSession) => string;
  run: (device: NetworkDevice, session: CliSession, command: string) => Promise<CliResult>;
  completions: (device: NetworkDevice, session: CliSession, input: string) => string[];
}

export const localCliEngine: CliEngine = {
  kind: "local-ts",
  initialSession: initialCliSession,
  prompt: cliPrompt,
  run: async (device, session, command) => runCliCommand(device, session, command),
  completions: cliCompletions
};

export const cliEngine: CliEngine = REMOTE_CLI_ENGINE_URL ? remoteCliEngine(REMOTE_CLI_ENGINE_URL) : localCliEngine;

function remoteCliEngine(baseUrl: string): CliEngine {
  return {
    kind: "remote",
    initialSession: initialCliSession,
    prompt: cliPrompt,
    run: async (device, session, command) => {
      try {
        const response = await fetch(`${baseUrl}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device, session, command })
        });
        if (!response.ok) {
          const fallback = runCliCommand(device, session, command);
          return { ...fallback, output: `% Remote CLI engine failed (${response.status}). Falling back to local simulator.\n${fallback.output}`.trim() };
        }
        return response.json() as Promise<CliResult>;
      } catch (error) {
        const fallback = runCliCommand(device, session, command);
        const message = error instanceof Error ? error.message : "network error";
        return { ...fallback, output: `% Remote CLI engine unavailable (${message}). Falling back to local simulator.\n${fallback.output}`.trim() };
      }
    },
    completions: cliCompletions
  };
}
