import { useEffect, useRef, useState } from "react";
import type { CmuxKey } from "@car/protocol";
import { DANGEROUS_KEY_HINT, isDangerousKey } from "@car/protocol";

interface KeyButton {
  key: CmuxKey;
  label: string;
  title: string;
}

/**
 * 按键条按用途分组，一行横向滑动。
 * 手机屏幕放不下这么多键，分组 + 横滑比换行更像原生键盘条。
 */
const KEY_GROUPS: KeyButton[][] = [
  [
    { key: "enter", label: "Enter", title: "回车 / 确认" },
    { key: "escape", label: "Esc", title: "取消 / 退出当前状态" },
    { key: "tab", label: "Tab", title: "补全 / 切换" },
  ],
  [
    { key: "up", label: "↑", title: "上（历史 / 选项）" },
    { key: "down", label: "↓", title: "下（历史 / 选项）" },
    { key: "left", label: "←", title: "左" },
    { key: "right", label: "→", title: "右" },
  ],
  [{ key: "ctrl+c", label: "Ctrl+C", title: DANGEROUS_KEY_HINT["ctrl+c"] ?? "中断" }],
];

function describeFailure(caught: unknown): string {
  const reason = caught instanceof Error ? caught.message : String(caught);
  return `没发出去：${reason}`;
}

export function Composer({
  disabled,
  collapsible = false,
  onSend,
  onKey,
}: {
  disabled: boolean;
  /** 沉浸模式下先收成一条，点开才展开 —— 输入框 + 按键条在手机上要吃掉小半屏。 */
  collapsible?: boolean;
  onSend: (text: string, submit: boolean) => Promise<void>;
  onKey: (key: CmuxKey, confirm: boolean) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pendingKey, setPendingKey] = useState<CmuxKey | null>(null);
  // 发送失败的原因就地显示：全局 error 会被紧随其后的刷新请求成功清掉，根本来不及看
  const [failure, setFailure] = useState<string | null>(null);
  // 中文输入法组字期间不能提交（需求文档 §26 中文输入）
  const [composing, setComposing] = useState(false);
  const keyBarRef = useRef<HTMLDivElement | null>(null);
  // 两端是否还有没滑到的键，用来决定要不要显示渐隐提示
  const [edges, setEdges] = useState({ start: false, end: false });

  const syncEdges = () => {
    const element = keyBarRef.current;
    if (!element) return;
    const start = element.scrollLeft > 4;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  };

  useEffect(() => {
    syncEdges();
    window.addEventListener("resize", syncEdges);
    return () => window.removeEventListener("resize", syncEdges);
  }, []);

  // 重新开启（或退出）控制模式就把上一次的失败提示收掉
  useEffect(() => setFailure(null), [disabled]);

  const send = async (submit: boolean) => {
    if (busy || disabled) return;
    const value = text;
    if (value.trim().length === 0 && submit === false) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSend(value, submit);
      // 只有确认发出去了才清空 —— 失败还清空的话，用户辛苦打的内容就白没了
      setText("");
    } catch (caught) {
      setFailure(describeFailure(caught));
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
    setFailure(null);
    try {
      await onKey(key, isDangerousKey(key));
    } catch (caught) {
      setFailure(describeFailure(caught));
    } finally {
      setBusy(false);
    }
  };

  if (collapsible && !expanded) {
    return (
      <div className="composer composer-collapsed">
        <button type="button" className="composer-expand" onClick={() => setExpanded(true)}>
          {disabled ? "只读模式 · 点这里展开输入区" : "点这里输入…"}
        </button>
      </div>
    );
  }

  return (
    <div className="composer">
      {collapsible ? (
        <button type="button" className="composer-collapse" onClick={() => setExpanded(false)} title="收起输入区">
          收起 ⌄
        </button>
      ) : null}
      {disabled ? <div className="composer-hint">只读模式：点击右上角 READ ONLY 开启控制</div> : null}
      {failure ? <div className="composer-hint danger-hint">{failure}</div> : null}
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

      <div
        className={`key-bar-wrap ${edges.start ? "fade-start" : ""} ${edges.end ? "fade-end" : ""}`}
      >
        <div className="key-bar" ref={keyBarRef} onScroll={syncEdges}>
          {KEY_GROUPS.map((group, groupIndex) => (
            <div className="key-group" key={group[0]?.key ?? groupIndex}>
              {group.map(({ key, label, title }) => (
                <button
                  type="button"
                  key={key}
                  title={title}
                  className={[
                    "key-button",
                    isDangerousKey(key) ? "danger" : "",
                    pendingKey === key ? "danger-armed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={disabled || busy}
                  onClick={() => void pressKey(key)}
                >
                  {pendingKey === key ? "确认?" : label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      {pendingKey ? (
        <div className="composer-hint danger-hint">
          {DANGEROUS_KEY_HINT[pendingKey] ?? "危险操作"}。再点一次「确认?」发送 {pendingKey}，或
          <button type="button" className="link-button" onClick={() => setPendingKey(null)}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
