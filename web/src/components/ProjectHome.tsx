import { ChangeEvent, useRef, useState } from "react";
import { Download, FileJson, LogOut, Network, Plus, Trash2, Upload } from "lucide-react";
import { downloadProject } from "../exporters/packetTracerExport";
import type { NetworkProject, User } from "../types/network";

export function ProjectHome({ user, projects, error, onOpen, onCreate, onCreateSample, onImport, onDelete, onLogout }: { user: User; projects: NetworkProject[]; error: string; onOpen: (project: NetworkProject) => void; onCreate: () => Promise<void>; onCreateSample: () => Promise<void>; onImport: (raw: string) => Promise<void>; onDelete: (projectId: string) => Promise<void>; onLogout: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const raw = await file.text();
    await runAction(() => onImport(raw));
  }

  async function runAction(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <div>
          <h1>Projects</h1>
          <p>{user.name} / {user.username}</p>
        </div>
        <button className="icon-button" onClick={onLogout} title="Logout" type="button"><LogOut size={18} /></button>
      </header>
      <div className="button-row">
        <button className="primary-action" disabled={pending} onClick={() => { void runAction(onCreate); }} type="button"><Plus size={17} />New Network</button>
        <button className="secondary-action" disabled={pending} onClick={() => { void runAction(onCreateSample); }} type="button"><Network size={17} />Sample Lab</button>
        <button className="secondary-action" disabled={pending} onClick={() => fileInputRef.current?.click()} title="Import JSON/PTWEB project (Cisco .pkt is not supported)" type="button"><Upload size={17} />Import</button>
        <input accept="application/json,.json,.ptweb" hidden onChange={(event) => { void importFile(event); }} ref={fileInputRef} type="file" />
      </div>
      {error && <strong className="form-error">{error}</strong>}
      <section className="project-grid">
        {projects.map((project) => (
          <article className="project-card" key={project.id}>
            <button onClick={() => onOpen(project)} type="button">
              <strong>{project.name}</strong>
              <span>{project.devices.length} devices / {project.links.length} links</span>
              <small>{new Date(project.updatedAt).toLocaleString()}</small>
            </button>
            <div>
              <button className="icon-button" onClick={() => downloadProject(project, "json")} title="Export JSON" type="button"><FileJson size={16} /></button>
              <button className="icon-button" onClick={() => downloadProject(project, "ptweb")} title="Export PTWEB project (not Cisco .pkt)" type="button"><Download size={16} /></button>
              <button className="icon-button danger" disabled={pending} onClick={() => { void runAction(() => onDelete(project.id)); }} title="Delete" type="button"><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
        {!projects.length && <p className="empty-state">No projects yet.</p>}
      </section>
    </main>
  );
}
