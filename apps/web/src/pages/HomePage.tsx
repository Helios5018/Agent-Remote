import { useEffect, useMemo, useState } from "react";
import type { AgentState, AttentionGroup, CmuxPane, CmuxSurface, CmuxWorkspace } from "@car/protocol";
import {
  AGENT_DISPLAY_NAME,
  STATUS_GLYPH,
  STATUS_LABEL,
  attentionGroupOf,
} from "@car/protocol";
import { formatAgo, formatDuration } from "@car/shared";
import { AgentRow } from "../components/AgentRow.tsx";
import { ControlToggle, TopBar } from "../components/TopBar.tsx";
import { agentsBySurface, useAppStore } from "../stores/AppStore.tsx";
import type { Route } from "../hooks/useRouter.ts";

/**
 * 首页（需求文档 §5 / §6）。
 *
 * 两个视图共用一页：
 *   结构 —— 直接按 cmux 的 Workspace → Pane → Surface 渲染，这是默认视图；
 *   关注 —— 按 NEEDS YOU / WORKING / IDLE 排序的 Attention Inbox。
 * 展开折叠状态与筛选条件存在 localStorage，刷新和重连都不会丢。
 */

const TREE_REFRESH_MS = 4000;
const PREFS_KEY = "car.home.prefs.v1";

type ViewMode = "tree" | "attention";

interface Prefs {
  view: ViewMode;
  /** 只显示跑着 Agent 的 surface。 */
  agentsOnly: boolean;
  /** 折叠起来的 workspace / pane key。 */
  collapsed: string[];
}

const DEFAULT_PREFS: Prefs = { view: "tree", agentsOnly: true, collapsed: [] };

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      view: parsed.view === "attention" ? "attention" : "tree",
      agentsOnly: parsed.agentsOnly !== false,
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed.filter((x) => typeof x === "string") : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const GROUP_TITLE: Record<AttentionGroup, string> = {
  NEEDS_YOU: "NEEDS YOU",
  WORKING: "WORKING",
  IDLE: "IDLE",
};

interface VisiblePane {
  pane: CmuxPane;
  key: string;
  surfaces: CmuxSurface[];
}

interface VisibleWorkspace {
  workspace: CmuxWorkspace;
  panes: VisiblePane[];
  counts: Record<AttentionGroup, number>;
  /** 被「只看 Agent」藏起来的 surface 数量。 */
  hidden: number;
}

