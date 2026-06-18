import { LogOut, Network, Plus, UserPlus } from "lucide-react";
import { TopologyPreview } from "./ProjectHome";
import type { User } from "../types/network";

export function LandingPage({
  user,
  onLogin,
  onSignup,
  onWorkspace,
  onLogout
}: {
  user: User | null;
  onLogin: () => void;
  onSignup: () => void;
  onWorkspace: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="home-shell home-landing">
      <header className="home-nav">
        <a className="home-brand" href="/" onClick={(event) => event.preventDefault()} aria-label="Network Editor Web 메인">
          <span className="app-mark"><Network size={20} /></span>
          <div>
            <strong>Network Editor</strong>
            <small>토폴로지 설계 도구</small>
          </div>
        </a>
        <div className="home-nav-actions">
          {user ? (
            <>
              <button className="secondary-action dark" onClick={onWorkspace} type="button">작업공간</button>
              <button className="icon-button" onClick={onLogout} title="로그아웃" type="button"><LogOut size={18} /></button>
            </>
          ) : (
            <>
              <button className="secondary-action dark" onClick={onLogin} type="button">로그인</button>
              <button className="primary-action" onClick={onSignup} type="button"><UserPlus size={17} />회원가입</button>
            </>
          )}
        </div>
      </header>

      <section className="home-hero public-hero">
        <div className="home-hero-copy">
          <p className="home-kicker">네트워크 토폴로지 빌더</p>
          <h1>처음 화면은 메인, 작업은 로그인 후 내 저장소에서.</h1>
          <p>장비 배치, 케이블 연결, 패킷 흐름 검증을 한 캔버스에서 다루고 프로젝트는 사용자별 작업공간에 저장합니다.</p>
          <div className="home-hero-actions">
            {user ? (
              <button className="primary-action" onClick={onWorkspace} type="button"><Network size={17} />내 작업공간</button>
            ) : (
              <>
                <button className="primary-action" onClick={onLogin} type="button"><Network size={17} />로그인하고 시작</button>
                <button className="secondary-action dark" onClick={onSignup} type="button"><Plus size={17} />계정 만들기</button>
              </>
            )}
          </div>
        </div>
        <TopologyPreview projects={user ? 1 : 0} />
      </section>
    </main>
  );
}
