import { useQuery } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { cn } from "cn";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar } from "@/components/role";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useArrivals } from "@/hooks/use-arrivals";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import { dispatchesQuery, dispatchQuery, ticketsQuery } from "@/lib/queries";
import type { Dispatch, Ticket } from "@/lib/types";
import { RunViewer } from "./run-viewer";

/** Running first, then most recent. */
export function runOrder(dispatches: Dispatch[]): Dispatch[] {
  return dispatches.toSorted((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.createdAt.localeCompare(a.createdAt));
}

export function RunsPage() {
  const { dispatchId } = useParams();
  const navigate = useNavigate();
  const dispatches = useQuery(dispatchesQuery);
  const tickets = useQuery(ticketsQuery(undefined));
  const ticketById = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t])), [tickets.data]);
  const ordered = useMemo(() => runOrder(dispatches.data ?? []), [dispatches.data]);

  // Open on something: the running dispatch, else the latest one.
  const first = ordered[0]?.id;
  useEffect(() => {
    if (!dispatchId && first) void navigate(`/runs/${first}`, { replace: true });
  }, [dispatchId, first, navigate]);

  // A dispatch older than the recent list can still be opened by link.
  const listed = dispatches.data?.find((d) => d.id === dispatchId);
  const single = useQuery({ ...dispatchQuery(dispatchId ?? ""), enabled: Boolean(dispatchId) && !listed && dispatches.isSuccess });
  const selected = listed ?? single.data;
  const running = ordered.filter((d) => d.status === "running").length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Live runs"
        info="Every dispatch: one attempt at one stage of one ticket. Running ones stream live."
        meta={
          running > 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <span aria-hidden className="size-2 rounded-full bg-pass text-pass motion-safe:animate-beacon" />
              {running} running
            </span>
          ) : (
            <span>Nothing running</span>
          )
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-1">
        <nav aria-label="Dispatches" className="min-h-0 overflow-y-auto border-r max-md:max-h-56 max-md:border-r-0 max-md:border-b">
          {dispatches.isError ? (
            <div className="p-4">
              <QueryError error={dispatches.error} what="dispatches" onRetry={() => void dispatches.refetch()} />
            </div>
          ) : dispatches.isPending ? (
            <div className="p-4">
              <RowsSkeleton />
            </div>
          ) : ordered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No dispatches yet. They appear here when a ready ticket's first stage starts.</p>
          ) : (
            <DispatchList dispatches={ordered} ticketById={ticketById} selectedId={dispatchId} />
          )}
        </nav>
        <div className="min-h-0">
          {selected ? (
            <RunViewer key={selected.id} dispatch={selected} ticket={ticketById.get(selected.ticketId)} />
          ) : dispatchId && single.isError ? (
            <p className="p-6 text-sm">
              There is no dispatch <code className="font-mono">{dispatchId}</code>.
            </p>
          ) : dispatches.isSuccess && ordered.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PlayIcon />
                </EmptyMedia>
                <EmptyTitle>No runs yet</EmptyTitle>
                <EmptyDescription>Start a ticket on the board; its first stage shows up here and streams live.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="p-6">
              <RowsSkeleton rows={6} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const VERDICT_TONE: Record<string, string> = { PASS: "text-pass", FAIL: "text-fail", BLOCKED: "text-blocked" };

function DispatchList({ dispatches, ticketById, selectedId }: { dispatches: Dispatch[]; ticketById: Map<string, Ticket>; selectedId?: string }) {
  const now = useNow(dispatches.some((d) => d.status === "running"));
  const fresh = useArrivals(dispatches.map((d) => d.id));
  return (
    <ol className="flex flex-col p-1.5">
      {dispatches.map((d) => {
        const ticket = ticketById.get(d.ticketId);
        const current = d.id === selectedId;
        const live = d.status === "running";
        return (
          <li key={d.id}>
            <Link
              to={`/runs/${d.id}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-2 py-2 hover:bg-accent/70 focus-visible:-outline-offset-2",
                current && "bg-accent",
                fresh.has(d.id) && "motion-safe:animate-arrive",
              )}
            >
              <RoleAvatar role={d.agentId} size="sm" live={live} tooltip={false} />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-baseline gap-1.5 text-sm font-medium">
                  {d.stage}
                  {d.attempt > 1 ? <span className="text-xs font-normal text-muted-foreground">#{d.attempt}</span> : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">{ticket?.title ?? d.ticketId}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5 text-xs">
                <span className={cn("font-mono font-medium", live ? "text-foreground" : (VERDICT_TONE[d.verdict ?? ""] ?? "text-muted-foreground"))}>
                  {live ? "live" : (d.verdict ?? (d.status === "succeeded" ? "done" : d.status))}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {live && d.startedAt ? duration(d.startedAt, null, now) : relativeTime(d.createdAt, now).replace(/ ago$/, "")}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
