import type { NetworkDevice, NetworkProject } from "../types/network";

export function desktopConsoleTargets(project: NetworkProject, device: NetworkDevice): NetworkDevice[] {
  const targets = new Map<string, NetworkDevice>();
  for (const link of project.links) {
    if (link.type !== "console") continue;
    const aDevice = project.devices.find((item) => item.id === link.endpointA.deviceId);
    const bDevice = project.devices.find((item) => item.id === link.endpointB.deviceId);
    const aPort = aDevice?.ports.find((port) => port.id === link.endpointA.portId);
    const bPort = bDevice?.ports.find((port) => port.id === link.endpointB.portId);
    if (!aDevice || !aPort || !bDevice || !bPort) continue;
    if (aDevice.id === device.id && aPort.kind === "console" && bPort.kind === "console") {
      targets.set(bDevice.id, bDevice);
    }
    if (bDevice.id === device.id && bPort.kind === "console" && aPort.kind === "console") {
      targets.set(aDevice.id, aDevice);
    }
  }
  return Array.from(targets.values()).sort((left, right) => left.label.localeCompare(right.label));
}
