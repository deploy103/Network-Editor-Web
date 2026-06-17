import { useEffect, useState } from "react";
import { Cpu, Power, Trash2 } from "lucide-react";
import type { DhcpPool, DnsRecord, FirewallRule, NetworkDevice, NetworkPort, NetworkProject, RouteEntry } from "../types/network";
import { requestDhcp, simulateDns, simulateHttp, simulatePing } from "../engine/simulation";
import { isPortAvailable, requiredModuleForPort } from "../engine/topology";
import { makeId, nowIso } from "../utils/ids";
import CliTerminal from "./CliTerminal";

interface Props {
  project: NetworkProject;
  device?: NetworkDevice;
  onChangeDevice: (device: NetworkDevice) => void;
  onRemoveDevice: (deviceId: string) => void;
  onProjectChange: (project: NetworkProject) => void;
}

type Tab = "physical" | "config" | "cli" | "desktop" | "services";

const tabsByDeviceType: Record<NetworkDevice["type"], Tab[]> = {
  router: ["physical", "config", "cli"],
  switch: ["physical", "config", "cli"],
  firewall: ["physical", "config", "cli", "services"],
  pc: ["physical", "config", "desktop"],
  server: ["physical", "config", "desktop", "services"],
  wireless: ["physical", "config"],
  hub: ["physical", "config"],
};

function tabsForDevice(device?: NetworkDevice): Tab[] {
  return device ? tabsByDeviceType[device.type] : ["physical"];
}

function updatePort(device: NetworkDevice, port: NetworkPort): NetworkDevice {
  return { ...device, ports: device.ports.map((entry) => (entry.id === port.id ? port : entry)) };
}

function updateModuleSlot(device: NetworkDevice, slotId: string, installedModule: string): NetworkDevice {
  return {
    ...device,
    moduleSlots: device.moduleSlots.map((slot) => (slot.id === slotId ? { ...slot, installedModule } : slot)),
    runtime: {
      ...device.runtime,
      arp: {},
      mac: {},
      dhcpLeases: {},
      lastBootAt: nowIso(),
    },
  };
}

function updatePool(device: NetworkDevice, index: number, pool: DhcpPool): NetworkDevice {
  return { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.map((entry, poolIndex) => (poolIndex === index ? pool : entry)) } };
}

function updateDns(device: NetworkDevice, index: number, record: DnsRecord): NetworkDevice {
  return { ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.map((entry, recordIndex) => (recordIndex === index ? record : entry)) } };
}

function removeDns(device: NetworkDevice, index: number): NetworkDevice {
  return { ...device, config: { ...device.config, dnsRecords: device.config.dnsRecords.filter((_, recordIndex) => recordIndex !== index) } };
}

function removePool(device: NetworkDevice, index: number): NetworkDevice {
  return { ...device, config: { ...device.config, dhcpPools: device.config.dhcpPools.filter((_, poolIndex) => poolIndex !== index) } };
}

function updateFirewallRule(device: NetworkDevice, index: number, rule: FirewallRule): NetworkDevice {
  return { ...device, config: { ...device.config, firewallRules: device.config.firewallRules.map((entry, ruleIndex) => (ruleIndex === index ? rule : entry)) } };
}

function updateStaticRoute(device: NetworkDevice, index: number, route: RouteEntry): NetworkDevice {
  return { ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.map((entry, routeIndex) => (routeIndex === index ? route : entry)) } };
}

function removeStaticRoute(device: NetworkDevice, index: number): NetworkDevice {
  return { ...device, config: { ...device.config, staticRoutes: device.config.staticRoutes.filter((_, routeIndex) => routeIndex !== index) } };
}

function removeFirewallRule(device: NetworkDevice, ruleId: string): NetworkDevice {
  return { ...device, config: { ...device.config, firewallRules: device.config.firewallRules.filter((rule) => rule.id !== ruleId) } };
}

function togglePower(device: NetworkDevice): NetworkDevice {
  return {
    ...device,
    powerOn: !device.powerOn,
    config: {
      ...device.config,
      cliMode: "user",
      cliContext: {},
    },
    runtime: {
      arp: {},
      mac: {},
      dhcpLeases: {},
      lastBootAt: nowIso(),
    },
  };
}

