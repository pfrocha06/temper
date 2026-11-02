import { TICKET_STATUSES } from "./constants";
import type { Ticket, TicketStatus } from "./types";

export type BoardColumn = { status: TicketStatus; tickets: Ticket[] };

/**
 * Tickets grouped into one column per status, in workflow order. Unknown
 * statuses are dropped rather than shown in a column nobody can act on.
 * Within a column, the most recently updated ticket comes first, except the
 * backlog and ready queues, which keep creation order (that is dispatch order).
 */
export function groupByStatus(tickets: Ticket[]): BoardColumn[] {
  const columns = new Map<TicketStatus, Ticket[]>(TICKET_STATUSES.map((s) => [s, []]));
  for (const t of tickets) columns.get(t.status as TicketStatus)?.push(t);
  return TICKET_STATUSES.map((status) => {
    const list = columns.get(status)!;
    const queue = status === "backlog" || status === "ready";
    const sorted = list.toSorted((a, b) => (queue ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
    return { status, tickets: sorted };
  });
}

/** Splits a textarea into list items: one per line, trimmed, blanks and bullet markers removed. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

// ── Filtering by where a ticket came from ────────────────────────────────────

/** A tracker name (`github`, `jira`, …), or "none" for tickets written on the board or from a spec. */
export type TicketSource = string;
export const NO_SOURCE = "none";

export const ticketSource = (t: Ticket): TicketSource => t.externalRef?.tracker ?? NO_SOURCE;

export type SourceCount = { source: TicketSource; count: number };

/** Each source present among the tickets, trackers first (GitHub, Jira, then others by name), "none" last. */
export function sourceCounts(tickets: Ticket[]): SourceCount[] {
  const counts = new Map<TicketSource, number>();
  for (const t of tickets) counts.set(ticketSource(t), (counts.get(ticketSource(t)) ?? 0) + 1);
  const rank = (s: TicketSource) => (s === "github" ? 0 : s === "jira" ? 1 : s === NO_SOURCE ? 3 : 2);
  return [...counts]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source));
}

export type IssueGroup = { key: string; url: string; count: number; open: number };

/** The issues behind one tracker's tickets, most tickets first: an issue usually becomes several. */
export function issuesOf(tickets: Ticket[], source: TicketSource): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const t of tickets) {
    const ref = t.externalRef;
    if (!ref || ref.tracker !== source) continue;
    const g = groups.get(ref.key) ?? { key: ref.key, url: ref.url, count: 0, open: 0 };
    g.count++;
    if (t.status !== "done" && t.status !== "cancelled") g.open++;
    groups.set(ref.key, g);
  }
  return [...groups.values()].sort((a, b) => b.open - a.open || b.count - a.count || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export type TicketFilter = { source?: TicketSource; issue?: string };

export function filterTickets(tickets: Ticket[], f: TicketFilter): Ticket[] {
  if (!f.source) return tickets;
  return tickets.filter((t) => ticketSource(t) === f.source && (!f.issue || t.externalRef?.key === f.issue));
}
