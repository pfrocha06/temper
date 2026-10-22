import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { audit, type Actor } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { tickets, type AcceptanceCriterion } from "./db/schema.ts";
import { newId } from "./ids.ts";
import type { TicketType } from "./workflow.ts";

export const TICKET_STATUSES = [
  "backlog",
  "ready",
  "in_progress",
  "awaiting_board",
  "done",
  "cancelled",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ACTIVE_STATUSES: TicketStatus[] = ["ready", "in_progress"];

export type Ticket = typeof tickets.$inferSelect;

export type NewTicket = {
  projectId: string;
  type: TicketType;
  title: string;
  spec?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  fileScope?: string[];
  dependsOn?: string[];
  parentId?: string;
  status?: TicketStatus;
};

export async function createTicket(db: Db, input: NewTicket, actor: Actor = "board"): Promise<Ticket> {
  const [row] = await db
    .insert(tickets)
    .values({ id: newId("tkt"), status: "backlog", ...input })
    .returning();
  await audit(db, { actor, kind: "ticket.created", subject: row!.id, data: { type: row!.type, title: row!.title } });
  return row!;
}

export async function getTicket(db: Db, id: string): Promise<Ticket | undefined> {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
  return row;
}

export async function listTickets(db: Db, projectId?: string): Promise<Ticket[]> {
  const q = db.select().from(tickets);
  return (projectId ? q.where(eq(tickets.projectId, projectId)) : q).orderBy(asc(tickets.createdAt));
}

export async function updateTicket(
  db: Db,
  id: string,
  patch: Partial<Omit<Ticket, "id" | "createdAt">>,
  actor: Actor = "system",
): Promise<Ticket> {
  const [row] = await db
    .update(tickets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tickets.id, id))
    .returning();
  if (!row) throw new Error(`ticket ${id} not found`);
  await audit(db, { actor, kind: "ticket.updated", subject: id, data: patch as Record<string, unknown> });
  return row;
}

/**
 * Ready tickets whose dependencies are all done, oldest first.
 * Tickets with an overlapping file scope with any in-progress ticket are skipped.
 */
export async function dispatchableTickets(db: Db): Promise<Ticket[]> {
  const ready = await db.select().from(tickets).where(eq(tickets.status, "ready")).orderBy(asc(tickets.createdAt));
  if (ready.length === 0) return [];
  const running = await db.select().from(tickets).where(eq(tickets.status, "in_progress"));
  const depIds = [...new Set(ready.flatMap((t) => t.dependsOn))];
  const doneDeps = depIds.length
    ? new Set(
        (await db.select({ id: tickets.id }).from(tickets).where(and(inArray(tickets.id, depIds), eq(tickets.status, "done")))).map(
          (r) => r.id,
        ),
      )
    : new Set<string>();
  const busyScopes = running.flatMap((t) => t.fileScope);
  return ready.filter((t) => t.dependsOn.every((d) => doneDeps.has(d)) && !scopesOverlap(t.fileScope, busyScopes));
}

/** Atomically moves a ticket from ready to in_progress. Returns false if someone else got it. */
export async function claimTicket(db: Db, id: string, stage: string): Promise<boolean> {
  const rows = await db
    .update(tickets)
    .set({ status: "in_progress", stage, updatedAt: sql`now()` })
    .where(and(eq(tickets.id, id), eq(tickets.status, "ready")))
    .returning({ id: tickets.id });
  if (rows.length === 0) return false;
  await audit(db, { actor: "system", kind: "ticket.claimed", subject: id, data: { stage } });
  return true;
}

/** Two glob-ish scopes overlap when one is a prefix of the other (after stripping `*`). */
export function scopesOverlap(a: string[], b: string[]): boolean {
  const norm = (s: string) => s.replace(/\*.*$/, "");
  return a.some((x) => b.some((y) => norm(x).startsWith(norm(y)) || norm(y).startsWith(norm(x))));
}
