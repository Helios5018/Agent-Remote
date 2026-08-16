import { createApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { FakeCmuxClient } from "../src/cmux/fake-client.ts";
import type { AppContext } from "../src/context.ts";
import { RealtimeHub } from "../src/realtime/hub.ts";
import { SessionManager } from "../src/security/token.ts";
import { StateEngine } from "../src/state/engine.ts";
import { StateStore } from "../src/state/store.ts";

export const TEST_TOKEN = "TESTTOKEN1234";

export interface TestHarness {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  client: FakeCmuxClient;
  engine: StateEngine;
  store: StateStore;
  clock: { value: number; advance(ms: number): void };
  request(path: string, init?: RequestInit & { cookie?: string }): Promise<Response>;
  loginCookie(): Promise<string>;
}

export async function createHarness(options: { token?: string } = {}): Promise<TestHarness> {
  const clock = {
    value: 1_700_000_000_000,
    advance(ms: number) {
      this.value += ms;
    },
  };
  const now = () => clock.value;

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 4318,
    token: options.token ?? TEST_TOKEN,
    dataDir: "/tmp/car-test",
    dbPath: ":memory:",
    staticDir: "",
    controlTtlMs: 60_000,
    staleAfterMs: 600_000,
    demo: true,
    maxOutputLines: 400,
  };

  const client = new FakeCmuxClient(undefined, now);
  // 真实 SQLite，但只存在内存里：既覆盖 SQL 逻辑，又不留文件
  const store = await StateStore.open(":memory:");
  const hub = new RealtimeHub({ now });
  const engine = new StateEngine({ now, store, onChange: (state) => hub.broadcastStatus(state) });
  const sessions = new SessionManager({ token: config.token, controlTtlMs: config.controlTtlMs, now });

  const ctx: AppContext = { config, client, engine, store, sessions, hub, now };
  const app = createApp(ctx);

  // 先同步一次拓扑，让 Agent 列表就绪
  engine.syncTree(await client.getTree());

  const harness: TestHarness = {
    ctx,
    app,
    client,
    engine,
    store,
    clock,
    async request(path, init = {}) {
      const { cookie, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (cookie) headers.set("cookie", cookie);
      if (rest.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      return app.request(`http://localhost${path}`, { ...rest, headers });
    },
    async loginCookie() {
      const response = await harness.request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ token: config.token }),
      });
      const setCookie = response.headers.get("set-cookie") ?? "";
      return setCookie.split(";")[0] ?? "";
    },
  };

  return harness;
}

/** 登录并开启控制模式，返回 cookie。 */
export async function loginWithControl(harness: TestHarness): Promise<string> {
  const cookie = await harness.loginCookie();
  await harness.request("/api/auth/control", {
    method: "POST",
    cookie,
    body: JSON.stringify({ enabled: true }),
  });
  return cookie;
}
