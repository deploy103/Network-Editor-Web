import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Cable, Clock3, Copy, Download, FileJson, LogOut, Monitor, Moon, Network, Plus, Router, Search, Server, Shield, Sun, Trash2, Upload } from "lucide-react";
import { downloadProject } from "../exporters/packetTracerExport";
import type { SampleProjectTemplateId } from "../data/sampleProject";
import { readImportPreview, type ImportPreview } from "../storage/importPreview";
import type { NetworkProject, User } from "../types/network";

type ProjectSort = "updated" | "name" | "size";

export function ProjectHome({ user, projects, error, onOpen, onCreate, onCreateSample, sampleTemplates, onDuplicate, onImport, onDelete, onLogout, onThemeToggle, theme }: { user: User; projects: NetworkProject[]; error: string; onOpen: (project: NetworkProject) => void; onCreate: () => Promise<void>; onCreateSample: (templateId?: SampleProjectTemplateId) => Promise<void>; sampleTemplates: Array<{ id: SampleProjectTemplateId; name: string; detail: string }>; onDuplicate: (projectId: string) => Promise<void>; onImport: (raw: string) => Promise<void>; onDelete: (projectId: string) => Promise<void>; onLogout: () => void; onThemeToggle: () => void; theme: "light" | "dark" }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("updated");
  const [deleteTarget, setDeleteTarget] = useState<NetworkProject | null>(null);
  const [importDraft, setImportDraft] = useState<ImportPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<SampleProjectTemplateId>(sampleTemplates[0]?.id ?? "routed-services");
  const visibleProjects = filterProjects(projects, query, sort);
  const stats = workspaceStats(projects);

  useEffect(() => {
    function closeDialog(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDeleteTarget(null);
      setImportDraft(null);
    }
    window.addEventListener("keydown", closeDialog);
    return () => window.removeEventListener("keydown", closeDialog);
  }, []);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const raw = await file.text();
    try {
      setImportDraft(readImportPreview(raw, file.name));
      setNotice("");
    } catch (error) {
      setImportDraft(null);
      setNotice(error instanceof Error ? error.message : "프로젝트 파일을 읽을 수 없습니다.");
    }
  }

  async function runAction(action: () => Promise<void>, successMessage = "") {
    if (pending) return;
    setNotice("");
    setPending(true);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "작업을 완료하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="home-shell home-landing" aria-busy={pending}>
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
          <button className="icon-button" onClick={onThemeToggle} title={theme === "dark" ? "Light mode" : "Dark mode"} type="button">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
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
            <button className="secondary-action dark" disabled={pending} onClick={() => { void runAction(() => onCreateSample(selectedTemplate)); }} type="button"><Network size={17} />샘플 랩</button>
          </div>
        </div>
        <TopologyPreview projects={projects.length} />
      </section>

      <section className="home-dashboard" id="projects">
        <div className="home-dashboard-head">
          <div>
            <p className="home-kicker">작업공간</p>
            <h2>프로젝트</h2>
            <span>{user.name} / 전체 {projects.length}개 / 표시 {visibleProjects.length}개</span>
          </div>
          <div className="button-row">
            <button className="primary-action" disabled={pending} onClick={() => { void runAction(onCreate); }} type="button"><Plus size={17} />새로 만들기</button>
            <select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value as SampleProjectTemplateId)} aria-label="샘플 랩 템플릿">
              {sampleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button className="secondary-action" disabled={pending} onClick={() => { void runAction(() => onCreateSample(selectedTemplate)); }} type="button"><Network size={17} />샘플</button>
            <button className="secondary-action" disabled={pending} onClick={() => fileInputRef.current?.click()} title="JSON/PTWEB 프로젝트 가져오기 (Cisco .pkt는 지원하지 않음)" type="button"><Upload size={17} />가져오기</button>
            <input accept="application/json,.json,.ptweb" hidden onChange={(event) => { void importFile(event); }} ref={fileInputRef} type="file" />
          </div>
        </div>
        <div className="workspace-stats">
          <span><strong>{stats.devices}</strong> 장비</span>
          <span><strong>{stats.links}</strong> 링크</span>
          <span><strong>{stats.upLinks}</strong> 활성 링크</span>
          <span><strong>{stats.services}</strong> 서비스</span>
          <span><strong>{stats.events}</strong> 이벤트</span>
        </div>
        <div className="project-tools">
          <label>
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="프로젝트 이름, 장비, IP, 서비스 검색" aria-label="프로젝트 검색" />
          </label>
          <select value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)} aria-label="프로젝트 정렬">
            <option value="updated">최근 수정순</option>
            <option value="name">이름순</option>
            <option value="size">규모순</option>
          </select>
        </div>
        {error && <strong className="form-error" role="alert">{error}</strong>}
        {notice && <strong className={isNoticeError(notice) ? "form-error" : "project-notice"} role={isNoticeError(notice) ? "alert" : "status"}>{notice}</strong>}
        <section className="project-grid">
          {visibleProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <button onClick={() => onOpen(project)} type="button">
                <strong>{project.name}</strong>
                <span className="project-stats"><Network size={14} />장비 {project.devices.length}개 / 링크 {project.links.length}개</span>
                <small><Clock3 size={13} />{new Date(project.updatedAt).toLocaleString()}</small>
              </button>
              <div>
                <button className="icon-button" disabled={pending} onClick={() => { void runAction(() => onDuplicate(project.id)); }} title="프로젝트 복제" type="button"><Copy size={16} /></button>
                <button className="icon-button" onClick={() => { downloadProject(project, "json"); setNotice(`${project.name} JSON을 내보냈습니다.`); }} title="JSON 내보내기" type="button"><FileJson size={16} /></button>
                <button className="icon-button" onClick={() => { downloadProject(project, "ptweb"); setNotice(`${project.name} PTWEB을 내보냈습니다.`); }} title="PTWEB 프로젝트 내보내기 (Cisco .pkt 아님)" type="button"><Download size={16} /></button>
                <button className="icon-button danger" disabled={pending} onClick={() => setDeleteTarget(project)} title="삭제" type="button"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {!projects.length && (
            <article className="empty-project-state">
              <Network size={28} />
              <strong>아직 프로젝트가 없습니다.</strong>
              <button className="primary-action" disabled={pending} onClick={() => { void runAction(() => onCreateSample(selectedTemplate)); }} type="button">샘플 만들기 <ArrowRight size={16} /></button>
            </article>
          )}
          {projects.length > 0 && visibleProjects.length === 0 && (
            <article className="empty-project-state">
              <Search size={28} />
              <strong>검색 결과가 없습니다.</strong>
              <button className="secondary-action" onClick={() => setQuery("")} type="button">검색 지우기</button>
            </article>
          )}
        </section>
      </section>
      {deleteTarget && (
        <div className="project-delete-dialog" onClick={() => setDeleteTarget(null)} role="dialog" aria-modal="true" aria-label="프로젝트 삭제 확인">
          <section onClick={(event) => event.stopPropagation()}>
            <header><Trash2 size={18} /><strong>프로젝트 삭제</strong></header>
            <p>{deleteTarget.name} 프로젝트를 삭제합니다. 저장된 장비, 케이블, 이벤트가 모두 제거됩니다.</p>
            <div className="button-row">
              <button className="secondary-action" disabled={pending} onClick={() => setDeleteTarget(null)} type="button">취소</button>
              <button className="primary-action danger-action" disabled={pending} onClick={() => { const id = deleteTarget.id; const name = deleteTarget.name; setDeleteTarget(null); void runAction(() => onDelete(id), `${name} 프로젝트를 삭제했습니다.`); }} type="button">삭제</button>
            </div>
          </section>
        </div>
      )}
      {importDraft && (
        <div className="project-import-dialog" onClick={() => setImportDraft(null)} role="dialog" aria-modal="true" aria-label="프로젝트 가져오기 확인">
          <section onClick={(event) => event.stopPropagation()}>
            <header><Upload size={18} /><strong>프로젝트 가져오기</strong></header>
            <div className="import-preview-grid">
              <span>파일</span><strong>{importDraft.fileName}</strong>
              <span>프로젝트</span><strong>{importDraft.name}</strong>
              <span>구성</span><strong>장비 {importDraft.devices}개 / 링크 {importDraft.links}개</strong>
            </div>
            <div className="button-row">
              <button className="secondary-action" disabled={pending} onClick={() => setImportDraft(null)} type="button">취소</button>
              <button className="primary-action" disabled={pending} onClick={() => { const raw = importDraft.raw; setImportDraft(null); void runAction(() => onImport(raw)); }} type="button">가져오기</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function filterProjects(projects: NetworkProject[], query: string, sort: ProjectSort): NetworkProject[] {
  const needle = query.trim().toLowerCase();
  const filtered = !needle ? projects : projects.filter((project) => projectSearchText(project).includes(needle));
  return [...filtered].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "size") return (b.devices.length + b.links.length) - (a.devices.length + a.links.length) || b.updatedAt.localeCompare(a.updatedAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function projectSearchText(project: NetworkProject): string {
  return [
    project.name,
    project.activity?.title ?? "",
    ...(project.activity?.objectives ?? []),
    ...(project.activity?.requirements ?? []).flatMap((requirement) => [requirement.label, requirement.kind]),
    ...(project.activity?.commandRules ?? []).flatMap((rule) => [rule.label, rule.command]),
    ...(project.activity?.commandSequences ?? []).flatMap((sequence) => [sequence.label, ...sequence.commands]),
    ...(project.activity?.commandOutputAssertions ?? []).flatMap((assertion) => [assertion.label, ...assertion.commands, assertion.expectedText]),
    ...(project.activity?.interfaceExpectations ?? []).flatMap((expectation) => [expectation.label, expectation.ipAddress ?? "", expectation.subnetMask ?? "", expectation.mode ?? "", String(expectation.vlan ?? "")]),
    ...(project.activity?.headerAssertions ?? []).flatMap((assertion) => [assertion.label, assertion.protocol ?? "", assertion.field, assertion.value]),
    ...(project.activity?.answerSnapshot?.devices ?? []).flatMap((device) => [device.label, device.kind, device.model]),
    ...(project.notes ?? []).map((note) => note.text),
    ...(project.drawings ?? []).flatMap((drawing) => [drawing.label, drawing.kind, drawing.color]),
    ...project.devices.flatMap((device) => [
      device.label,
      device.model,
      device.config.hostname,
      ...Object.entries(device.config.services).filter(([, enabled]) => enabled).map(([name]) => name),
      ...device.config.dhcpPools.flatMap((pool) => [pool.name, pool.network, pool.startIp, pool.defaultGateway, pool.dnsServer]),
      ...(device.config.dhcpExcludedRanges ?? []).flatMap((range) => [range.startIp, range.endIp ?? ""]),
      ...device.config.dnsRecords.flatMap((record) => [record.name, record.value]),
      ...device.ports.flatMap((port) => [port.name, port.ipAddress, port.gateway, port.dnsServer])
    ])
  ].join(" ").toLowerCase();
}

function isNoticeError(value: string): boolean {
  return (
    value.includes("없습니다") ||
    value.includes("수 없습니다") ||
    value.includes("못했습니다") ||
    value.includes("파일만") ||
    value.includes("지원하지 않습니다") ||
    value.includes("올바르지") ||
    value.includes("너무 큽니다") ||
    value.includes("확인") ||
    value.includes("실패")
  );
}

function workspaceStats(projects: NetworkProject[]): { devices: number; links: number; upLinks: number; services: number; events: number } {
  return projects.reduce((stats, project) => ({
    devices: stats.devices + project.devices.length,
    links: stats.links + project.links.length,
    upLinks: stats.upLinks + project.links.filter((link) => link.status === "up").length,
    services: stats.services + project.devices.reduce((count, device) => count + Object.values(device.config.services).filter(Boolean).length, 0),
    events: stats.events + project.simulationEvents.length
  }), { devices: 0, links: 0, upLinks: 0, services: 0, events: 0 });
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
