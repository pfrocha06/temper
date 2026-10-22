import { useDraggable } from "@dnd-kit/core";
import { CheckCheckIcon, EllipsisIcon, ExternalLinkIcon, GitPullRequestIcon, PlayIcon, XIcon } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { ExternalRefChip } from "@/components/badges";
import { PipelineStrip } from "@/components/pipeline";
import { RoleAvatar } from "@/components/role";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { duration, relativeTime } from "@/lib/format";
import type { PipelineNode } from "@/lib/pipeline";
import type { Ticket, TicketStatus } from "@/lib/types";
import { isDraggable, type CardLive } from "./board-model";

type Props = {
  ticket: Ticket;
  nodes: PipelineNode[];
  live: CardLive;
  now: number;
  fresh: boolean;
  onOpen: (id: string) => void;
  onStart: (t: Ticket) => void;
  onCancel: (t: Ticket) => void;
};

/** How long the ticket has been where it is, in the words of its column. */
function timeHint(ticket: Ticket, live: CardLive, now: number): string {
  if (live.running?.startedAt) return duration(live.running.startedAt, null, now);
  const since = relativeTime(ticket.updatedAt, now);
  if (ticket.status === "awaiting_board") return `waiting ${since.replace(/ ago$/, "")}`;
  return since;
}

export const TicketCard = memo(function TicketCard({ ticket, nodes, live, now, fresh, onOpen, onStart, onCancel }: Props) {
  const status = ticket.status as TicketStatus;
  const draggable = isDraggable(status);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id, data: { ticket }, disabled: !draggable });
  const acCount = ticket.acceptanceCriteria.length;
  const working = live.active;

  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // The title button is the focus target; keyboard users move tickets from the menu.
      tabIndex={-1}
      role={undefined}
      aria-roledescription={undefined}
      aria-labelledby={`card-${ticket.id}`}
      className={cn(
        "group/card relative flex touch-manipulation flex-col gap-2 rounded-lg border bg-card p-2.5 text-card-foreground shadow-xs transition-[border-color,box-shadow,opacity]",
        "hover:border-ring/50 has-[button[data-open]:focus-visible]:ring-2 has-[button[data-open]:focus-visible]:ring-ring",
        draggable && "cursor-grab active:cursor-grabbing",
        working && "border-l-2",
        working && roleBorder(working.role),
        status === "awaiting_board" && "border-board/50",
        isDragging && "opacity-40",
        fresh && "motion-safe:animate-arrive",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-sm bg-secondary px-1.5 py-px font-medium text-secondary-foreground">{ticket.type}</span>
        {ticket.prUrl ? (
          <span className="inline-flex items-center gap-0.5" title="Pull request open">
            <GitPullRequestIcon aria-hidden className="size-3.5" />
            <span className="sr-only">Pull request open</span>
          </span>
        ) : null}
        <span className="ml-auto tabular-nums">{timeHint(ticket, live, now)}</span>
        <CardMenu ticket={ticket} onStart={onStart} onCancel={onCancel} />
      </div>
      <h3 id={`card-${ticket.id}`} className="text-sm leading-snug font-medium">
        <button type="button" data-open onClick={() => onOpen(ticket.id)} className="text-left outline-none after:absolute after:inset-0 after:rounded-lg">
          {ticket.title}
        </button>
      </h3>
      {ticket.externalRef ? (
        <div className="flex">
          <ExternalRefChip externalRef={ticket.externalRef} />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <PipelineStrip nodes={nodes} className={cn(status === "backlog" && "opacity-50")} />
        {acCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title={`${acCount} acceptance criteria`}>
            <CheckCheckIcon aria-hidden className="size-3.5" />
            <span className="tabular-nums">{acCount}</span>
            <span className="sr-only"> acceptance criteria</span>
          </span>
        ) : null}
        {working ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{nodes.find((n) => n.state === "running")?.stage ?? ticket.stage}</span>
            <RoleAvatar role={working.role} size="xs" live />
          </span>
        ) : status === "awaiting_board" ? (
          nodes.some((n) => n.current && (n.state === "blocked" || n.state === "fail")) ? (
            <span className="ml-auto text-xs font-medium text-blocked">Stuck at {ticket.stage}</span>
          ) : (
            <span className="ml-auto text-xs font-medium text-board">Your call</span>
          )
        ) : status === "backlog" ? (
          <Button size="xs" variant="ghost" className="relative z-10 ml-auto -my-1" onClick={() => onStart(ticket)}>
            <PlayIcon data-icon="inline-start" />
            Start
          </Button>
        ) : null}
      </div>
    </article>
  );
});

function roleBorder(role: string): string {
  switch (role) {
    case "chief":
      return "border-l-role-chief";
    case "builder":
      return "border-l-role-builder";
    case "verifier":
      return "border-l-role-verifier";
    case "reviewer":
      return "border-l-role-reviewer";
    default:
      return "border-l-role-server";
  }
}

function CardMenu({ ticket, onStart, onCancel }: { ticket: Ticket; onStart: (t: Ticket) => void; onCancel: (t: Ticket) => void }) {
  const open = ticket.status !== "done" && ticket.status !== "cancelled";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="relative z-10 -my-1 -mr-1 opacity-60 group-hover/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          aria-label={`Actions for ${ticket.title}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to={`/tickets/${ticket.id}`}>
              <ExternalLinkIcon />
              Open ticket
            </Link>
          </DropdownMenuItem>
          {ticket.status === "backlog" ? (
            <DropdownMenuItem onSelect={() => onStart(ticket)}>
              <PlayIcon />
              Start (move to Ready)
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {open ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onSelect={() => onCancel(ticket)}>
                <XIcon />
                Cancel ticket…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
