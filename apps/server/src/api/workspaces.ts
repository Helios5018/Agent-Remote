import { Hono } from "hono";
import { RenameTitleRequestSchema, type SurfaceWriteResponse } from "@car/protocol";
import { apiError, type AppContext } from "../context.ts";
import { CmuxError } from "../cmux/client.ts";
import { requireControl, type Env } from "../security/middleware.ts";
import { safeJson } from "./auth.ts";

/** GET /api/tree —— cmux 真实结构：Workspace → Pane → Surface（需求文档 §6 / §22）。 */
export function createWorkspaceRoutes(ctx: AppContext) {
  const app = new Hono<Env>();

  app.get("/", async (c) => {
    try {
      const tree = await ctx.client.getTree();
      // 顺带把最新拓扑喂给 State Engine，页面刷新即可纠正状态。
      ctx.engine.syncTree(tree);
      return c.json(tree);
    } catch (error) {
      if (error instanceof CmuxError) {
        return c.json(apiError("CMUX_UNAVAILABLE", error.message), 503);
      }
      return c.json(apiError("INTERNAL", "获取 cmux 拓扑失败"), 500);
    }
  });

  return app;
}

/** POST /api/workspaces/:workspaceId/title —— 改 cmux workspace 的真实名字。 */
export function createWorkspaceWriteRoutes(ctx: AppContext) {
  const app = new Hono<Env>();

  app.post("/:workspaceId/title", requireControl(ctx), async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const parsed = RenameTitleRequestSchema.safeParse(await safeJson(c.req.raw));
    if (!parsed.success) return c.json(apiError("BAD_REQUEST", "名称不合法"), 400);

    try {
      const tree = await ctx.client.getTree();
      const found = tree.workspaces.find((workspace) => workspace.id === workspaceId || workspace.ref === workspaceId);
      if (!found) return c.json(apiError("NOT_FOUND", `workspace 不存在: ${workspaceId}`), 404);
      await ctx.client.renameWorkspace(found.id, parsed.data.title);
      ctx.engine.syncTree(await ctx.client.getTree());
    } catch (error) {
      if (error instanceof CmuxError) {
        if (error.code === "WORKSPACE_NOT_FOUND") {
          return c.json(apiError("NOT_FOUND", error.message), 404);
        }
        return c.json(apiError("CMUX_UNAVAILABLE", error.message), 503);
      }
      return c.json(apiError("INTERNAL", "改 workspace 名称失败"), 500);
    }

    ctx.store.audit({
      at: ctx.now(),
      action: "workspace.rename",
      detail: `workspace=${workspaceId} len=${parsed.data.title.length}`,
    });
    ctx.hub.broadcast({ type: "agent.list_changed", inbox: ctx.engine.inbox() });
    const session = c.get("session");
    const body: SurfaceWriteResponse = {
      ok: true,
      controlModeExpiresAt: ctx.sessions.hasControl(session) ? session.controlUntil : undefined,
    };
    return c.json(body);
  });

  return app;
}
