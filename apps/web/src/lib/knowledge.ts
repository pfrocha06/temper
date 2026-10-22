import { KNOWLEDGE_KINDS } from "./constants";
import type { KnowledgeEntry, KnowledgeKind } from "./types";

/** `all`, entries for every project; `env`, environment-wide entries only; else one project's id. */
export type ProjectScope = "all" | "env" | (string & {});

export type KnowledgeFilter = {
  kinds: KnowledgeKind[];
  project: ProjectScope;
  archived: boolean;
};

export type KnowledgeGroup = { kind: KnowledgeKind; entries: KnowledgeEntry[] };

/**
 * Applies the kind, project and archived filters. A project scope keeps environment-wide entries
 * too, because agents working on that project load them as well.
 */
export function filterKnowledge(entries: KnowledgeEntry[], f: KnowledgeFilter): KnowledgeEntry[] {
  return entries.filter((e) => {
    if (!f.archived && e.status === "archived") return false;
    if (f.kinds.length > 0 && !f.kinds.includes(e.kind as KnowledgeKind)) return false;
    if (f.project === "env") return !e.projectId;
    if (f.project !== "all") return !e.projectId || e.projectId === f.project;
    return true;
  });
}

/** Pinned first, active before archived, then most recently updated. */
export function compareKnowledge(a: KnowledgeEntry, b: KnowledgeEntry): number {
  return (
    b.pinned - a.pinned ||
    Number(a.status === "archived") - Number(b.status === "archived") ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Groups by kind in the canonical order, sorted within each group; empty groups are dropped and
 * kinds the console does not know yet go last.
 */
export function groupKnowledge(entries: KnowledgeEntry[]): KnowledgeGroup[] {
  const byKind = new Map<string, KnowledgeEntry[]>();
  for (const e of entries) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const known: readonly string[] = KNOWLEDGE_KINDS;
  const order = [...KNOWLEDGE_KINDS, ...[...byKind.keys()].filter((k) => !known.includes(k)).toSorted()];
  return order.flatMap((kind) => {
    const list = byKind.get(kind);
    return list ? [{ kind: kind as KnowledgeKind, entries: list.toSorted(compareKnowledge) }] : [];
  });
}

/** Count of active entries per kind, for the filter chips. */
export function countByKind(entries: KnowledgeEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) if (e.status !== "archived") counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return counts;
}

/** Comma- or newline-separated tags, trimmed, de-duplicated, empty ones dropped. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

/** Where an entry came from, for people: the board, a run, a ticket, or the Chief in conversation. */
export function sourceLabel(source: string | null): { text: string; href?: string } {
  if (!source) return { text: "unknown" };
  if (source === "board") return { text: "you" };
  if (source === "chief") return { text: "Chief of Staff, in conversation" };
  if (source.startsWith("dsp_")) return { text: "a run", href: `/runs/${source}` };
  if (source.startsWith("tkt_")) return { text: "a ticket", href: `/tickets/${source}` };
  return { text: source };
}
