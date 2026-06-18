import type { NetworkProject, SimulationEvent } from "../types/network";
import { fallbackPing } from "../engine/simulation";

interface WasmModule {
  default: () => Promise<void>;
  simulate_ping: (project: string, source: string, target: string) => string;
  engine_version: () => string;
}

let wasmModule: Promise<WasmModule | null> | null = null;

export async function simulatePing(project: NetworkProject, sourceId: string, targetId: string): Promise<{ project: NetworkProject; success: boolean; message: string }> {
  if (requiresEnhancedFallback(project)) return fallbackPing(project, sourceId, targetId);
  const wasm = await loadWasm();
  if (!wasm) return fallbackPing(project, sourceId, targetId);
  try {
    const payload = JSON.stringify(toEngineProject(project));
    const result = JSON.parse(wasm.simulate_ping(payload, sourceId, targetId)) as { success: boolean; message: string; events: Array<Omit<SimulationEvent, "id" | "time">> };
    const now = Date.now();
    const packetId = `pdu_${now}_${sourceId}_${targetId}`;
    return {
      project: {
        ...project,
        simulationEvents: [
          ...project.simulationEvents,
          ...result.events.map((event, index) => ({ ...event, id: `evt_${now}_${index}`, time: now + index, sourceDeviceId: event.sourceDeviceId ?? sourceId, targetDeviceId: event.targetDeviceId ?? targetId, packetId: event.packetId ?? packetId }))
        ]
      },
      success: result.success,
      message: result.message
    };
  } catch {
    return fallbackPing(project, sourceId, targetId);
  }
}

export async function engineLabel(): Promise<string> {
  const wasm = await loadWasm();
  const version = wasm?.engine_version();
  return version ? `WASM 엔진: ${version}` : "TypeScript 대체 엔진";
}

async function loadWasm(): Promise<WasmModule | null> {
  if (!wasmModule) {
    const engineUrl = "/engine/network_engine.js";
    wasmModule = import(/* @vite-ignore */ engineUrl)
      .then(async (module: WasmModule) => {
        await module.default();
        return module;
      })
      .catch(() => null);
  }
  return wasmModule;
}

function toEngineProject(project: NetworkProject) {
  return {
    devices: project.devices.map((device) => ({
      id: device.id,
      label: device.label,
      kind: device.kind,
      power_on: device.powerOn,
      static_routes: device.config.staticRoutes.map((route) => ({ network: route.network, mask: route.mask, next_hop: route.nextHop })),
      ports: device.ports.map((port) => ({
        id: port.id,
        name: port.name,
        mac: port.macAddress,
        admin_up: port.adminUp,
        mode: port.mode,
        vlan: port.vlan,
        allowed_vlans: port.allowedVlans,
        ip: port.ipAddress,
        mask: port.subnetMask,
        gateway: port.gateway
      }))
    })),
    links: project.links.map((link) => ({
      id: link.id,
      a_device: link.endpointA.deviceId,
      a_port: link.endpointA.portId,
      b_device: link.endpointB.deviceId,
      b_port: link.endpointB.portId,
      status: link.status
    }))
  };
}

function requiresEnhancedFallback(project: NetworkProject): boolean {
  return project.devices.some((device) =>
    device.config.accessRules.length > 0 ||
    device.config.natRules.length > 0 ||
    device.ports.some((port) => port.kind === "wireless")
  );
}
