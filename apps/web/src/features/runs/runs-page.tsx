import { useQuery } from "@tanstack/react-query";
import { PlayIcon } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { cn } from "cn";
import { DispatchStatus, VerdictBadge } from "@/components/badges";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import { dispatchesQuery, dispatchQuery, ticketsQuery } from "@/lib/queries";
import type { Dispatch, Ticket } from "@/lib/types";
import { RunViewer } from "./run-viewer";

export function RunsPage() {
  const { dispatchId } = useParams();
  const dispatches = useQuery(dispatchesQuery);
  const tickets = useQuery(ticketsQuery(undefined));
  const ticketById = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t])), [tickets.data]);

  // A dispatch older than the recent list can still be opened by link.
  const listed = dispatches.data?.find((d) => d.id === dispatchId);
  const single = useQuery({ ...dispatchQuery(dispatchId ?? ""), enabled: Boolean(dispatchId) && !listed && dispatches.isSuccess });
  const selected = listed ?? single.data;

  const running = dispatches.data?.filter((d) => d.status === "running").length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Live runs" description={running === 0 ? "Nothing running right now." : `${running} running now.`} />
      <div className="grid min-h-0 flex-1 md:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r max-md:max-h-64 max-md:border-r-0 max-md:border-b">
          {dispatches.isError ? (
            <div className="p-4">
              <QueryError error={dispatches.error} what="dispatches" onRetry={() => void dispatches.refetch()} />
            </div>
          ) : dispatches.isPending ? (
            <div className="p-4">
              <RowsSkeleton />
            </div>
          ) : dispatches.data.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No dispatches yet. They appear here when a ready ticket's first stage starts.</p>
          ) : (
            <DispatchList dispatches={dispatches.data} ticketById={ticketById} selectedId={dispatchId} />
          )}
        </div>
        <div className="min-h-0">
          {selected ? (
            <RunViewer key={selected.id} dispatch={selected} ticket={ticketById.get(selected.ticketId)} />
          ) : dispatchId && single.isError ? (
            <p className="p-6 text-sm">
              There is no dispatch <code className="font-mono">{dispatchId}</code>.
            </p>
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PlayIcon />
                </EmptyMedia>
                <EmptyTitle>Pick a run</EmptyTitle>
                <EmptyDescription>Choose a dispatch on the left to read its events. Running ones stream live.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}

function DispatchList({ dispatches, ticketById, selectedId }: { dispatches: Dispatch[]; ticketById: Map<string, Ticket>; selectedId?: string }) {
  const now = useNow(dispatches.some((d) => d.status === "running"));
  return (
    <ol className="flex flex-col">
      {dispatches.map((d) => {
        const ticket = ticketById.get(d.ticketId);
        const current = d.id === selectedId;
        return (
          <li key={d.id}>
            <Link
              to={`/runs/${d.id}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 border-b px-4 py-2 hover:bg-accent focus-visible:-outline-offset-2",
                current && "bg-accent",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{d.stage}</span>
                {d.attempt > 1 ? <span className="text-xs text-muted-foreground">#{d.attempt}</span> : null}
                <span className="ml-auto">{d.verdict ? <VerdictBadge verdict={d.verdict} /> : <DispatchStatus status={d.status} />}</span>
              </span>
              <span className="truncate text-xs">{ticket?.title ?? d.ticketId}</span>
              <span className="flex gap-3 text-xs text-muted-foreground">
                <span className="font-mono">
                  {d.agentId}@{d.agentVersion}
                </span>
                <span>{relativeTime(d.createdAt)}</span>
                {d.startedAt ? <span className="tabular-nums">{duration(d.startedAt, d.finishedAt, now)}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
