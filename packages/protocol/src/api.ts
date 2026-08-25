import { z } from "zod";
import { AgentStateSchema, InboxSchema } from "./agent.ts";
import { CmuxKeySchema, CmuxTreeSchema, ScrollActionSchema, SurfaceSnapshotSchema } from "./cmux.ts";
import { SurfaceGridSchema } from "./grid.ts";

/** POST /api/auth/login */
export const LoginRequestSchema = z.object({
  token: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** 会话能力：默认只读，需要显式开启控制模式（需求文档 §23.2）。 */
export const SessionInfoSchema = z.object({
  authenticated: z.boolean(),
  controlMode: z.boolean(),
  /** 控制模式到期时间戳；只读时为 undefined。 */
  controlModeExpiresAt: z.number().optional(),
  controlModeTtlMs: z.number(),
  serverVersion: z.string(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** POST /api/auth/control */
export const ControlModeRequestSchema = z.object({
  enabled: z.boolean(),
});
export type ControlModeRequest = z.infer<typeof ControlModeRequestSchema>;

/** GET /api/agents */
export const AgentsResponseSchema = InboxSchema;
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;

/** GET /api/agents/:surfaceId */
export const AgentDetailResponseSchema = z.object({
  agent: AgentStateSchema,
  snapshot: SurfaceSnapshotSchema.nullable(),
});
export type AgentDetailResponse = z.infer<typeof AgentDetailResponseSchema>;

/** GET /api/tree */
export const TreeResponseSchema = CmuxTreeSchema;
export type TreeResponse = z.infer<typeof TreeResponseSchema>;

/** GET /api/surfaces/:surfaceId/output */
export const SurfaceOutputResponseSchema = SurfaceSnapshotSchema;
export type SurfaceOutputResponse = z.infer<typeof SurfaceOutputResponseSchema>;

/** POST /api/surfaces/:surfaceId/input */
export const SurfaceInputRequestSchema = z.object({
  text: z.string().max(20000),
  submit: z.boolean().default(true),
});
export type SurfaceInputRequest = z.infer<typeof SurfaceInputRequestSchema>;

/** POST /api/surfaces/:surfaceId/key */
export const SurfaceKeyRequestSchema = z.object({
  key: CmuxKeySchema,
  /** 危险按键必须带上确认标记（需求文档 §23.4）。 */
  confirm: z.boolean().optional(),
});
export type SurfaceKeyRequest = z.infer<typeof SurfaceKeyRequestSchema>;

/**
 * POST /api/surfaces/:surfaceId/scroll —— 翻页。
 *
 * 和 /key 分开：翻页只改「看到哪一屏」，不往终端里写东西，所以只读模式也允许。
 */
export const SurfaceScrollRequestSchema = z.object({
  action: ScrollActionSchema,
});
export type SurfaceScrollRequest = z.infer<typeof SurfaceScrollRequestSchema>;

/** 翻页后顺带把新画面带回来，省掉一次往返。 */
export const SurfaceScrollResponseSchema = z.object({
  ok: z.literal(true),
  grid: SurfaceGridSchema,
});
export type SurfaceScrollResponse = z.infer<typeof SurfaceScrollResponseSchema>;

/**
 * GET /api/surfaces/:surfaceId/history —— 网格之外更早的历史（纯文本、无颜色）。
 *
 * `terminal.replay` 只给最近 240 行回滚，再往上只能走 `read-screen --scrollback`。
 */
export const SurfaceHistoryResponseSchema = z.object({
  /** 已经去掉与网格重叠部分之后的历史文本。 */
  text: z.string(),
  /** cmux 一共给了多少行（含与网格重叠的部分）。 */
  totalLines: z.number().int().nonnegative(),
  /** 因为与网格重叠而被去掉的尾部行数。 */
  droppedTail: z.number().int().nonnegative(),
  /** 是否顶到了请求行数上限，上面可能还有更早的内容。 */
  truncated: z.boolean(),
});
export type SurfaceHistoryResponse = z.infer<typeof SurfaceHistoryResponseSchema>;

export const OkResponseSchema = z.object({
  ok: z.literal(true),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** POST /api/agents/:surfaceId/read —— 标记已读，RESPONDED_UNREAD → IDLE */
export const MarkReadResponseSchema = z.object({
  ok: z.literal(true),
  agent: AgentStateSchema,
});
