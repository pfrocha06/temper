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
    const sorted = list.toSorted((a, b) =>
      queue ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
    return { status, tickets: sorted };
  });
}

/** A short hint of where a ticket works: the first scope entry plus a count of the rest. */
export function fileScopeHint(scope: string[]): string | undefined {
  if (scope.length === 0) return undefined;
  return scope.length === 1 ? scope[0] : `${scope[0]} +${scope.length - 1}`;
}

/** Splits a textarea into list items: one per line, trimmed, blanks and bullet markers removed. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}
