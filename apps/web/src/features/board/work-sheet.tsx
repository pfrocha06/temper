import { GitPullRequestIcon, PlayIcon } from "lucide-react";
import { ExternalRefChip } from "@/components/badges";
import { PipelineStrip } from "@/components/pipeline";
import { RoleAvatar } from "@/components/role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_LABEL } from "@/lib/constants";
import type { PipelineNode } from "@/lib/pipeline";
import type { ActiveDispatch, TicketStatus } from "@/lib/types";
import { WORK_COLUMN_LABEL, workColumn, type WorkItem } from "@/lib/work";

/** The tickets an issue or spec became, for when you want to look inside it. */
export function WorkSheet({
  item,
  pipelines,
  active,
  starting,
  onClose,
  onOpenTicket,
  onStart,
}: {
  item: WorkItem | undefined;
  pipelines: Map<string, PipelineNode[]>;
  active: ActiveDispatch[];
  starting: boolean;
  onClose: () => void;
  onOpenTicket: (id: string) => void;
  onStart: (item: WorkItem) => void;
}) {
  return (
    <Sheet open={item !== undefined} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {item ? (
          <>
            <SheetHeader className="border-b pr-12">
              <div className="flex flex-wrap items-center gap-1.5">
                {item.ref ? <ExternalRefChip externalRef={item.ref} /> : <Badge variant="secondary">Spec</Badge>}
                <Badge variant="outline">{WORK_COLUMN_LABEL[workColumn(item)]}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {item.done} of {item.total} tickets done
                </span>
              </div>
              <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
              <SheetDescription>The Chief of Staff split this into tickets. Each runs through its own stages; open one for its evidence.</SheetDescription>
            </SheetHeader>
            <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {item.tickets.map((t) => {
                const agent = active.find((a) => a.ticketId === t.id);
                return (
                  <li key={t.id} className="border-b last:border-b-0">
                    <button type="button" onClick={() => onOpenTicket(t.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={t.status === "awaiting_board" ? "font-medium text-board" : undefined}>{STATUS_LABEL[t.status as TicketStatus] ?? t.status}</span>
                        <span>· {t.type}</span>
                        {t.prUrl ? <GitPullRequestIcon aria-label="Pull request open" className="size-3.5" /> : null}
                        {agent ? <RoleAvatar role={agent.role} size="xs" live className="ml-auto" /> : null}
                      </span>
                      <span className="text-sm font-medium leading-snug">{t.title}</span>
                      <PipelineStrip nodes={pipelines.get(t.id) ?? []} className={t.status === "backlog" ? "opacity-50" : undefined} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {item.backlog > 0 ? (
              <SheetFooter className="flex-row border-t">
                <Button size="sm" disabled={starting} onClick={() => onStart(item)}>
                  <PlayIcon data-icon="inline-start" />
                  {item.backlog === item.total ? "Start" : `Start the other ${item.backlog}`}
                </Button>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
