import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import { apiError, type AppContext } from "../context.ts";
import { SESSION_COOKIE, type Session } from "./token.ts";

export type Env = {
  Variables: {
    session: Session;
  };
};

/**
 * 登录校验：首次用 Access Token 换 Session Cookie，之后都认 Cookie（需求文档 §23.1）。
 * 为了方便脚本/调试，也接受 Authorization: Bearer <token>。
 */
export function requireAuth(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c: Context<Env>, next: Next) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    let session = ctx.sessions.get(cookie);

    if (!session) {
      const header = c.req.header("authorization");
      const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1];
      const headerToken = bearer ?? c.req.header("x-car-token");
      if (headerToken) session = ctx.sessions.login(headerToken);
    }

    if (!session) {
      return c.json(apiError("UNAUTHORIZED", "需要先用 Access Token 登录"), 401);
    }
    c.set("session", session);
    await next();
  };
}

/**
 * 控制模式校验（需求文档 §23.2）：默认只读，写操作必须显式开启 CONTROL MODE。
 */
export function requireControl(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c: Context<Env>, next: Next) => {
    const session = c.get("session");
    if (!ctx.sessions.hasControl(session)) {
      return c.json(
        apiError("READ_ONLY", "当前是只读模式，请先开启 Control Mode"),
        403,
      );
    }
    await next();
    // 有效的写操作会续期控制模式，长时间不操作会自动回到只读。
    ctx.sessions.touchControl(session);
  };
}

/** Hook 接收端：不用 Session，只认共享 token（本机 Agent 进程调用）。 */
export function requireHookToken(ctx: AppContext): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const token = c.req.header("x-car-token") ?? c.req.query("token") ?? "";
    if (token !== ctx.config.token) {
      // 故意返回 200：Hook 失效绝不能影响 Agent 本身运行（需求文档 §33）。
      return c.json({ ok: false, ignored: "bad token" }, 200);
    }
    await next();
  };
}