export function HomePage({
  navigate,
  back,
  workspaceId,
}: {
  navigate: (route: Route) => void;
  back?: () => void;
  /** 只看某一个 workspace（来自 #/w/:id 深链）。 */
  workspaceId?: string;
}) {
  const { inbox, tree, refreshInbox, refreshTree, subscribe, connection } = useAppStore();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    subscribe(null);
  }, [subscribe]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 拓扑没有走 WebSocket 推送，这里自己轮询；页面切到后台就停，省电。
  useEffect(() => {
    void refreshTree();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshTree();
    }, TREE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshTree]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // 隐私模式下写不了 localStorage，不影响使用。
    }
  }, [prefs]);

  const agents = useMemo(() => agentsBySurface(inbox), [inbox]);
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const keyword = query.trim().toLowerCase();

  const model = useMemo<VisibleWorkspace[]>(() => {
    if (!tree) return [];
    const result: VisibleWorkspace[] = [];

    for (const workspace of tree.workspaces) {
      if (workspaceId && workspace.id !== workspaceId) continue;
      const workspaceHit =
        keyword.length === 0 ||
        workspace.title.toLowerCase().includes(keyword) ||
        workspace.ref.includes(keyword);

      const counts: Record<AttentionGroup, number> = { NEEDS_YOU: 0, WORKING: 0, IDLE: 0 };
      const panes: VisiblePane[] = [];
      let hidden = 0;

      for (const pane of workspace.panes) {
        const surfaces: CmuxSurface[] = [];
        for (const surface of pane.surfaces) {
          const agent = agents.get(surface.id);
          if (agent) counts[attentionGroupOf(agent.status)] += 1;

          if (prefs.agentsOnly && surface.agent === null && !agent) {
            hidden += 1;
            continue;
          }
          const surfaceHit =
            workspaceHit ||
            surface.title.toLowerCase().includes(keyword) ||
            surface.ref.includes(keyword);
          if (!surfaceHit) continue;
          surfaces.push(surface);
        }
        if (surfaces.length > 0) panes.push({ pane, key: pane.id ?? pane.ref, surfaces });
      }

      if (panes.length === 0) continue;
      result.push({ workspace, panes, counts, hidden });
    }
    return result;
  }, [tree, agents, prefs.agentsOnly, keyword, workspaceId]);

  const allKeys = useMemo(
    () => model.flatMap((item) => [item.workspace.id, ...item.panes.map((pane) => pane.key)]),
    [model],
  );
  // 只看 workspace 层：折在里面的 pane 不该影响「一键折叠 / 展开」的语义。
  const anyExpanded = model.some((item) => !collapsed.has(item.workspace.id));

  const toggle = (key: string) =>
    setPrefs((current) => {
      const next = new Set(current.collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, collapsed: [...next] };
    });

  const toggleAll = () =>
    setPrefs((current) => ({ ...current, collapsed: anyExpanded ? allKeys : [] }));

  const summary = inbox?.summary;
  const summaryText = summary
    ? [
        summary.needsYou > 0 ? `${summary.needsYou} 需要你` : null,
        summary.working > 0 ? `${summary.working} 运行中` : null,
        summary.error > 0 ? `${summary.error} 出错` : null,
        summary.idle > 0 ? `${summary.idle} 空闲` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "加载中…";

  const focusedWorkspace = workspaceId ? model[0]?.workspace : undefined;
  const title = focusedWorkspace ? focusedWorkspace.title : "Agents";
  // 搜索时强制展开，否则搜到的东西还藏在折叠里就没意义了。
  const forceExpand = keyword.length > 0;

  return (
    <div className="page">
      <TopBar title={title} subtitle={summaryText} onBack={back} right={<ControlToggle />} />

      <div className="view-switch">
        <button
          type="button"
          className={prefs.view === "tree" ? "on" : ""}
          onClick={() => setPrefs((current) => ({ ...current, view: "tree" }))}
        >
          结构
        </button>
        <button
          type="button"
          className={prefs.view === "attention" ? "on" : ""}
          onClick={() => setPrefs((current) => ({ ...current, view: "attention" }))}
        >
          关注{summary && summary.needsYou > 0 ? ` (${summary.needsYou})` : ""}
        </button>
      </div>

      {prefs.view === "tree" ? (
        <div className="tree-toolbar">
          <div className="tree-search-wrap">
            <input
              className="tree-search"
              value={query}
              placeholder="搜索 workspace / surface"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" className="tree-search-clear" onClick={() => setQuery("")} aria-label="清空">
                ✕
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={`chip-button ${prefs.agentsOnly ? "on" : ""}`}
            onClick={() => setPrefs((current) => ({ ...current, agentsOnly: !current.agentsOnly }))}
            title={prefs.agentsOnly ? "点击显示全部 surface" : "点击只看跑着 Agent 的 surface"}
          >
            {prefs.agentsOnly ? "只看 Agent" : "全部 surface"}
          </button>
          <button type="button" className="chip-button" onClick={toggleAll}>
            {anyExpanded ? "全部折叠" : "全部展开"}
          </button>
        </div>
      ) : null}

      <div className="scroll-area">
        {connection !== "open" ? (
          <div className="banner">连接中断，正在自动重连…（已退化为轮询）</div>
        ) : null}

        {prefs.view === "attention" ? (
          <AttentionView inbox={inbox} now={now} navigate={navigate} />
        ) : (
          <TreeView
            model={model}
            agents={agents}
            now={now}
            collapsed={collapsed}
            forceExpand={forceExpand}
            loading={!tree}
            keyword={keyword}
            onToggle={toggle}
            navigate={navigate}
          />
        )}

        <div className="footer-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              void refreshInbox();
              void refreshTree();
            }}
          >
            手动刷新
          </button>
          {workspaceId ? (
            <button type="button" className="ghost-button" onClick={() => navigate({ name: "inbox" })}>
              查看全部 workspace
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AttentionView({
  inbox,
  now,
  navigate,
}: {
  inbox: ReturnType<typeof useAppStore>["inbox"];
  now: number;
  navigate: (route: Route) => void;
}) {
  if (inbox && inbox.groups.length === 0) {
    return (
      <div className="empty">
        <p>还没有发现运行中的 Agent。</p>
        <p className="empty-hint">在 cmux 里启动 Claude / Codex / Grok 后会自动出现在这里。</p>
      </div>
    );
  }

  return (
    <>
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
    </>
  );
}

function TreeView({
  model,
  agents,
  now,
  collapsed,
  forceExpand,
  loading,
  keyword,
  onToggle,
  navigate,
}: {
  model: VisibleWorkspace[];
  agents: Map<string, AgentState>;
  now: number;
  collapsed: Set<string>;
  forceExpand: boolean;
  loading: boolean;
  keyword: string;
  onToggle: (key: string) => void;
  navigate: (route: Route) => void;
}) {
  if (loading) return <div className="empty">加载 cmux 结构中…</div>;

  if (model.length === 0) {
    return (
      <div className="empty">
        <p>{keyword ? "没有匹配的 workspace / surface。" : "没有可显示的 surface。"}</p>
        <p className="empty-hint">
          {keyword ? "换个关键词试试。" : "如果只是没在跑 Agent，可以点上面的「只看 Agent」切换成全部 surface。"}
        </p>
      </div>
    );
  }

  return (
    <>
      {model.map(({ workspace, panes, counts, hidden }) => {
        const expanded = forceExpand || !collapsed.has(workspace.id);
        const total = panes.reduce((sum, pane) => sum + pane.surfaces.length, 0);
        // 只有一个 pane 时不必再套一层，少一级缩进。
        const flat = panes.length === 1;

        return (
          <section className="ws-block" key={workspace.id}>
            <button type="button" className="ws-header" onClick={() => onToggle(workspace.id)}>
              <span className="caret">{expanded ? "▾" : "▸"}</span>
              <span className="ws-name">{workspace.title}</span>
              {workspace.selected ? <span className="chip chip-now">当前</span> : null}
              <span className="ws-counts">
                {counts.NEEDS_YOU > 0 ? (
                  <span className="chip chip-attention">{counts.NEEDS_YOU} 需要你</span>
                ) : null}
                {counts.WORKING > 0 ? <span className="chip chip-working">{counts.WORKING} 运行中</span> : null}
                {!expanded ? <span className="chip">{total} surface</span> : null}
                {/* 被「只看 Agent」藏起来的数量，提示这里还有东西没显示 */}
                {hidden > 0 ? (
                  <span className="chip chip-hidden" title={`还有 ${hidden} 个没有 Agent 的 surface`}>
                    +{hidden}
                  </span>
                ) : null}
              </span>
              <span className="mono dim ws-ref">{workspace.ref}</span>
            </button>

            {expanded
              ? panes.map(({ pane, key, surfaces }) => {
                  const paneExpanded = flat || forceExpand || !collapsed.has(key);
                  return (
                    <div className="pane-block" key={key}>
                      {flat ? null : (
                        <button type="button" className="pane-header" onClick={() => onToggle(key)}>
                          <span className="caret">{paneExpanded ? "▾" : "▸"}</span>
                          <span className="mono">{pane.ref}</span>
                          <span className="dim">· {surfaces.length} surface</span>
                          {pane.focused ? <span className="chip chip-now">焦点</span> : null}
                        </button>
                      )}
                      {paneExpanded
                        ? surfaces.map((surface) => (
                            <SurfaceRow
                              key={surface.id}
                              surface={surface}
                              agent={agents.get(surface.id)}
                              now={now}
                              onOpen={() => navigate({ name: "session", surfaceId: surface.id })}
                            />
                          ))
                        : null}
                    </div>
                  );
                })
              : null}

          </section>
        );
      })}
    </>
  );
}

const STATUS_TONE: Record<string, string> = {
  WORKING: "status-working",
  NEEDS_APPROVAL: "status-attention",
  NEEDS_INPUT: "status-attention",
  RESPONDED_UNREAD: "status-responded",
  IDLE: "status-idle",
  POSSIBLY_STALE: "status-stale",
  ERROR: "status-error",
  CLOSED: "status-closed",
};

function SurfaceRow({
  surface,
  agent,
  now,
  onOpen,
}: {
  surface: CmuxSurface;
  agent?: AgentState;
  now: number;
  onOpen: () => void;
}) {
  const kind = surface.agent ?? agent?.agent ?? null;
  const kindLabel = kind ? AGENT_DISPLAY_NAME[kind] : surface.type === "terminal" ? "Shell" : surface.type;
  const tone = agent ? STATUS_TONE[agent.status] : "status-idle";
  const glyph = agent ? STATUS_GLYPH[agent.status] : kind ? "○" : "·";
  const timing = agent
    ? agent.status === "WORKING" && agent.turnStartedAt
      ? formatDuration(now - agent.turnStartedAt)
      : formatAgo(agent.lastActivityAt, now)
    : "";

  return (
    <button type="button" className={`surface-row ${agent ? "" : "muted"}`} onClick={onOpen}>
      <span className={`surface-glyph ${tone}`}>{glyph}</span>
      <span className="surface-main">
        <span className="surface-title">{surface.title}</span>
        <span className="surface-meta">
          {kindLabel}
          {agent ? ` · ${STATUS_LABEL[agent.status]}` : ""}
          {agent?.currentActivity ? ` · ${agent.currentActivity}` : ""}
        </span>
      </span>
      <span className="surface-side">
        {timing ? <span>{timing}</span> : null}
        <span className="mono dim">{surface.ref}</span>
      </span>
    </button>
  );
}
