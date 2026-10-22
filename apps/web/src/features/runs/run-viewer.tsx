import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLineIcon, PauseIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { cn } from "cn";
import { Pipeline } from "@/components/pipeline";
import { QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Toggle } from "@/components/ui/toggle";
import { useNow } from "@/hooks/use-now";
import { duration } from "@/lib/format";
import { derivePipeline } from "@/lib/pipeline";
import { ticketQuery } from "@/lib/queries";
import { toRunLine } from "@/lib/run-events";
import type { Dispatch, Ticket } from "@/lib/types";
import { RunLineView } from "./run-line";
import { useRunEvents } from "./use-run-events";

const VERDICT_TONE: Record<string, string> = { PASS: "text-pass", FAIL: "text-fail", BLOCKED: "text-blocked" };

export function RunViewer({ dispatch, ticket }: { dispatch: Dispatch; ticket: Ticket | undefined }) {
  const running = dispatch.status === "running";
  const { events, history, streaming } = useRunEvents(dispatch.id, running);
  const lines = useMemo(() => events.map(toRunLine), [events]);
  const now = useNow(running);
  const hasResult = lines.some((l) => l.kind === "result");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const detail = useQuery(ticketQuery(dispatch.ticketId));
  const nodes = useMemo(() => (detail.data ? derivePipeline(detail.data.ticket, detail.data.dispatches) : []), [detail.data]);
  const navigate = useNavigate();
  const m = roleMeta(dispatch.agentId);

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

  const openStage = (stage: string) => {
    const latest = nodes.find((n) => n.stage === stage)?.latest;
    if (latest) void navigate(`/runs/${latest.id}`);
  };

  return (
    <section aria-labelledby="run-h" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <RoleAvatar role={dispatch.agentId} size="md" live={running} />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 id="run-h" className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              <span className={m.text}>{m.label}</span>
              <span>{dispatch.stage}</span>
              {dispatch.attempt > 1 ? <span className="font-normal text-muted-foreground">attempt {dispatch.attempt}</span> : null}
              <span className={cn("font-mono text-xs", running ? "text-foreground" : (VERDICT_TONE[dispatch.verdict ?? ""] ?? "text-muted-foreground"))}>
                {running ? (streaming ? "live" : "connecting") : (dispatch.verdict ?? dispatch.status)}
              </span>
              {dispatch.startedAt ? (
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{duration(dispatch.startedAt, dispatch.finishedAt, now)}</span>
              ) : null}
            </h2>
            {ticket ? (
              <Link to={`/tickets/${ticket.id}`} className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline">
                {ticket.title}
              </Link>
            ) : null}
          </div>
          <Toggle size="sm" variant="outline" pressed={follow} onPressedChange={setFollow} aria-label={follow ? "Pause auto-scroll" : "Follow new events"}>
            {follow ? <PauseIcon /> : <ArrowDownToLineIcon />}
            {follow ? "Following" : "Follow"}
          </Toggle>
        </div>
        {nodes.length > 0 ? (
          <div className="overflow-x-auto">
            <Pipeline nodes={nodes} selected={dispatch.stage} onSelect={openStage} className="max-w-2xl min-w-[18rem]" />
          </div>
        ) : null}
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto py-3" tabIndex={0} aria-label="Run events">
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
            {running ? "Waiting for the agent's first event…" : "No events recorded. Gate stages run on the server and leave only a summary."}
          </p>
        ) : (
          <ol aria-live={running && follow ? "polite" : "off"} aria-relevant="additions">
            {lines.map((l, i) => (
              <RunLineView key={l.id} line={l} live={running && i === lines.length - 1} accent={m.text} />
            ))}
          </ol>
        )}
        {dispatch.summary && !running && !hasResult ? (
          <div className="mx-4 mt-3 rounded-lg border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Dispatch summary</p>
            <p className="text-sm whitespace-pre-wrap">{dispatch.summary}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
