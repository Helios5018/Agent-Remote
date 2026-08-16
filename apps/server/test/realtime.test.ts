import { describe, expect, it, vi } from "vitest";
import type { AgentState, ServerMessage } from "@car/protocol";
import { REFRESH_INTERVAL_MS } from "@car/protocol";
import { RealtimeHub } from "../src/realtime/hub.ts";
import { Poller } from "../src/realtime/poller.ts";
import { StateEngine } from "../src/state/engine.ts";
import { FakeCmuxClient } from "../src/cmux/fake-client.ts";

function collector() {
  const messages: ServerMessage[] = [];
  return { messages, send: (message: ServerMessage) => messages.push(message) };
}

describe("RealtimeHub", () => {
  it("连接后立即发 hello", () => {
    const hub = new RealtimeHub();
    const sink = collector();
    hub.add(sink.send);
    expect(sink.messages[0]?.type).toBe("hello");
  });

  it("subscribe 决定谁能收到 surface 内容", () => {
    const hub = new RealtimeHub();
    const a = collector();
    const b = collector();
    const clientA = hub.add(a.send);
    hub.add(b.send);

    hub.handleMessage(clientA.id, JSON.stringify({ type: "subscribe", surfaceId: "S1" }));
    hub.sendToViewers("S1", { type: "surface.snapshot", surfaceId: "S1", revision: 1, content: "hi" });

    expect(a.messages.some((m) => m.type === "surface.snapshot")).toBe(true);
    expect(b.messages.some((m) => m.type === "surface.snapshot")).toBe(false);
    expect(hub.viewedSurfaces()).toEqual(["S1"]);
  });

  it("ping → pong", () => {
    const hub = new RealtimeHub({ now: () => 42 });
    const sink = collector();
    const client = hub.add(sink.send);
    hub.handleMessage(client.id, JSON.stringify({ type: "ping" }));
    expect(sink.messages.at(-1)).toEqual({ type: "pong", now: 42 });
  });

  it("非法消息只回错误，不影响连接", () => {
    const hub = new RealtimeHub();
    const sink = collector();
    const client = hub.add(sink.send);
    hub.handleMessage(client.id, "not json");
    hub.handleMessage(client.id, JSON.stringify({ type: "nope" }));
    expect(sink.messages.filter((m) => m.type === "error")).toHaveLength(2);
    expect(hub.clientCount).toBe(1);
  });

  it("最后一个查看者离开才通知停止查看", () => {
    const events: Array<[string | null, boolean]> = [];
    const hub = new RealtimeHub({ onViewingChanged: (surfaceId, viewing) => events.push([surfaceId, viewing]) });
    const a = hub.add(collector().send);
    const b = hub.add(collector().send);

    hub.handleMessage(a.id, JSON.stringify({ type: "subscribe", surfaceId: "S1" }));
    hub.handleMessage(b.id, JSON.stringify({ type: "subscribe", surfaceId: "S1" }));
    hub.remove(a.id);
    expect(events).toEqual([
      ["S1", true],
      ["S1", true],
    ]);

    hub.remove(b.id);
    expect(events.at(-1)).toEqual(["S1", false]);
  });

  it("单个客户端发送异常不影响广播其它人", () => {
    const hub = new RealtimeHub();
    hub.add(() => {
      throw new Error("socket closed");
    });
    const ok = collector();
    hub.add(ok.send);
    expect(() => hub.broadcast({ type: "pong", now: 1 })).not.toThrow();
    expect(ok.messages.at(-1)?.type).toBe("pong");
  });
});

describe("Poller 刷新策略（§18）", () => {
  const base: AgentState = {
    id: "S1",
    agent: "codex",
    workspaceId: "W1",
    surfaceId: "S1",
    status: "IDLE",
    lastActivityAt: 0,
    statusChangedAt: 0,
    hookConnected: false,
    outputRevision: 0,
  };

  function makePoller() {
    const client = new FakeCmuxClient();
    const engine = new StateEngine();
    const hub = new RealtimeHub();
    return { poller: new Poller({ client, engine, hub }), client, engine, hub };
  }

  it("正在查看 400ms / Working 1s / Idle 8s", () => {
    const { poller } = makePoller();
    expect(poller.intervalFor(base, true)).toBe(REFRESH_INTERVAL_MS.viewing);
    expect(poller.intervalFor({ ...base, status: "WORKING" }, false)).toBe(REFRESH_INTERVAL_MS.working);
    expect(poller.intervalFor({ ...base, status: "NEEDS_APPROVAL" }, false)).toBe(REFRESH_INTERVAL_MS.working);
    expect(poller.intervalFor(base, false)).toBe(REFRESH_INTERVAL_MS.idle);
  });

  it("有 hook 托底的 idle agent 不可见时不读取", () => {
    const { poller } = makePoller();
    expect(poller.intervalFor({ ...base, hookConnected: true }, false)).toBeNull();
    expect(poller.intervalFor({ ...base, hookConnected: true }, true)).toBe(REFRESH_INTERVAL_MS.viewing);
    expect(poller.intervalFor({ ...base, status: "CLOSED" }, false)).toBeNull();
  });

  it("内容没变化时不向浏览器推送", async () => {
    const client = new FakeCmuxClient();
    const engine = new StateEngine();
    const hub = new RealtimeHub();
    const poller = new Poller({ client, engine, hub });

    engine.syncTree(await client.getTree());
    const sink = collector();
    const viewer = hub.add(sink.send);
    hub.handleMessage(viewer.id, JSON.stringify({ type: "subscribe", surfaceId: "sf-11" }));

    await poller.tick();
    const first = sink.messages.filter((m) => m.type === "surface.snapshot").length;
    expect(first).toBe(1);

    await poller.tick();
    expect(sink.messages.filter((m) => m.type === "surface.snapshot")).toHaveLength(first);

    client.appendOutput("sf-11", "新的一行输出");
    poller.scheduleImmediate("sf-11");
    await poller.tick();
    expect(sink.messages.filter((m) => m.type === "surface.snapshot").length).toBe(first + 1);
  });

  it("cmux 读取失败只上报错误，不打断循环", async () => {
    const client = new FakeCmuxClient();
    const engine = new StateEngine();
    const hub = new RealtimeHub();
    const onError = vi.fn();
    // 拓扑正常但读屏失败：模拟 cmux 单条命令超时
    const flaky = {
      ...client,
      ping: () => client.ping(),
      getTree: () => client.getTree(),
      sendText: (id: string, text: string) => client.sendText(id, text),
      sendKey: (id: string, key: "enter") => client.sendKey(id, key),
      readSurface: async () => {
        throw new Error("read-screen timeout");
      },
    };
    const poller = new Poller({ client: flaky, engine, hub, onError });

    engine.syncTree(await client.getTree());
    poller.scheduleImmediate("sf-11");
    await expect(poller.tick()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});
