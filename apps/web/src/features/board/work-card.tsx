import { FileTextIcon, GitPullRequestIcon, PlayIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "cn";
import { ExternalRefChip } from "@/components/badges";
import { RoleAvatar } from "@/components/role";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import type { ActiveDispatch } from "@/lib/types";
import type { WorkColumn, WorkItem } from "@/lib/work";

type Props = {
  item: WorkItem;
  column: WorkColumn;
  /** Agents working on this item's tickets right now. */
  active: ActiveDispatch[];
  now: number;
  fresh: boolean;
  onOpen: (key: string) => void;
  onStart: (item: WorkItem) => void;
};

/** One issue or spec the board delegated: how far along it is and whether it needs you. */
export const WorkCard = memo(function WorkCard({ item, column, active, now, fresh, onOpen, onStart }: Props) {
  const pct = item.total ? Math.round((item.done / item.total) * 100) : 0;
  const parts = [
    active.length > 0 ? `${active.length} working` : item.running > 0 ? `${item.running} queued` : "",
    item.prs.length > 0 ? `${item.prs.length} PR${item.prs.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);

  return (
    <article
      aria-labelledby={`work-${item.key}`}
      className={cn(
        "group/card relative flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-card-foreground shadow-xs transition-[border-color,box-shadow]",
        "hover:border-ring/50 has-[button[data-open]:focus-visible]:ring-2 has-[button[data-open]:focus-visible]:ring-ring",
        column === "needs_you" && "border-board/50",
        fresh && "motion-safe:animate-arrive",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {item.ref ? (
          <ExternalRefChip externalRef={item.ref} />
        ) : (
          <span className="inline-flex items-center gap-1">
            <FileTextIcon aria-hidden className="size-3.5" />
            {item.tickets.length > 1 || item.key.startsWith("spec:") ? "Spec" : "Ticket"}
          </span>
        )}
        <span className="ml-auto tabular-nums">{relativeTime(item.updatedAt, now)}</span>
      </div>
      <h3 id={`work-${item.key}`} className="text-sm leading-snug font-medium">
        <button type="button" data-open onClick={() => onOpen(item.key)} className="text-left outline-none after:absolute after:inset-0 after:rounded-lg">
          {item.title}
        </button>
      </h3>
      {column !== "backlog" ? (
        <div className="flex items-center gap-2" title={`${item.done} of ${item.total} tickets done`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tickets done">
            <div className={cn("h-full rounded-full", column === "done" ? "bg-pass" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {item.done}/{item.total}
          </span>
        </div>
      ) : null}
      <div className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
        {column === "needs_you" ? (
          <span className="font-medium text-board">
            {item.waiting} {item.waiting === 1 ? "ticket needs" : "tickets need"} you
          </span>
        ) : column === "backlog" ? (
          <span className="tabular-nums">
            {item.total} {item.total === 1 ? "ticket" : "tickets"}
          </span>
        ) : (
          <span>{parts.join(" · ")}</span>
        )}
        {active.length > 0 ? (
          <span className="flex -space-x-1">
            {active.slice(0, 3).map((a) => (
              <RoleAvatar key={a.dispatchId} role={a.role} size="xs" live />
            ))}
          </span>
        ) : null}
        {item.prs.length > 0 && column !== "in_progress" ? <GitPullRequestIcon aria-label="Pull request open" className="size-3.5" /> : null}
        {column === "backlog" ? (
          <Button size="xs" variant="ghost" className="relative z-10 ml-auto -my-1" onClick={() => onStart(item)}>
            <PlayIcon data-icon="inline-start" />
            Start
          </Button>
        ) : null}
      </div>
    </article>
  );
});
