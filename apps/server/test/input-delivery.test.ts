import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type TestHarness } from "./helpers.ts";

describe("输入与创建的部分失败", () => {
  let harness: TestHarness;
  afterEach(() => { harness?.store.close(); vi.restoreAllMocks(); });

  it("正文已写入、Enter 报错时报告提交未知；补 Enter 不重复正文", async () => {
    harness = await createHarness();
    const cookie = await harness.loginCookie();
    const key = vi.spyOn(harness.client, "sendKey").mockRejectedValueOnce(new Error("timeout"));
    const send = (text: string) => harness.request("/api/surfaces/sf-11/input", {
      cookie, method: "POST", body: JSON.stringify({ text, submit: true }),
    });
    const failed = await send("不要重复的正文");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: { code: "INPUT_TEXT_WRITTEN_SUBMIT_UNKNOWN" } });
    expect(harness.client.sentText).toHaveLength(1);
    const recovered = await send("");
    expect(recovered.status).toBe(200);
    expect(harness.client.sentText).toHaveLength(1);
    expect(key).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(harness.store.recentAudit(20))).not.toContain("不要重复的正文");
  });

  it("写正文异常后不继续发送 Enter，也不声称正文没写入", async () => {
    harness = await createHarness();
    const cookie = await harness.loginCookie();
    vi.spyOn(harness.client, "sendText").mockRejectedValueOnce(new Error("response lost"));
    const result = await harness.request("/api/surfaces/sf-11/input", {
      cookie, method: "POST", body: JSON.stringify({ text: "任务", submit: true }),
    });
    expect(await result.json()).toMatchObject({ error: { code: "INPUT_DELIVERY_UNKNOWN" } });
    expect(harness.client.sentKeys).toHaveLength(0);
  });

  it.each(["sendText", "sendKey"] as const)("创建成功但 %s 失败仍返回已创建 tab", async method => {
    harness = await createHarness();
    const cookie = await harness.loginCookie();
    vi.spyOn(harness.client, method).mockRejectedValueOnce(new Error("timeout"));
    const result = await harness.request("/api/surfaces", {
      cookie, method: "POST", body: JSON.stringify({ paneId: "pane-7", launch: "claude" }),
    });
    expect(result.status).toBe(201);
    const body = await result.json() as { surfaceId: string };
    expect(body).toMatchObject({ ok: true, launched: null,
      launchError: { stage: method === "sendText" ? "text_unknown" : "submit_unknown" } });
    const tree = await harness.client.getTree();
    expect(tree.workspaces.flatMap(w => w.panes.flatMap(p => p.surfaces)).some(s => s.id === body.surfaceId)).toBe(true);
    expect(harness.client.created).toHaveLength(1);
  });
});
