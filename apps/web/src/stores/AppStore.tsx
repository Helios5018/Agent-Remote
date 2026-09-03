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
import type {
  AgentKind,
  AgentState,
  CmuxKey,
  CreateSurfaceResponse,
  CmuxSurface,
  CmuxTree,
  CmuxWorkspace,
  Inbox,
  ScrollAction,
  ServerMessage,
  SessionInfo,
  SurfaceGrid,
  SurfaceHistoryResponse,
} from "@car/protocol";
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
  /** cmux 真实结构：Workspace → Pane → Surface，首页直接按它渲染。 */
  tree: CmuxTree | null;
  connection: ConnectionState;
  error: string | null;
  contents: Record<string, SurfaceContent>;
  /** surfaceId → 彩色渲染网格。 */
  grids: Record<string, SurfaceGrid>;

  login(token: string): Promise<void>;
  logout(): Promise<void>;
  setControlMode(enabled: boolean): Promise<void>;
  refreshInbox(): Promise<void>;
  refreshTree(): Promise<void>;
  openSession(surfaceId: string): Promise<AgentState | null>;
  /**
   * 在某个 pane 里新建一个 surface；成功后拓扑已刷新。
   * 和其它写操作一样：失败会抛出，调用方要据此给出可见的反馈。
   */
  createSurface(
    paneId: string,
    workspaceId: string | undefined,
    launch: AgentKind | null,
  ): Promise<CreateSurfaceResponse>;
  subscribe(surfaceId: string | null): void;
  /** 写操作失败会抛出 —— 调用方要据此保住用户没发出去的内容。 */
  sendInput(surfaceId: string, text: string, submit: boolean): Promise<void>;
  sendKey(surfaceId: string, key: CmuxKey, confirm?: boolean): Promise<void>;
  renameSurface(surfaceId: string, title: string): Promise<void>;
  renameWorkspace(workspaceId: string, title: string): Promise<void>;
  /** 翻页（只读模式下也可用），成功后网格直接被替换成滚动后的画面。 */
  scrollSurface(surfaceId: string, action: ScrollAction): Promise<void>;
  /** 拉网格之外更早的历史（纯文本）。 */
  loadHistory(surfaceId: string, drop: number): Promise<SurfaceHistoryResponse | null>;
  refreshOutput(surfaceId: string): Promise<void>;
  refreshGrid(surfaceId: string): Promise<void>;
  clearError(): void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [tree, setTree] = useState<CmuxTree | null>(null);
  const [contents, setContents] = useState<Record<string, SurfaceContent>>({});
  const [grids, setGrids] = useState<Record<string, SurfaceGrid>>({});
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
      case "surface.grid":
        setGrids((current) => ({ ...current, [message.surfaceId]: message.grid }));
        break;
      default:
        break;
    }
  }, []);

  const { state: connection, subscribe } = useRealtime({ enabled: authenticated, onMessage: handleMessage });

  /**
   * 统一处理接口错误。
   *
   * 401 / READ_ONLY 都要顺手把本地会话状态改对：控制模式在服务端会静默过期，
   * 徽标要是还停在 CONTROL，用户就会对着一个「假 CONTROL」反复点发送。
   */
  const noteApiError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError) {
      if (caught.status === 401) setSession((s) => (s ? { ...s, authenticated: false } : null));
      if (caught.code === "READ_ONLY") {
        setSession((s) => (s ? { ...s, controlMode: false, controlModeExpiresAt: undefined } : s));
      }
      setError(caught.message);
    } else {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  /** 服务端每次写操作都会给控制模式续期，本地倒计时跟着走。 */
  const noteControlRenewed = useCallback((expiresAt: number | undefined) => {
    if (!expiresAt) return;
    setSession((s) => (s?.controlMode ? { ...s, controlModeExpiresAt: expiresAt } : s));
  }, []);

  const withError = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const result = await fn();
        setError(null);
        return result;
      } catch (caught) {
        noteApiError(caught);
        return null;
      }
    },
    [noteApiError],
  );

  const refreshInbox = useCallback(async () => {
    const result = await withError(() => api.agents());
    if (result) setInbox(result);
  }, [withError]);

  const refreshTree = useCallback(async () => {
    const result = await withError(() => api.tree());
    if (result) setTree(result);
  }, [withError]);

  const refreshOutput = useCallback(
    async (surfaceId: string) => {
      const snapshot = await withError(() => api.output(surfaceId));
      if (snapshot) {
        setContents((current) => ({
          ...current,
          [surfaceId]: { content: snapshot.content, revision: snapshot.revision },
        }));
      }
    },
    [withError],
  );

  const refreshGrid = useCallback(
    async (surfaceId: string) => {
      const grid = await withError(() => api.grid(surfaceId));
      if (grid) setGrids((current) => ({ ...current, [surfaceId]: grid }));
    },
    [withError],
  );

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

  /*
   * 控制模式到点自动回落。
   *
   * 服务端过期是静默的，前端不自己倒计时的话徽标会一直亮着 CONTROL，
   * 用户要等到点了发送被 403 才知道 —— 那一下的内容还发不出去。
   */
  useEffect(() => {
    const expiresAt = session?.controlModeExpiresAt;
    if (session?.controlMode !== true || !expiresAt) return;
    const timer = window.setTimeout(
      () => setSession((s) => (s ? { ...s, controlMode: false, controlModeExpiresAt: undefined } : s)),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session?.controlMode, session?.controlModeExpiresAt]);

  const value = useMemo<AppStoreValue>(
    () => ({
      session,
      loading,
      inbox,
      tree,
      connection,
      error,
      contents,
      grids,

      async login(token: string) {
        const info = await withError(() => api.login(token));
        if (info) setSession(info);
      },

      async logout() {
        const info = await withError(() => api.logout());
        if (info) setSession(info);
        setInbox(null);
        setTree(null);
        setGrids({});
      },

      async setControlMode(enabled: boolean) {
        const info = await withError(() => api.setControlMode(enabled));
        if (info) setSession(info);
      },

      refreshInbox,
      refreshTree,

      async openSession(surfaceId: string) {
        // 非 Agent 的 surface（shell / browser）没有 Agent 状态，
        // 但仍然允许只读查看，所以 404 不算错误，直接退化成读输出。
        let detail: Awaited<ReturnType<typeof api.agent>> | null = null;
        try {
          detail = await api.agent(surfaceId);
          setError(null);
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 404) {
            // 非 Agent 的 surface 没有状态，但照样能看彩色画面
            await refreshGrid(surfaceId);
            return null;
          }
          if (caught instanceof ApiError && caught.status === 401) {
            setSession((s) => (s ? { ...s, authenticated: false } : null));
          }
          setError(caught instanceof Error ? caught.message : String(caught));
          return null;
        }
        if (detail.snapshot) {
          setContents((current) => ({
            ...current,
            [surfaceId]: { content: detail.snapshot!.content, revision: detail.snapshot!.revision },
          }));
        }
        setInbox((current) => (current ? patchAgent(current, detail.agent) : current));
        return detail.agent;
      },

      async createSurface(paneId: string, workspaceId: string | undefined, launch: AgentKind | null) {
        // 和 sendInput 一样失败即抛出：调用方要就地说明「为什么没建成」，
        // 吞成 null 的话按钮点下去毫无动静，和坏了没区别。
        try {
          const result = await api.createSurface(paneId, workspaceId, launch);
          setError(null);
          noteControlRenewed(result.controlModeExpiresAt);
          // 新 tab 得立刻出现在结构树里，否则跳过去会看到「找不到 surface」。
          await refreshTree();
          return result;
        } catch (caught) {
          noteApiError(caught);
          throw caught;
        }
      },

      subscribe,

      /*
       * 写操作故意不走 withError：它把异常吞成 null，调用方分不清成功还是失败，
       * Composer 就会在发送失败后照样清空输入框 —— 表现出来就是「点了没反应，字还没了」。
       */
      async sendInput(surfaceId: string, text: string, submit: boolean) {
        try {
          const result = await api.sendInput(surfaceId, text, submit);
          setError(null);
          noteControlRenewed(result.controlModeExpiresAt);
        } catch (caught) {
          noteApiError(caught);
          throw caught;
        }
      },

      async sendKey(surfaceId: string, key: CmuxKey, confirm = false) {
        try {
          const result = await api.sendKey(surfaceId, key, confirm);
          setError(null);
          noteControlRenewed(result.controlModeExpiresAt);
        } catch (caught) {
          noteApiError(caught);
          throw caught;
        }
      },

      async renameSurface(surfaceId: string, title: string) {
        try {
          const result = await api.renameSurface(surfaceId, title);
          setError(null);
          noteControlRenewed(result.controlModeExpiresAt);
          await Promise.all([refreshTree(), refreshInbox()]);
        } catch (caught) {
          noteApiError(caught);
          throw caught;
        }
      },

      async renameWorkspace(workspaceId: string, title: string) {
        try {
          const result = await api.renameWorkspace(workspaceId, title);
          setError(null);
          noteControlRenewed(result.controlModeExpiresAt);
          await Promise.all([refreshTree(), refreshInbox()]);
        } catch (caught) {
          noteApiError(caught);
          throw caught;
        }
      },

      async scrollSurface(surfaceId: string, action: ScrollAction) {
        const result = await withError(() => api.scroll(surfaceId, action));
        if (result) setGrids((current) => ({ ...current, [surfaceId]: result.grid }));
      },

      loadHistory: (surfaceId: string, drop: number) => withError(() => api.history(surfaceId, drop)),

      refreshOutput,
      refreshGrid,

      clearError: () => setError(null),
    }),
    [
      session,
      loading,
      inbox,
      tree,
      connection,
      error,
      contents,
      grids,
      refreshInbox,
      refreshTree,
      refreshOutput,
      refreshGrid,
      subscribe,
      withError,
      noteApiError,
      noteControlRenewed,
    ],
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

/** surfaceId → { surface, workspace }，用于给没有 Agent 的 surface 也标出归属。 */
export function findSurface(
  tree: CmuxTree | null,
  surfaceId: string,
): { surface: CmuxSurface; workspace: CmuxWorkspace } | undefined {
  if (!tree) return undefined;
  for (const workspace of tree.workspaces) {
    for (const pane of workspace.panes) {
      const surface = pane.surfaces.find((item) => item.id === surfaceId);
      if (surface) return { surface, workspace };
    }
  }
  return undefined;
}

/** 把 Inbox 摊平成 surfaceId → AgentState，树视图逐行查状态用。 */
export function agentsBySurface(inbox: Inbox | null): Map<string, AgentState> {
  const map = new Map<string, AgentState>();
  for (const group of inbox?.groups ?? []) {
    for (const agent of group.agents) map.set(agent.surfaceId, agent);
  }
  return map;
}
