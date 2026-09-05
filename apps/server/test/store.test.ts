import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentState } from "@car/protocol";
import { StateStore } from "../src/state/store.ts";

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "car-store-"));
  dirs.push(dir);
  return join(dir, "state.db");
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE: AgentState = {
  id: "SURF-11",
  agent: "codex",
  sessionId: "sess-1",
  workspaceId: "WS-WORLD",
  paneId: "PANE-7",
  surfaceId: "SURF-11",
  surfaceRef: "surface:11",
  pid: 5201,
  status: "RESPONDED_UNREAD",
  currentActivity: "Running tests",
  lastActivityAt: 1000,
  statusChangedAt: 1000,
  hookConnected: true,
  outputRevision: 3,
};

describe("StateStore（SQLite）", () => {
  it("能在真实 SQLite 上落盘并读回", async () => {
    const path = tempDb();
    const store = await StateStore.open(path);
    expect(["bun", "node"]).toContain(store.driver);

    store.save(SAMPLE, 2000);
    store.close();

    const reopened = await StateStore.open(path);
    const rows = reopened.loadAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surfaceId: "SURF-11",
      agent: "codex",
      status: "RESPONDED_UNREAD",
      hookConnected: true,
      pid: 5201,
    });
    reopened.close();
  });

  it("同一 surface 重复保存是 upsert，不会产生重复行", async () => {
    const store = await StateStore.open(tempDb());
    store.save(SAMPLE, 1);
    store.save({ ...SAMPLE, status: "IDLE" }, 2);
    const rows = store.loadAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("IDLE");
    store.close();
  });

  it("审计日志按时间倒序返回，且截断过长内容", async () => {
    const store = await StateStore.open(tempDb());
    store.audit({ at: 1, action: "surface.input", surfaceId: "S1", detail: "len=10 submit=true" });
    store.audit({ at: 2, action: "surface.key", surfaceId: "S1", detail: "x".repeat(1000) });

    const entries = store.recentAudit(10);
    expect(entries[0]?.action).toBe("surface.key");
    expect(entries[0]?.detail?.length).toBe(500);
    expect(entries[1]?.action).toBe("surface.input");
    store.close();
  });

  it("不保存终端内容：活动文案最多 200 字", async () => {
    const store = await StateStore.open(tempDb());
    store.save({ ...SAMPLE, currentActivity: "终".repeat(1000) }, 1);
    expect(store.loadAll()[0]?.currentActivity?.length).toBe(200);
    store.close();
  });

  it("settings 可读写", async () => {
    const store = await StateStore.open(tempDb());
    expect(store.getSetting("theme")).toBeUndefined();
    store.setSetting("theme", "dark");
    store.setSetting("theme", "light");
    expect(store.getSetting("theme")).toBe("light");
    store.close();
  });

  it("内存兜底驱动不会抛异常", () => {
    const store = StateStore.inMemory();
    expect(() => store.save(SAMPLE, 1)).not.toThrow();
    expect(store.loadAll()).toEqual([]);
  });
});

describe("持久化不可用", () => {
  it("打不开数据目录时明确失败，不静默退化为无持久化", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "car-db-test-"));
    try {
      await expect(StateStore.open(join(directory, "missing", "state.db"))).rejects.toThrow("SQLite");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
