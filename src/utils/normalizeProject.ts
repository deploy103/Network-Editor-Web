import type { NetworkDevice, NetworkLink, NetworkPort, NetworkProject } from "../types/network";
import { refreshLinkStatuses } from "../engine/topology";
import { nowIso } from "./ids";

function normalizePort(port: NetworkPort): NetworkPort {
  const vlan = port.vlan || 1;
  return {
    ...port,
    description: port.description ?? "",
    status: port.status ?? "up",
    duplex: port.duplex ?? "auto",
    bandwidthMbps: port.bandwidthMbps || 100,
    mode: port.mode ?? "access",
    vlan,
    allowedVlans: port.allowedVlans?.length ? port.allowedVlans : [vlan],
    interfaceConfig: {
      ipAddress: port.interfaceConfig?.ipAddress ?? "",
      subnetMask: port.interfaceConfig?.subnetMask ?? "",
      gateway: port.interfaceConfig?.gateway ?? "",
      dns: port.interfaceConfig?.dns ?? "",
      helperAddress: port.interfaceConfig?.helperAddress ?? "",
      dhcp: Boolean(port.interfaceConfig?.dhcp),
    },
  };
}

function normalizeDevice(device: NetworkDevice): NetworkDevice {
  return {
    ...device,
    powerOn: device.powerOn ?? true,
    ports: (device.ports ?? []).map(normalizePort),
    moduleSlots: device.moduleSlots ?? [],
    config: {
      hostname: device.config?.hostname ?? device.label ?? "Device",
      runningConfig: device.config?.runningConfig ?? [],
      startupConfig: device.config?.startupConfig ?? [],
      staticRoutes: device.config?.staticRoutes ?? [],
      dhcpPools: device.config?.dhcpPools ?? [],
      dnsRecords: device.config?.dnsRecords ?? [],
      httpEnabled: Boolean(device.config?.httpEnabled),
      httpBody: device.config?.httpBody ?? "",
      firewallRules: device.config?.firewallRules ?? [],
      wireless: {
        ssid: device.config?.wireless?.ssid ?? "",
        security: device.config?.wireless?.security ?? "open",
        wepKey: device.config?.wireless?.wepKey ?? "",
      },
      cliMode: device.config?.cliMode ?? "user",
      cliContext: device.config?.cliContext ?? {},
    },
    runtime: {
      arp: device.runtime?.arp ?? {},
      mac: device.runtime?.mac ?? {},
      dhcpLeases: device.runtime?.dhcpLeases ?? {},
      lastBootAt: device.runtime?.lastBootAt ?? nowIso(),
    },
  };
}

function normalizeLink(link: NetworkLink): NetworkLink {
  return {
    ...link,
    status: link.status ?? "down",
    activity: Boolean(link.activity),
    dceEndpoint: link.dceEndpoint ?? (link.type === "serial-dce" ? "a" : link.type === "serial-dte" ? "b" : undefined),
  };
}

export function normalizeProject(project: NetworkProject): NetworkProject {
  const scenarioId = project.simulation?.activeScenarioId ?? project.simulation?.scenarios?.[0]?.id ?? "scenario-0";
  return refreshLinkStatuses({
    ...project,
    description: project.description ?? "",
    devices: (project.devices ?? []).map(normalizeDevice),
    links: (project.links ?? []).map(normalizeLink),
    simulation: {
      mode: project.simulation?.mode ?? "realtime",
      time: project.simulation?.time ?? 0,
      activeScenarioId: scenarioId,
      scenarios: project.simulation?.scenarios?.length ? project.simulation.scenarios : [{ id: scenarioId, name: "Scenario 0", description: "", pdus: [] }],
      events: project.simulation?.events ?? [],
      selectedEventId: project.simulation?.selectedEventId,
    },
    createdAt: project.createdAt ?? nowIso(),
    updatedAt: project.updatedAt ?? nowIso(),
  });
}
