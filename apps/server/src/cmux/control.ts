import type { CmuxKey, ScrollKey } from "@car/protocol";

/**
 * 控制类命令的参数构造。
 *
 * 安全约束（需求文档 §23.3）：所有写操作都必须显式带 surface，
 * 绝不允许 "send to current terminal" —— 这里用类型和运行时双重保证。
 */

export function assertSurfaceTarget(surfaceId: string | undefined | null): asserts surfaceId is string {
  if (typeof surfaceId !== "string" || surfaceId.trim().length === 0) {
    throw new Error("每个写操作都必须显式指定 surface");
  }
}

export function buildSendTextArgs(surfaceId: string, text: string): string[] {
  assertSurfaceTarget(surfaceId);
  // `--` 之后的内容一律当作字面文本，避免 "-r" 之类开头的 prompt 被当成 flag。
  return ["send", "--surface", surfaceId, "--", text];
}

export function buildSendKeyArgs(surfaceId: string, key: CmuxKey): string[] {
  assertSurfaceTarget(surfaceId);
  return ["send-key", "--surface", surfaceId, "--", key];
}

/**
 * 翻页。走的还是 send-key，但语义上只是换一屏来看，
 * 所以在 API 层不要求控制模式（见 `SurfaceScrollRequestSchema`）。
 */
export function buildScrollKeyArgs(surfaceId: string, key: ScrollKey): string[] {
  assertSurfaceTarget(surfaceId);
  return ["send-key", "--surface", surfaceId, "--", key];
}

export function buildReadScreenArgs(surfaceId: string, lines: number, scrollback: boolean): string[] {
  assertSurfaceTarget(surfaceId);
  const args = ["read-screen", "--surface", surfaceId, "--lines", String(lines), "--json"];
  if (scrollback) args.push("--scrollback");
  return args;
}

/**
 * 彩色渲染网格。走 RPC 而不是 read-screen：
 * read-screen 的定义就是 "as plain text"，颜色和格子宽度在那一层已经没了。
 */
export function buildReplayArgs(surfaceId: string): string[] {
  assertSurfaceTarget(surfaceId);
  return ["rpc", "terminal.replay", JSON.stringify({ surface_id: surfaceId })];
}

export const TREE_ARGS = ["tree", "--all", "--json", "--id-format", "both"];
export const TOP_ARGS = ["top", "--all", "--processes", "--json"];
