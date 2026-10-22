import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, GitPullRequestIcon, InboxIcon, PlayIcon, RadioIcon, XIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { AcChips, GateChips, RegressionCount } from "@/components/evidence";
import { Markdown } from "@/components/markdown";
import { Pipeline } from "@/components/pipeline";
import { RowsSkeleton } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_LABEL } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { acceptanceStatus, latestArtifact, parseGates } from "@/lib/gates";
import { derivePipeline } from "@/lib/pipeline";
import { ticketQuery } from "@/lib/queries";
import type { Ticket, TicketStatus } from "@/lib/types";

/** A quick look at one ticket without leaving the board. */
export function TicketSheet({
  ticketId,
  onClose,
  onStart,
  onCancel,
}: {
  ticketId: string | null;
  onClose: () => void;
  onStart: (t: Ticket) => void;
  onCancel: (t: Ticket) => void;
}) {
  return (
    <Sheet open={ticketId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">{ticketId ? <SheetBody id={ticketId} onStart={onStart} onCancel={onCancel} /> : null}</SheetContent>
    </Sheet>
  );
}

function SheetBody({ id, onStart, onCancel }: { id: string; onStart: (t: Ticket) => void; onCancel: (t: Ticket) => void }) {
  const detail = useQuery(ticketQuery(id));
  const derived = useMemo(() => {
    if (!detail.data) return undefined;
    const { ticket, dispatches, artifacts } = detail.data;
    const gates = latestArtifact(artifacts, "gates.md");
    const latest = artifacts.filter((a) => a.name !== "spec.md").toSorted((a, b) => b.id - a.id)[0];
    return { nodes: derivePipeline(ticket, dispatches), ac: acceptanceStatus(ticket, artifacts), gates: gates ? parseGates(gates.content) : undefined, latest };
  }, [detail.data]);

  if (!detail.data || !derived) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Loading ticket</SheetTitle>
          <SheetDescription className="sr-only">Loading</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <RowsSkeleton />
        </div>
      </>
    );
  }
  const { ticket, dispatches } = detail.data;
  const running = dispatches.find((d) => d.status === "running");
  const open = ticket.status !== "done" && ticket.status !== "cancelled";

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{ticket.type}</Badge>
          <Badge variant="outline">{STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}</Badge>
          <span className="text-xs text-muted-foreground">updated {relativeTime(ticket.updatedAt)}</span>
        </div>
        <SheetTitle className="text-base leading-snug">{ticket.title}</SheetTitle>
        <SheetDescription className="sr-only">Quick view of the ticket's stages, evidence and actions</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <Pipeline nodes={derived.nodes} />
        {derived.ac.items.length > 0 ? (
          <section aria-label="Acceptance criteria" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Acceptance criteria{" "}
              <span className="tabular-nums">
                {derived.ac.passed}/{derived.ac.items.length}
              </span>
            </h3>
            <AcChips summary={derived.ac} />
            <RegressionCount summary={derived.ac} />
          </section>
        ) : null}
        {derived.gates ? (
          <section aria-label="Gate checks" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Gates{derived.gates.filesChanged !== undefined ? `, ${derived.gates.filesChanged} files changed` : ""}
            </h3>
            <GateChips checks={derived.gates.checks} />
          </section>
        ) : null}
        {derived.latest ? (
          <section aria-label="Latest artifact" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Latest: <span className="font-mono">{derived.latest.name}</span>, {relativeTime(derived.latest.createdAt)}
            </h3>
            <div className="relative max-h-56 overflow-hidden rounded-md border bg-muted/30 p-3 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-12 after:bg-gradient-to-t after:from-popover">
              <Markdown className="text-[0.8125rem] [&_h1]:text-sm [&_h2]:text-sm">{derived.latest.content}</Markdown>
            </div>
          </section>
        ) : ticket.spec ? (
          <section aria-label="Spec" className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Spec</h3>
            <p className="line-clamp-6 text-sm">{ticket.spec}</p>
          </section>
        ) : null}
      </div>
      <SheetFooter className="flex-row flex-wrap border-t">
        <Button asChild size="sm">
          <Link to={`/tickets/${ticket.id}`}>
            Open ticket
            <ArrowUpRightIcon data-icon="inline-end" />
          </Link>
        </Button>
        {ticket.status === "awaiting_board" ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/inbox">
              <InboxIcon data-icon="inline-start" />
              Decide in inbox
            </Link>
          </Button>
        ) : null}
        {running ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/runs/${running.id}`}>
              <RadioIcon data-icon="inline-start" />
              Watch run
            </Link>
          </Button>
        ) : null}
        {ticket.prUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={ticket.prUrl} target="_blank" rel="noreferrer noopener">
              <GitPullRequestIcon data-icon="inline-start" />
              PR
            </a>
          </Button>
        ) : null}
        {ticket.status === "backlog" ? (
          <Button size="sm" variant="outline" onClick={() => onStart(ticket)}>
            <PlayIcon data-icon="inline-start" />
            Start
          </Button>
        ) : null}
        {open ? (
          <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => onCancel(ticket)}>
            <XIcon data-icon="inline-start" />
            Cancel
          </Button>
        ) : null}
      </SheetFooter>
    </>
  );
}
