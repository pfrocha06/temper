import type { UpdateStatus } from "@/lib/types";

export type UpdatePhase = "current" | "available" | "applying" | "failed" | "done";

/**
 * Where an update stands, from the server's status and the commit this browser asked for
 * (`target`, kept across the restart). The server that applied the update is gone after a
 * successful switch, so "done" is the new server running `target`.
 */
export function updatePhase(s: UpdateStatus | null, target: string | null): UpdatePhase {
  if (!s) return "current";
  if (target && s.current === target && !s.applying) return "done";
  if (s.applying?.finished === "failed") return "failed";
  if (s.applying && !s.applying.finished) return "applying";
  if (s.diverged || s.behind === 0) return "current";
  return "available";
}
