import { useEffect, useState } from "react";
import type { AttentionGroup } from "@car/protocol";
import { AgentRow } from "../components/AgentRow.tsx";
import { ControlToggle, TopBar } from "../components/TopBar.tsx";
import { useAppStore } from "../stores/AppStore.tsx";
import type { Route } from "../hooks/useRouter.ts";

const GROUP_TITLE: Record<AttentionGroup, string> = {
  NEEDS_YOU: "NEEDS YOU",
  WORKING: "WORKING",
  IDLE: "IDLE",
};

/** 首页：Attention Inbox（需求文档 §5.1）。 */
export function InboxPage({ navigate }: { navigate: (route: Route) => void }) {
  const { inbox, refreshInbox, subscribe, connection } = useAppStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    subscribe(null);
  }, [subscribe]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = inbox?.summary;
  const summaryText = summary
    ? [
        summary.needsYou > 0 ? `${summary.needsYou} Need You` : null,
        summary.working > 0 ? `${summary.working} Working` : null,
        summary.error > 0 ? `${summary.error} Error` : null,
        summary.idle > 0 ? `${summary.idle} Idle` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "加载中…";

  return (
    <div className="page">
      <TopBar title="Agents" subtitle={summaryText} right={<ControlToggle />} />

      <div className="scroll-area">
        {connection !== "open" ? (
          <div className="banner">连接中断，正在自动重连…（已退化为轮询）</div>
        ) : null}

        {inbox && inbox.groups.length === 0 ? (
          <div className="empty">
            <p>还没有发现运行中的 Agent。</p>
            <p className="empty-hint">在 cmux 里启动 Claude / Codex / Grok 后会自动出现在这里。</p>
          </div>
        ) : null}

        {inbox?.groups.map((group) => (
          <section className="group" key={group.group}>
            <h2 className="group-title">{GROUP_TITLE[group.group]}</h2>
            {group.agents.map((agent) => (
              <AgentRow
                key={agent.surfaceId}
                agent={agent}
                now={now}
                onOpen={(surfaceId) => navigate({ name: "session", surfaceId })}
              />
            ))}
          </section>
        ))}

        <div className="footer-actions">
          <button type="button" className="ghost-button" onClick={() => void refreshInbox()}>
            手动刷新
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate({ name: "workspace", workspaceId: "all" })}
          >
            查看 cmux 结构
          </button>
        </div>
      </div>
    </div>
  );
}
