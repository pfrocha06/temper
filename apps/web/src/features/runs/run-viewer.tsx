import { ArrowDownToLineIcon, PauseIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DispatchStatus, VerdictBadge } from "@/components/badges";
import { QueryError, RowsSkeleton } from "@/components/query-state";
import { Toggle } from "@/components/ui/toggle";
import { useNow } from "@/hooks/use-now";
import { duration } from "@/lib/format";
import { toRunLine } from "@/lib/run-events";
import type { Dispatch, Ticket } from "@/lib/types";
import { RunLineView } from "./run-line";
import { useRunEvents } from "./use-run-events";

export function RunViewer({ dispatch, ticket }: { dispatch: Dispatch; ticket: Ticket | undefined }) {
  const running = dispatch.status === "running";
  const { events, history, streaming } = useRunEvents(dispatch.id, running);
  const lines = useMemo(() => events.map(toRunLine), [events]);
  const now = useNow(running);
  const hasResult = lines.some((l) => l.kind === "result");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [lines.length, follow]);

  // Scrolling up to read pauses following; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  return (
    <section aria-labelledby="run-h" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <h2 id="run-h" className="text-sm font-semibold">
          {dispatch.stage}
          {dispatch.attempt > 1 ? <span className="font-normal text-muted-foreground"> attempt {dispatch.attempt}</span> : null}
        </h2>
        {ticket ? (
          <Link to={`/tickets/${ticket.id}`} className="min-w-0 truncate text-sm text-primary hover:underline">
            {ticket.title}
          </Link>
        ) : null}
        <span className="font-mono text-xs text-muted-foreground">
          {dispatch.agentId}@{dispatch.agentVersion}
        </span>
        <VerdictBadge verdict={dispatch.verdict} />
        <DispatchStatus status={dispatch.status} />
        {dispatch.startedAt ? <span className="text-xs text-muted-foreground tabular-nums">{duration(dispatch.startedAt, dispatch.finishedAt, now)}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {running ? <span className="text-xs text-muted-foreground">{streaming ? "Live" : "Connecting…"}</span> : null}
          <Toggle
            size="sm"
            variant="outline"
            pressed={follow}
            onPressedChange={setFollow}
            aria-label={follow ? "Pause auto-scroll" : "Follow new events"}
          >
            {follow ? <PauseIcon /> : <ArrowDownToLineIcon />}
            {follow ? "Following" : "Follow"}
          </Toggle>
        </div>
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto py-2" tabIndex={0} aria-label="Run events">
        {history.isError ? (
          <div className="px-4">
            <QueryError error={history.error} what="run events" onRetry={() => void history.refetch()} />
          </div>
        ) : history.isPending ? (
          <div className="px-4">
            <RowsSkeleton rows={6} />
          </div>
        ) : lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {running ? "Waiting for the agent's first event…" : "This dispatch recorded no events. Gate stages run on the server and only leave a summary."}
          </p>
        ) : (
          <ol aria-live={running && follow ? "polite" : "off"} aria-relevant="additions">
            {lines.map((l) => (
              <RunLineView key={l.id} line={l} />
            ))}
          </ol>
        )}
        {dispatch.summary && !running && !hasResult ? (
          <div className="mx-4 mt-3 rounded-md border bg-muted/50 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Dispatch summary</p>
            <p className="text-sm whitespace-pre-wrap">{dispatch.summary}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
