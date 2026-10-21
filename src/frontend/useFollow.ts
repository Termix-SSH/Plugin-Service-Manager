import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import {
  isElectron,
  pluginWsUrl,
  resolveConnectionOrigin,
} from "@termix-ssh/plugin-sdk/ui";
import type { JournalEntry } from "../shared/types";

/** Most lines kept in the browser. */
export const MAX_KEPT = 5000;

export type FollowSource =
  | {
      source: "journal";
      units?: string[];
      priority?: number;
      grep?: string;
      kernel?: boolean;
      lines?: number;
    }
  | { source: "file"; path: string };

export type FollowState = "idle" | "connecting" | "live" | "ended" | "error";

/**
 * Streams new journal entries or file lines over the follow socket while
 * `on` is true. Lines are kept here, capped at MAX_KEPT.
 */
export function useFollow<T extends JournalEntry | string>(
  host: PluginHostRecord | undefined,
  target: FollowSource | null,
  on: boolean,
) {
  const [lines, setLines] = useState<T[]>([]);
  const [state, setState] = useState<FollowState>("idle");
  const [error, setError] = useState("");
  const [paused, setPausedState] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const key = target ? JSON.stringify(target) : "";

  const clear = useCallback(() => setLines([]), []);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "pause", data: next }));
    }
  }, []);

  useEffect(() => {
    if (!on || !host || !target) {
      setState("idle");
      return;
    }
    let closed = false;
    setState("connecting");
    setError("");
    setLines([]);
    setPausedState(false);

    void (async () => {
      try {
        const origin = isElectron()
          ? await resolveConnectionOrigin({
              connectionOrigin: host.connectionOrigin,
            } as never)
          : "local";
        const resolved = await pluginWsUrl("service-manager", "/follow", {
          origin,
        });
        if (closed) return;
        if (!resolved) throw new Error("No server to connect to");
        const ws = new WebSocket(resolved.url, resolved.protocols);
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: "connect",
              data: {
                hostConfig: {
                  id: Number(host.id),
                  syncId: host.syncId ?? null,
                  ip: host.ip,
                },
                ...target,
              },
            }),
          );
        };
        ws.onmessage = (event) => {
          let message: {
            type?: string;
            data?: T[];
            message?: string;
          };
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.type === "started") setState("live");
          else if (message.type === "lines" && Array.isArray(message.data)) {
            const incoming = message.data;
            setLines((prev) => {
              const next = prev.concat(incoming);
              return next.length > MAX_KEPT ? next.slice(-MAX_KEPT) : next;
            });
          } else if (message.type === "error") {
            setError(message.message ?? "");
            setState("error");
          } else if (message.type === "ended") {
            setState((prev) => (prev === "error" ? prev : "ended"));
          }
        };
        ws.onclose = () => {
          if (!closed) setState((prev) => (prev === "live" ? "ended" : prev));
        };
      } catch (e) {
        if (closed) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();

    return () => {
      closed = true;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "disconnect" }));
          }
          ws.close();
        } catch {
          // already closed
        }
      }
    };
    // key stands in for target, which is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, host?.id, key]);

  return { lines, state, error, paused, setPaused, clear };
}
