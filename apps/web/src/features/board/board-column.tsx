import { useDroppable } from "@dnd-kit/core";
import { CircleDashedIcon, CircleDotIcon, CircleIcon, CircleCheckIcon, HandIcon, PlayIcon, XIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import { STATUS_LABEL } from "@/lib/constants";
import type { TicketStatus } from "@/lib/types";

const COLUMN_ICON: Record<TicketStatus, LucideIcon> = {
  backlog: CircleDashedIcon,
  ready: CircleIcon,
  in_progress: CircleDotIcon,
  awaiting_board: HandIcon,
  done: CircleCheckIcon,
  cancelled: XIcon,
};

const EMPTY_HINT: Record<TicketStatus, string> = {
  backlog: "New tickets wait here until you start them.",
  ready: "Started tickets wait here for a free agent.",
  in_progress: "No ticket is being worked on.",
  awaiting_board: "Nothing needs the board.",
  done: "Finished tickets land here.",
  cancelled: "Cancelled tickets.",
};

const DROP_LABEL: Partial<Record<TicketStatus, { label: string; icon: LucideIcon }>> = {
  ready: { label: "Drop to start", icon: PlayIcon },
  cancelled: { label: "Drop to cancel", icon: XIcon },
};

type Props = {
  status: TicketStatus;
  count: number;
  /** A drag is in progress and this column accepts the dragged card. */
  accepting: boolean;
  /** Collapsed to a narrow strip: empty, or folded away like Cancelled. */
  compact: boolean;
  children: ReactNode;
};

/** A board column. Empty columns fold into a strip so the full ones get the room, and open up as drop targets. */
export function BoardColumn({ status, count, accepting, compact, children }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !accepting });
  const Icon = COLUMN_ICON[status];
  const id = `col-${status}`;
  const drop = DROP_LABEL[status];
  const danger = status === "cancelled";

  if (accepting && drop) {
    const DropIcon = drop.icon;
    return (
      <section
        ref={setNodeRef}
        aria-labelledby={id}
        className={cn(
          "flex min-h-24 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm transition-colors md:min-w-44 md:flex-1 md:self-stretch",
          danger ? "border-fail/50 text-fail" : "border-board/50 text-board",
          isOver && (danger ? "bg-fail/10" : "bg-board/10"),
        )}
      >
        <DropIcon aria-hidden className="size-5" />
        <h2 id={id} className="font-medium">
          {drop.label}
        </h2>
        <span className="text-xs opacity-80">{STATUS_LABEL[status]}</span>
      </section>
    );
  }

  if (compact) {
    return (
      <section
        ref={setNodeRef}
        aria-labelledby={id}
        title={count === 0 ? EMPTY_HINT[status] : undefined}
        className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground md:w-11 md:flex-col md:px-0 md:py-3"
      >
        <Icon aria-hidden className="size-4" />
        <h2 id={id} className="text-xs font-medium md:[writing-mode:vertical-rl]">
          {STATUS_LABEL[status]} <span className="tabular-nums">{count}</span>
        </h2>
        {children}
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={id}
      className="flex shrink-0 flex-col rounded-lg bg-muted/40 md:max-h-full md:max-w-96 md:min-w-64 md:flex-1 md:basis-0"
    >
      <header className="flex h-9 items-center gap-2 px-2.5">
        <Icon aria-hidden className={cn("size-4", status === "awaiting_board" ? "text-board" : "text-muted-foreground")} />
        <h2 id={id} className="text-sm font-medium">
          {STATUS_LABEL[status]}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </header>
      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</ol>
    </section>
  );
}
