import type { NetworkProject } from "../types/network";
import { createDevice } from "../data/deviceCatalog";
import { addLink } from "../engine/topology";
import { createEmptyProject } from "../storage/localStore";

export function createSampleProject(ownerUserId: string): NetworkProject {
  let project = createEmptyProject(ownerUserId, "Campus DHCP DNS Lab");
  const router = createDevice("router", 360, 190, 1);
  const sw = createDevice("switch", 350, 360, 1);
  const pc = createDevice("pc", 120, 360, 1);
  const server = createDevice("server", 610, 360, 1);

  router.ports[0].interfaceConfig = { ipAddress: "192.168.1.1", subnetMask: "255.255.255.0", gateway: "", dns: "192.168.1.10", dhcp: false };
  router.config.dhcpPools = [
    {
      name: "LAN",
      network: "192.168.1.0",
      mask: "255.255.255.0",
      defaultRouter: "192.168.1.1",
      dnsServer: "192.168.1.10",
      nextOffset: 21,
      leases: { [pc.ports[0].macAddress]: "192.168.1.20" },
    },
  ];
  router.runtime.dhcpLeases = { [pc.ports[0].macAddress]: "192.168.1.20" };
  router.config.runningConfig.push(
    "interface FastEthernet0/0",
    " ip address 192.168.1.1 255.255.255.0",
    " no shutdown",
    "ip dhcp pool LAN",
    " network 192.168.1.0 255.255.255.0",
    " default-router 192.168.1.1",
    " dns-server 192.168.1.10",
  );

  pc.ports[0].interfaceConfig = { ipAddress: "192.168.1.20", subnetMask: "255.255.255.0", gateway: "192.168.1.1", dns: "192.168.1.10", dhcp: true };

  server.ports[0].interfaceConfig = { ipAddress: "192.168.1.10", subnetMask: "255.255.255.0", gateway: "192.168.1.1", dns: "192.168.1.10", dhcp: false };
  server.config.dnsRecords = [
    { host: "lab.local", address: "192.168.1.10" },
    { host: "www.lab.local", address: "192.168.1.10" },
  ];
  server.config.httpEnabled = true;

  project = { ...project, devices: [router, sw, pc, server] };
  project = addLink(project, "copper-straight", { deviceId: router.id, portId: router.ports[0].id }, { deviceId: sw.id, portId: sw.ports[0].id });
  project = addLink(project, "copper-straight", { deviceId: pc.id, portId: pc.ports[0].id }, { deviceId: sw.id, portId: sw.ports[1].id });
  project = addLink(project, "copper-straight", { deviceId: server.id, portId: server.ports[0].id }, { deviceId: sw.id, portId: sw.ports[2].id });
  return project;
}
