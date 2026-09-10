import { randomUUID } from "node:crypto";
import type { AgentKind, AgentState, AgentStatus } from "@car/protocol";
import { createMemoryDatabase, openDatabase, type SqlDatabase } from "./db.ts";

/**
 * 持久化层（需求文档 §23.5）。
 *
 * 只保存：Agent 状态 / 时间 / Session 信息 / 未读状态 / 用户配置 / 操作审计。
 * **不保存**：终端输出、对话全文、源码、API Key。
 * currentActivity 只存一句 ≤200 字的状态标签（例如 "Running Bash: pnpm test"）。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  surface_id        TEXT PRIMARY KEY,
  agent             TEXT NOT NULL,
  session_id        TEXT,
  workspace_id      TEXT NOT NULL,
  pane_id           TEXT,
  pid               INTEGER,
  status            TEXT NOT NULL,
  current_activity  TEXT,
  last_activity_at  INTEGER NOT NULL,
  last_viewed_at    INTEGER,
  turn_started_at   INTEGER,
  status_changed_at INTEGER NOT NULL,
  hook_connected    INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  action      TEXT NOT NULL,
  surface_id  TEXT,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 只存 session id 与时间戳；重启后手机端不用重新输 PIN。
CREATE TABLE IF NOT EXISTS web_sessions (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- 登录失败计数与锁定；持久化是为了重启不会把攻击者的计数清零。
CREATE TABLE IF NOT EXISTS login_throttle (
  key             TEXT PRIMARY KEY,
  failures        INTEGER NOT NULL,
  last_failure_at INTEGER NOT NULL,
  locked_until    INTEGER NOT NULL
);
`;

export interface PersistedAgent {
  surfaceId: string;
  agent: AgentKind;
  sessionId?: string;
  workspaceId: string;
  paneId?: string;
  pid?: number;
  status: AgentStatus;
  currentActivity?: string;
  lastActivityAt: number;
  lastViewedAt?: number;
  turnStartedAt?: number;
  statusChangedAt: number;
  hookConnected: boolean;
}

export interface AuditEntry {
  at: number;
  action: string;
  surfaceId?: string;
  detail?: string;
}

const ACTIVITY_MAX_LEN = 200;

export class StateStore {
  readonly instanceId: string;

  constructor(private readonly db: SqlDatabase) {
    this.db.exec(SCHEMA);
    const candidate = randomUUID();
    this.db.run("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING", ["instance_id", candidate]);
    const stored = this.getSetting("instance_id");
    // Explicit nonpersistent test driver has no settings; real drivers must persist identity.
    if (!stored && db.driver !== "memory") throw new Error("无法初始化服务实例 ID");
    this.instanceId = stored ?? candidate;
  }

  static async open(path: string): Promise<StateStore> {
    return new StateStore(await openDatabase(path));
  }

  static inMemory(): StateStore {
    return new StateStore(createMemoryDatabase());
  }

  get driver(): string {
    return this.db.driver;
  }

  save(state: AgentState, now: number): void {
    this.db.run(
      `INSERT INTO agent_sessions (
         surface_id, agent, session_id, workspace_id, pane_id, pid, status,
         current_activity, last_activity_at, last_viewed_at, turn_started_at,
         status_changed_at, hook_connected, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(surface_id) DO UPDATE SET
         agent=excluded.agent,
         session_id=excluded.session_id,
         workspace_id=excluded.workspace_id,
         pane_id=excluded.pane_id,
         pid=excluded.pid,
         status=excluded.status,
         current_activity=excluded.current_activity,
         last_activity_at=excluded.last_activity_at,
         last_viewed_at=excluded.last_viewed_at,
         turn_started_at=excluded.turn_started_at,
         status_changed_at=excluded.status_changed_at,
         hook_connected=excluded.hook_connected,
         updated_at=excluded.updated_at`,
      [
        state.surfaceId,
        state.agent,
        state.sessionId ?? null,
        state.workspaceId,
        state.paneId ?? null,
        state.pid ?? null,
        state.status,
        state.currentActivity ? state.currentActivity.slice(0, ACTIVITY_MAX_LEN) : null,
        state.lastActivityAt,
        state.lastViewedAt ?? null,
        state.turnStartedAt ?? null,
        state.statusChangedAt,
        state.hookConnected ? 1 : 0,
        now,
      ],
    );
  }

  loadAll(): PersistedAgent[] {
    const rows = this.db.all<Record<string, unknown>>(`SELECT * FROM agent_sessions`);
    return rows.map((row) => ({
      surfaceId: String(row["surface_id"]),
      agent: String(row["agent"]) as AgentKind,
      sessionId: row["session_id"] == null ? undefined : String(row["session_id"]),
      workspaceId: String(row["workspace_id"]),
      paneId: row["pane_id"] == null ? undefined : String(row["pane_id"]),
      pid: row["pid"] == null ? undefined : Number(row["pid"]),
      status: String(row["status"]) as AgentStatus,
      currentActivity: row["current_activity"] == null ? undefined : String(row["current_activity"]),
      lastActivityAt: Number(row["last_activity_at"]),
      lastViewedAt: row["last_viewed_at"] == null ? undefined : Number(row["last_viewed_at"]),
      turnStartedAt: row["turn_started_at"] == null ? undefined : Number(row["turn_started_at"]),
      statusChangedAt: Number(row["status_changed_at"]),
      hookConnected: Number(row["hook_connected"]) === 1,
    }));
  }

  /** Agent 已经彻底消失（进程退出且过了保留期）时清掉，避免历史记录无限堆积。 */
  deleteAgent(surfaceId: string): void {
    this.db.run(`DELETE FROM agent_sessions WHERE surface_id = ?`, [surfaceId]);
  }

  /** 操作审计：谁在什么时候对哪个 surface 做了什么写操作。 */
  audit(entry: AuditEntry): void {
    this.db.run(`INSERT INTO audit_log (at, action, surface_id, detail) VALUES (?,?,?,?)`, [
      entry.at,
      entry.action,
      entry.surfaceId ?? null,
      entry.detail ? entry.detail.slice(0, 500) : null,
    ]);
  }

  recentAudit(limit = 50): AuditEntry[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT at, action, surface_id, detail FROM audit_log ORDER BY at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((row) => ({
      at: Number(row["at"]),
      action: String(row["action"]),
      surfaceId: row["surface_id"] == null ? undefined : String(row["surface_id"]),
      detail: row["detail"] == null ? undefined : String(row["detail"]),
    }));
  }

  /** 浏览器 Session：重启服务后手机端不用重新输 Token。 */
  saveSession(session: { id: string; createdAt: number; lastSeenAt: number }): void {
    this.db.run(
      `INSERT INTO web_sessions (id, created_at, last_seen_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [session.id, session.createdAt, session.lastSeenAt],
    );
  }

  loadSessions(): Array<{ id: string; createdAt: number; lastSeenAt: number }> {
    return this.db
      .all<Record<string, unknown>>(`SELECT id, created_at, last_seen_at FROM web_sessions`)
      .map((row) => ({
        id: String(row["id"]),
        createdAt: Number(row["created_at"]),
        lastSeenAt: Number(row["last_seen_at"]),
      }));
  }

  deleteSession(id: string): void {
    this.db.run(`DELETE FROM web_sessions WHERE id = ?`, [id]);
  }

  /** Token 变了就把旧 Session 全部作废。 */
  clearSessions(): void {
    this.db.run(`DELETE FROM web_sessions`);
  }

  /** 登录限流状态。 */
  saveThrottle(entry: { key: string; failures: number; lastFailureAt: number; lockedUntil: number }): void {
    this.db.run(
      `INSERT INTO login_throttle (key, failures, last_failure_at, locked_until) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         failures = excluded.failures,
         last_failure_at = excluded.last_failure_at,
         locked_until = excluded.locked_until`,
      [entry.key, entry.failures, entry.lastFailureAt, entry.lockedUntil],
    );
  }

  loadThrottle(): Array<{ key: string; failures: number; lastFailureAt: number; lockedUntil: number }> {
    return this.db
      .all<Record<string, unknown>>(`SELECT key, failures, last_failure_at, locked_until FROM login_throttle`)
      .map((row) => ({
        key: String(row["key"]),
        failures: Number(row["failures"]),
        lastFailureAt: Number(row["last_failure_at"]),
        lockedUntil: Number(row["locked_until"]),
      }));
  }

  deleteThrottle(key: string): void {
    this.db.run(`DELETE FROM login_throttle WHERE key = ?`, [key]);
  }

  getSetting(key: string): string | undefined {
    const row = this.db.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  close(): void {
    this.db.close();
  }
}
