import { createDevice } from "./deviceCatalog";
import { addLink, recalc, validateConnection } from "../engine/topology";
import type { NetworkDevice, NetworkPort, NetworkProject } from "../types/network";
import { createId } from "../utils/id";

export function createRoutedSampleProject(ownerId: string): NetworkProject {
  const now = new Date().toISOString();
  const pc = createDevice("pc-pt", { x: 130, y: 260 }, []);
  const switchDevice = createDevice("switch-2960", { x: 360, y: 250 }, [pc]);
  const router = createDevice("router-1941", { x: 610, y: 240 }, [pc, switchDevice]);
  const server = createDevice("server-pt", { x: 870, y: 250 }, [pc, switchDevice, router]);

  const configuredPc = updatePortByName(pc, "FastEthernet0", { ipAddress: "192.168.10.10", subnetMask: "255.255.255.0", gateway: "192.168.10.1", dnsServer: "10.10.10.10" });
  const configuredRouter = updatePortByIndex(
    updatePortByIndex(router, 0, { ipAddress: "192.168.10.1", subnetMask: "255.255.255.0", mode: "routed", helperAddresses: ["10.10.10.10"] }),
    1,
    { ipAddress: "10.10.10.1", subnetMask: "255.255.255.0", mode: "routed" }
  );
  const configuredServer = {
    ...updatePortByName(server, "FastEthernet0", { ipAddress: "10.10.10.10", subnetMask: "255.255.255.0", gateway: "10.10.10.1", dnsServer: "10.10.10.10" }),
    config: {
      ...server.config,
      services: { ...server.config.services, http: true, dhcp: true, dns: true, tftp: true, syslog: true },
      dhcpPools: [{
        id: createId("pool"),
        name: "USERS",
        network: "192.168.10.0",
        mask: "255.255.255.0",
        defaultGateway: "192.168.10.1",
        dnsServer: "10.10.10.10",
        startIp: "192.168.10.100",
        maxLeases: 50,
        enabled: true
      }],
      dhcpExcludedRanges: [{ id: createId("dhcp_exclude"), startIp: "192.168.10.1", endIp: "192.168.10.20" }],
      dnsRecords: [{ id: createId("dns"), name: "www.lab.local", value: "10.10.10.10" }]
    }
  };

  let project: NetworkProject = {
    id: createId("project"),
    ownerId,
    name: "라우팅 HTTP 샘플",
    devices: [configuredPc, switchDevice, configuredRouter, configuredServer],
    links: [],
    simulationEvents: [],
    createdAt: now,
    updatedAt: now
  };
  project = connect(project, configuredPc.id, switchDevice.id);
  project = connect(project, switchDevice.id, configuredRouter.id);
  project = connect(project, configuredRouter.id, configuredServer.id);
  return recalc(project);
}

function connect(project: NetworkProject, aDeviceId: string, bDeviceId: string): NetworkProject {
  const result = validateConnection(project, aDeviceId, bDeviceId, "auto");
  return result.link ? addLink(project, result.link) : project;
}

function updatePortByName(device: NetworkDevice, name: string, patch: Partial<NetworkPort>): NetworkDevice {
  return { ...device, ports: device.ports.map((port) => port.name === name ? { ...port, ...patch } : port) };
}

function updatePortByIndex(device: NetworkDevice, index: number, patch: Partial<NetworkPort>): NetworkDevice {
  let dataIndex = -1;
  return {
    ...device,
    ports: device.ports.map((port) => {
      if (port.kind === "console") return port;
      dataIndex += 1;
      return dataIndex === index ? { ...port, ...patch } : port;
    })
  };
}
