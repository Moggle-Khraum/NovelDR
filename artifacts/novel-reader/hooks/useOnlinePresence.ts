import { useEffect } from "react";
import { AppState } from "react-native";

const ONLINE_URL = "wss://noveldr-online.noveldr-log.workers.dev/ws";
const FIRST_CONNECT_DELAY_MS = 10_000;
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export function useOnlinePresence(): void {
  useEffect(() => {
    if (ONLINE_URL.includes("YOUR-WORKER")) return;

    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 5_000;
    let active = false;

    const clearTimers = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pingTimer = null;
      retryTimer = null;
    };

    const disconnect = () => {
      clearTimers();
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };

    const connect = () => {
      if (!active || ws) return;
      try {
        const sock = new WebSocket(ONLINE_URL);
        ws = sock;
        sock.onopen = () => {
          backoff = 5_000;
          pingTimer = setInterval(() => {
            try {
              sock.send("ping");
            } catch {
              // ignore
            }
          }, PING_MS);
        };
        const retry = () => {
          if (ws !== sock) return;
          disconnect();
          if (!active) return;
          retryTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        };
        sock.onclose = retry;
        sock.onerror = retry;
      } catch {
        ws = null;
      }
    };

    const start = () => {
      active = true;
      retryTimer = setTimeout(connect, FIRST_CONNECT_DELAY_MS);
    };
    const stop = () => {
      active = false;
      disconnect();
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        if (!active) start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, []);
}
