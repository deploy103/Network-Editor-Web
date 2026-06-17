import type { FirewallRule, NetworkDevice, NetworkPort, NetworkProject, OsiLayerTrace, SimulationEvent } from "../types/network";
import { makeId } from "../utils/ids";
import { bestRoute, sameSubnet, usableAddressFromOffset } from "./ip";
import { findPath, refreshLinkStatuses } from "./topology";

function event(time: number, atDeviceId: string, type: string, summary: string, status: SimulationEvent["status"], lastDeviceId?: string, layers: OsiLayerTrace[] = [], details: Record<string, string> = {}): SimulationEvent {
  return {
    id: makeId("event"),
    time,
    visible: true,
    lastDeviceId,
    atDeviceId,
    type,
    summary,
    status,
    layers,
    details,
  };
}

function layer(layer: number, name: string, direction: "in" | "out", action: OsiLayerTrace["action"], detail: string): OsiLayerTrace {
  return { layer, name, direction, action, detail };
}

function firstConfiguredDataPort(device: NetworkDevice): NetworkPort | undefined {
  return device.ports.find((port) => port.kind !== "console" && port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask);
}

function portHasUpLink(project: NetworkProject, deviceId: string, portId: string): boolean {
  return project.links.some(
    (link) =>
      link.status === "up" &&
      ((link.a.deviceId === deviceId && link.a.portId === portId) || (link.b.deviceId === deviceId && link.b.portId === portId)),
  );
}

function firstLinkedConfiguredDataPort(project: NetworkProject, device: NetworkDevice): NetworkPort | undefined {
  return (
    device.ports.find(
      (port) => port.kind !== "console" && port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask && portHasUpLink(project, device.id, port.id),
    ) ?? firstConfiguredDataPort(device)
  );
}

function firstActiveDataPort(device: NetworkDevice): NetworkPort | undefined {
  return device.ports.find((port) => port.kind !== "console" && port.status === "up");
}

function firstLinkedActiveDataPort(project: NetworkProject, device: NetworkDevice): NetworkPort | undefined {
  return (
    device.ports.find(
      (port) =>
        port.kind !== "console" &&
        port.status === "up" &&
        portHasUpLink(project, device.id, port.id),
    ) ?? firstActiveDataPort(device)
  );
}

function portTowardDevice(project: NetworkProject, deviceId: string, peerId: string): NetworkPort | undefined {
  const link = project.links.find(
    (entry) =>
      (entry.a.deviceId === deviceId && entry.b.deviceId === peerId) ||
      (entry.b.deviceId === deviceId && entry.a.deviceId === peerId),
  );
  const device = project.devices.find((entry) => entry.id === deviceId);
  const endpoint = link?.a.deviceId === deviceId ? link.a : link?.b.deviceId === deviceId ? link.b : undefined;
  return device?.ports.find((port) => port.id === endpoint?.portId);
}

function learnSwitches(project: NetworkProject, path: NetworkDevice[], source: NetworkDevice): NetworkProject {
  const sourcePort = firstLinkedConfiguredDataPort(project, source);
  if (!sourcePort) return project;
  const nextDevices = project.devices.map((device) => {
    const pathIndex = path.findIndex((entry) => entry.id === device.id);
    if (device.type !== "switch" || pathIndex < 1) return device;
    const ingress = portTowardDevice(project, device.id, path[pathIndex - 1].id) ?? device.ports.find((port) => port.status === "up") ?? device.ports[0];
    return {
      ...device,
      runtime: {
        ...device.runtime,
        mac: {
          ...device.runtime.mac,
          [sourcePort.macAddress]: { portId: ingress.id, vlan: ingress.vlan, age: 300 },
        },
      },
    };
  });
  return { ...project, devices: nextDevices };
}

function learnArp(project: NetworkProject, source: NetworkDevice, destination: NetworkDevice): NetworkProject {
  const sourcePort = firstLinkedConfiguredDataPort(project, source);
  const destinationPort = firstLinkedConfiguredDataPort(project, destination);
  if (!sourcePort || !destinationPort) return project;

  return {
    ...project,
    devices: project.devices.map((device) => {
      if (device.id === source.id) {
        return {
          ...device,
          runtime: {
            ...device.runtime,
            arp: {
              ...device.runtime.arp,
              [destinationPort.interfaceConfig.ipAddress]: destinationPort.macAddress,
            },
          },
        };
      }
      if (device.id === destination.id) {
        return {
          ...device,
          runtime: {
            ...device.runtime,
            arp: {
              ...device.runtime.arp,
              [sourcePort.interfaceConfig.ipAddress]: sourcePort.macAddress,
            },
          },
        };
      }
      return device;
    }),
  };
}

