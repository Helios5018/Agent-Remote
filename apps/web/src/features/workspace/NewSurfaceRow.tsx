import { useState } from "react";
import { AGENT_DISPLAY_NAME, AGENT_KINDS, type AgentKind, type CmuxPane } from "@car/protocol";
import { useAppStore } from "../../stores/AppStore.tsx";
import type { Route } from "../../hooks/useRouter.ts";

/**
 * 在这个 pane 里新开一个 tab。
 *
 * 只建 terminal：cmux 自己的 agent-session 面板读不到画面，从手机上打开会是一片空白。
 * 起 Agent 走服务端白名单（Claude / Codex / Grok / Pi），这边只能选，不能传命令。
 * 工作目录由服务端从同 pane 已有进程反查，所以手机上不用打路径。
 */
export function NewSurfaceRow({
  workspaceId,
  pane,
  navigate,
}: {
  workspaceId: string;
  pane: CmuxPane;
  navigate: (route: Route) => void;
}) {
  const { createSurface } = useAppStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 失败原因就地显示。顶部的 banner 在长列表里可能已经滚出屏幕，看不见等于没提示。
  const [note, setNote] = useState<string | null>(null);

  const create = async (launch: AgentKind | null) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await createSurface(pane.id ?? pane.ref, workspaceId, launch);
      setOpen(false);
      // 建完直接进会话页：新 tab 在 Mac 上没有被 focus，只能从这里看。
      navigate({ name: "session", surfaceId: result.surfaceId });
    } catch (caught) {
      setNote(`没建成：${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="pane-new">
        <button type="button" className="pane-new-trigger" onClick={() => setOpen(true)}>
          ＋ 新建 surface
        </button>
        {note ? <div className="pane-new-note">{note}</div> : null}
      </div>
    );
  }

  return (
    <div className="pane-new open">
      <button type="button" className="pane-new-option" disabled={busy} onClick={() => void create(null)}>
        Shell
      </button>
      {AGENT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="pane-new-option"
          disabled={busy}
          onClick={() => void create(kind)}
        >
          {AGENT_DISPLAY_NAME[kind]}
        </button>
      ))}
      <button type="button" className="pane-new-cancel" disabled={busy} onClick={() => setOpen(false)}>
        {busy ? "创建中…" : "取消"}
      </button>
      {note ? <div className="pane-new-note">{note}</div> : null}
    </div>
  );
}

