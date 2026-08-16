import { z } from "zod";
import { AgentKindSchema } from "./agent.ts";

/**
 * cmux 真实结构（需求文档 §4）：
 * Workspace └── Pane └── Surface └── Agent Process
 */

export const CmuxSurfaceSchema = z.object({
  /** cmux surface UUID，跨重启稳定，作为系统主键。 */
  id: z.string(),
  /** 短引用 surface:11，重启后会变，只用于展示与 CLI 调用。 */
  ref: z.string(),
  paneId: z.string().optional(),
  paneRef: z.string().optional(),
  workspaceId: z.string(),
  workspaceRef: z.string().optional(),
  title: z.string(),
  type: z.string(),
  tty: z.string().nullable().optional(),
  focused: z.boolean(),
  selected: z.boolean(),
  index: z.number().int(),
  /** 进程发现的结果：该 surface 里跑的是哪个 Agent。 */
  agent: AgentKindSchema.nullable(),
  agentPid: z.number().int().positive().nullable(),
});
export type CmuxSurface = z.infer<typeof CmuxSurfaceSchema>;

export const CmuxPaneSchema = z.object({
  id: z.string().optional(),
  ref: z.string(),
  index: z.number().int(),
  focused: z.boolean(),
  surfaces: z.array(CmuxSurfaceSchema),
});
export type CmuxPane = z.infer<typeof CmuxPaneSchema>;

export const CmuxWorkspaceSchema = z.object({
  id: z.string(),
  ref: z.string(),
  index: z.number().int(),
  title: z.string(),
  description: z.string().nullable().optional(),
  selected: z.boolean(),
  windowRef: z.string().optional(),
  panes: z.array(CmuxPaneSchema),
});
export type CmuxWorkspace = z.infer<typeof CmuxWorkspaceSchema>;

export const CmuxTreeSchema = z.object({
  workspaces: z.array(CmuxWorkspaceSchema),
  /** pid → surface UUID，用于把 Hook 上报的 pid 关联到 surface。 */
  pidIndex: z.record(z.string()).default({}),
  fetchedAt: z.number(),
});
export type CmuxTree = z.infer<typeof CmuxTreeSchema>;

export const SurfaceSnapshotSchema = z.object({
  surfaceId: z.string(),
  surfaceRef: z.string().optional(),
  workspaceId: z.string().optional(),
  /** 纯文本内容（第一版不做完整 terminal emulator）。 */
  content: z.string(),
  /** 内容变化才自增。 */
  revision: z.number().int().nonnegative(),
  fetchedAt: z.number(),
});
export type SurfaceSnapshot = z.infer<typeof SurfaceSnapshotSchema>;

/** 第一版允许的按键白名单（需求文档 §22）。 */
export const CmuxKeySchema = z.enum([
  "enter",
  "escape",
  "tab",
  "up",
  "down",
  "ctrl+c",
]);
export type CmuxKey = z.infer<typeof CmuxKeySchema>;

export const ALLOWED_KEYS: readonly CmuxKey[] = CmuxKeySchema.options;

/** 需要二次确认的危险操作（需求文档 §23.4）。 */
export const DANGEROUS_KEYS: readonly CmuxKey[] = ["ctrl+c"];

export function isDangerousKey(key: CmuxKey): boolean {
  return DANGEROUS_KEYS.includes(key);
}

/** 前端按钮名 → cmux CLI 键名。 */
const KEY_ALIASES: Record<string, CmuxKey> = {
  enter: "enter",
  return: "enter",
  esc: "escape",
  escape: "escape",
  tab: "tab",
  up: "up",
  arrowup: "up",
  down: "down",
  arrowdown: "down",
  "ctrl+c": "ctrl+c",
  "ctrl-c": "ctrl+c",
  ctrlc: "ctrl+c",
};

export function normalizeKey(raw: string): CmuxKey | null {
  return KEY_ALIASES[raw.trim().toLowerCase()] ?? null;
}
