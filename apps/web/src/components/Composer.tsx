import { useState } from "react";
import type { CmuxKey } from "@car/protocol";
import { isDangerousKey } from "@car/protocol";

const KEYS: Array<{ key: CmuxKey; label: string }> = [
  { key: "enter", label: "Enter" },
  { key: "escape", label: "Esc" },
  { key: "tab", label: "Tab" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "ctrl+c", label: "Ctrl+C" },
];

export function Composer({
  disabled,
  onSend,
  onKey,
}: {
  disabled: boolean;
  onSend: (text: string, submit: boolean) => Promise<void>;
  onKey: (key: CmuxKey, confirm: boolean) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<CmuxKey | null>(null);
  // 中文输入法组字期间不能提交（需求文档 §26 中文输入）
  const [composing, setComposing] = useState(false);

  const send = async (submit: boolean) => {
    if (busy || disabled) return;
    const value = text;
    if (value.trim().length === 0 && submit === false) return;
    setBusy(true);
    try {
      await onSend(value, submit);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const pressKey = async (key: CmuxKey) => {
    if (busy || disabled) return;
    // 危险操作二次确认（需求文档 §23.4）
    if (isDangerousKey(key) && pendingKey !== key) {
      setPendingKey(key);
      return;
    }
    setPendingKey(null);
    setBusy(true);
    try {
      await onKey(key, isDangerousKey(key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      {disabled ? <div className="composer-hint">只读模式：点击右上角 READ ONLY 开启控制</div> : null}
      <div className="composer-input-row">
        <textarea
          className="composer-input"
          value={text}
          rows={2}
          placeholder="输入消息……"
          disabled={disabled || busy}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composing) {
              event.preventDefault();
              void send(true);
            }
          }}
        />
        <button
          type="button"
          className="send-button"
          disabled={disabled || busy || text.trim().length === 0}
          onClick={() => void send(true)}
        >
          Send
        </button>
      </div>

      <div className="key-bar">
        {KEYS.map(({ key, label }) => (
          <button
            type="button"
            key={key}
            className={`key-button ${pendingKey === key ? "danger-armed" : ""} ${isDangerousKey(key) ? "danger" : ""}`}
            disabled={disabled || busy}
            onClick={() => void pressKey(key)}
          >
            {pendingKey === key ? "确认?" : label}
          </button>
        ))}
      </div>
      {pendingKey ? (
        <div className="composer-hint danger-hint">
          再点一次「确认?」发送 {pendingKey}，或
          <button type="button" className="link-button" onClick={() => setPendingKey(null)}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
