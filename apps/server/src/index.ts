import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { HELP_TEXT, parseArgs, type ServerConfig } from "./config.ts";
import { CmuxCliClient } from "./cmux/cli-client.ts";
import { FakeCmuxClient } from "./cmux/fake-client.ts";
import type { CmuxClient } from "./cmux/client.ts";
import type { AppContext } from "./context.ts";
import { RealtimeHub } from "./realtime/hub.ts";
import { Poller } from "./realtime/poller.ts";
import { authenticateUpgrade, createWebSocketHandlers } from "./realtime/websocket.ts";
import { resolveAccessToken, SessionManager } from "./security/token.ts";
import { StateEngine } from "./state/engine.ts";
import { StateStore } from "./state/store.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { config, help, tokenProvided, rotateToken } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(HELP_TEXT);
    return;
  }

  mkdirSync(config.dataDir, { recursive: true });

  const store = await StateStore.open(config.dbPath);
  config.token = resolveAccessToken(store, { explicit: tokenProvided ? config.token : "", rotate: rotateToken });
  const client: CmuxClient = config.demo ? new FakeCmuxClient() : new CmuxCliClient({ maxOutputLines: config.maxOutputLines });

  const hub = new RealtimeHub();
  const engine = new StateEngine({
    store,
    stale: { staleAfterMs: config.staleAfterMs },
    onChange: (state) => hub.broadcastStatus(state),
  });
  const sessions = new SessionManager({
    token: config.token,
    controlTtlMs: config.controlTtlMs,
    // 重启后手机端不用重新输 Token；控制模式不持久化，一律回到只读。
    persistence: {
      load: () => store.loadSessions(),
      save: (session) => store.saveSession(session),
      remove: (id) => store.deleteSession(id),
    },
  });

  const ctx: AppContext = {
    config,
    client,
    engine,
    store,
    sessions,
    hub,
    now: Date.now,
  };

  const poller = new Poller({
    client,
    engine,
    hub,
    onError: (error, where) => {
      if (process.env["CAR_DEBUG"] === "1") console.error(`[poller:${where}]`, error);
    },
  });
  ctx.poller = poller;

  // Hook 脚本要知道端口和 token，写一份配置到数据目录。
  writeHookConfig(config);

  const app = createApp(ctx);
  const staticDir = resolveStaticDir(config);
  const { websocket } = createWebSocketHandlers(ctx);

  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) {
    console.error("CMUX Agent Remote 需要 Bun 运行：bun run apps/server/src/index.ts");
    process.exitCode = 1;
    return;
  }

  const server = bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 120,
    websocket,
    fetch: async (request: Request, srv: BunServer) => {
      const url = new URL(request.url);

      if (url.pathname === "/ws") {
        const session = authenticateUpgrade(ctx, request);
        if (!session) return new Response("unauthorized", { status: 401 });
        if (srv.upgrade(request, { data: {} })) return undefined;
        return new Response("upgrade failed", { status: 400 });
      }

      if (url.pathname.startsWith("/api/")) return app.fetch(request);

      if (staticDir) {
        const response = await serveStatic(staticDir, url.pathname);
        if (response) return response;
      }
      return app.fetch(request);
    },
  });

  poller.start();
  await poller.refreshTree();

  printBanner(config, server.port);

  const shutdown = () => {
    poller.stop();
    hub.closeAll();
    store.close();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

interface BunServer {
  port: number;
  upgrade(request: Request, options?: { data?: unknown }): boolean;
  stop(closeActive?: boolean): void;
}

interface BunLike {
  serve(options: Record<string, unknown>): BunServer;
  file(path: string): { exists(): Promise<boolean>; type: string };
}

async function serveStatic(root: string, pathname: string): Promise<Response | undefined> {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) return undefined;
  const clean = pathname.replace(/\?.*$/, "");
  const relative = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  // 目录穿越防护
  const target = resolve(root, relative);
  if (!target.startsWith(resolve(root))) return new Response("forbidden", { status: 403 });

  const file = bun.file(target);
  if (await file.exists()) return new Response(file as unknown as BodyInit);

  // SPA 回退
  const index = bun.file(join(root, "index.html"));
  if (await index.exists()) return new Response(index as unknown as BodyInit, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  return undefined;
}

function resolveStaticDir(config: ServerConfig): string | null {
  const candidates = [
    config.staticDir,
    resolve(here, "../../web/dist"),
    resolve(here, "../../../apps/web/dist"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

/** Hook 脚本读取这个文件拿到 endpoint 与 token。 */
function writeHookConfig(config: ServerConfig): void {
  const target = join(config.dataDir, "hook.json");
  const payload = {
    endpoint: `http://127.0.0.1:${config.port}/api/hooks`,
    token: config.token,
    updatedAt: Date.now(),
  };
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn("[hook] 无法写入 hook 配置:", error);
  }
}

function lanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

function printBanner(config: ServerConfig, port: number): void {
  const lines = [
    "",
    "  CMUX Agent Remote",
    "",
    `  Local:        http://localhost:${port}`,
  ];
  if (config.host === "0.0.0.0") {
    const lan = lanAddress();
    if (lan) lines.push(`  Network:      http://${lan}:${port}`);
  }
  lines.push("", `  Access Token: ${config.token}`, "");
  if (config.demo) lines.push("  模式:         DEMO（使用内置假数据）", "");
  console.log(lines.join("\n"));
}

void main();
