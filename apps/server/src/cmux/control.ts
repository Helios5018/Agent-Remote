import type { CmuxKey } from "@car/protocol";

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

export function buildReadScreenArgs(surfaceId: string, lines: number, scrollback: boolean): string[] {
  assertSurfaceTarget(surfaceId);
  const args = ["read-screen", "--surface", surfaceId, "--lines", String(lines), "--json"];
  if (scrollback) args.push("--scrollback");
  return args;
}

export const TREE_ARGS = ["tree", "--all", "--json", "--id-format", "both"];
export const TOP_ARGS = ["top", "--all", "--processes", "--json"];
