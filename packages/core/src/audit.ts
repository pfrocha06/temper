import { desc } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { auditEvents } from "./db/schema.ts";
import { redact } from "./redact.ts";

export type Actor = "board" | "system" | `agent:${string}`;

export type AuditInput = {
  actor: Actor;
  kind: string;
  subject?: string;
  data?: Record<string, unknown>;
};

type Listener = (event: typeof auditEvents.$inferSelect) => void;
const listeners = new Set<Listener>();

export function onAudit(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Appends a redacted audit event. Audit events are never updated or deleted. */
export async function audit(db: Db, input: AuditInput) {
  const [row] = await db
    .insert(auditEvents)
    .values({ actor: input.actor, kind: input.kind, subject: input.subject, data: redact(input.data ?? {}) })
    .returning();
  for (const l of listeners) l(row!);
  return row!;
}

export async function recentAudit(db: Db, limit = 100) {
  return db.select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(limit);
}
