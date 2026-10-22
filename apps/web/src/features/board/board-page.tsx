import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileInputIcon, FolderGit2Icon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { PipelineStrip } from "@/components/pipeline";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { CancelTicketDialog } from "@/features/ticket/ticket-actions";
import { useAppActions } from "@/hooks/use-app-actions";
import { useArrivals } from "@/hooks/use-arrivals";
import { useNow } from "@/hooks/use-now";
import { useProject } from "@/hooks/use-project";
import { groupByStatus } from "@/lib/board";
import { STATUS_LABEL } from "@/lib/constants";
import { derivePipeline, dispatchesByTicket } from "@/lib/pipeline";
import { dispatchesQuery, statusQuery, ticketsQuery, useStartTicket } from "@/lib/queries";
import type { Ticket, TicketStatus } from "@/lib/types";
import { ActivityStrip } from "./activity-strip";
import { BoardColumn } from "./board-column";
import { canDrop, liveFor } from "./board-model";
import { TicketCard } from "./ticket-card";
import { TicketSheet } from "./ticket-sheet";

const NO_DISPATCHES: never[] = [];
const titleOf = (data: unknown) => (data as { ticket?: Ticket } | undefined)?.ticket?.title ?? "the ticket";

/** The column under the pointer wins; touch drags fall back to overlap. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

export function BoardPage() {
  const { project, isLoading: projectsLoading } = useProject();
  const tickets = useQuery({ ...ticketsQuery(project?.id), enabled: Boolean(project) });
  const dispatches = useQuery(dispatchesQuery);
  const status = useQuery(statusQuery);
  const { show } = useAppActions();
  const start = useStartTicket();
  const [params, setParams] = useSearchParams();
  const openId = params.get("t");
  const [cancelling, setCancelling] = useState<Ticket | null>(null);
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const ticketList = tickets.data;
  const dispatchList = dispatches.data ?? NO_DISPATCHES;
  const columns = useMemo(() => groupByStatus(ticketList ?? []), [ticketList]);
  const pipelines = useMemo(() => {
    const byTicket = dispatchesByTicket(dispatchList);
    return new Map((ticketList ?? []).map((t) => [t.id, derivePipeline(t, byTicket.get(t.id) ?? [])]));
  }, [ticketList, dispatchList]);
  const ticketById = useMemo(() => new Map((ticketList ?? []).map((t) => [t.id, t])), [ticketList]);
  const fresh = useArrivals(ticketList?.map((t) => `${t.id}:${t.status}`));
  const active = status.data?.active ?? NO_DISPATCHES;
  const now = useNow(active.length > 0);

  const onOpen = useCallback((id: string) => setParams((p) => (p.set("t", id), p)), [setParams]);
  const onClose = useCallback(() => setParams((p) => (p.delete("t"), p)), [setParams]);
  const onStart = useCallback(
    (t: Ticket) =>
      start.mutate(t.id, {
        onSuccess: () => toast.success(`Started “${t.title}”`),
        onError: (e) => toast.error(`Could not start: ${e.message}`),
      }),
    // `start.mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onCancel = useCallback((t: Ticket) => setCancelling(t), []);

  if (!projectsLoading && !project) return <NoProject />;

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as { ticket: Ticket }).ticket);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const t = (e.active.data.current as { ticket: Ticket }).ticket;
    const to = e.over?.id as TicketStatus | undefined;
    if (!to || !canDrop(t.status as TicketStatus, to)) return;
    if (to === "ready") onStart(t);
    else if (to === "cancelled") setCancelling(t);
  };

  const total = ticketList?.length ?? 0;
  const counts = Object.fromEntries(columns.map((c) => [c.status, c.tickets.length])) as Record<TicketStatus, number>;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Board"
        info="Drag a backlog ticket to Ready to start it, or any open ticket onto Cancelled. Click a card for a quick look."
        meta={
          project ? (
            <>
              <span className="tabular-nums">{total} tickets</span>
              {counts.awaiting_board > 0 ? <span className="font-medium text-board tabular-nums">{counts.awaiting_board} need you</span> : null}
            </>
          ) : null
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => show("import-spec")} disabled={!project}>
              <FileInputIcon data-icon="inline-start" />
              Import spec
              <Kbd className="ml-1 max-md:hidden">I</Kbd>
            </Button>
            <Button size="sm" onClick={() => show("new-ticket")} disabled={!project}>
              <PlusIcon data-icon="inline-start" />
              New ticket
              <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground max-md:hidden">N</Kbd>
            </Button>
          </>
        }
      />
      <ActivityStrip status={status.data} dispatches={dispatchList} ticketById={ticketById} />
      <div className="min-h-0 flex-1 p-3 md:px-6 md:py-4">
        {tickets.isError ? (
          <QueryError error={tickets.error} what="tickets" onRetry={() => void tickets.refetch()} />
        ) : tickets.isPending ? (
          <RowsSkeleton rows={5} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
            accessibility={{
              screenReaderInstructions: { draggable: "Use the card's actions menu to start or cancel a ticket with the keyboard." },
              announcements: {
                onDragStart: ({ active }) => `Picked up ${titleOf(active.data.current)}.`,
                onDragOver: ({ active, over }) => (over ? `${titleOf(active.data.current)} is over ${STATUS_LABEL[over.id as TicketStatus]}.` : undefined),
                onDragEnd: ({ active, over }) =>
                  over ? `Dropped ${titleOf(active.data.current)} on ${STATUS_LABEL[over.id as TicketStatus]}.` : `Put ${titleOf(active.data.current)} back.`,
                onDragCancel: ({ active }) => `Put ${titleOf(active.data.current)} back.`,
              },
            }}
          >
            <div className="flex h-full flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-1">
              {columns.map((c) => {
                const accepting = dragging !== null && canDrop(dragging.status as TicketStatus, c.status);
                const folded = c.status === "cancelled" && !showCancelled;
                const compact = !accepting && (c.tickets.length === 0 || folded);
                return (
                  <BoardColumn key={c.status} status={c.status} count={c.tickets.length} accepting={accepting} compact={compact}>
                    {compact ? (
                      folded && c.tickets.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto md:ml-0"
                          aria-label={`Show ${c.tickets.length} cancelled`}
                          onClick={() => setShowCancelled(true)}
                        >
                          <ChevronRightIcon />
                        </Button>
                      ) : null
                    ) : (
                      c.tickets.map((t) => (
                        <li key={t.id}>
                          <TicketCard
                            ticket={t}
                            nodes={pipelines.get(t.id) ?? []}
                            live={liveFor(t, active, dispatchList)}
                            now={now}
                            fresh={fresh.has(`${t.id}:${t.status}`)}
                            onOpen={onOpen}
                            onStart={onStart}
                            onCancel={onCancel}
                          />
                        </li>
                      ))
                    )}
                  </BoardColumn>
                );
              })}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging ? (
                <div className="flex w-64 rotate-1 flex-col gap-2 rounded-lg border bg-card p-2.5 text-sm font-medium shadow-lg">
                  {dragging.title}
                  <PipelineStrip nodes={pipelines.get(dragging.id) ?? []} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <TicketSheet ticketId={openId} onClose={onClose} onStart={onStart} onCancel={onCancel} />
      <CancelTicketDialog ticket={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

function NoProject() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2Icon />
        </EmptyMedia>
        <EmptyTitle>No project yet</EmptyTitle>
        <EmptyDescription>
          Register the repository Temper should work on, then come back to add tickets:
          <code className="mt-2 block rounded-md bg-muted px-2 py-1 font-mono text-xs">temper project add --name NAME --repo PATH</code>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
