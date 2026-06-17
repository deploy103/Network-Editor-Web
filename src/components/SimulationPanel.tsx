import { useMemo, useState } from "react";
import { Play, RotateCcw, StepForward, Wifi } from "lucide-react";
import type { EventStatus, NetworkProject, UserCreatedPdu } from "../types/network";
import { makeId } from "../utils/ids";
import { requestDhcp, simulateDns, simulateHttp, simulatePing } from "../engine/simulation";

interface Props {
  project: NetworkProject;
  onProjectChange: (project: NetworkProject) => void;
}

function addPdu(project: NetworkProject, pdu: UserCreatedPdu): NetworkProject {
  return {
    ...project,
    simulation: {
      ...project.simulation,
      scenarios: project.simulation.scenarios.map((scenario) =>
        scenario.id === project.simulation.activeScenarioId ? { ...scenario, pdus: [...scenario.pdus, pdu] } : scenario,
      ),
    },
  };
}

function updatePduStatus(project: NetworkProject, pduId: string, status: EventStatus): NetworkProject {
  return {
    ...project,
    simulation: {
      ...project.simulation,
      scenarios: project.simulation.scenarios.map((scenario) => ({
        ...scenario,
        pdus: scenario.pdus.map((pdu) => (pdu.id === pduId ? { ...pdu, lastStatus: status } : pdu)),
      })),
    },
  };
}

function selectLatestEvent(project: NetworkProject): NetworkProject {
  const latest = project.simulation.events.at(-1);
  if (!latest) return project;
  return { ...project, simulation: { ...project.simulation, selectedEventId: latest.id } };
}

function deviceLabel(project: NetworkProject, deviceId: string): string {
  return project.devices.find((device) => device.id === deviceId)?.label ?? "Missing";
}

