import type { CmuxKey, CmuxTree, SurfaceGrid, SurfaceSnapshot } from "@car/protocol";

/**
 * Module 1：cmux Adapter —— 系统的眼睛和手（需求文档 §13）。
 *
 * 第一版用 cmux CLI 实现；后续可换成 cmux Unix Socket，
 * 上层业务只依赖这个接口，不感知实现变化。
 */
export interface CmuxClient {
  /** 是否可用（cmux 是否在跑）。 */
  ping(): Promise<boolean>;

  /** 完整拓扑：Workspace → Pane → Surface（含 Agent 进程发现结果）。 */
  getTree(): Promise<CmuxTree>;

  /** 读取某个 surface 的当前输出（纯文本，便宜，用于后台状态推断）。 */
  readSurface(surfaceId: string, options?: ReadSurfaceOptions): Promise<SurfaceSnapshot>;

  /**
   * 读取彩色渲染网格（贵一些，只给正在查看的 surface 用）。
   * 纯文本没有颜色，也没有「每个字符占几格」的信息，无法还原 TUI。
   */
  readGrid(surfaceId: string): Promise<SurfaceGrid>;

  /** 向 surface 输入文本（只打字，不回车）。 */
  sendText(surfaceId: string, text: string): Promise<void>;

  /** 向 surface 发送按键。 */
  sendKey(surfaceId: string, key: CmuxKey): Promise<void>;
}

export interface ReadSurfaceOptions {
  /** 读取行数，默认 200。 */
  lines?: number;
  /** 是否包含 scrollback。 */
  scrollback?: boolean;
}

export class CmuxError extends Error {
  constructor(
    message: string,
    readonly code: "CMUX_UNAVAILABLE" | "CMUX_COMMAND_FAILED" | "SURFACE_NOT_FOUND",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CmuxError";
  }
}
