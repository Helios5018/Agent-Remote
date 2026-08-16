import type { CmuxClient } from "./cmux/client.ts";
import type { Poller } from "./realtime/poller.ts";
import type { RealtimeHub } from "./realtime/hub.ts";
import type { SessionManager } from "./security/token.ts";
import type { StateEngine } from "./state/engine.ts";
import type { StateStore } from "./state/store.ts";
import type { ServerConfig } from "./config.ts";

/** 一次运行所需要的全部依赖，方便测试里整体替换。 */
export interface AppContext {
  config: ServerConfig;
  client: CmuxClient;
  engine: StateEngine;
  store: StateStore;
  sessions: SessionManager;
  hub: RealtimeHub;
  poller?: Poller;
  now: () => number;
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "READ_ONLY"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFIRM_REQUIRED"
  | "CMUX_UNAVAILABLE"
  | "INTERNAL";

export function apiError(code: ApiErrorCode, message: string) {
  return { error: { code, message } } as const;
}