function addressMatches(pattern: string, address: string): boolean {
  const value = pattern.trim().toLowerCase();
  return !value || value === "any" || value === address.toLowerCase();
}

function protocolMatches(rule: FirewallRule, protocol: "icmp" | "tcp" | "udp"): boolean {
  return rule.protocol === "ip" || rule.protocol === protocol;
}

function findFirewallBlock(path: NetworkDevice[], protocol: "icmp" | "tcp" | "udp", sourceIp: string, destinationIp: string): { device: NetworkDevice; rule: FirewallRule; previousId?: string } | null {
  for (const [index, device] of path.entries()) {
    if (device.type !== "firewall") continue;
    const matched = device.config.firewallRules.find((rule) => protocolMatches(rule, protocol) && addressMatches(rule.source, sourceIp) && addressMatches(rule.destination, destinationIp));
    if (matched?.action === "deny") {
      return { device, rule: matched, previousId: path[index - 1]?.id };
    }
  }
  return null;
}

function hasConnectedDestination(device: NetworkDevice, destinationIp: string): boolean {
  return device.ports.some((port) => port.interfaceConfig.ipAddress && port.interfaceConfig.subnetMask && sameSubnet(port.interfaceConfig.ipAddress, port.interfaceConfig.subnetMask, destinationIp));
}

function findRoutingFailure(project: NetworkProject, path: NetworkDevice[], destinationIp: string): { device: NetworkDevice; previousId?: string } | null {
  for (const [index, device] of path.entries()) {
    if (index === 0 || index === path.length - 1) continue;
    if (device.type !== "router" && device.type !== "firewall") continue;
    if (!hasConnectedDestination(device, destinationIp) && !bestRoute(device, destinationIp, project)) {
      return { device, previousId: path[index - 1]?.id };
    }
  }
  return null;
}

function dhcpRelayAllowed(path: NetworkDevice[], serverIp: string): boolean {
  if (!path.length) return false;
  const transitRouters = path.slice(1, -1).filter((device) => device.type === "router" || device.type === "firewall");
  if (!transitRouters.length) return true;
  return transitRouters.some((device) => device.ports.some((port) => port.interfaceConfig.helperAddress === serverIp));
}

