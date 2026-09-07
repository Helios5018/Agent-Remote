import { useAppStore } from "../stores/AppStore.tsx";
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
import type { AgentKind, CmuxKey } from "@car/protocol";
import { DANGEROUS_KEY_HINT, isDangerousKey } from "@car/protocol";

/** 粘贴（或合成后的文本）达到这么多行，自动进展开编辑。 */
export const PASTE_EXPAND_LINES = 8;
/** 紧凑态自动长高上限：窗口高度的这一比例，再多就框内滚动。 */
export const AUTO_GROW_MAX_RATIO = 0.4;

export function countTextLines(text: string): number {
  if (text.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

export function shouldExpandEditorForText(text: string, threshold = PASTE_EXPAND_LINES): boolean {
  return countTextLines(text) >= threshold;
}

/** 把粘贴结果拼进当前选区，用来在 paste 事件里预判要不要放大。 */
export function applyPaste(text: string, pasted: string, start: number, end: number): string {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return text.slice(0, from) + pasted + text.slice(to);
}

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
];

const INTERRUPT_KEY: KeyButton = {
  key: "ctrl+c",
  label: "Ctrl+C",
  title: DANGEROUS_KEY_HINT["ctrl+c"] ?? "中断",
};

/** Pi 用 Ctrl+P 打开模型选择器；其他 Agent 不展示这个专属快捷键。 */
export function composerKeysForAgent(agentKind?: AgentKind | null): CmuxKey[] {
  return keyGroupsForAgent(agentKind).flatMap((group) => group.map(({ key }) => key));
}

function keyGroupsForAgent(agentKind?: AgentKind | null): KeyButton[][] {
  return [
    ...KEY_GROUPS,
    [
      INTERRUPT_KEY,
      ...(agentKind === "pi"
        ? [{ key: "ctrl+p" as const, label: "Ctrl+P", title: "切换 Pi 模型" }]
        : []),
    ],
  ];
}

/** 输入框角上的放大/还原标记，不要做成独立大按钮。 */
function SizeGlyph({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d={
          expanded
            ? "M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"
            : "M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Composer({
  surfaceId,
  collapsible = false,
  agentKind,
  onSend,
  onKey,
}: {
  surfaceId: string;
  /** 沉浸模式下先收成一条，点开才展开 —— 输入框 + 按键条在手机上要吃掉小半屏。 */
  collapsible?: boolean;
  /** Pi 会额外显示用于快速切换模型的 Ctrl+P。 */
  agentKind?: AgentKind | null;
  onSend: (text: string, submit: boolean) => Promise<void>;
  onKey: (key: CmuxKey, confirm: boolean) => Promise<void>;
}) {
  const { drafts } = useAppStore();
  const subscribeDraft = useCallback((listener: () => void) => drafts.subscribe(surfaceId, listener), [drafts, surfaceId]);
  const snapshot = useCallback(() => drafts.get(surfaceId), [drafts, surfaceId]);
  const draft = useSyncExternalStore(subscribeDraft, snapshot, snapshot);
  const { text, busy, message: failure, uncertain, textWritten } = draft;
  const setText = (value: string) => drafts.edit(surfaceId, value);
  const [expanded, setExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<CmuxKey | null>(null);
  // 中文输入法组字期间不能提交（需求文档 §26 中文输入）
  const [composing, setComposing] = useState(false);
  const keyBarRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  const syncTextareaHeight = () => {
    const element = textareaRef.current;
    if (!element) return;
    if (editorOpen) {
      element.style.height = "";
      element.style.overflowY = "auto";
      return;
    }
    element.style.height = "auto";
    const maxPx = Math.round(window.innerHeight * AUTO_GROW_MAX_RATIO);
    const next = Math.min(element.scrollHeight, maxPx);
    element.style.height = `${next}px`;
    element.style.overflowY = element.scrollHeight > maxPx ? "auto" : "hidden";
  };

  useLayoutEffect(syncTextareaHeight, [text, editorOpen]);

  useEffect(() => {
    window.addEventListener("resize", syncTextareaHeight);
    return () => window.removeEventListener("resize", syncTextareaHeight);
  }, [editorOpen]);

  // 展开编辑时按可视视口封顶，避开 iOS 键盘把 Send 顶没
  useEffect(() => {
    const root = composerRef.current;
    if (!root || !editorOpen) return;
    const apply = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const ratio = mobile ? 0.8 : 0.62;
      root.style.setProperty("--composer-sheet-max", `${Math.max(240, Math.round(height * ratio))}px`);
    };
    apply();
    window.visualViewport?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    return () => {
      window.visualViewport?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--composer-sheet-max");
    };
  }, [editorOpen]);

  useEffect(() => {
    if (editorOpen || (collapsible && expanded)) textareaRef.current?.focus();
  }, [editorOpen, collapsible, expanded]);

  const send = async (submit: boolean) => {
    if (busy || uncertain) return;
    if (text.trim().length === 0 && submit === false) return;
    if (await drafts.run(surfaceId, () => onSend(text, submit), true)) setEditorOpen(false);
  };

  const pressKey = async (key: CmuxKey) => {
    if (busy || uncertain) return;
    if (isDangerousKey(key) && pendingKey !== key) {
      setPendingKey(key);
      return;
    }
    setPendingKey(null);
    await drafts.run(surfaceId, () => onKey(key, isDangerousKey(key)), false);
  };

  const feedback = failure ? (
    <div className={`composer-hint${uncertain ? " danger-hint" : ""}`} role="status">
      {failure}
      {uncertain ? <div className="composer-recovery-actions">
        {textWritten ? <button type="button" disabled={busy} onClick={() => {
          void drafts.run(surfaceId, () => onSend("", true), true, true);
        }}>已核对，仅补发 Enter</button> : null}
        {!draft.keyUncertain ? <button type="button" disabled={busy} onClick={() => drafts.resolve(surfaceId, true)}>终端已接收，清除草稿</button> : null}
        <button type="button" disabled={busy} onClick={() => drafts.resolve(surfaceId, false)}>{draft.keyUncertain ? "已核对，继续操作" : "终端未接收，继续编辑"}</button>
      </div> : null}
    </div>
  ) : null;

  if (collapsible && !expanded) {
    const preview = text.trim().length > 0 ? text.trim().replace(/\s+/g, " ").slice(0, 40) : "";
    return (
      <div className="composer composer-collapsed">
        {feedback}
        <button type="button" className="composer-expand" onClick={() => setExpanded(true)}>
          {preview
            ? `继续编辑：${preview}${text.trim().length > 40 ? "…" : ""}`
            : "点这里输入…"}
        </button>
      </div>
    );
  }

  return (
    <div ref={composerRef} className={`composer${editorOpen ? " composer-editor-open" : ""}`}>
      {feedback}
      <div className="composer-input-row">
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={text}
            rows={2}
            maxLength={20000}
            placeholder="输入消息……"
            disabled={busy || uncertain}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData?.getData("text") ?? "";
              const target = event.currentTarget;
              const next = applyPaste(text, pasted, target.selectionStart ?? text.length, target.selectionEnd ?? text.length);
              if (shouldExpandEditorForText(next)) setEditorOpen(true);
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composing) {
                event.preventDefault();
                void send(true);
                return;
              }
              if (event.key === "Escape" && editorOpen && !composing) {
                event.preventDefault();
                setEditorOpen(false);
              }
            }}
          />
          <div className="composer-input-tools">
            <button
              type="button"
              className="composer-size-toggle"
              title={editorOpen ? "还原输入区" : "放大输入区"}
              aria-label={editorOpen ? "还原输入区" : "放大输入区"}
              aria-expanded={editorOpen}
              onClick={() => setEditorOpen((current) => !current)}
            >
              <SizeGlyph expanded={editorOpen} />
            </button>
            {collapsible ? (
              <button
                type="button"
                className="composer-collapse"
                onClick={() => {
                  setEditorOpen(false);
                  setExpanded(false);
                }}
                title="收起输入区，保留草稿"
                aria-label="收起输入区"
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="m4 6 4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <div className="composer-actions">
          <button
            type="button"
            className="send-button"
            disabled={busy || uncertain || text.trim().length === 0}
            onClick={() => void send(true)}
          >
            Send
          </button>
        </div>
      </div>

      <div
        className={`key-bar-wrap ${edges.start ? "fade-start" : ""} ${edges.end ? "fade-end" : ""}`}
      >
        <div className="key-bar" ref={keyBarRef} onScroll={syncEdges}>
          {keyGroupsForAgent(agentKind).map((group, groupIndex) => (
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
                  disabled={busy || uncertain}
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
