import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { audit, type Actor } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { knowledgeEntries, knowledgeReads, KNOWLEDGE_KINDS } from "./db/schema.ts";
import { newId } from "./ids.ts";
import { redact } from "./redact.ts";

export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export { KNOWLEDGE_KINDS };

/**
 * The store behind the knowledge base. Postgres today; the interface keeps a context database
 * (e.g. an OpenViking-style service) pluggable later.
 */
export type KnowledgeInput = {
  environmentId: string;
  projectId?: string | null;
  area?: string | null;
  kind: KnowledgeKind;
  title: string;
  abstract: string;
  body?: string;
  tags?: string[];
  source?: string;
};

export async function addKnowledge(db: Db, input: KnowledgeInput, actor: Actor): Promise<KnowledgeEntry> {
  const clean = redact(input);
  const [row] = await db.insert(knowledgeEntries).values({ id: newId("kn"), ...clean }).returning();
  await audit(db, { actor, kind: "knowledge.added", subject: row!.id, data: { title: row!.title, kind: row!.kind } });
  return row!;
}

export async function updateKnowledge(
  db: Db,
  id: string,
  patch: Partial<Pick<KnowledgeEntry, "kind" | "title" | "abstract" | "body" | "tags" | "area" | "projectId" | "status" | "pinned">>,
  actor: Actor,
): Promise<KnowledgeEntry> {
  // Pinning or archiving is bookkeeping; only content changes make a new version.
  const content = ["kind", "title", "abstract", "body", "tags", "area", "projectId"].some((k) => k in patch);
  const [row] = await db
    .update(knowledgeEntries)
    .set({ ...redact(patch), ...(content ? { version: sql`${knowledgeEntries.version} + 1` } : {}), updatedAt: new Date() })
    .where(eq(knowledgeEntries.id, id))
    .returning();
  if (!row) throw new Error(`knowledge entry ${id} not found`);
  await audit(db, { actor, kind: "knowledge.updated", subject: id, data: patch as Record<string, unknown> });
  return row;
}

export async function archiveKnowledge(db: Db, id: string, reason: string, actor: Actor): Promise<KnowledgeEntry> {
  const row = await updateKnowledge(db, id, { status: "archived" }, actor);
  await audit(db, { actor, kind: "knowledge.archived", subject: id, data: { reason } });
  return row;
}

export async function getKnowledge(db: Db, id: string): Promise<KnowledgeEntry | undefined> {
  const [row] = await db.select().from(knowledgeEntries).where(eq(knowledgeEntries.id, id));
  return row;
}

export type KnowledgeQuery = {
  environmentId: string;
  /** Entries for this project plus environment-wide ones. */
  projectId?: string;
  /** File paths the work touches; entries with a matching area rank first. */
  paths?: string[];
  text?: string;
  kinds?: KnowledgeKind[];
  includeArchived?: boolean;
  limit?: number;
};

/** Search: full-text when `text` is given, then pinned, area matches and recency. */
export async function searchKnowledge(db: Db, q: KnowledgeQuery): Promise<KnowledgeEntry[]> {
  const doc = sql`to_tsvector('english', ${knowledgeEntries.title} || ' ' || ${knowledgeEntries.abstract} || ' ' || ${knowledgeEntries.body})`;
  const conds = [eq(knowledgeEntries.environmentId, q.environmentId)];
  if (!q.includeArchived) conds.push(eq(knowledgeEntries.status, "active"));
  if (q.projectId) conds.push(or(isNull(knowledgeEntries.projectId), eq(knowledgeEntries.projectId, q.projectId))!);
  if (q.kinds?.length) conds.push(inArray(knowledgeEntries.kind, q.kinds));
  if (q.text?.trim()) conds.push(sql`${doc} @@ websearch_to_tsquery('english', ${q.text})`);
  const rows = await db
    .select()
    .from(knowledgeEntries)
    .where(and(...conds))
    .orderBy(desc(knowledgeEntries.pinned), desc(knowledgeEntries.updatedAt))
    .limit(Math.min(q.limit ?? 50, 200));
  if (!q.paths?.length) return rows;
  const matches = (e: KnowledgeEntry) => !!e.area && q.paths!.some((p) => p.startsWith(e.area!) || e.area!.startsWith(p.replace(/\*.*$/, "")));
  return [...rows.filter(matches), ...rows.filter((e) => !matches(e))];
}

export async function recordKnowledgeReads(db: Db, entryIds: string[], via: string, dispatchId?: string): Promise<void> {
  if (entryIds.length === 0) return;
  await db.insert(knowledgeReads).values(entryIds.map((entryId) => ({ entryId, via, dispatchId })));
}

export async function knowledgeReadsFor(db: Db, entryId: string, limit = 50) {
  return db.select().from(knowledgeReads).where(eq(knowledgeReads.entryId, entryId)).orderBy(desc(knowledgeReads.id)).limit(limit);
}

/** The L0/L1 digest that goes into a prompt: titles and abstracts, never full bodies. */
export function knowledgeDigest(entries: KnowledgeEntry[], maxChars = 6000): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- [${e.kind}] ${e.title} (${e.id})${e.area ? ` — ${e.area}` : ""}: ${e.abstract}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
