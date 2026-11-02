import type { IntakeCandidate, IntakeImportResult } from "@/lib/types";

/** Why a candidate cannot be ticked, or undefined when it can. */
export function blockedReason(c: IntakeCandidate, anyAuthor: boolean): string | undefined {
  if (c.ticketId) return "Already on the board";
  if (!c.trusted && !anyAuthor) return `Opened by ${c.author ?? "someone"}, who cannot push to the repository`;
  return undefined;
}

export const selectable = (c: IntakeCandidate, anyAuthor: boolean) => blockedReason(c, anyAuthor) === undefined;

/** Ticked keys that are still selectable (a filter change or the author switch can drop some). */
export function effectiveSelection(candidates: IntakeCandidate[], selected: ReadonlySet<string>, anyAuthor: boolean): string[] {
  return candidates.filter((c) => selected.has(c.key) && selectable(c, anyAuthor)).map((c) => c.key);
}

export type RowProgress =
  | { state: "queued" }
  | { state: "importing"; since: number }
  | { state: "done"; result: IntakeImportResult }
  | { state: "failed"; error: string };

export function progressSummary(progress: ReadonlyMap<string, RowProgress>): { done: number; total: number; tickets: number; skipped: number; failed: number } {
  let done = 0;
  let tickets = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of progress.values()) {
    if (p.state === "done") {
      done++;
      if (p.result.status === "skipped") skipped++;
      tickets += p.result.ticketIds.length;
    } else if (p.state === "failed") {
      done++;
      failed++;
    }
  }
  return { done, total: progress.size, tickets, skipped, failed };
}
