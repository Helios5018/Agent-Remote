import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentState } from "@car/protocol";
import { AGENT_DISPLAY_NAME, STATUS_LABEL } from "@car/protocol";
import { formatAgo, formatDuration } from "@car/shared";
import { Composer } from "../components/Composer.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { TerminalGrid, type GridLayout } from "../components/TerminalGrid.tsx";
import { ControlToggle, TopBar } from "../components/TopBar.tsx";
import { findAgent, findSurface, useAppStore } from "../stores/AppStore.tsx";
import type { Route } from "../hooks/useRouter.ts";

const LAYOUT_KEY = "car.session.layout.v1";

/** Agent 会话页（需求文档 §7）：使用频率最高的页面。 */
export function SessionPage({
  surfaceId,
  back,
  navigate,
}: {
  surfaceId: string;
  back: () => void;
  navigate: (route: Route) => void;
}) {
  const {
    inbox,
    tree,
    grids,
    openSession,
    subscribe,
    sendInput,
    sendKey,
    refreshGrid,
    refreshTree,
    session,
    error,
  } = useAppStore();
  const [agent, setAgent] = useState<AgentState | null>(() => findAgent(inbox, surfaceId) ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [layoutPref, setLayoutPref] = useState<GridLayout | "auto">(readLayoutPref);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const liveAgent = findAgent(inbox, surfaceId) ?? agent;
  const placement = findSurface(tree, surfaceId);
  const grid = grids[surfaceId];
  const controlMode = session?.controlMode === true;

  // 自动：全屏 TUI 等比缩放保住边框，普通输出按屏宽软换行
  const layout: GridLayout = layoutPref === "auto" ? (grid?.altScreen ? "fit" : "flow") : layoutPref;

  // store 里的函数会随状态刷新而换引用；用 ref 固定住，
  // 否则一旦请求失败就会「失败 → 状态更新 → 重新请求」无限重试。
  const actionsRef = useRef({ openSession, subscribe, refreshTree, refreshGrid });
  actionsRef.current = { openSession, subscribe, refreshTree, refreshGrid };

  useEffect(() => {
    let cancelled = false;
    actionsRef.current.subscribe(surfaceId);
    // 直接从 #/s/:id 进来时树还没拉过，标题要靠它。
    void actionsRef.current.refreshTree();
    void actionsRef.current.refreshGrid(surfaceId);
    void actionsRef.current.openSession(surfaceId).then((result) => {
      if (result && !cancelled) setAgent(result);
    });
    return () => {
      cancelled = true;
      actionsRef.current.subscribe(null);
    };
  }, [surfaceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, layoutPref);
    } catch {
      // 隐私模式写不了，忽略
    }
  }, [layoutPref]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 只有用户本来就贴着底部时才自动滚动，避免打断向上翻阅
  useLayoutEffect(() => {
    const element = outputRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [grid?.revision, layout]);

  const onScroll = () => {
    const element = outputRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 40;
  };

  // 主标题用 surface 名，workspace 名放到副标题里做归属说明。
  const title = liveAgent?.surfaceTitle || placement?.surface.title || liveAgent?.surfaceRef || surfaceId;
  const workspaceTitle = liveAgent?.workspaceTitle ?? placement?.workspace.title;
  const workspaceId = liveAgent?.workspaceId ?? placement?.workspace.id;
  const surfaceRef = liveAgent?.surfaceRef ?? placement?.surface.ref ?? surfaceId;
  const kindLabel = liveAgent
    ? AGENT_DISPLAY_NAME[liveAgent.agent]
    : placement?.surface.type === "terminal" || !placement
      ? "Shell"
      : placement.surface.type;

  const runningFor =
    liveAgent?.status === "WORKING" && liveAgent.turnStartedAt
      ? `Running ${formatDuration(now - liveAgent.turnStartedAt)}`
      : liveAgent
        ? `更新于 ${formatAgo(liveAgent.lastActivityAt, now)}`
        : "";

  return (
    <div className="page session-page">
      <TopBar title={title} subtitle={surfaceRef} onBack={back} right={<ControlToggle />} />

      <div className="session-header">
        <div className="session-agent">{kindLabel}</div>
        {liveAgent ? <StatusBadge status={liveAgent.status} /> : null}
        {workspaceTitle ? (
          <button
            type="button"
            className="ws-chip ws-chip-button"
            title="查看该 workspace 的结构"
            onClick={() => (workspaceId ? navigate({ name: "workspace", workspaceId }) : undefined)}
          >
            ▤ {workspaceTitle}
          </button>
        ) : null}
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

      <div className="output" ref={outputRef} onScroll={onScroll}>
        {grid ? (
          <TerminalGrid grid={grid} layout={layout} />
        ) : (
          <div className="output-empty dim">（正在读取终端画面…）</div>
        )}
      </div>

      <div className="session-tools">
        <button type="button" className="ghost-button" onClick={() => void refreshGrid(surfaceId)}>
          手动刷新
        </button>
        <div className="session-tools-right">
          {grid ? (
            <span className="dim mono">
              {grid.columns}×{grid.viewportRows}
              {grid.altScreen ? " · TUI" : ""}
            </span>
          ) : null}
          <button
            type="button"
            className="chip-button"
            title={
              layoutPref === "auto"
                ? "当前：自动（TUI 缩放 / 普通输出换行）"
                : layoutPref === "fit"
                  ? "当前：整屏缩放到屏宽"
                  : "当前：按屏宽换行"
            }
            onClick={() =>
              setLayoutPref((current) =>
                current === "auto" ? "fit" : current === "fit" ? "flow" : "auto",
              )
            }
          >
            {layoutPref === "auto" ? "自动" : layoutPref === "fit" ? "缩放" : "换行"}
          </button>
        </div>
      </div>

      <Composer
        disabled={!controlMode}
        onSend={async (text, submit) => {
          await sendInput(surfaceId, text, submit);
          await refreshGrid(surfaceId);
        }}
        onKey={async (key, confirm) => {
          await sendKey(surfaceId, key, confirm);
          await refreshGrid(surfaceId);
        }}
      />
    </div>
  );
}

function readLayoutPref(): GridLayout | "auto" {
  try {
    const saved = window.localStorage.getItem(LAYOUT_KEY);
    if (saved === "fit" || saved === "flow") return saved;
  } catch {
    // 读不到就用自动
  }
  return "auto";
}