export function simulatePing(projectInput: NetworkProject, sourceId: string, destinationId: string): NetworkProject {
  let project = refreshLinkStatuses(projectInput);
  const source = project.devices.find((device) => device.id === sourceId);
  const destination = project.devices.find((device) => device.id === destinationId);
  const startTime = project.simulation.time;
  const events: SimulationEvent[] = [];

  if (!source || !destination) return project;
  const sourcePort = firstConfiguredDataPort(source);
  const destinationPort = firstConfiguredDataPort(destination);

  if (!source.powerOn || !destination.powerOn || !sourcePort || !destinationPort) {
    events.push(event(startTime + 0.001, source.id, "ICMP", "Ping failed: source or destination is powered off or missing IP configuration.", "failed"));
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.001, events: [...project.simulation.events, ...events] } };
  }

  const sourceIp = sourcePort.interfaceConfig.ipAddress;
  const mask = sourcePort.interfaceConfig.subnetMask;
  const destinationIp = destinationPort.interfaceConfig.ipAddress;
  const sameNetwork = sameSubnet(sourceIp, mask, destinationIp);
  const route = sameNetwork ? undefined : bestRoute(source, destinationIp, project);
  const gateway = sameNetwork ? destinationIp : sourcePort.interfaceConfig.gateway || route?.nextHop || "";
  const path = findPath(project, source.id, destination.id);

  events.push(
    event(
      startTime + 0.001,
      source.id,
      "ARP",
      sameNetwork ? `${source.label} broadcasts ARP for ${destinationIp}.` : `${source.label} resolves gateway ${gateway || "unknown"} before forwarding.`,
      gateway || sameNetwork ? "info" : "failed",
      undefined,
      [
        layer(3, "Network", "out", "queue", `Need MAC address for ${sameNetwork ? destinationIp : gateway}`),
        layer(2, "Data Link", "out", "encapsulate", "Create Ethernet broadcast frame ff:ff:ff:ff:ff:ff"),
        layer(1, "Physical", "out", "transmit", "Transmit ARP request"),
      ],
      { sourceIp, destinationIp, gateway: gateway || "none" },
    ),
  );

  if (!path.length) {
    events.push(event(startTime + 0.01, source.id, "ICMP", `Ping failed: no active path to ${destination.label}.`, "failed"));
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.01, events: [...project.simulation.events, ...events] } };
  }

  if (!sameNetwork && !route && !sourcePort.interfaceConfig.gateway) {
    events.push(event(startTime + 0.02, source.id, "ICMP", "Ping failed: destination is remote and no route/default gateway is configured.", "failed"));
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.02, events: [...project.simulation.events, ...events] } };
  }

  const forwardRoutingFailure = findRoutingFailure(project, path, destinationIp);
  if (forwardRoutingFailure) {
    events.push(
      event(
        startTime + 0.02,
        forwardRoutingFailure.device.id,
        "IP",
        `${forwardRoutingFailure.device.label} dropped packet: no route to ${destinationIp}.`,
        "failed",
        forwardRoutingFailure.previousId,
        [layer(3, "Network", "in", "drop", `No matching route for ${destinationIp}`)],
        { destinationIp },
      ),
    );
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.02, events: [...project.simulation.events, ...events] } };
  }

  const returnRoutingFailure = findRoutingFailure(project, [...path].reverse(), sourceIp);
  if (returnRoutingFailure) {
    events.push(
      event(
        startTime + 0.021,
        returnRoutingFailure.device.id,
        "IP",
        `${returnRoutingFailure.device.label} cannot return echo reply: no route to ${sourceIp}.`,
        "failed",
        returnRoutingFailure.previousId,
        [layer(3, "Network", "out", "drop", `No matching return route for ${sourceIp}`)],
        { sourceIp },
      ),
    );
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.021, events: [...project.simulation.events, ...events] } };
  }

  const firewallBlock = findFirewallBlock(path, "icmp", sourceIp, destinationIp);
  if (firewallBlock) {
    events.push(
      event(
        startTime + 0.02,
        firewallBlock.device.id,
        "ACL",
        `${firewallBlock.device.label} denied ICMP ${sourceIp} -> ${destinationIp}.`,
        "failed",
        firewallBlock.previousId,
        [layer(3, "Network", "in", "drop", `Matched ${firewallBlock.rule.action} ${firewallBlock.rule.protocol} ${firewallBlock.rule.source} ${firewallBlock.rule.destination}`)],
      ),
    );
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.02, events: [...project.simulation.events, ...events] } };
  }

  project = learnSwitches(project, path, source);
  project = learnArp(project, source, destination);
  path.slice(1).forEach((device, index) => {
    const last = path[index];
    if (device.type === "switch") {
      events.push(event(startTime + 0.02 + index * 0.005, device.id, "Ethernet", `${device.label} learns ${sourcePort.macAddress} and forwards the frame.`, "info", last.id));
    } else if (device.type === "hub") {
      events.push(event(startTime + 0.02 + index * 0.005, device.id, "Ethernet", `${device.label} floods the frame out all active ports except ingress.`, "info", last.id));
    } else if (device.type === "router" || device.type === "firewall") {
      events.push(event(startTime + 0.02 + index * 0.005, device.id, "IP", `${device.label} checks routing table and forwards toward ${destinationIp}.`, "info", last.id));
    }
  });

  const resultTime = startTime + 0.04 + path.length * 0.005;
  events.push(
    event(
      resultTime,
      destination.id,
      "ICMP",
      `${destination.label} accepts ICMP echo request from ${sourceIp} and returns echo reply.`,
      "success",
      path.at(-2)?.id,
      [
        layer(1, "Physical", "in", "accept", "Signal received on active port"),
        layer(2, "Data Link", "in", "de-encapsulate", "Destination MAC matches local interface"),
        layer(3, "Network", "in", "accept", `Destination IP ${destinationIp} matches local interface`),
        layer(4, "ICMP", "in", "accept", "Echo request accepted"),
        layer(3, "Network", "out", "encapsulate", "Create echo reply"),
      ],
      { sourceIp, destinationIp, ttl: "128" },
    ),
    event(
      resultTime + 0.01,
      source.id,
      "ICMP",
      `${source.label} receives ICMP echo reply from ${destinationIp}.`,
      "success",
      path[1]?.id ?? destination.id,
      [
        layer(1, "Physical", "in", "accept", "Reply signal received on active port"),
        layer(2, "Data Link", "in", "de-encapsulate", "Reply frame destination MAC matches local interface"),
        layer(3, "Network", "in", "accept", `Reply source IP ${destinationIp}`),
        layer(4, "ICMP", "in", "accept", "Echo reply accepted"),
      ],
      { sourceIp: destinationIp, destinationIp: sourceIp, ttl: "128" },
    ),
  );

  return {
    ...project,
    simulation: {
      ...project.simulation,
      time: resultTime + 0.01,
      events: [...project.simulation.events, ...events],
    },
  };
}

