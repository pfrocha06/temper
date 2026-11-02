import { ChevronRightIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon, HandIcon, XIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { ActiveDispatch } from "@/lib/types";
import { WORK_COLUMN_LABEL, type WorkColumn, type WorkItem } from "@/lib/work";
import { WorkCard } from "./work-card";

const ICON: Record<WorkColumn, LucideIcon> = {
  backlog: CircleDashedIcon,
  in_progress: CircleDotIcon,
  needs_you: HandIcon,
  done: CircleCheckIcon,
  cancelled: XIcon,
};

const EMPTY_HINT: Record<WorkColumn, string> = {
  backlog: "Imported issues and specs wait here until you start them.",
  in_progress: "Nothing is being worked on.",
  needs_you: "Nothing needs you.",
  done: "Finished work lands here.",
  cancelled: "Work whose tickets were all cancelled.",
};

type Props = {
  columns: Array<{ column: WorkColumn; items: WorkItem[] }>;
  active: ActiveDispatch[];
  now: number;
  fresh: ReadonlySet<string>;
  onOpen: (key: string) => void;
  onStart: (item: WorkItem) => void;
};

/** The board by issue: four columns of delegated work, Cancelled folded away. */
export function WorkBoard({ columns, active, now, fresh, onOpen, onStart }: Props) {
  const [showCancelled, setShowCancelled] = useState(false);
  return (
    <div className="flex h-full flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-1">
      {columns.map(({ column, items }) => {
        const Icon = ICON[column];
        const id = `work-col-${column}`;
        const folded = column === "cancelled" && !showCancelled;
        if (items.length === 0 || folded) {
          return (
            <section
              key={column}
              aria-labelledby={id}
              title={items.length === 0 ? EMPTY_HINT[column] : undefined}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground md:w-11 md:flex-col md:px-0 md:py-3"
            >
              <Icon aria-hidden className="size-4" />
              <h2 id={id} className="text-xs font-medium md:[writing-mode:vertical-rl]">
                {WORK_COLUMN_LABEL[column]} <span className="tabular-nums">{items.length}</span>
              </h2>
              {folded && items.length > 0 ? (
                <Button variant="ghost" size="icon-xs" className="ml-auto md:ml-0" aria-label={`Show ${items.length} cancelled`} onClick={() => setShowCancelled(true)}>
                  <ChevronRightIcon />
                </Button>
              ) : null}
            </section>
          );
        }
        return (
          <section key={column} aria-labelledby={id} className="flex shrink-0 flex-col rounded-lg bg-muted/40 md:max-h-full md:max-w-96 md:min-w-64 md:flex-1 md:basis-0">
            <header className="flex h-9 items-center gap-2 px-2.5">
              <Icon aria-hidden className={cn("size-4", column === "needs_you" ? "text-board" : "text-muted-foreground")} />
              <h2 id={id} className="text-sm font-medium">
                {WORK_COLUMN_LABEL[column]}
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
            </header>
            <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.map((item) => (
                <li key={item.key}>
                  <WorkCard
                    item={item}
                    column={column}
                    active={active.filter((a) => item.tickets.some((t) => t.id === a.ticketId))}
                    now={now}
                    fresh={fresh.has(`${item.key}:${column}`)}
                    onOpen={onOpen}
                    onStart={onStart}
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