export default function SimulationPanel({ project, onProjectChange }: Props) {
  const [sourceId, setSourceId] = useState(project.devices[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState(project.devices[1]?.id ?? "");
  const [httpServerId, setHttpServerId] = useState("");
  const [dnsHost, setDnsHost] = useState("lab.local");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatus | "all">("all");
  const activeScenario = project.simulation.scenarios.find((scenario) => scenario.id === project.simulation.activeScenarioId);
  const selectedEvent = project.simulation.events.find((event) => event.id === project.simulation.selectedEventId) ?? project.simulation.events.at(-1);
  const serverOptions = useMemo(() => project.devices.filter((device) => device.config.httpEnabled || device.type === "server"), [project.devices]);
  const eventTypes = useMemo(() => Array.from(new Set(project.simulation.events.map((event) => event.type))).sort(), [project.simulation.events]);
  const visibleEvents = project.simulation.events
    .filter((event) => eventTypeFilter === "all" || event.type === eventTypeFilter)
    .filter((event) => eventStatusFilter === "all" || event.status === eventStatusFilter)
    .slice(-80);
  const safeSourceId = project.devices.some((device) => device.id === sourceId) ? sourceId : project.devices[0]?.id ?? "";
  const safeDestinationId = project.devices.some((device) => device.id === destinationId) ? destinationId : project.devices.find((device) => device.id !== safeSourceId)?.id ?? project.devices[0]?.id ?? "";
  const safeHttpServerId = serverOptions.some((device) => device.id === httpServerId) ? httpServerId : serverOptions[0]?.id ?? "";

  function runPing() {
    if (!safeSourceId || !safeDestinationId) return;
    const pdu: UserCreatedPdu = {
      id: makeId("pdu"),
      sourceDeviceId: safeSourceId,
      destinationDeviceId: safeDestinationId,
      protocol: "ICMP",
      color: "#2f80ed",
      scheduledTime: project.simulation.time,
      periodic: false,
      lastStatus: "queued",
    };
    const simulated = simulatePing(addPdu(project, pdu), safeSourceId, safeDestinationId);
    const latestStatus = simulated.simulation.events.at(-1)?.status ?? "failed";
    onProjectChange(selectLatestEvent(updatePduStatus(simulated, pdu.id, latestStatus)));
  }

  function stepForward() {
    const events = project.simulation.events;
    if (!events.length) return;
    const currentIndex = events.findIndex((event) => event.id === selectedEvent?.id);
    const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, events.length - 1);
    const nextEvent = events[nextIndex];
    onProjectChange({ ...project, simulation: { ...project.simulation, selectedEventId: nextEvent.id, time: nextEvent.time } });
  }

  return (
    <section className="simulation-panel">
      <div className="sim-controls">
        <div className="mode-toggle" data-mode={project.simulation.mode}>
          <button
            className={project.simulation.mode === "realtime" ? "active" : ""}
            onClick={() => onProjectChange({ ...project, simulation: { ...project.simulation, mode: "realtime" } })}
          >
            Realtime
          </button>
          <button
            className={project.simulation.mode === "simulation" ? "active" : ""}
            onClick={() => onProjectChange({ ...project, simulation: { ...project.simulation, mode: "simulation" } })}
          >
            Simulation
          </button>
        </div>
        <select value={safeSourceId} onChange={(event) => setSourceId(event.target.value)}>
          {project.devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
        </select>
        <select value={safeDestinationId} onChange={(event) => setDestinationId(event.target.value)}>
          {project.devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
        </select>
        <button onClick={runPing} disabled={!safeSourceId || !safeDestinationId}><Play size={15} /> PDU</button>
        <button onClick={() => onProjectChange(selectLatestEvent(requestDhcp(project, safeSourceId)))} disabled={!safeSourceId}><Wifi size={15} /> DHCP</button>
        <button onClick={() => onProjectChange({ ...project, simulation: { ...project.simulation, events: [], time: 0, selectedEventId: undefined } })}><RotateCcw size={15} /></button>
        <button onClick={stepForward} disabled={!project.simulation.events.length} title="다음 이벤트"><StepForward size={15} /></button>
      </div>
      <div className="sim-extra">
        <input value={dnsHost} onChange={(event) => setDnsHost(event.target.value)} />
        <button onClick={() => onProjectChange(selectLatestEvent(simulateDns(project, safeSourceId, dnsHost)))} disabled={!safeSourceId}>DNS</button>
        <select value={safeHttpServerId} onChange={(event) => setHttpServerId(event.target.value)}>
          {serverOptions.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
        </select>
        <button onClick={() => onProjectChange(selectLatestEvent(simulateHttp(project, safeSourceId, safeHttpServerId)))} disabled={!safeSourceId || !safeHttpServerId}>HTTP</button>
        <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
          <option value="all">All Events</option>
          {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={eventStatusFilter} onChange={(event) => setEventStatusFilter(event.target.value as EventStatus | "all")}>
          <option value="all">All Status</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
          <option value="info">info</option>
          <option value="queued">queued</option>
        </select>
      </div>
      <div className="event-area">
        <div className="event-list">
          {visibleEvents.length ? (
            visibleEvents.map((event) => (
              <button
                key={event.id}
                className={`${event.status} ${selectedEvent?.id === event.id ? "selected" : ""}`}
                onClick={() => onProjectChange({ ...project, simulation: { ...project.simulation, selectedEventId: event.id } })}
              >
                <span>{event.time.toFixed(3)}</span>
                <strong>{event.type}</strong>
                <em>{event.summary}</em>
              </button>
            ))
          ) : (
            <span className="muted">No matching events</span>
          )}
        </div>
        <div className="pdu-list">
          <div className="panel-title">PDUs</div>
          {(activeScenario?.pdus ?? []).slice(-8).map((pdu) => (
            <div key={pdu.id} className="pdu-row">
              <span style={{ background: pdu.color }} />
              <b>{pdu.protocol}</b>
              <small>{pdu.lastStatus}</small>
              <em>{deviceLabel(project, pdu.sourceDeviceId)} {"->"} {deviceLabel(project, pdu.destinationDeviceId)}</em>
            </div>
          ))}
        </div>
        <div className="event-detail">
          {selectedEvent ? (
            <>
              <strong>{selectedEvent.type}</strong>
              <p>{selectedEvent.summary}</p>
              <div className="layer-trace">
                {selectedEvent.layers.map((layer) => (
                  <div key={`${layer.layer}-${layer.direction}-${layer.detail}`}>
                    L{layer.layer} {layer.name}: {layer.action} - {layer.detail}
                  </div>
                ))}
              </div>
              {Object.keys(selectedEvent.details).length > 0 && (
                <div className="event-kv">
                  {Object.entries(selectedEvent.details).map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span className="muted">No events</span>
          )}
        </div>
      </div>
    </section>
  );
}