export function requestDhcp(projectInput: NetworkProject, clientId: string): NetworkProject {
  let project = refreshLinkStatuses(projectInput);
  const client = project.devices.find((device) => device.id === clientId);
  const startTime = project.simulation.time;
  const events: SimulationEvent[] = [];
  if (!client) return project;

  const clientPort = firstLinkedActiveDataPort(project, client);
  if (!client.powerOn || !clientPort) {
    events.push(event(startTime + 0.001, client.id, "DHCP", "DHCP failed: client is powered off or has no active data interface.", "failed"));
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.001, events: [...project.simulation.events, ...events] } };
  }

  const server = project.devices
    .filter((device) => device.id !== client.id && device.powerOn && device.config.dhcpPools.some((pool) => pool.network && pool.mask))
    .find((device) => {
      const serverPort = firstConfiguredDataPort(device);
      if (!serverPort) return false;
      const path = findPath(project, client.id, device.id);
      return dhcpRelayAllowed(path, serverPort.interfaceConfig.ipAddress);
    });

  if (!server) {
    events.push(event(startTime + 0.001, client.id, "DHCP", "DHCP failed: no reachable DHCP server or relay helper found on the active data path.", "failed"));
    return { ...project, simulation: { ...project.simulation, time: startTime + 0.001, events: [...project.simulation.events, ...events] } };
  }

  const pool = server.config.dhcpPools.find((entry) => entry.network && entry.mask)!;
  const existingLease = pool.leases[clientPort.macAddress];
  const offeredIp = existingLease ?? usableAddressFromOffset(pool.network, pool.nextOffset);
  const updatedDevices = project.devices.map((device) => {
    if (device.id === client.id) {
      return {
        ...device,
        ports: device.ports.map((port) =>
          port.id === clientPort.id
            ? {
                ...port,
                interfaceConfig: {
                  ipAddress: offeredIp,
                  subnetMask: pool.mask,
                  gateway: pool.defaultRouter,
                  dns: pool.dnsServer,
                  dhcp: true,
                },
              }
            : port,
        ),
      };
    }
    if (device.id === server.id) {
      return {
        ...device,
        config: {
          ...device.config,
          dhcpPools: device.config.dhcpPools.map((entry) =>
            entry.name === pool.name
              ? {
                  ...entry,
                  leases: { ...entry.leases, [clientPort.macAddress]: offeredIp },
                  nextOffset: existingLease ? entry.nextOffset : entry.nextOffset + 1,
                }
              : entry,
          ),
        },
        runtime: {
          ...device.runtime,
          dhcpLeases: { ...device.runtime.dhcpLeases, [clientPort.macAddress]: offeredIp },
        },
      };
    }
    return device;
  });

  events.push(
    event(startTime + 0.001, client.id, "DHCP", `${client.label} broadcasts DHCPDISCOVER.`, "info"),
    event(startTime + 0.006, server.id, "DHCP", `${server.label} offers ${offeredIp} from pool ${pool.name}.`, "info", client.id),
    event(startTime + 0.012, client.id, "DHCP", `${client.label} requests ${offeredIp}.`, "info", server.id),
    event(startTime + 0.018, server.id, "DHCP", `${server.label} acknowledges ${offeredIp}.`, "success", client.id),
  );

  return {
    ...project,
    devices: updatedDevices,
    simulation: {
      ...project.simulation,
      time: startTime + 0.018,
      events: [...project.simulation.events, ...events],
    },
  };
}

