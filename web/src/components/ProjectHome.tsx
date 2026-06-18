import { ChangeEvent, useRef, useState } from "react";
import { ArrowRight, Cable, Clock3, Download, FileJson, LogOut, Monitor, Network, Plus, Router, Server, Shield, Trash2, Upload } from "lucide-react";
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
    <main className="home-shell home-landing">
      <header className="home-nav">
        <a className="home-brand" href="#projects" aria-label="Network Editor Web projects">
          <span className="app-mark"><Network size={20} /></span>
          <div>
            <strong>Network Editor</strong>
            <small>{user.username} 작업공간</small>
          </div>
        </a>
        <div className="home-nav-actions">
          <a href="#projects">프로젝트</a>
          <button className="icon-button" onClick={onLogout} title="로그아웃" type="button"><LogOut size={18} /></button>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker">네트워크 토폴로지 빌더</p>
          <h1>장비, 케이블, 패킷 흐름을 한 장의 맵에서 설계합니다.</h1>
          <p>라우터와 스위치부터 서버, PC, 방화벽까지 배치하고 포트 상태와 시뮬레이션 이벤트를 바로 확인합니다.</p>
          <div className="home-hero-actions">
            <button className="primary-action" disabled={pending} onClick={() => { void runAction(onCreate); }} type="button"><Plus size={17} />새 네트워크</button>
            <button className="secondary-action dark" disabled={pending} onClick={() => { void runAction(onCreateSample); }} type="button"><Network size={17} />샘플 랩</button>
          </div>
        </div>
        <TopologyPreview projects={projects.length} />
      </section>

      <section className="home-dashboard" id="projects">
        <div className="home-dashboard-head">
          <div>
            <p className="home-kicker">작업공간</p>
            <h2>프로젝트</h2>
            <span>{user.name} / {projects.length}개 랩</span>
          </div>
          <div className="button-row">
            <button className="primary-action" disabled={pending} onClick={() => { void runAction(onCreate); }} type="button"><Plus size={17} />새로 만들기</button>
            <button className="secondary-action" disabled={pending} onClick={() => { void runAction(onCreateSample); }} type="button"><Network size={17} />샘플</button>
            <button className="secondary-action" disabled={pending} onClick={() => fileInputRef.current?.click()} title="JSON/PTWEB 프로젝트 가져오기 (Cisco .pkt는 지원하지 않음)" type="button"><Upload size={17} />가져오기</button>
            <input accept="application/json,.json,.ptweb" hidden onChange={(event) => { void importFile(event); }} ref={fileInputRef} type="file" />
          </div>
        </div>
        {error && <strong className="form-error">{error}</strong>}
        <section className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <button onClick={() => onOpen(project)} type="button">
                <strong>{project.name}</strong>
                <span className="project-stats"><Network size={14} />장비 {project.devices.length}개 / 링크 {project.links.length}개</span>
                <small><Clock3 size={13} />{new Date(project.updatedAt).toLocaleString()}</small>
              </button>
              <div>
                <button className="icon-button" onClick={() => downloadProject(project, "json")} title="JSON 내보내기" type="button"><FileJson size={16} /></button>
                <button className="icon-button" onClick={() => downloadProject(project, "ptweb")} title="PTWEB 프로젝트 내보내기 (Cisco .pkt 아님)" type="button"><Download size={16} /></button>
                <button className="icon-button danger" disabled={pending} onClick={() => { void runAction(() => onDelete(project.id)); }} title="삭제" type="button"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {!projects.length && (
            <article className="empty-project-state">
              <Network size={28} />
              <strong>아직 프로젝트가 없습니다.</strong>
              <button className="primary-action" disabled={pending} onClick={() => { void runAction(onCreateSample); }} type="button">샘플 만들기 <ArrowRight size={16} /></button>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}

export function TopologyPreview({ projects }: { projects: number }) {
  return (
    <aside className="topology-preview" aria-label="토폴로지 미리보기">
      <div className="preview-toolbar">
        <span />
        <span />
        <span />
        <strong>{projects}개 랩</strong>
      </div>
      <div className="preview-canvas">
        <div className="preview-link core-users" />
        <div className="preview-link core-edge" />
        <div className="preview-link core-services" />
        <div className="preview-link users-laptop" />
        <div className="preview-node core"><Router size={20} /><strong>코어</strong><small>라우터</small></div>
        <div className="preview-node users"><Network size={20} /><strong>사용자망</strong><small>스위치</small></div>
        <div className="preview-node edge"><Shield size={20} /><strong>경계</strong><small>방화벽</small></div>
        <div className="preview-node services"><Server size={20} /><strong>서비스</strong><small>서버</small></div>
        <div className="preview-node laptop"><Monitor size={20} /><strong>호스트</strong><small>PC</small></div>
        <div className="preview-packet"><Cable size={15} /></div>
      </div>
    </aside>
  );
}
