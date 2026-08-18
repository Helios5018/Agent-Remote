import type { AgentState } from "@car/protocol";
import { AGENT_DISPLAY_NAME } from "@car/protocol";
import { formatAgo, formatDuration } from "@car/shared";
import { StatusBadge } from "./StatusBadge.tsx";

/** 主标题用 surface 名（就是终端标签上那行字），workspace 名作为归属信息跟在后面。 */
export function agentTitle(agent: AgentState): string {
  return agent.surfaceTitle || agent.workspaceTitle || agent.surfaceRef || agent.surfaceId;
}

/** workspace 名与 surface 名相同时没必要重复展示。 */
export function agentWorkspaceLabel(agent: AgentState): string | null {
  const workspace = agent.workspaceTitle || agent.workspaceRef;
  if (!workspace || workspace === agentTitle(agent)) return null;
  return workspace;
}

export function AgentRow({
  agent,
  now,
  onOpen,
}: {
  agent: AgentState;
  now: number;
  onOpen: (surfaceId: string) => void;
}) {
  const workspace = agentWorkspaceLabel(agent);
  const timing =
    agent.status === "WORKING" && agent.turnStartedAt
      ? formatDuration(now - agent.turnStartedAt)
      : formatAgo(agent.lastActivityAt, now);

  return (
    <button type="button" className="agent-row" onClick={() => onOpen(agent.surfaceId)}>
      <div className="agent-row-main">
        <div className="agent-row-title">{agentTitle(agent)}</div>
        <div className="agent-row-meta">
          {workspace ? <span className="ws-chip">▤ {workspace}</span> : null}
          <span className="agent-kind">{AGENT_DISPLAY_NAME[agent.agent]}</span>
          <span className="dot">·</span>
          <StatusBadge status={agent.status} />
        </div>
        {agent.currentActivity ? <div className="agent-row-activity">{agent.currentActivity}</div> : null}
      </div>
      <div className="agent-row-side">
        <div className="agent-row-time">{timing}</div>
        <div className="agent-row-surface">{agent.surfaceRef ?? ""}</div>
      </div>
    </button>
  );
}