export function simulateDns(projectInput: NetworkProject, clientId: string, host: string): NetworkProject {
  const project = refreshLinkStatuses(projectInput);
  const client = project.devices.find((device) => device.id === clientId);
  const startTime = project.simulation.time;
  const events: SimulationEvent[] = [];
  const lookup = host.trim().toLowerCase();

  if (!client || !client.powerOn || !firstConfiguredDataPort(client)) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [...project.simulation.events, event(startTime + 0.001, clientId, "DNS", "DNS failed: client is powered off or missing IP configuration.", "failed")],
      },
    };
  }

  const server = project.devices
    .filter((device) => device.powerOn && device.config.dnsRecords.some((record) => record.host.toLowerCase() === lookup))
    .find((device) => findPath(project, client.id, device.id).length > 0);

  const serverPort = server ? firstConfiguredDataPort(server) : undefined;
  if (!lookup || !server || !serverPort) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [...project.simulation.events, event(startTime + 0.001, client.id, "DNS", `DNS failed: no reachable DNS record for ${host || "empty query"}.`, "failed")],
      },
    };
  }

  const path = findPath(project, client.id, server.id);
  const clientPort = firstConfiguredDataPort(client)!;
  const forwardRoutingFailure = findRoutingFailure(project, path, serverPort.interfaceConfig.ipAddress);
  if (forwardRoutingFailure) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.003,
        events: [
          ...project.simulation.events,
          event(startTime + 0.003, forwardRoutingFailure.device.id, "IP", `${forwardRoutingFailure.device.label} dropped DNS query: no route to ${serverPort.interfaceConfig.ipAddress}.`, "failed", forwardRoutingFailure.previousId, [
            layer(3, "Network", "in", "drop", `No matching route for ${serverPort.interfaceConfig.ipAddress}`),
          ]),
        ],
      },
    };
  }
  const returnRoutingFailure = findRoutingFailure(project, [...path].reverse(), clientPort.interfaceConfig.ipAddress);
  if (returnRoutingFailure) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.004,
        events: [
          ...project.simulation.events,
          event(startTime + 0.004, returnRoutingFailure.device.id, "IP", `${returnRoutingFailure.device.label} cannot return DNS answer: no route to ${clientPort.interfaceConfig.ipAddress}.`, "failed", returnRoutingFailure.previousId, [
            layer(3, "Network", "out", "drop", `No matching return route for ${clientPort.interfaceConfig.ipAddress}`),
          ]),
        ],
      },
    };
  }
  const firewallBlock = findFirewallBlock(path, "udp", clientPort.interfaceConfig.ipAddress, serverPort.interfaceConfig.ipAddress);
  if (firewallBlock) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.004,
        events: [
          ...project.simulation.events,
          event(startTime + 0.004, firewallBlock.device.id, "ACL", `${firewallBlock.device.label} denied DNS query ${host}.`, "failed", firewallBlock.previousId, [
            layer(3, "Network", "in", "drop", `Matched ${firewallBlock.rule.action} ${firewallBlock.rule.protocol} ${firewallBlock.rule.source} ${firewallBlock.rule.destination}`),
          ]),
        ],
      },
    };
  }

  const record = server.config.dnsRecords.find((entry) => entry.host.toLowerCase() === lookup)!;
  events.push(
    event(startTime + 0.001, client.id, "DNS", `${client.label} sends DNS query for ${host}.`, "info", undefined, [
      layer(7, "DNS", "out", "encapsulate", `Query A ${host}`),
      layer(4, "UDP", "out", "encapsulate", "Use destination port 53"),
      layer(3, "IP", "out", "transmit", `Forward across ${path.length} device path`),
    ]),
    event(startTime + 0.008, server.id, "DNS", `${server.label} resolves ${host} -> ${record.address}.`, "info", path.at(-2)?.id, [], { host, address: record.address }),
    event(startTime + 0.014, client.id, "DNS", `${client.label} receives DNS answer ${host} -> ${record.address}.`, "success", path[1]?.id ?? server.id, [], { host, address: record.address }),
  );

  return { ...project, simulation: { ...project.simulation, time: startTime + 0.014, events: [...project.simulation.events, ...events] } };
}

