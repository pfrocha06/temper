import { useQuery } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { dispatchesQuery, dispatchQuery, ticketsQuery } from "@/lib/queries";
import { groupRuns, splitRuns } from "@/lib/runs";
import type { Dispatch } from "@/lib/types";
import { RunViewer } from "./run-viewer";
import { TicketRunsList } from "./ticket-runs";

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
  const groups = useMemo(() => groupRuns(dispatches.data ?? []), [dispatches.data]);

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

  // j / k step through tickets in on-screen order, opening each one's live or latest run.
  const step = (by: number) => {
    const { running: r, latest, older } = splitRuns(groups);
    const order = [...r, ...latest, ...older];
    const at = order.findIndex((g) => g.ticketId === selected?.ticketId);
    const g = order[at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + by))];
    const next = g && (g.running ?? g.latest).id;
    if (next && next !== dispatchId) void navigate(`/runs/${next}`);
  };
  useHotkeys({ j: () => step(1), k: () => step(-1) });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Live runs"
        info="Runs grouped by ticket: each run is one attempt at one stage. Running ones stream live. j / k move between tickets."
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
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[22rem_minmax(0,1fr)] md:grid-rows-1">
        <nav aria-label="Runs by ticket" aria-keyshortcuts="j k" className="min-h-0 overflow-y-auto border-r bg-muted/20 max-md:max-h-[38vh] max-md:border-r-0 max-md:border-b">
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
            <TicketRunsList groups={groups} ticketById={ticketById} selectedId={dispatchId} />
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
