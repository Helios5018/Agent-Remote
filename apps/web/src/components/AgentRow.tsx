import type { AgentState } from "@car/protocol";
import { AGENT_DISPLAY_NAME } from "@car/protocol";
import { formatAgo, formatDuration } from "@car/shared";
import { StatusBadge } from "./StatusBadge.tsx";

export function AgentRow({
  agent,
  now,
  onOpen,
}: {
  agent: AgentState;
  now: number;
  onOpen: (surfaceId: string) => void;
}) {
  const title = agent.workspaceTitle || agent.surfaceTitle || agent.surfaceRef || agent.surfaceId;
  const timing =
    agent.status === "WORKING" && agent.turnStartedAt
      ? formatDuration(now - agent.turnStartedAt)
      : formatAgo(agent.lastActivityAt, now);

  return (
    <button type="button" className="agent-row" onClick={() => onOpen(agent.surfaceId)}>
      <div className="agent-row-main">
        <div className="agent-row-title">{title}</div>
        <div className="agent-row-meta">
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
