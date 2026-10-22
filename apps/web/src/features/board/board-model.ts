import type { ActiveDispatch, Dispatch, Ticket, TicketStatus } from "@/lib/types";

/** Where a card may be dropped. Backlog → Ready starts a ticket; any open ticket → Cancelled cancels it. */
export function canDrop(from: TicketStatus, to: TicketStatus): boolean {
  if (to === "ready") return from === "backlog";
  if (to === "cancelled") return from !== "done" && from !== "cancelled";
  return false;
}

export function isDraggable(status: TicketStatus): boolean {
  return status !== "done" && status !== "cancelled";
}

export type CardLive = {
  /** The agent working on the ticket right now. */
  active: ActiveDispatch | undefined;
  /** The running dispatch, for its start time. */
  running: Dispatch | undefined;
};

export function liveFor(ticket: Ticket, active: ActiveDispatch[], dispatches: Dispatch[]): CardLive {
  return {
    active: active.find((a) => a.ticketId === ticket.id),
    running: dispatches.find((d) => d.ticketId === ticket.id && d.status === "running"),
  };
}
