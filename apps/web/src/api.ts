import type {
  AgentDetailResponse,
  CmuxKey,
  Inbox,
  SessionInfo,
  SurfaceSnapshot,
  TreeResponse,
} from "@car/protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  const text = await response.text();
  const body = text ? safeParse(text) : null;

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? "UNKNOWN", error?.message ?? response.statusText);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  session: () => request<SessionInfo>("/api/auth/session"),

  login: (token: string) =>
    request<SessionInfo>("/api/auth/login", { method: "POST", body: JSON.stringify({ token }) }),

  logout: () => request<SessionInfo>("/api/auth/logout", { method: "POST" }),

  setControlMode: (enabled: boolean) =>
    request<SessionInfo>("/api/auth/control", { method: "POST", body: JSON.stringify({ enabled }) }),

  agents: () => request<Inbox>("/api/agents"),

  agent: (surfaceId: string) => request<AgentDetailResponse>(`/api/agents/${encodeURIComponent(surfaceId)}`),

  markRead: (surfaceId: string) =>
    request<{ ok: true }>(`/api/agents/${encodeURIComponent(surfaceId)}/read`, { method: "POST" }),

  tree: () => request<TreeResponse>("/api/tree"),

  output: (surfaceId: string) =>
    request<SurfaceSnapshot>(`/api/surfaces/${encodeURIComponent(surfaceId)}/output`),

  sendInput: (surfaceId: string, text: string, submit: boolean) =>
    request<{ ok: true }>(`/api/surfaces/${encodeURIComponent(surfaceId)}/input`, {
      method: "POST",
      body: JSON.stringify({ text, submit }),
    }),

  sendKey: (surfaceId: string, key: CmuxKey, confirm = false) =>
    request<{ ok: true }>(`/api/surfaces/${encodeURIComponent(surfaceId)}/key`, {
      method: "POST",
      body: JSON.stringify({ key, confirm }),
    }),
};
