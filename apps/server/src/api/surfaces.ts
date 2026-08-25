import { Hono } from "hono";
import {
  isDangerousKey,
  SurfaceInputRequestSchema,
  SurfaceKeyRequestSchema,
  SurfaceScrollRequestSchema,
  type ScrollKey,
  type SurfaceGrid,
} from "@car/protocol";
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

  /** 彩色渲染网格：颜色、粗体、反显、光标、格子宽度都在这里。 */
  app.get("/:surfaceId/grid", async (c) => {
    const surfaceId = c.req.param("surfaceId");
    try {
      const grid = await ctx.client.readGrid(surfaceId);
      ctx.engine.applyOutput(surfaceId, false, grid.revision);
      return c.json(grid);
    } catch (error) {
      return handleCmuxError(c, error);
    }
  });

  /**
   * 网格之外更早的历史（纯文本、无颜色）。
   *
   * `terminal.replay` 每次只带最近 240 行回滚，再往上只有 `read-screen --scrollback`。
   * `drop` 由前端传当前网格已经画出来的行数，避免和网格重复。
   */
  app.get("/:surfaceId/history", async (c) => {
    const surfaceId = c.req.param("surfaceId");
    const lines = clampInt(c.req.query("lines"), ctx.config.maxHistoryLines, 1, ctx.config.maxHistoryLines);
    const drop = clampInt(c.req.query("drop"), 0, 0, Number.MAX_SAFE_INTEGER);
    try {
      const text = await ctx.client.readHistory(surfaceId, lines);
      const all = text.length > 0 ? text.split("\n") : [];
      const kept = all.slice(0, Math.max(0, all.length - drop));
      return c.json({
        text: kept.join("\n"),
        totalLines: all.length,
        droppedTail: all.length - kept.length,
        truncated: all.length >= lines,
      });
    } catch (error) {
      return handleCmuxError(c, error);
    }
  });

  /**
   * 翻页。故意不加 requireControl：翻页不往终端写任何东西，
   * 只是让终端 / TUI 换一屏来画，只读模式下也应该能回看历史。
   */
  app.post("/:surfaceId/scroll", async (c) => {
    const surfaceId = c.req.param("surfaceId");
    const parsed = SurfaceScrollRequestSchema.safeParse(await safeJson(c.req.raw));
    if (!parsed.success) return c.json(apiError("BAD_REQUEST", "不支持的翻页动作"), 400);
    const { action } = parsed.data;

    try {
      const grid =
        action === "bottom"
          ? await scrollToBottom(ctx, surfaceId)
          : await scrollOnce(ctx, surfaceId, action);
      ctx.store.audit({ at: ctx.now(), action: "surface.scroll", surfaceId, detail: action });
      return c.json({ ok: true as const, grid });
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

/** 翻一屏，等 TUI 重绘完再截图 —— 读太快会拿到翻页前的旧画面。 */
async function scrollOnce(ctx: AppContext, surfaceId: string, key: ScrollKey): Promise<SurfaceGrid> {
  await ctx.client.scrollSurface(surfaceId, key);
  await sleep(ctx.config.scrollRedrawDelayMs);
  return ctx.client.readGrid(surfaceId);
}

/**
 * 回到最新一屏。
 *
 * TUI 没有通用的「跳到底部」键（实测 Claude Code 收到 `end` 画面不动），
 * 只能连按 pagedown 直到画面不再变化。revision 只在内容变化时自增，
 * 拿它当「到底了」的判据；步数封顶兜住「Agent 正在刷输出，画面一直在变」。
 */
async function scrollToBottom(ctx: AppContext, surfaceId: string): Promise<SurfaceGrid> {
  let grid = await ctx.client.readGrid(surfaceId);
  for (let step = 0; step < SCROLL_TO_BOTTOM_MAX_STEPS; step += 1) {
    const next = await scrollOnce(ctx, surfaceId, "pagedown");
    if (next.revision === grid.revision) return next;
    grid = next;
  }
  return grid;
}

const SCROLL_TO_BOTTOM_MAX_STEPS = 12;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function handleCmuxError(c: { json: (body: unknown, status?: 400 | 404 | 500 | 503) => Response }, error: unknown) {
  if (error instanceof CmuxError) {
    if (error.code === "SURFACE_NOT_FOUND") return c.json(apiError("NOT_FOUND", error.message), 404);
    return c.json(apiError("CMUX_UNAVAILABLE", error.message), 503);
  }
  return c.json(apiError("INTERNAL", "cmux 操作失败"), 500);
}
