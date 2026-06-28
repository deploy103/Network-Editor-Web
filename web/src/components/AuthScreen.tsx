import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, LogIn, Moon, Network, RefreshCw, ShieldCheck, Sun, UserPlus } from "lucide-react";
import { login, signup } from "../storage/repository";
import type { User } from "../types/network";

export function AuthScreen({
  initialMode = "login",
  onAuthenticated,
  onBack,
  onModeChange,
  onThemeToggle,
  theme
}: {
  initialMode?: "login" | "signup";
  onAuthenticated: (user: User) => void;
  onBack?: () => void;
  onModeChange?: (mode: "login" | "signup") => void;
  onThemeToggle: () => void;
  theme: "light" | "dark";
}) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [form, setForm] = useState({ name: "", username: "", email: "", birthDate: "", password: "", confirmPassword: "", captcha: "", remember: false });

  useEffect(() => {
    setMode(initialMode);
    setError("");
  }, [initialMode]);

  function switchMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setError("");
    setCaptcha(createCaptcha());
    setForm((current) => ({ ...current, captcha: "" }));
    onModeChange?.(nextMode);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const normalizedForm = {
        ...form,
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        birthDate: form.birthDate.trim()
      };
      if (mode === "login" && Number(normalizedForm.captcha.trim()) !== captcha.answer) {
        setCaptcha(createCaptcha());
        setForm((current) => ({ ...current, captcha: "" }));
        throw new Error("CAPTCHA 확인값이 올바르지 않습니다.");
      }
      const user = mode === "login" ? await login(normalizedForm.username, normalizedForm.password, normalizedForm.remember) : await signup(normalizedForm);
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
        <div className="auth-card-actions">
          <a className="auth-back-link" href="/" onClick={(event) => { event.preventDefault(); onBack?.(); }}><ArrowLeft size={15} />메인으로</a>
          <button className="icon-button" onClick={onThemeToggle} title={theme === "dark" ? "Light mode" : "Dark mode"} type="button">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
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
            <>
              <div className="auth-check-box auth-captcha-box">
                <span>CAPTCHA</span>
                <strong><ShieldCheck size={18} />{captcha.a} + {captcha.b}</strong>
                <input inputMode="numeric" maxLength={3} placeholder="답" value={form.captcha} onChange={(event) => setForm({ ...form, captcha: event.target.value.replace(/\D/g, "") })} />
                <button className="icon-button" onClick={() => { setCaptcha(createCaptcha()); setForm({ ...form, captcha: "" }); }} title="CAPTCHA 새로고침" type="button"><RefreshCw size={16} /></button>
              </div>
              <label className="auth-remember"><input checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} type="checkbox" />로그인 유지하기</label>
            </>
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

function createCaptcha(): { a: number; b: number; answer: number } {
  const a = Math.floor(Math.random() * 9) + 3;
  const b = Math.floor(Math.random() * 8) + 2;
  return { a, b, answer: a + b };
}
