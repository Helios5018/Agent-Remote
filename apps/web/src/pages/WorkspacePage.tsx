import { useEffect, useState } from "react";
import type { CmuxTree } from "@car/protocol";
import { AGENT_DISPLAY_NAME, STATUS_GLYPH, STATUS_LABEL } from "@car/protocol";
import { TopBar } from "../components/TopBar.tsx";
import { api } from "../api.ts";
import { findAgent, useAppStore } from "../stores/AppStore.tsx";
import type { Route } from "../hooks/useRouter.ts";

/**
 * Workspace 页（需求文档 §6）：展示 cmux 的真实结构，
 * 回答「这个 Agent 实际位于哪个 cmux Surface？」
 */
export function WorkspacePage({
  workspaceId,
  navigate,
  back,
}: {
  workspaceId: string;
  navigate: (route: Route) => void;
  back: () => void;
}) {
  const { inbox, subscribe } = useAppStore();
  const [tree, setTree] = useState<CmuxTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    subscribe(null);
  }, [subscribe]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.tree();
        if (!cancelled) setTree(result);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const workspaces =
    workspaceId === "all"
      ? (tree?.workspaces ?? [])
      : (tree?.workspaces.filter((workspace) => workspace.id === workspaceId) ?? []);

  const title = workspaceId === "all" ? "cmux 结构" : (workspaces[0]?.title ?? "Workspace");

  return (
    <div className="page">
      <TopBar title={title} subtitle="Workspace → Pane → Surface" onBack={back} />
      <div className="scroll-area">
        {error ? <div className="banner error">{error}</div> : null}
        {!tree ? <div className="empty">加载中…</div> : null}

        {workspaces.map((workspace) => (
          <section className="group" key={workspace.id}>
            <h2 className="group-title">
              {workspace.title} <span className="mono dim">{workspace.ref}</span>
            </h2>

            {workspace.panes.map((pane) => (
              <div className="pane-block" key={pane.ref}>
                <div className="pane-title mono">▼ {pane.ref}</div>
                {pane.surfaces.map((surface) => {
                  const agent = findAgent(inbox, surface.id);
                  const clickable = surface.agent !== null;
                  return (
                    <button
                      key={surface.id}
                      type="button"
                      className={`surface-row ${clickable ? "" : "plain"}`}
                      disabled={!clickable}
                      onClick={() => navigate({ name: "session", surfaceId: surface.id })}
                    >
                      <span className="surface-glyph">
                        {agent ? STATUS_GLYPH[agent.status] : surface.agent ? "○" : " "}
                      </span>
                      <span className="surface-main">
                        <span className="mono">{surface.ref}</span>
                        <span className="surface-title">{surface.title}</span>
                        <span className="surface-meta">
                          {surface.agent ? AGENT_DISPLAY_NAME[surface.agent] : "Shell"}
                          {agent ? ` · ${STATUS_LABEL[agent.status]}` : ""}
                          {agent?.currentActivity ? ` · ${agent.currentActivity}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
