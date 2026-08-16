import { Hono } from "hono";
import { apiError, type AppContext } from "../context.ts";
import { CmuxError } from "../cmux/client.ts";
import type { Env } from "../security/middleware.ts";

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
