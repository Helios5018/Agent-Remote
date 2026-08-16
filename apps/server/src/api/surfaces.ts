import { Hono } from "hono";
import { isDangerousKey, SurfaceInputRequestSchema, SurfaceKeyRequestSchema } from "@car/protocol";
import { apiError, type AppContext } from "../context.ts";
import { CmuxError } from "../cmux/client.ts";
import { requireControl, type Env } from "../security/middleware.ts";
import { safeJson } from "./auth.ts";

/**
 * Surface 读写（需求文档 §22 / §23.3）。
 * 所有写操作都在 URL 里显式指定 surface，服务端不存在 "current terminal" 概念。
 */
export function createSurfaceRoutes(ctx: AppContext) {
  const app = new Hono<Env>();

  app.get("/:surfaceId/output", async (c) => {
    const surfaceId = c.req.param("surfaceId");
    try {
      const snapshot = await ctx.client.readSurface(surfaceId, {
        lines: Number(c.req.query("lines") ?? ctx.config.maxOutputLines) || ctx.config.maxOutputLines,
        scrollback: c.req.query("scrollback") === "1",
      });
      ctx.engine.applyOutput(surfaceId, false, snapshot.revision);
      return c.json(snapshot);
    } catch (error) {
      return handleCmuxError(c, error);
    }
  });

  app.post("/:surfaceId/input", requireControl(ctx), async (c) => {
    const surfaceId = c.req.param("surfaceId");
    const parsed = SurfaceInputRequestSchema.safeParse(await safeJson(c.req.raw));
    if (!parsed.success) return c.json(apiError("BAD_REQUEST", "参数不合法"), 400);

    const { text, submit } = parsed.data;
    if (text.length === 0 && !submit) {
      return c.json(apiError("BAD_REQUEST", "内容为空"), 400);
    }

    try {
      if (text.length > 0) await ctx.client.sendText(surfaceId, text);
      if (submit) await ctx.client.sendKey(surfaceId, "enter");
    } catch (error) {
      return handleCmuxError(c, error);
    }

    ctx.store.audit({
      at: ctx.now(),
      action: "surface.input",
      surfaceId,
      // 审计只记录长度，不落 prompt 原文（需求文档 §23.5）。
      detail: `len=${text.length} submit=${submit}`,
    });

    const updated = ctx.engine.noteUserInput(surfaceId, submit);
    if (updated) {
      ctx.hub.broadcast({ type: "agent.list_changed", inbox: ctx.engine.inbox() });
    }
    ctx.poller?.scheduleImmediate(surfaceId);

    return c.json({ ok: true as const });
  });

  app.post("/:surfaceId/key", requireControl(ctx), async (c) => {
    const surfaceId = c.req.param("surfaceId");
    const parsed = SurfaceKeyRequestSchema.safeParse(await safeJson(c.req.raw));
    if (!parsed.success) {
      return c.json(apiError("BAD_REQUEST", "不支持的按键"), 400);
    }
    const { key, confirm } = parsed.data;

    // 危险操作必须二次确认（需求文档 §23.4）。
    if (isDangerousKey(key) && confirm !== true) {
      return c.json(apiError("CONFIRM_REQUIRED", `${key} 需要二次确认`), 428);
    }

    try {
      await ctx.client.sendKey(surfaceId, key);
    } catch (error) {
      return handleCmuxError(c, error);
    }

    ctx.store.audit({ at: ctx.now(), action: "surface.key", surfaceId, detail: key });
    ctx.poller?.scheduleImmediate(surfaceId);
    return c.json({ ok: true as const });
  });

  return app;
}

function handleCmuxError(c: { json: (body: unknown, status?: 400 | 404 | 500 | 503) => Response }, error: unknown) {
  if (error instanceof CmuxError) {
    if (error.code === "SURFACE_NOT_FOUND") return c.json(apiError("NOT_FOUND", error.message), 404);
    return c.json(apiError("CMUX_UNAVAILABLE", error.message), 503);
  }
  return c.json(apiError("INTERNAL", "cmux 操作失败"), 500);
}