export function simulateHttp(projectInput: NetworkProject, clientId: string, serverId: string): NetworkProject {
  const project = refreshLinkStatuses(projectInput);
  const client = project.devices.find((device) => device.id === clientId);
  const server = project.devices.find((device) => device.id === serverId);
  const startTime = project.simulation.time;
  const clientPort = client ? firstConfiguredDataPort(client) : undefined;
  const serverPort = server ? firstConfiguredDataPort(server) : undefined;
  const path = client && server ? findPath(project, client.id, server.id) : [];

  let summary = "";
  if (!client || !server) {
    summary = "HTTP failed: client or server device was not found.";
  } else if (!client.powerOn || !server.powerOn) {
    summary = "HTTP failed: client or server is powered off.";
  } else if (!clientPort || !serverPort) {
    summary = "HTTP failed: client or server is missing IP configuration.";
  } else if (!server.config.httpEnabled) {
    summary = "HTTP failed: server service is disabled.";
  } else if (!path.length) {
    summary = `HTTP failed: no active data path to ${server.label}.`;
  }

  if (summary) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [...project.simulation.events, event(startTime + 0.001, client?.id ?? clientId, "HTTP", summary, "failed", server?.id ?? serverId)],
      },
    };
  }

  const forwardRoutingFailure = findRoutingFailure(project, path, serverPort!.interfaceConfig.ipAddress);
  if (forwardRoutingFailure) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [
          ...project.simulation.events,
          event(startTime + 0.001, forwardRoutingFailure.device.id, "IP", `${forwardRoutingFailure.device.label} dropped HTTP packet: no route to ${serverPort!.interfaceConfig.ipAddress}.`, "failed", forwardRoutingFailure.previousId, [
            layer(3, "Network", "in", "drop", `No matching route for ${serverPort!.interfaceConfig.ipAddress}`),
          ]),
        ],
      },
    };
  }

  const returnRoutingFailure = findRoutingFailure(project, [...path].reverse(), clientPort!.interfaceConfig.ipAddress);
  if (returnRoutingFailure) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [
          ...project.simulation.events,
          event(startTime + 0.001, returnRoutingFailure.device.id, "IP", `${returnRoutingFailure.device.label} cannot return HTTP response: no route to ${clientPort!.interfaceConfig.ipAddress}.`, "failed", returnRoutingFailure.previousId, [
            layer(3, "Network", "out", "drop", `No matching return route for ${clientPort!.interfaceConfig.ipAddress}`),
          ]),
        ],
      },
    };
  }

  const firewallBlock = findFirewallBlock(path, "tcp", clientPort!.interfaceConfig.ipAddress, serverPort!.interfaceConfig.ipAddress);
  if (firewallBlock) {
    return {
      ...project,
      simulation: {
        ...project.simulation,
        time: startTime + 0.001,
        events: [
          ...project.simulation.events,
          event(startTime + 0.001, firewallBlock.device.id, "ACL", `${firewallBlock.device.label} denied HTTP session to ${server!.label}.`, "failed", firewallBlock.previousId, [
            layer(3, "Network", "in", "drop", `Matched ${firewallBlock.rule.action} ${firewallBlock.rule.protocol} ${firewallBlock.rule.source} ${firewallBlock.rule.destination}`),
          ]),
        ],
      },
    };
  }

  const events = [
    event(
      startTime + 0.001,
      server!.id,
      "HTTP",
      `${server!.label} receives HTTP GET from ${client!.label}.`,
      "info",
      path.at(-2)?.id ?? client!.id,
      [
        layer(7, "HTTP", "out", "encapsulate", "GET /"),
        layer(4, "TCP", "out", "encapsulate", "Open simplified TCP session"),
        layer(3, "IP", "out", "encapsulate", `Send packet from ${clientPort!.interfaceConfig.ipAddress} to ${serverPort!.interfaceConfig.ipAddress}`),
      ],
      { path: path.map((device) => device.label).join(" -> ") },
    ),
    event(
      startTime + 0.012,
      client!.id,
      "HTTP",
      `${client!.label} receives HTTP response from ${server!.label}.`,
      "success",
      path[1]?.id ?? server!.id,
      [
        layer(7, "HTTP", "in", "accept", "200 OK"),
        layer(4, "TCP", "in", "accept", "Simplified TCP payload accepted"),
        layer(3, "IP", "in", "de-encapsulate", `Receive packet from ${serverPort!.interfaceConfig.ipAddress}`),
      ],
      { response: server!.config.httpBody, path: [...path].reverse().map((device) => device.label).join(" -> ") },
    ),
  ];
  return { ...project, simulation: { ...project.simulation, time: startTime + 0.012, events: [...project.simulation.events, ...events] } };
}
