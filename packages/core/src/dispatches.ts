import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { RunEvent } from "./adapter.ts";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { artifacts, dispatchEvents, dispatches } from "./db/schema.ts";
import { newId } from "./ids.ts";
import { redact } from "./redact.ts";
import type { Verdict } from "./workflow.ts";

export type Dispatch = typeof dispatches.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type DispatchEvent = typeof dispatchEvents.$inferSelect;

type EventListener = (e: DispatchEvent) => void;
const eventListeners = new Set<EventListener>();
export function onDispatchEvent(l: EventListener): () => void {
  eventListeners.add(l);
  return () => eventListeners.delete(l);
}

export async function createDispatch(
  db: Db,
  input: { ticketId: string; stage: string; agentId: string; agentVersion: number; temperatureSnapshotId?: number },
): Promise<Dispatch> {
  const prior = await db
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(and(eq(dispatches.ticketId, input.ticketId), eq(dispatches.stage, input.stage)));
  const [row] = await db
    .insert(dispatches)
    .values({ id: newId("dsp"), ...input, attempt: prior.length + 1, status: "running", startedAt: new Date() })
    .returning();
  await audit(db, {
    actor: "system",
    kind: "dispatch.started",
    subject: row!.id,
    data: { ticketId: input.ticketId, stage: input.stage, agent: `${input.agentId}@${input.agentVersion}`, attempt: row!.attempt },
  });
  return row!;
}

/** Every dispatch ends exactly once. A second finish is an error, never a silent overwrite. */
export async function finishDispatch(
  db: Db,
  id: string,
  outcome: { status: "succeeded" | "failed" | "cancelled"; verdict?: Verdict; summary?: string; sessionId?: string },
): Promise<Dispatch> {
  const [row] = await db
    .update(dispatches)
    .set({ ...outcome, summary: outcome.summary && redact(outcome.summary), finishedAt: new Date() })
    .where(and(eq(dispatches.id, id), eq(dispatches.status, "running")))
    .returning();
  if (!row) throw new Error(`dispatch ${id} is not running`);
  await audit(db, {
    actor: "system",
    kind: "dispatch.finished",
    subject: id,
    data: { ticketId: row.ticketId, stage: row.stage, status: row.status, verdict: row.verdict },
  });
  return row;
}

export async function recordDispatchEvent(db: Db, dispatchId: string, event: RunEvent): Promise<void> {
  const { kind, ...payload } = event;
  const [row] = await db.insert(dispatchEvents).values({ dispatchId, kind, payload: redact(payload) }).returning();
  for (const l of eventListeners) l(row!);
}

export async function dispatchEventsAfter(db: Db, dispatchId: string, afterId = 0): Promise<DispatchEvent[]> {
  return db
    .select()
    .from(dispatchEvents)
    .where(and(eq(dispatchEvents.dispatchId, dispatchId), gt(dispatchEvents.id, afterId)))
    .orderBy(asc(dispatchEvents.id));
}

export async function ticketDispatches(db: Db, ticketId: string): Promise<Dispatch[]> {
  return db.select().from(dispatches).where(eq(dispatches.ticketId, ticketId)).orderBy(asc(dispatches.createdAt));
}

export async function runningDispatches(db: Db): Promise<Dispatch[]> {
  return db.select().from(dispatches).where(eq(dispatches.status, "running"));
}

export async function recentDispatches(db: Db, limit = 50): Promise<Dispatch[]> {
  return db.select().from(dispatches).orderBy(desc(dispatches.createdAt)).limit(limit);
}

export async function getDispatch(db: Db, id: string): Promise<Dispatch | undefined> {
  const [row] = await db.select().from(dispatches).where(eq(dispatches.id, id));
  return row;
}

/** Dispatch counts per stage for a ticket, used for loop caps. */
export async function stageAttempts(db: Db, ticketId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const d of await ticketDispatches(db, ticketId)) out[d.stage] = (out[d.stage] ?? 0) + 1;
  return out;
}

export async function saveArtifact(
  db: Db,
  input: { ticketId: string; dispatchId?: string; name: string; content: string },
): Promise<Artifact> {
  const [row] = await db.insert(artifacts).values({ ...input, content: redact(input.content) }).returning();
  return row!;
}

/** Latest version of each named artifact for a ticket. */
export async function latestArtifacts(db: Db, ticketId: string): Promise<Artifact[]> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.ticketId, ticketId)).orderBy(desc(artifacts.id));
  const seen = new Map<string, Artifact>();
  for (const r of rows) if (!seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

export async function allArtifacts(db: Db, ticketIds: string[]): Promise<Artifact[]> {
  if (ticketIds.length === 0) return [];
  return db.select().from(artifacts).where(inArray(artifacts.ticketId, ticketIds)).orderBy(asc(artifacts.id));
}
