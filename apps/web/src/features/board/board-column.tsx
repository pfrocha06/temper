import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { BoardColumn as Column } from "@/lib/board";
import { STATUS_LABEL } from "@/lib/constants";
import type { TicketStatus } from "@/lib/types";
import { TicketCard } from "./ticket-card";

const EMPTY_HINT: Record<TicketStatus, string> = {
  backlog: "New tickets wait here until you start them.",
  ready: "Started tickets wait here for a free agent.",
  in_progress: "No ticket is being worked on.",
  awaiting_board: "Nothing needs the board.",
  done: "Finished tickets land here.",
  cancelled: "",
};

export function BoardColumn({ column, collapsible = false }: { column: Column; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const id = `col-${column.status}`;
  if (!open) {
    return (
      <section aria-labelledby={id} className="flex w-10 shrink-0 flex-col items-center rounded-md border border-dashed py-2">
        <Button variant="ghost" size="icon-sm" aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)} aria-label={`Show ${STATUS_LABEL[column.status]} (${column.tickets.length})`}>
          <ChevronRightIcon />
        </Button>
        <h2 id={id} className="mt-2 text-xs font-medium text-muted-foreground [writing-mode:vertical-rl]">
          {STATUS_LABEL[column.status]} {column.tickets.length}
        </h2>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="flex max-w-80 min-w-52 flex-1 basis-0 flex-col rounded-md bg-muted/50">
      <header className="flex h-9 items-center gap-2 px-2.5">
        <h2 id={id} className="text-sm font-medium">
          {STATUS_LABEL[column.status]}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{column.tickets.length}</span>
        {collapsible ? (
          <Button variant="ghost" size="xs" className="ml-auto" aria-expanded onClick={() => setOpen(false)}>
            Hide
          </Button>
        ) : null}
      </header>
      <ol className={cn("flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5")}>
        {column.tickets.length === 0 ? (
          <li className="px-1 py-2 text-xs text-muted-foreground">{EMPTY_HINT[column.status]}</li>
        ) : (
          column.tickets.map((t) => (
            <li key={t.id}>
              <TicketCard ticket={t} />
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
