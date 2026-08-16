import { useState } from "react";
import { useAppStore } from "../stores/AppStore.tsx";

export function LoginPage() {
  const { login, error } = useAppStore();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || token.trim().length === 0) return;
    setBusy(true);
    try {
      await login(token.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <h1>CMUX Agent Remote</h1>
        <p className="login-hint">输入启动服务时打印的 Access Token</p>
        <input
          className="login-input"
          value={token}
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ACCESS TOKEN"
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
        <button type="button" className="primary-button" disabled={busy} onClick={() => void submit()}>
          {busy ? "登录中…" : "登录"}
        </button>
        {error ? <div className="login-error">{error}</div> : null}
      </div>
    </div>
  );
}
