import type { AgentEvent, AgentKind } from "@car/protocol";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { grokAdapter } from "./grok.ts";
import type { HookAdapter, HookEnvelope } from "./types.ts";

export * from "./types.ts";
export { claudeAdapter } from "./claude.ts";
export { codexAdapter } from "./codex.ts";
export { grokAdapter } from "./grok.ts";

export const HOOK_ADAPTERS: Record<AgentKind, HookAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
};

/**
 * Agent Hook Adapter 总入口（需求文档 §14）：
 * 把三个 Agent 的事件翻译成统一语言。
 */
export function normalizeHook(agent: AgentKind, envelope: HookEnvelope, now: number): AgentEvent | null {
  const adapter = HOOK_ADAPTERS[agent];
  if (!adapter) return null;
  return adapter.normalize(envelope, now);
}
