import { z } from "zod";
import { AgentKindSchema, AgentStateSchema, InboxSchema } from "./agent.ts";
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

/**
 * POST /api/surfaces —— 在指定 pane 里新建一个 surface。
 *
 * 只建 terminal：`--type agent-session` 建出来的是 cmux 自己的 Agent 面板，
 * `read-screen` 报 "Surface is not a terminal"、`terminal.replay` 直接 not_found，
 * 在这边既看不到画面也发不了输入，等于建了个盲盒。
 *
 * `launch` 是白名单枚举而不是自由命令字符串 —— 这个接口开在公网上，
 * 收任意命令等于送一个远程 shell。
 */
export const CreateSurfaceRequestSchema = z.object({
  /** 目标 pane（UUID 优先，也认 pane:N 短引用）。必填：不存在「当前 pane」这种概念。 */
  paneId: z.string().min(1).max(128),
  /** pane 用短引用时需要 workspace 上下文才能定位。 */
  workspaceId: z.string().min(1).max(128).optional(),
  /** 建完顺手起哪个 Agent；null 就是一个干净的 shell。 */
  launch: AgentKindSchema.nullable().default(null),
});
export type CreateSurfaceRequest = z.infer<typeof CreateSurfaceRequestSchema>;

export const CreateSurfaceResponseSchema = z.object({
  ok: z.literal(true),
  /** 新 surface 的 UUID，可以直接跳会话页。 */
  surfaceId: z.string(),
  surfaceRef: z.string(),
  paneId: z.string().optional(),
  workspaceId: z.string().optional(),
  /** 服务端替它选的工作目录；反查不到时为 null（cmux 用自己的默认值）。 */
  cwd: z.string().nullable(),
  launched: AgentKindSchema.nullable(),
  /** 建 surface 也是写操作，同样带回续期后的到期时间（见 SurfaceWriteResponse）。 */
  controlModeExpiresAt: z.number().optional(),
});
export type CreateSurfaceResponse = z.infer<typeof CreateSurfaceResponseSchema>;

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
 * 写操作（input / key）的响应。
 *
 * 带上续期后的控制模式到期时间：服务端每次写操作都会续期，
 * 前端只有跟着续，界面上的 CONTROL 才不会比服务端先「过期」。
 */
export const SurfaceWriteResponseSchema = z.object({
  ok: z.literal(true),
  controlModeExpiresAt: z.number().optional(),
});
export type SurfaceWriteResponse = z.infer<typeof SurfaceWriteResponseSchema>;

/** POST /api/surfaces/:surfaceId/title 与 POST /api/workspaces/:workspaceId/title */
export const RenameTitleRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
});
export type RenameTitleRequest = z.infer<typeof RenameTitleRequestSchema>;

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
