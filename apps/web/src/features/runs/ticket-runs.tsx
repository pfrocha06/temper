import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { PipelineStrip } from "@/components/pipeline";
import { AgentProviderLogo } from "@/components/provider-logo";
import { RoleAvatar } from "@/components/role";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useArrivals } from "@/hooks/use-arrivals";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import { derivePipeline } from "@/lib/pipeline";
import { splitRuns, type TicketRuns } from "@/lib/runs";
import type { Dispatch, Ticket } from "@/lib/types";

const VERDICT_TONE: Record<string, string> = { PASS: "text-pass", FAIL: "text-fail", BLOCKED: "text-blocked" };

function statusWord(d: Dispatch): string {
  if (d.status === "running") return "live";
  return d.verdict ?? (d.status === "succeeded" ? "done" : d.status);
}

function statusTone(d: Dispatch): string {
  if (d.status === "running") return "text-foreground";
  return VERDICT_TONE[d.verdict ?? ""] ?? "text-muted-foreground";
}

/** Arrow keys move between the runs in the list, in on-screen order. */
function onListKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const links = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-run-link]")];
  const i = links.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next = links[e.key === "ArrowDown" ? i + 1 : i - 1];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

type ListProps = { groups: TicketRuns[]; ticketById: Map<string, Ticket>; selectedId?: string };

/** Tickets with their runs: running ones first, the latest finished ones, then the older rest folded away. */
export function TicketRunsList({ groups, ticketById, selectedId }: ListProps) {
  const { running, latest, older } = useMemo(() => splitRuns(groups), [groups]);
  const now = useNow(running.length > 0);
  const fresh = useArrivals(groups.map((g) => g.ticketId));
  const olderHasSelected = older.some((g) => g.dispatches.some((d) => d.id === selectedId));
  const [olderOpen, setOlderOpen] = useState<boolean | undefined>(undefined);
  const row = (g: TicketRuns) => <TicketRow key={g.ticketId} group={g} ticket={ticketById.get(g.ticketId)} selectedId={selectedId} now={now} fresh={fresh.has(g.ticketId)} />;

  return (
    <div className="flex flex-col gap-3 p-1.5 pb-4" onKeyDown={onListKeyDown}>
      {running.length > 0 ? (
        <section aria-labelledby="runs-running">
          <SectionTitle id="runs-running" live>
            Running <span className="tabular-nums">{running.length}</span>
          </SectionTitle>
          <ul className="flex flex-col gap-0.5">{running.map(row)}</ul>
        </section>
      ) : null}
      {latest.length > 0 ? (
        <section aria-labelledby="runs-latest">
          <SectionTitle id="runs-latest">Latest</SectionTitle>
          <ul className="flex flex-col gap-0.5">{latest.map(row)}</ul>
        </section>
      ) : null}
      {older.length > 0 ? (
        <Collapsible open={olderOpen ?? olderHasSelected} onOpenChange={setOlderOpen} asChild>
          <section aria-label="Recent">
            <CollapsibleTrigger className="group/older flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2">
              <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-data-[state=open]/older:rotate-90" />
              Recent
              <span className="ml-auto rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] tabular-nums">{older.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 flex flex-col gap-0.5">{older.map(row)}</ul>
            </CollapsibleContent>
          </section>
        </Collapsible>
      ) : null}
    </div>
  );
}

function SectionTitle({ id, live, children }: { id: string; live?: boolean; children: React.ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
      {live ? <span aria-hidden className="size-1.5 rounded-full bg-pass text-pass motion-safe:animate-beacon" /> : null}
      {children}
    </h3>
  );
}

function TicketRow({ group, ticket, selectedId, now, fresh }: { group: TicketRuns; ticket: Ticket | undefined; selectedId?: string; now: number; fresh: boolean }) {
  const head = group.running ?? group.latest;
  const containsSelected = group.dispatches.some((d) => d.id === selectedId);
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const expanded = toggled ?? containsSelected;
  const nodes = useMemo(() => (ticket ? derivePipeline(ticket, group.dispatches) : []), [ticket, group.dispatches]);
  const live = Boolean(group.running);
  const attemptsId = `attempts-${group.ticketId}`;
  const title = ticket?.title ?? group.ticketId;

  return (
    <li className={cn("rounded-lg", fresh && "motion-safe:animate-arrive", containsSelected && "bg-accent/40")}>
      <div className="flex items-stretch">
        <Link
          to={`/runs/${head.id}`}
          data-run-link
          aria-current={head.id === selectedId ? "page" : undefined}
          aria-label={`${title}: ${head.stage} ${statusWord(head)}`}
          className={cn(
            "grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-lg py-2 pl-2 hover:bg-accent/70 focus-visible:-outline-offset-2",
            head.id === selectedId && !expanded && "bg-accent",
          )}
        >
          <RoleAvatar role={head.agentId} size="sm" live={live} tooltip={false} className="row-span-2" />
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="text-right text-xs text-muted-foreground tabular-nums">
            {live && head.startedAt ? duration(head.startedAt, null, now) : relativeTime(group.lastActivity, now).replace(/ ago$/, "")}
          </span>
          <span className="col-span-2 flex min-w-0 items-center gap-2 text-xs">
            {nodes.length > 0 ? <PipelineStrip nodes={nodes} className="shrink-0" /> : null}
            <span className="truncate text-muted-foreground">
              {head.stage}
              {head.attempt > 1 ? ` #${head.attempt}` : ""}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <AgentProviderLogo agentId={head.agentId} size="xs" className="text-muted-foreground" />
              <span className={cn("font-mono font-medium", statusTone(head))}>{statusWord(head)}</span>
            </span>
          </span>
        </Link>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={attemptsId}
          aria-label={`${expanded ? "Hide" : "Show"} ${group.dispatches.length} runs of ${title}`}
          onClick={() => setToggled(!expanded)}
          className="group/exp flex w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-muted-foreground hover:bg-accent/70 hover:text-foreground focus-visible:-outline-offset-2"
        >
          <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
          <span aria-hidden className="font-mono text-[0.625rem] tabular-nums">
            {group.dispatches.length}
          </span>
        </button>
      </div>
      {expanded ? (
        <ol id={attemptsId} aria-label={`Runs of ${title}`} className="relative mr-1 mb-1 ml-5 flex flex-col border-l pl-1.5">
          {group.dispatches.map((d) => (
            <AttemptRow key={d.id} dispatch={d} selected={d.id === selectedId} now={now} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function AttemptRow({ dispatch: d, selected, now }: { dispatch: Dispatch; selected: boolean; now: number }) {
  const live = d.status === "running";
  return (
    <li>
      <Link
        to={`/runs/${d.id}`}
        data-run-link
        aria-current={selected ? "page" : undefined}
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto_3.25rem] items-center gap-x-2 rounded-md px-1.5 py-1 text-xs hover:bg-accent/70 focus-visible:-outline-offset-2",
          selected && "bg-accent font-medium",
        )}
      >
        <RoleAvatar role={d.agentId} size="xs" live={live} tooltip={false} />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            {d.stage}
            {d.attempt > 1 ? <span className="text-muted-foreground"> #{d.attempt}</span> : null}
          </span>
          <AgentProviderLogo agentId={d.agentId} size="xs" className="text-muted-foreground" />
        </span>
        <span className={cn("font-mono", statusTone(d))}>{statusWord(d)}</span>
        <span className="text-right text-muted-foreground tabular-nums">{d.startedAt ? duration(d.startedAt, d.finishedAt, now) : "queued"}</span>
      </Link>
    </li>
  );
}
