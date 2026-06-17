import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, LogIn, UserPlus } from "lucide-react";
import type { AppUser } from "../types/network";
import { loginUser, registerUser } from "../auth/authStore";

interface Props {
  onAuthenticated: (user: AppUser) => void;
  initialMode?: "login" | "register";
  onBack?: () => void;
}

const blankRegister = {
  name: "",
  username: "",
  email: "",
  birthDate: "",
  password: "",
  confirmPassword: "",
};

export default function AuthScreen({ onAuthenticated, initialMode = "login", onBack }: Props) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [login, setLogin] = useState({ username: "", password: "" });
  const [register, setRegister] = useState(blankRegister);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError("");
  }, [initialMode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = mode === "login" ? await loginUser(login) : await registerUser(register);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        {onBack && (
          <button className="auth-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
            소개로 돌아가기
          </button>
        )}
        <div className="auth-mark">
          <LockKeyhole size={28} />
        </div>
        <h1>Network Editor Web</h1>
        <form onSubmit={submit} className="form-grid">
          {mode === "register" && (
            <>
              <label>
                이름
                <input value={register.name} onChange={(event) => setRegister({ ...register, name: event.target.value })} autoComplete="name" />
              </label>
              <label>
                이메일
                <input value={register.email} onChange={(event) => setRegister({ ...register, email: event.target.value })} autoComplete="email" />
              </label>
              <label>
                생년월일
                <input type="date" value={register.birthDate} onChange={(event) => setRegister({ ...register, birthDate: event.target.value })} />
              </label>
            </>
          )}
          <label>
            아이디
            <input
              value={mode === "login" ? login.username : register.username}
              onChange={(event) =>
                mode === "login" ? setLogin({ ...login, username: event.target.value }) : setRegister({ ...register, username: event.target.value })
              }
              autoComplete="username"
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={mode === "login" ? login.password : register.password}
              onChange={(event) =>
                mode === "login" ? setLogin({ ...login, password: event.target.value }) : setRegister({ ...register, password: event.target.value })
              }
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {mode === "register" && (
            <label>
              비밀번호 확인
              <input
                type="password"
                value={register.confirmPassword}
                onChange={(event) => setRegister({ ...register, confirmPassword: event.target.value })}
                autoComplete="new-password"
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" disabled={busy}>
            {mode === "login" ? <LogIn size={18} /> : <UserPlus size={18} />}
            {mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>
        <button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "회원가입으로 전환" : "로그인으로 전환"}
        </button>
      </section>
    </main>
  );
}
