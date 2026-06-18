import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, LogIn, Network, ShieldCheck, UserPlus } from "lucide-react";
import { login, signup } from "../storage/repository";
import type { User } from "../types/network";

export function AuthScreen({
  initialMode = "login",
  onAuthenticated,
  onBack,
  onModeChange
}: {
  initialMode?: "login" | "signup";
  onAuthenticated: (user: User) => void;
  onBack?: () => void;
  onModeChange?: (mode: "login" | "signup") => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", email: "", birthDate: "", password: "", confirmPassword: "" });

  useEffect(() => {
    setMode(initialMode);
    setError("");
  }, [initialMode]);

  function switchMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setError("");
    onModeChange?.(nextMode);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const user = mode === "login" ? await login(form.username, form.password) : await signup(form);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell auth-refined">
      <section className={`auth-panel auth-card ${mode === "signup" ? "auth-card-wide" : ""}`}>
        <a className="auth-back-link" href="/" onClick={(event) => { event.preventDefault(); onBack?.(); }}><ArrowLeft size={15} />메인으로</a>
        <header>
          <span className="app-mark"><Network size={20} /></span>
          <p className="auth-eyebrow">{mode === "login" ? "계정 로그인" : "새 계정 생성"}</p>
          <h1>{mode === "login" ? "로그인" : "회원가입"}</h1>
          <p>네트워크 토폴로지를 설계하고 패킷 흐름을 검증하는 작업 공간입니다.</p>
        </header>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")} type="button"><LogIn size={16} />로그인</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")} type="button"><UserPlus size={16} />회원가입</button>
        </div>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <>
              <input maxLength={80} placeholder="이름" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              <input maxLength={120} placeholder="이메일" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              <input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} />
            </>
          )}
          <input maxLength={40} placeholder="아이디" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input maxLength={80} placeholder="비밀번호" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          {mode === "signup" && <input maxLength={80} placeholder="비밀번호 확인" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />}
          {mode === "login" && (
            <div className="auth-check-box">
              <span>보안 확인</span>
              <strong><ShieldCheck size={18} />랩 준비 완료</strong>
            </div>
          )}
          {error && <strong className="form-error">{error}</strong>}
          <button className="primary-action" disabled={pending} type="submit">{pending ? "처리 중..." : mode === "login" ? "로그인" : "계정 만들기"}</button>
        </form>
        <p className="auth-sub-link">
          {mode === "login" ? "아직 계정이 없으면 " : "이미 계정이 있으면 "}
          <button onClick={() => switchMode(mode === "login" ? "signup" : "login")} type="button">{mode === "login" ? "회원가입" : "로그인"}</button>
        </p>
      </section>
    </main>
  );
}
