import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ControlModeRequestSchema, LoginRequestSchema, type SessionInfo } from "@car/protocol";
import { SERVER_VERSION } from "@car/protocol";
import { apiError, type AppContext } from "../context.ts";
import { SESSION_COOKIE, type Session } from "../security/token.ts";

export function sessionInfo(ctx: AppContext, session: Session | null): SessionInfo {
  const hasControl = ctx.sessions.hasControl(session);
  return {
    authenticated: session !== null,
    controlMode: hasControl,
    controlModeExpiresAt: hasControl ? session?.controlUntil : undefined,
    controlModeTtlMs: ctx.sessions.controlTtlMs,
    serverVersion: SERVER_VERSION,
  };
}

export function createAuthRoutes(ctx: AppContext) {
  const app = new Hono();

  app.get("/session", (c) => {
    const session = ctx.sessions.get(getCookie(c, SESSION_COOKIE));
    return c.json(sessionInfo(ctx, session));
  });

  app.post("/login", async (c) => {
    const body = await safeJson(c.req.raw);
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(apiError("BAD_REQUEST", "缺少 token"), 400);

    const session = ctx.sessions.login(parsed.data.token);
    if (!session) {
      ctx.store.audit({ at: ctx.now(), action: "auth.login_failed" });
      return c.json(apiError("UNAUTHORIZED", "Token 不正确"), 401);
    }

    setCookie(c, SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    ctx.store.audit({ at: ctx.now(), action: "auth.login" });
    return c.json(sessionInfo(ctx, session));
  });

  app.post("/logout", (c) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) ctx.sessions.logout(cookie);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json(sessionInfo(ctx, null));
  });

  /** 显式开启 / 关闭控制模式（需求文档 §23.2）。 */
  app.post("/control", async (c) => {
    const session = ctx.sessions.get(getCookie(c, SESSION_COOKIE));
    if (!session) return c.json(apiError("UNAUTHORIZED", "需要先登录"), 401);

    const body = await safeJson(c.req.raw);
    const parsed = ControlModeRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(apiError("BAD_REQUEST", "参数不合法"), 400);

    ctx.sessions.setControlMode(session, parsed.data.enabled);
    ctx.store.audit({
      at: ctx.now(),
      action: parsed.data.enabled ? "control.enable" : "control.disable",
    });
    return c.json(sessionInfo(ctx, session));
  });

  return app;
}

export async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
