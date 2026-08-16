import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "@car/protocol";

export type ConnectionState = "connecting" | "open" | "closed";

export interface RealtimeOptions {
  enabled: boolean;
  onMessage: (message: ServerMessage) => void;
}

/**
 * WebSocket 自动重连（需求文档 §26 / §33）。
 * 断线后指数退避重连，并在恢复时重新发送当前订阅。
 */
export function useRealtime({ enabled, onMessage }: RealtimeOptions) {
  const [state, setState] = useState<ConnectionState>("closed");
  const socketRef = useRef<WebSocket | null>(null);
  const viewingRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled) return;
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socketRef.current = socket;
    setState("connecting");

    socket.onopen = () => {
      attemptRef.current = 0;
      setState("open");
      // 重连后恢复订阅
      socket.send(JSON.stringify({ type: "subscribe", surfaceId: viewingRef.current }));
    };

    socket.onmessage = (event) => {
      try {
        handlerRef.current(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // 忽略无法解析的消息
      }
    };

    socket.onclose = () => {
      setState("closed");
      socketRef.current = null;
      if (!enabled) return;
      const attempt = Math.min(attemptRef.current++, 6);
      const delay = Math.min(500 * 2 ** attempt, 15_000);
      timerRef.current = window.setTimeout(connect, delay);
    };

    socket.onerror = () => socket.close();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.close();
      socketRef.current = null;
      setState("closed");
      return;
    }
    connect();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled, connect]);

  // 手机端切回前台时立刻重连，别等退避计时
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !socketRef.current) {
        attemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [connect]);

  const subscribe = useCallback((surfaceId: string | null) => {
    viewingRef.current = surfaceId;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "subscribe", surfaceId }));
    }
  }, []);

  return { state, subscribe };
}
