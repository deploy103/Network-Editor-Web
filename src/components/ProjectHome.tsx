import { ChangeEvent, useState } from "react";
import { FolderOpen, LogOut, Plus, Trash2, Upload } from "lucide-react";
import type { AppUser, NetworkProject } from "../types/network";
import { createEmptyProject, deleteProject } from "../storage/localStore";
import { createSampleProject } from "../utils/sampleProject";
import { importProjectJson } from "../exporters/projectExport";
import { makeId, nowIso } from "../utils/ids";

interface Props {
  user: AppUser;
  projects: NetworkProject[];
  onLogout: () => void;
  onOpenProject: (project: NetworkProject) => void;
  onProjectCreated: (project: NetworkProject) => void;
  onProjectsChanged: () => void;
}

export default function ProjectHome({ user, projects, onLogout, onOpenProject, onProjectCreated, onProjectsChanged }: Props) {
  const [error, setError] = useState("");

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const imported = importProjectJson(text);
      const importedAt = nowIso();
      onProjectCreated({ ...imported, id: makeId("project"), ownerUserId: user.id, name: `${imported.name} Import`, createdAt: importedAt, updatedAt: importedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로젝트 파일을 가져오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <div>
          <span className="eyebrow">{user.username}</span>
          <h1>Projects</h1>
        </div>
        <div className="home-actions">
          <label className="icon-button">
            <Upload size={18} />
            <input hidden type="file" accept=".json,.network.json,.pkt" onChange={importFile} />
          </label>
          <button className="icon-button" onClick={() => onProjectCreated(createEmptyProject(user.id))} title="새 프로젝트">
            <Plus size={18} />
          </button>
          <button className="icon-button" onClick={() => onProjectCreated(createSampleProject(user.id))} title="샘플 프로젝트">
            <FolderOpen size={18} />
          </button>
          <button className="icon-button" onClick={onLogout} title="로그아웃">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {error && <p className="home-error form-error">{error}</p>}

      {projects.length === 0 ? (
        <section className="empty-state">
          <button onClick={() => onProjectCreated(createEmptyProject(user.id))}>
            <Plus size={18} />
            새 네트워크 구성
          </button>
          <button onClick={() => onProjectCreated(createSampleProject(user.id))}>
            <FolderOpen size={18} />
            샘플 랩 열기
          </button>
        </section>
      ) : (
        <section className="project-grid">
          {projects.map((project) => (
            <article key={project.id} className="project-card">
              <button className="project-open" onClick={() => onOpenProject(project)}>
                <strong>{project.name}</strong>
                <span>{project.devices.length} devices / {project.links.length} links</span>
                <small>{new Date(project.updatedAt).toLocaleString()}</small>
              </button>
              <button
                className="icon-button danger"
                onClick={() => {
                  deleteProject(project.id);
                  onProjectsChanged();
                }}
                title="삭제"
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
