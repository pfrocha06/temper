import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { dispatchEventsQuery } from "@/lib/queries";
import { mergeEvents } from "@/lib/run-events";
import type { DispatchEvent } from "@/lib/types";

/**
 * Recorded events for a dispatch, then live ones while it runs. The stream is
 * opened before history is (re)fetched so nothing written in between is lost;
 * duplicates are merged away by id. Mount with `key={dispatchId}`.
 */
export function useRunEvents(dispatchId: string, running: boolean) {
  const qc = useQueryClient();
  const history = useQuery(dispatchEventsQuery(dispatchId));
  const [live, setLive] = useState<DispatchEvent[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    const query = dispatchEventsQuery(dispatchId);
    if (!running) {
      // It just finished (or was never live): one more fetch picks up the tail.
      void qc.invalidateQueries({ queryKey: query.queryKey });
      return;
    }
    const source = new EventSource(`/api/stream?dispatch=${encodeURIComponent(dispatchId)}`);
    source.onopen = () => {
      setStreaming(true);
      void qc.invalidateQueries({ queryKey: query.queryKey });
    };
    source.onerror = () => setStreaming(false);
    source.addEventListener("dispatch_event", (e) => {
      try {
        const event = JSON.parse((e as MessageEvent<string>).data) as DispatchEvent;
        if (event.dispatchId === dispatchId) setLive((prev) => [...prev, event]);
      } catch {
        // A malformed frame is skipped; the next history fetch fills the gap.
      }
    });
    return () => {
      source.close();
      setStreaming(false);
    };
  }, [dispatchId, running, qc]);

  const events = useMemo(() => mergeEvents(history.data ?? [], live), [history.data, live]);
  return { events, history, streaming };
}