function selectLatestEvent(project: NetworkProject): NetworkProject {
  const latest = project.simulation.events.at(-1);
  if (!latest) return project;
  return { ...project, simulation: { ...project.simulation, selectedEventId: latest.id } };
}

function connectionForPort(project: NetworkProject, deviceId: string, portId: string): { label: string; type: string; status: string } | null {
  const link = project.links.find(
    (entry) =>
      (entry.a.deviceId === deviceId && entry.a.portId === portId) ||
      (entry.b.deviceId === deviceId && entry.b.portId === portId),
  );
  if (!link) return null;
  const peer = link.a.deviceId === deviceId && link.a.portId === portId ? link.b : link.a;
  const peerDevice = project.devices.find((entry) => entry.id === peer.deviceId);
  const peerPort = peerDevice?.ports.find((entry) => entry.id === peer.portId);
  return {
    label: `${peerDevice?.label ?? "Missing"} ${peerPort?.name ?? "port"}`,
    type: link.type,
    status: link.status,
  };
}

export default function Inspector({ project, device, onChangeDevice, onRemoveDevice, onProjectChange }: Props) {
  const [tab, setTab] = useState<Tab>("physical");
  const [desktopTargetId, setDesktopTargetId] = useState("");
  const [desktopHost, setDesktopHost] = useState("lab.local");
  const [desktopHttpId, setDesktopHttpId] = useState("");

  const visibleTabs = tabsForDevice(device);
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [device?.type, tab]);

  if (!device) {
    return <aside className="inspector empty-inspector">Select a device</aside>;
  }

  const targetDevices = project.devices.filter((entry) => entry.id !== device.id);
  const safeDesktopTargetId = targetDevices.some((entry) => entry.id === desktopTargetId) ? desktopTargetId : targetDevices[0]?.id ?? "";
  const httpDevices = project.devices.filter((entry) => entry.id !== device.id && (entry.config.httpEnabled || entry.type === "server"));
  const safeDesktopHttpId = httpDevices.some((entry) => entry.id === desktopHttpId) ? desktopHttpId : httpDevices[0]?.id ?? "";
  const hasWirelessPort = device.ports.some((port) => port.kind === "wireless");
  const moduleDependentPorts = device.ports.filter((port) => requiredModuleForPort(device, port));

  return (
    <aside className={`inspector ${activeTab === "cli" ? "cli-inspector" : ""}`}>
      <div className="inspector-head">
        <input value={device.label} onChange={(event) => onChangeDevice({ ...device, label: event.target.value, config: { ...device.config, hostname: event.target.value } })} />
        <button className="icon-button danger" onClick={() => onRemoveDevice(device.id)} title="삭제">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="tab-row">
        {visibleTabs.map((entry) => (
          <button key={entry} className={activeTab === entry ? "active" : ""} onClick={() => setTab(entry)}>
            {entry}
          </button>
        ))}
      </div>

      {activeTab === "physical" && (
        <section className="inspector-section">
          <button className={`power-toggle ${device.powerOn ? "on" : "off"}`} onClick={() => onChangeDevice(togglePower(device))}>
            <Power size={16} />
            {device.powerOn ? "Power On" : "Power Off"}
          </button>
          <div className="module-panel">
            <div className="module-panel-head">
              <Cpu size={16} />
              <strong>Modules</strong>
              <span>{device.moduleSlots.length ? `${device.moduleSlots.length} slot${device.moduleSlots.length > 1 ? "s" : ""}` : "fixed"}</span>
            </div>
            {device.moduleSlots.length ? (
              <div className="module-grid">
                {device.moduleSlots.map((slot) => (
                  <div key={slot.id} className="module-card">
                    <div className="module-card-head">
                      <strong>{slot.label}</strong>
                      <span>{slot.installedModule ?? "Blank"}</span>
                    </div>
                    <select value={slot.installedModule ?? "Blank"} onChange={(event) => onChangeDevice(updateModuleSlot(device, slot.id, event.target.value))}>
                      {slot.compatibleModules.map((module) => (
                        <option key={module}>{module}</option>
                      ))}
                    </select>
                    <div className="module-button-row">
                      {slot.compatibleModules.map((module) => (
                        <button key={module} type="button" className={slot.installedModule === module ? "active" : ""} onClick={() => onChangeDevice(updateModuleSlot(device, slot.id, module))}>
                          {module}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="muted">Fixed hardware. No removable modules.</span>
            )}
            {moduleDependentPorts.length > 0 && (
              <div className="module-port-list">
                {moduleDependentPorts.map((port) => {
                  const moduleReady = isPortAvailable(device, port);
                  return (
                    <div key={port.id} className={moduleReady ? "" : "unavailable"}>
                      <span>{port.name}</span>
                      <em>{requiredModuleForPort(device, port)} {moduleReady ? "ready" : "needed"}</em>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "config" && (
        <section className="inspector-section">
          {device.ports.map((port) => {
            const connection = connectionForPort(project, device.id, port.id);
            const moduleReady = isPortAvailable(device, port);
            const requiredModule = requiredModuleForPort(device, port);
            return (
              <details key={port.id} open={device.ports.length <= 3}>
                <summary>
                  {port.name}
                  {connection && <span className="port-connected-chip">{connection.status}</span>}
                  {!moduleReady && <span className="port-connected-chip unavailable">module</span>}
                </summary>
                {connection && (
                  <div className="port-peer-note">
                    <span>Connected to</span>
                    <strong>{connection.label}</strong>
                    <em>{connection.type}</em>
                  </div>
                )}
                {!moduleReady && (
                  <div className="port-peer-note unavailable">
                    <span>Unavailable</span>
                    <strong>Requires {requiredModule} module</strong>
                    <em>slot</em>
                  </div>
                )}
                <div className="field-list compact">
                  <label>
                    Description
                    <input value={port.description ?? ""} onChange={(event) => onChangeDevice(updatePort(device, { ...port, description: event.target.value }))} />
                  </label>
                  <label>
                    Status
                    <select value={port.status} onChange={(event) => onChangeDevice(updatePort(device, { ...port, status: event.target.value as NetworkPort["status"] }))}>
                      <option value="up">up</option>
                      <option value="administratively-down">shutdown</option>
                      <option value="down">down</option>
                    </select>
                  </label>
                  <label>
                    IP
                    <input value={port.interfaceConfig.ipAddress} onChange={(event) => onChangeDevice(updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, ipAddress: event.target.value, dhcp: false } }))} />
                  </label>
                  <label>
                    Mask
                    <input value={port.interfaceConfig.subnetMask} onChange={(event) => onChangeDevice(updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, subnetMask: event.target.value, dhcp: false } }))} />
                  </label>
                  <label>
                    Gateway
                    <input value={port.interfaceConfig.gateway ?? ""} onChange={(event) => onChangeDevice(updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, gateway: event.target.value } }))} />
                  </label>
                  <label>
                    Helper
                    <input value={port.interfaceConfig.helperAddress ?? ""} onChange={(event) => onChangeDevice(updatePort(device, { ...port, interfaceConfig: { ...port.interfaceConfig, helperAddress: event.target.value } }))} />
                  </label>
                  <label>
                    VLAN
                    <input type="number" value={port.vlan} onChange={(event) => onChangeDevice(updatePort(device, { ...port, vlan: Number(event.target.value) || 1 }))} />
                  </label>
                  <label>
                    Duplex
                    <select value={port.duplex} onChange={(event) => onChangeDevice(updatePort(device, { ...port, duplex: event.target.value as NetworkPort["duplex"] }))}>
                      <option value="auto">auto</option>
                      <option value="half">half</option>
                      <option value="full">full</option>
                    </select>
                  </label>
                  <label>
                    Speed Mbps
                    <input type="number" value={port.bandwidthMbps} onChange={(event) => onChangeDevice(updatePort(device, { ...port, bandwidthMbps: Number(event.target.value) || port.bandwidthMbps }))} />
                  </label>
                  {port.kind === "serial" && (
                    <label>
                      Clock rate
                      <input type="number" value={port.clockRate ?? ""} onChange={(event) => onChangeDevice(updatePort(device, { ...port, clockRate: Number(event.target.value) || undefined }))} />
                    </label>
                  )}
                  <label>
                    Mode
                    <select value={port.mode} onChange={(event) => onChangeDevice(updatePort(device, { ...port, mode: event.target.value as NetworkPort["mode"] }))}>
                      <option value="access">access</option>
                      <option value="trunk">trunk</option>
                      <option value="routed">routed</option>
                    </select>
                  </label>
                  {port.mode === "trunk" && (
                    <label>
                      Allowed VLANs
                      <input
                        value={port.allowedVlans.join(",")}
                        onChange={(event) =>
                          onChangeDevice(
                            updatePort(device, {
                              ...port,
                              allowedVlans: event.target.value
                                .split(",")
                                .map((value) => Number(value.trim()))
                                .filter((value) => Number.isInteger(value) && value > 0),
                            }),
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              </details>
            );
          })}
          {hasWirelessPort && (
            <details open>
              <summary>Wireless</summary>
              <div className="field-list compact">
                <label>
                  SSID
                  <input value={device.config.wireless.ssid} onChange={(event) => onChangeDevice({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, ssid: event.target.value } } })} />
                </label>
                <label>
                  Security
                  <select value={device.config.wireless.security} onChange={(event) => onChangeDevice({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, security: event.target.value as NetworkDevice["config"]["wireless"]["security"] } } })}>
                    <option value="open">open</option>
                    <option value="wep">wep</option>
                  </select>
                </label>
                {device.config.wireless.security === "wep" && (
                  <label>
                    WEP key
                    <input value={device.config.wireless.wepKey} onChange={(event) => onChangeDevice({ ...device, config: { ...device.config, wireless: { ...device.config.wireless, wepKey: event.target.value } } })} />
                  </label>
                )}
              </div>
            </details>
          )}
          {(device.type === "router" || device.type === "firewall") && (
            <details open={device.config.staticRoutes.length > 0}>
              <summary>Static Routes</summary>
              <div className="route-list">
                {device.config.staticRoutes.map((route, index) => (
                  <div key={`${route.destination}-${route.mask}-${route.nextHop}-${index}`} className="route-row">
                    <input value={route.destination} onChange={(event) => onChangeDevice(updateStaticRoute(device, index, { ...route, destination: event.target.value }))} />
                    <input value={route.mask} onChange={(event) => onChangeDevice(updateStaticRoute(device, index, { ...route, mask: event.target.value }))} />
                    <input value={route.nextHop} onChange={(event) => onChangeDevice(updateStaticRoute(device, index, { ...route, nextHop: event.target.value }))} />
                    <button className="icon-button danger" onClick={() => onChangeDevice(removeStaticRoute(device, index))} title="Route 삭제">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    onChangeDevice({
                      ...device,
                      config: {
                        ...device.config,
                        staticRoutes: [...device.config.staticRoutes, { destination: "0.0.0.0", mask: "0.0.0.0", nextHop: "192.168.1.1", learnedBy: "static" }],
                      },
                    })
                  }
                >
                  Add Route
                </button>
              </div>
            </details>
          )}
        </section>
      )}

      {activeTab === "cli" && <CliTerminal project={project} device={device} onDeviceChange={onChangeDevice} onProjectChange={onProjectChange} />}

      {activeTab === "desktop" && (
        <section className="inspector-section">
          <div className="desktop-actions">
            <button onClick={() => onProjectChange(selectLatestEvent(requestDhcp(project, device.id)))}>DHCP</button>
            <label>
              Ping target
              <select value={safeDesktopTargetId} onChange={(event) => setDesktopTargetId(event.target.value)}>
                {targetDevices.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </label>
            <button disabled={!safeDesktopTargetId} onClick={() => onProjectChange(selectLatestEvent(simulatePing(project, device.id, safeDesktopTargetId)))}>
              Ping
            </button>
            <label>
              DNS host
              <input value={desktopHost} onChange={(event) => setDesktopHost(event.target.value)} />
            </label>
            <button onClick={() => onProjectChange(selectLatestEvent(simulateDns(project, device.id, desktopHost)))}>DNS</button>
            <label>
              HTTP server
              <select value={safeDesktopHttpId} onChange={(event) => setDesktopHttpId(event.target.value)}>
                {httpDevices.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </label>
            <button disabled={!safeDesktopHttpId} onClick={() => onProjectChange(selectLatestEvent(simulateHttp(project, device.id, safeDesktopHttpId)))}>
              HTTP
            </button>
          </div>
          <pre className="table-output">
            {device.ports.map((port) => `${port.name}: ${port.interfaceConfig.ipAddress || "unassigned"} ${port.interfaceConfig.dhcp ? "(DHCP)" : ""}`).join("\n")}
          </pre>
          <pre className="table-output">ARP table{"\n"}{Object.entries(device.runtime.arp).map(([ip, mac]) => `${ip} ${mac}`).join("\n") || "empty"}</pre>
        </section>
      )}

      {activeTab === "services" && (
        <section className="inspector-section">
          <label className="inline-toggle">
            <input type="checkbox" checked={device.config.httpEnabled} onChange={(event) => onChangeDevice({ ...device, config: { ...device.config, httpEnabled: event.target.checked } })} />
            HTTP
          </label>
          <textarea value={device.config.httpBody} onChange={(event) => onChangeDevice({ ...device, config: { ...device.config, httpBody: event.target.value } })} />
          <div className="subhead">DNS</div>
          {device.config.dnsRecords.map((record, index) => (
            <div key={`${record.host}-${index}`} className="service-row">
              <input value={record.host} onChange={(event) => onChangeDevice(updateDns(device, index, { ...record, host: event.target.value }))} />
              <input value={record.address} onChange={(event) => onChangeDevice(updateDns(device, index, { ...record, address: event.target.value }))} />
              <button className="icon-button danger" onClick={() => onChangeDevice(removeDns(device, index))} title="DNS 삭제">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => onChangeDevice({ ...device, config: { ...device.config, dnsRecords: [...device.config.dnsRecords, { host: "new.local", address: "192.168.1.10" }] } })}>Add DNS</button>
          <div className="subhead">DHCP Pools</div>
          {device.config.dhcpPools.map((pool, index) => (
            <details key={`${pool.name}-${index}`} open>
              <summary>{pool.name}</summary>
              <div className="field-list compact">
                <label>Network<input value={pool.network} onChange={(event) => onChangeDevice(updatePool(device, index, { ...pool, network: event.target.value }))} /></label>
                <label>Mask<input value={pool.mask} onChange={(event) => onChangeDevice(updatePool(device, index, { ...pool, mask: event.target.value }))} /></label>
                <label>Gateway<input value={pool.defaultRouter} onChange={(event) => onChangeDevice(updatePool(device, index, { ...pool, defaultRouter: event.target.value }))} /></label>
                <label>DNS<input value={pool.dnsServer} onChange={(event) => onChangeDevice(updatePool(device, index, { ...pool, dnsServer: event.target.value }))} /></label>
              </div>
              <button className="danger" onClick={() => onChangeDevice(removePool(device, index))}>Remove Pool</button>
            </details>
          ))}
          <button
            onClick={() =>
              onChangeDevice({
                ...device,
                config: {
                  ...device.config,
                  dhcpPools: [...device.config.dhcpPools, { name: `POOL${device.config.dhcpPools.length + 1}`, network: "192.168.10.0", mask: "255.255.255.0", defaultRouter: "192.168.10.1", dnsServer: "192.168.10.10", nextOffset: 10, leases: {} }],
                },
              })
            }
          >
            Add DHCP Pool
          </button>
          {device.type === "firewall" && (
            <>
              <div className="subhead">Firewall Rules</div>
              {device.config.firewallRules.map((rule, index) => (
                <div key={rule.id} className="firewall-rule-row">
                  <select value={rule.action} onChange={(event) => onChangeDevice(updateFirewallRule(device, index, { ...rule, action: event.target.value as FirewallRule["action"] }))}>
                    <option value="permit">permit</option>
                    <option value="deny">deny</option>
                  </select>
                  <select value={rule.protocol} onChange={(event) => onChangeDevice(updateFirewallRule(device, index, { ...rule, protocol: event.target.value as FirewallRule["protocol"] }))}>
                    <option value="ip">ip</option>
                    <option value="icmp">icmp</option>
                    <option value="tcp">tcp</option>
                    <option value="udp">udp</option>
                  </select>
                  <input value={rule.source} onChange={(event) => onChangeDevice(updateFirewallRule(device, index, { ...rule, source: event.target.value }))} />
                  <input value={rule.destination} onChange={(event) => onChangeDevice(updateFirewallRule(device, index, { ...rule, destination: event.target.value }))} />
                  <button className="icon-button danger" onClick={() => onChangeDevice(removeFirewallRule(device, rule.id))} title="ACL 삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => onChangeDevice({ ...device, config: { ...device.config, firewallRules: [...device.config.firewallRules, { id: makeId("acl"), action: "deny", protocol: "icmp", source: "any", destination: "any" }] } })}>
                Add ACL
              </button>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
