import { useState } from "react";
import { ArrowRight, LogIn, Network, UserPlus, X } from "lucide-react";
import type { AppUser } from "../types/network";

interface Props {
  user: AppUser | null;
  onOpenWorkspace: () => void;
  onLogin: () => void;
  onRegister: () => void;
}

export default function LandingPage({ user, onOpenWorkspace, onLogin, onRegister }: Props) {
  const [authPromptOpen, setAuthPromptOpen] = useState(false);

  function start() {
    if (user) {
      onOpenWorkspace();
      return;
    }
    setAuthPromptOpen(true);
  }

  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <div className="landing-brand">
          <Network size={22} />
          <span>Network Editor Web</span>
        </div>
        <div className="landing-nav-actions">
          {user ? (
            <button className="landing-ghost" onClick={onOpenWorkspace}>내 작업실</button>
          ) : (
            <>
              <button className="landing-ghost" onClick={onLogin}>로그인</button>
              <button className="landing-solid" onClick={onRegister}>회원가입</button>
            </>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-kicker">Packet Tracer style network lab</span>
          <h1>Network Editor Web</h1>
          <p>라우터, 스위치, 방화벽, PC, 서버를 배치하고 케이블을 연결해 ARP, DHCP, DNS, HTTP, ACL 흐름을 웹에서 실습합니다.</p>
          <button className="landing-cta" onClick={start}>
            만들러가기
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <section className="landing-strip">
        <div>
          <strong>Topology</strong>
          <span>드래그 배치와 케이블 연결</span>
        </div>
        <div>
          <strong>Simulation</strong>
          <span>PDU 이벤트와 OSI 레이어 추적</span>
        </div>
        <div>
          <strong>CLI</strong>
          <span>IOS 스타일 설정 명령</span>
        </div>
      </section>

      {authPromptOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-required-title">
          <section className="auth-required-modal">
            <button className="modal-close" onClick={() => setAuthPromptOpen(false)} title="닫기">
              <X size={18} />
            </button>
            <h2 id="auth-required-title">로그인을 먼저 해주세요.</h2>
            <p>혹시 아이디가 없다면 회원가입하세요.</p>
            <div className="auth-choice-row">
              <button onClick={onLogin}>
                <LogIn size={18} />
                로그인하러가기
              </button>
              <button onClick={onRegister}>
                <UserPlus size={18} />
                회원가입하러가기
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
