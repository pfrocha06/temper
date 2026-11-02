// The board's default view: one card per piece of work the board delegated (a tracker issue or a
// pasted spec), not per ticket. The Chief splits each into tickets; those show only inside it.
import { NO_SOURCE, ticketSource, type SourceCount, type TicketSource } from "./board";
import type { Ticket } from "./types";

type ExternalRef = NonNullable<Ticket["externalRef"]>;

export type WorkColumn = "backlog" | "in_progress" | "needs_you" | "done" | "cancelled";
export const WORK_COLUMNS: readonly WorkColumn[] = ["backlog", "in_progress", "needs_you", "done", "cancelled"];
export const WORK_COLUMN_LABEL: Record<WorkColumn, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  needs_you: "Needs you",
  done: "Done",
  cancelled: "Cancelled",
};

export type WorkItem = {
  /** Stable id for the URL: `github:o/r#4`, `spec:<title>` or `ticket:<id>`. */
  key: string;
  title: string;
  ref?: ExternalRef;
  source: TicketSource;
  /** Creation order, which is the order the Chief planned them. */
  tickets: Ticket[];
  /** Tickets that count towards progress: all but the cancelled. */
  total: number;
  done: number;
  /** Started and not finished: ready or in progress. */
  running: number;
  waiting: number;
  backlog: number;
  prs: string[];
  createdAt: string;
  updatedAt: string;
};

/** The spec title `importSpec` appends to each ticket it creates ("From spec: …"). */
export function specTitle(t: Ticket): string | undefined {
  return /\n\nFrom spec: (.+?)\s*$/.exec(t.spec ?? "")?.[1];
}

function keyOf(t: Ticket): string {
  if (t.externalRef) return `${t.externalRef.tracker}:${t.externalRef.key}`;
  const spec = specTitle(t);
  return spec ? `spec:${spec}` : `ticket:${t.id}`;
}

/** Groups tickets into work items, in order of their first ticket. */
export function groupWork(tickets: Ticket[]): WorkItem[] {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = keyOf(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups].map(([key, list]) => {
    const first = list[0]!;
    const ref = list.find((t) => t.externalRef)?.externalRef ?? undefined;
    const spec = list.map(specTitle).find(Boolean);
    const count = (...s: string[]) => list.filter((t) => s.includes(t.status)).length;
    return {
      key,
      title: key.startsWith("ticket:") ? first.title : (spec ?? ref?.key ?? first.title),
      ref,
      source: ticketSource(first),
      tickets: list,
      total: list.length - count("cancelled"),
      done: count("done"),
      running: count("ready", "in_progress"),
      waiting: count("awaiting_board"),
      backlog: count("backlog"),
      prs: list.filter((t) => t.prUrl && t.status !== "done" && t.status !== "cancelled").map((t) => t.prUrl!),
      createdAt: first.createdAt,
      updatedAt: list.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), first.updatedAt),
    };
  });
}

/** Where a work item sits: what its tickets add up to, with anything needing the board on top. */
export function workColumn(i: WorkItem): WorkColumn {
  if (i.total === 0) return "cancelled";
  if (i.waiting > 0) return "needs_you";
  if (i.done === i.total) return "done";
  if (i.backlog < i.total) return "in_progress";
  return "backlog";
}

export function workColumns(items: WorkItem[]): Array<{ column: WorkColumn; items: WorkItem[] }> {
  return WORK_COLUMNS.map((column) => {
    const list = items.filter((i) => workColumn(i) === column);
    const sorted = column === "backlog" ? list : list.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { column, items: sorted };
  });
}

/** Like `sourceCounts`, but counting work items: "GitHub 19" means 19 issues. */
export function workSourceCounts(items: WorkItem[]): SourceCount[] {
  const counts = new Map<TicketSource, number>();
  for (const i of items) counts.set(i.source, (counts.get(i.source) ?? 0) + 1);
  const rank = (s: TicketSource) => (s === "github" ? 0 : s === "jira" ? 1 : s === NO_SOURCE ? 3 : 2);
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source));
}
