import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentState } from "@car/protocol";
import { AGENT_DISPLAY_NAME, STATUS_LABEL } from "@car/protocol";
import { formatAgo, formatDuration } from "@car/shared";
import { Composer } from "../components/Composer.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { ControlToggle, TopBar } from "../components/TopBar.tsx";
import { findAgent, useAppStore } from "../stores/AppStore.tsx";

/** Agent 会话页（需求文档 §7）：使用频率最高的页面。 */
export function SessionPage({ surfaceId, back }: { surfaceId: string; back: () => void }) {
  const { inbox, contents, openSession, subscribe, sendInput, sendKey, refreshOutput, session, error } =
    useAppStore();
  const [agent, setAgent] = useState<AgentState | null>(() => findAgent(inbox, surfaceId) ?? null);
  const [now, setNow] = useState(() => Date.now());
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottom = useRef(true);

  const liveAgent = findAgent(inbox, surfaceId) ?? agent;
  const content = contents[surfaceId]?.content ?? "";
  const controlMode = session?.controlMode === true;

  // store 里的函数会随状态刷新而换引用；用 ref 固定住，
  // 否则一旦请求失败就会「失败 → 状态更新 → 重新请求」无限重试。
  const actionsRef = useRef({ openSession, subscribe });
  actionsRef.current = { openSession, subscribe };

  useEffect(() => {
    let cancelled = false;
    actionsRef.current.subscribe(surfaceId);
    void actionsRef.current.openSession(surfaceId).then((result) => {
      if (result && !cancelled) setAgent(result);
    });
    return () => {
      cancelled = true;
      actionsRef.current.subscribe(null);
    };
  }, [surfaceId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 只有用户本来就贴着底部时才自动滚动，避免打断向上翻阅
  useLayoutEffect(() => {
    const element = outputRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [content]);

  const onScroll = () => {
    const element = outputRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 40;
  };

  const title = liveAgent?.workspaceTitle || liveAgent?.surfaceTitle || surfaceId;
  const runningFor =
    liveAgent?.status === "WORKING" && liveAgent.turnStartedAt
      ? `Running ${formatDuration(now - liveAgent.turnStartedAt)}`
      : liveAgent
        ? `更新于 ${formatAgo(liveAgent.lastActivityAt, now)}`
        : "";

  return (
    <div className="page session-page">
      <TopBar title={title} subtitle={liveAgent?.surfaceRef ?? surfaceId} onBack={back} right={<ControlToggle />} />

      <div className="session-header">
        <div className="session-agent">{liveAgent ? AGENT_DISPLAY_NAME[liveAgent.agent] : "Agent"}</div>
        {liveAgent ? <StatusBadge status={liveAgent.status} /> : null}
        <div className="session-timing">{runningFor}</div>
        {liveAgent?.currentActivity ? <div className="session-activity">{liveAgent.currentActivity}</div> : null}
        {liveAgent?.status === "POSSIBLY_STALE" ? (
          <div className="session-warning">
            {STATUS_LABEL.POSSIBLY_STALE} · No activity for{" "}
            {Math.floor((now - liveAgent.lastActivityAt) / 60000)}m
          </div>
        ) : null}
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <pre className="output" ref={outputRef} onScroll={onScroll}>
        {content || "（暂无输出）"}
      </pre>

      <div className="session-tools">
        <button type="button" className="ghost-button" onClick={() => void refreshOutput(surfaceId)}>
          手动刷新
        </button>
        <span className="dim mono">rev {contents[surfaceId]?.revision ?? 0}</span>
      </div>

      <Composer
        disabled={!controlMode}
        onSend={async (text, submit) => {
          await sendInput(surfaceId, text, submit);
          await refreshOutput(surfaceId);
        }}
        onKey={async (key, confirm) => {
          await sendKey(surfaceId, key, confirm);
          await refreshOutput(surfaceId);
        }}
      />
    </div>
  );
}
