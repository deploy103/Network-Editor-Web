import type { NetworkProject, SimulationEvent } from "../types/network";
import { fallbackPing } from "../engine/simulation";

interface WasmModule {
  default: () => Promise<void>;
  simulate_ping: (project: string, source: string, target: string) => string;
  engine_version: () => string;
}

let wasmModule: Promise<WasmModule | null> | null = null;

export async function simulatePing(project: NetworkProject, sourceId: string, targetId: string, protocol = "icmp"): Promise<{ project: NetworkProject; success: boolean; message: string }> {
  if (requiresTypeScriptPingFallback(project, protocol)) return fallbackPing(project, sourceId, targetId, protocol);
  const wasm = await loadWasm();
  if (!wasm) return fallbackPing(project, sourceId, targetId, protocol);
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
    return fallbackPing(project, sourceId, targetId, protocol);
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
      static_routes: device.config.staticRoutes.map((route) => ({ network: route.network, mask: route.mask, next_hop: route.nextHop, distance: route.distance })),
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

export function requiresTypeScriptPingFallback(project: NetworkProject, protocol = "icmp"): boolean {
  if (protocol.toLowerCase() !== "icmp") return true;
  return project.devices.some((device) =>
    device.config.accessRules.length > 0 ||
    device.config.natRules.length > 0 ||
    (device.config.routingProtocols?.length ?? 0) > 0 ||
    (device.config.routeMaps?.length ?? 0) > 0 ||
    (device.config.prefixLists?.length ?? 0) > 0 ||
    (device.config.ipSlaOperations?.length ?? 0) > 0 ||
    (device.config.trackObjects?.length ?? 0) > 0 ||
    device.config.staticRoutes.some((route) => Boolean(route.trackId)) ||
    device.ports.some((port) =>
      port.kind === "wireless" ||
      Boolean(port.accessGroupIn || port.accessGroupOut || port.policyRouteMap || port.natRole) ||
      Boolean(port.secondaryIpAddresses?.length || port.hsrpGroups?.length || port.vrrpGroups?.length) ||
      Boolean(port.parentPortId || port.subinterfaceVlan || port.encapsulationDot1qNative) ||
      (port.mode === "trunk" && port.nativeVlan !== undefined && !port.allowedVlans.includes(port.nativeVlan))
    )
  );
}
