import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentState, CmuxKey, Inbox, ServerMessage, SessionInfo } from "@car/protocol";
import { api, ApiError } from "../api.ts";
import { useRealtime, type ConnectionState } from "../hooks/useRealtime.ts";

interface SurfaceContent {
  content: string;
  revision: number;
}

interface AppStoreValue {
  session: SessionInfo | null;
  loading: boolean;
  inbox: Inbox | null;
  connection: ConnectionState;
  error: string | null;
  contents: Record<string, SurfaceContent>;

  login(token: string): Promise<void>;
  logout(): Promise<void>;
  setControlMode(enabled: boolean): Promise<void>;
  refreshInbox(): Promise<void>;
  openSession(surfaceId: string): Promise<AgentState | null>;
  subscribe(surfaceId: string | null): void;
  sendInput(surfaceId: string, text: string, submit: boolean): Promise<void>;
  sendKey(surfaceId: string, key: CmuxKey, confirm?: boolean): Promise<void>;
  refreshOutput(surfaceId: string): Promise<void>;
  clearError(): void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [contents, setContents] = useState<Record<string, SurfaceContent>>({});
  const [error, setError] = useState<string | null>(null);
  const authenticated = session?.authenticated === true;
  const inboxRef = useRef<Inbox | null>(null);
  inboxRef.current = inbox;

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "agent.list_changed":
        setInbox(message.inbox);
        break;
      case "agent.status_changed":
        setInbox((current) => (current ? patchAgent(current, message.agent) : current));
        break;
      case "surface.snapshot":
        setContents((current) => ({
          ...current,
          [message.surfaceId]: { content: message.content, revision: message.revision },
        }));
        break;
      default:
        break;
    }
  }, []);

  const { state: connection, subscribe } = useRealtime({ enabled: authenticated, onMessage: handleMessage });

  const withError = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 401) setSession((s) => (s ? { ...s, authenticated: false } : null));
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      return null;
    }
  }, []);

  const refreshInbox = useCallback(async () => {
    const result = await withError(() => api.agents());
    if (result) setInbox(result);
  }, [withError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await api.session();
        if (!cancelled) setSession(info);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated) void refreshInbox();
  }, [authenticated, refreshInbox]);

  // WebSocket 断开期间退化为轮询，保证信息不停更新。
  useEffect(() => {
    if (!authenticated || connection === "open") return;
    const timer = window.setInterval(() => void refreshInbox(), 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, connection, refreshInbox]);

  const value = useMemo<AppStoreValue>(
    () => ({
      session,
      loading,
      inbox,
      connection,
      error,
      contents,

      async login(token: string) {
        const info = await withError(() => api.login(token));
        if (info) setSession(info);
      },

      async logout() {
        const info = await withError(() => api.logout());
        if (info) setSession(info);
        setInbox(null);
      },

      async setControlMode(enabled: boolean) {
        const info = await withError(() => api.setControlMode(enabled));
        if (info) setSession(info);
      },

      refreshInbox,

      async openSession(surfaceId: string) {
        const detail = await withError(() => api.agent(surfaceId));
        if (!detail) return null;
        if (detail.snapshot) {
          setContents((current) => ({
            ...current,
            [surfaceId]: { content: detail.snapshot!.content, revision: detail.snapshot!.revision },
          }));
        }
        setInbox((current) => (current ? patchAgent(current, detail.agent) : current));
        return detail.agent;
      },

      subscribe,

      async sendInput(surfaceId: string, text: string, submit: boolean) {
        await withError(() => api.sendInput(surfaceId, text, submit));
      },

      async sendKey(surfaceId: string, key: CmuxKey, confirm = false) {
        await withError(() => api.sendKey(surfaceId, key, confirm));
      },

      async refreshOutput(surfaceId: string) {
        const snapshot = await withError(() => api.output(surfaceId));
        if (snapshot) {
          setContents((current) => ({
            ...current,
            [surfaceId]: { content: snapshot.content, revision: snapshot.revision },
          }));
        }
      },

      clearError: () => setError(null),
    }),
    [session, loading, inbox, connection, error, contents, refreshInbox, subscribe, withError],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore 必须在 AppStoreProvider 内使用");
  return value;
}

/** 用单个 Agent 的新状态原地更新 Inbox（避免整页重排闪动）。 */
export function patchAgent(inbox: Inbox, agent: AgentState): Inbox {
  let found = false;
  const groups = inbox.groups.map((group) => ({
    ...group,
    agents: group.agents.map((item) => {
      if (item.surfaceId !== agent.surfaceId) return item;
      found = true;
      return agent;
    }),
  }));
  if (!found) return inbox;
  return { ...inbox, groups };
}

/** 从 Inbox 里找一个 Agent。 */
export function findAgent(inbox: Inbox | null, surfaceId: string): AgentState | undefined {
  if (!inbox) return undefined;
  for (const group of inbox.groups) {
    const hit = group.agents.find((agent) => agent.surfaceId === surfaceId);
    if (hit) return hit;
  }
  return undefined;
}
