import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/config.ts";
import {
  generateToken,
  resolveAccessToken,
  safeCompare,
  SessionManager,
  type SessionPersistence,
} from "../src/security/token.ts";
import { StateStore } from "../src/state/store.ts";

describe("Access Token", () => {
  it("生成的 token 只用易抄写的字符", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateToken()).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    }
  });

  it("每次生成都不同", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateToken())).size).toBe(50);
  });

  it("比较是定长的，且长度不同直接判否", () => {
    expect(safeCompare("ABC", "ABC")).toBe(true);
    expect(safeCompare("ABC", "ABD")).toBe(false);
    expect(safeCompare("ABC", "ABCD")).toBe(false);
  });
});

describe("Token 解析与持久化", () => {
  it("首次启动生成并保存，重启后复用（手机端不用重新输）", async () => {
    const store = await StateStore.open(":memory:");
    const first = resolveAccessToken(store);
    expect(resolveAccessToken(store)).toBe(first);
    store.close();
  });

  it("--rotate-token 换新并作废旧 Session", async () => {
    const store = await StateStore.open(":memory:");
    const first = resolveAccessToken(store);
    store.saveSession({ id: "s1", createdAt: 1, lastSeenAt: 1 });

    const second = resolveAccessToken(store, { rotate: true });
    expect(second).not.toBe(first);
    expect(store.loadSessions()).toHaveLength(0);
    store.close();
  });

  it("显式指定的 token 优先，并在变化时作废旧 Session", async () => {
    const store = await StateStore.open(":memory:");
    resolveAccessToken(store);
    store.saveSession({ id: "s1", createdAt: 1, lastSeenAt: 1 });

    expect(resolveAccessToken(store, { explicit: "MYTOKEN" })).toBe("MYTOKEN");
    expect(store.loadSessions()).toHaveLength(0);

    // 同一个 token 再次启动，不该踢掉已登录设备
    store.saveSession({ id: "s2", createdAt: 1, lastSeenAt: 1 });
    resolveAccessToken(store, { explicit: "MYTOKEN" });
    expect(store.loadSessions()).toHaveLength(1);
    store.close();
  });
});

describe("SessionManager", () => {
  const now = () => 1_000_000;

  it("Token 正确才发 Session", () => {
    const sessions = new SessionManager({ token: "GOOD", now });
    expect(sessions.login("BAD")).toBeNull();
    const session = sessions.login("GOOD");
    expect(session).not.toBeNull();
    expect(sessions.get(session?.id)).toBe(session);
  });

  it("默认只读，显式开启后才有控制权", () => {
    let clock = 1_000_000;
    const sessions = new SessionManager({ token: "GOOD", controlTtlMs: 1000, now: () => clock });
    const session = sessions.login("GOOD")!;
    expect(sessions.hasControl(session)).toBe(false);

    sessions.setControlMode(session, true);
    expect(sessions.hasControl(session)).toBe(true);

    clock += 1500;
    expect(sessions.hasControl(session)).toBe(false);
  });

  it("有操作就续期，没操作就自动回到只读", () => {
    let clock = 1_000_000;
    const sessions = new SessionManager({ token: "GOOD", controlTtlMs: 1000, now: () => clock });
    const session = sessions.login("GOOD")!;
    sessions.setControlMode(session, true);

    clock += 800;
    sessions.touchControl(session);
    clock += 800;
    expect(sessions.hasControl(session)).toBe(true);

    clock += 1200;
    expect(sessions.hasControl(session)).toBe(false);
    // 已经过期之后再 touch 不该复活
    sessions.touchControl(session);
    expect(sessions.hasControl(session)).toBe(false);
  });

  it("登出后 Session 立即失效", () => {
    const sessions = new SessionManager({ token: "GOOD", now });
    const session = sessions.login("GOOD")!;
    sessions.logout(session.id);
    expect(sessions.get(session.id)).toBeNull();
  });

  it("Session 可持久化，但控制模式重启后一定回到只读", () => {
    const rows: Array<{ id: string; createdAt: number; lastSeenAt: number }> = [];
    const persistence: SessionPersistence = {
      load: () => rows,
      save: (session) => {
        const index = rows.findIndex((row) => row.id === session.id);
        if (index >= 0) rows[index] = session;
        else rows.push(session);
      },
      remove: (id) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
    };

    const first = new SessionManager({ token: "GOOD", now, persistence });
    const session = first.login("GOOD")!;
    first.setControlMode(session, true);
    expect(rows).toHaveLength(1);

    const restarted = new SessionManager({ token: "GOOD", now, persistence });
    const restored = restarted.get(session.id);
    expect(restored).not.toBeNull();
    expect(restarted.hasControl(restored)).toBe(false);
  });

  it("过期很久的 Session 不会被恢复", () => {
    const rows = [{ id: "old", createdAt: 0, lastSeenAt: 0 }];
    const removed: string[] = [];
    const manager = new SessionManager({
      token: "GOOD",
      now: () => 400 * 24 * 60 * 60 * 1000,
      persistence: {
        load: () => rows,
        save: () => {},
        remove: (id) => removed.push(id),
      },
    });
    expect(manager.get("old")).toBeNull();
    expect(removed).toEqual(["old"]);
  });
});

describe("命令行参数", () => {
  it("默认监听 127.0.0.1:4318", () => {
    const { config } = parseArgs([], {});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4318);
  });

  it("--lan 才对局域网开放", () => {
    expect(parseArgs(["--lan"], {}).config.host).toBe("0.0.0.0");
  });

  it("解析端口 / token / demo / rotate", () => {
    const result = parseArgs(["--port", "5000", "--token", "ABC", "--demo", "--rotate-token"], {});
    expect(result.config.port).toBe(5000);
    expect(result.config.token).toBe("ABC");
    expect(result.config.demo).toBe(true);
    expect(result.tokenProvided).toBe(true);
    expect(result.rotateToken).toBe(true);
  });

  it("非法端口回落到默认值", () => {
    expect(parseArgs(["--port", "abc"], {}).config.port).toBe(4318);
  });

  it("环境变量也能配置", () => {
    const { config, tokenProvided } = parseArgs([], { CAR_PORT: "6000", CAR_TOKEN: "ENVTOKEN" });
    expect(config.port).toBe(6000);
    expect(config.token).toBe("ENVTOKEN");
    expect(tokenProvided).toBe(true);
  });
});
