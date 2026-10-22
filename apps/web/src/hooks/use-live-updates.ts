import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { probeAuth, useAuthRequired } from "@/lib/auth";
import { CHANGE_ROOTS, createDebouncedFlush, rootsForAudit } from "@/lib/live";

export type LiveState = "connecting" | "open" | "down";

/**
 * The one app-wide subscription to `/api/stream`. Audit and change events
 * invalidate the matching queries; a reconnect refreshes everything that was missed.
 * A stream closed by a 401 does not retry: it waits for the sign-in screen to clear.
 */
export function useLiveUpdates(): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");
  const signedOut = useAuthRequired();

  useEffect(() => {
    if (signedOut) return;
    const debounced = createDebouncedFlush((roots) => {
      for (const root of roots) void qc.invalidateQueries({ queryKey: [root] });
    });
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let everOpened = false;
    let disposed = false;

    const connect = () => {
      source = new EventSource("/api/stream");
      source.onopen = () => {
        setState("open");
        if (everOpened) void qc.invalidateQueries();
        everOpened = true;
      };
      source.onerror = () => {
        setState("down");
        // The browser retries on its own unless the connection is closed for good.
        if (source?.readyState === EventSource.CLOSED && !disposed) {
          source.close();
          // An EventSource cannot see the status: ask, and stop here if it was a 401.
          void probeAuth().then((authorised) => {
            if (authorised && !disposed) retry = setTimeout(connect, 3000);
          });
        }
      };
      source.addEventListener("change", () => debounced.add(CHANGE_ROOTS));
      source.addEventListener("audit", (e) => {
        try {
          const { kind } = JSON.parse((e as MessageEvent<string>).data) as { kind: string };
          debounced.add(rootsForAudit(kind));
        } catch {
          debounced.add(CHANGE_ROOTS);
        }
      });
    };
    connect();
    return () => {
      disposed = true;
      debounced.cancel();
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [qc, signedOut]);

  return state;
}
