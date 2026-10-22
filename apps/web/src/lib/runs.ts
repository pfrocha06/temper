import type { Dispatch } from "./types";

/** One ticket's dispatches on the Live runs screen. */
export type TicketRuns = {
  ticketId: string;
  /** Oldest first: the order the attempts happened. */
  dispatches: Dispatch[];
  latest: Dispatch;
  running: Dispatch | undefined;
  /** When anything last happened on this ticket (ISO). */
  lastActivity: string;
};

const activity = (d: Dispatch) => [d.finishedAt, d.startedAt, d.createdAt].filter((x): x is string => Boolean(x)).toSorted().at(-1)!;

/** Dispatches grouped by ticket: tickets with a running dispatch first, then the most recently active. */
export function groupRuns(dispatches: Dispatch[]): TicketRuns[] {
  const byTicket = new Map<string, Dispatch[]>();
  for (const d of dispatches) {
    const list = byTicket.get(d.ticketId) ?? [];
    list.push(d);
    byTicket.set(d.ticketId, list);
  }
  const groups = [...byTicket].map(([ticketId, list]): TicketRuns => {
    const sorted = list.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.attempt - b.attempt);
    return {
      ticketId,
      dispatches: sorted,
      latest: sorted.at(-1)!,
      running: sorted.findLast((d) => d.status === "running"),
      lastActivity: sorted.map(activity).toSorted().at(-1)!,
    };
  });
  return groups.toSorted((a, b) => Number(Boolean(b.running)) - Number(Boolean(a.running)) || b.lastActivity.localeCompare(a.lastActivity));
}

/** Running tickets, the few latest finished ones, and the older rest (collapsed on screen). */
export function splitRuns(groups: TicketRuns[], latestCount = 5): { running: TicketRuns[]; latest: TicketRuns[]; older: TicketRuns[] } {
  const running = groups.filter((g) => g.running);
  const done = groups.filter((g) => !g.running);
  return { running, latest: done.slice(0, latestCount), older: done.slice(latestCount) };
}
