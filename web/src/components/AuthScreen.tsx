import { FormEvent, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { login, signup } from "../storage/repository";
import type { User } from "../types/network";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", email: "", birthDate: "", password: "", confirmPassword: "" });

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
    <main className="auth-shell">
      <section className="auth-panel">
        <header>
          <h1>Network Editor Web</h1>
          <p>라우터, 스위치, 방화벽, 서버, PC를 배치하고 실제 패킷 흐름을 검증합니다.</p>
        </header>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button"><LogIn size={16} />Login</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button"><UserPlus size={16} />Signup</button>
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
          {error && <strong className="form-error">{error}</strong>}
          <button className="primary-action" disabled={pending} type="submit">{pending ? "Working..." : mode === "login" ? "Login" : "Create account"}</button>
        </form>
      </section>
    </main>
  );
}
