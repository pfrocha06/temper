import type { KeyRoot } from "./queries";

/** Which query roots an audit event makes stale. Unknown kinds refresh nothing. */
export function rootsForAudit(kind: string): KeyRoot[] {
  const [domain] = kind.split(".", 1);
  switch (domain) {
    case "ticket":
    case "spec":
      return ["tickets", "ticket", "status"];
    case "dispatch":
      return ["dispatches", "dispatch", "ticket", "status", "agents"];
    case "approval":
      return ["approvals", "status", "tickets", "ticket"];
    case "agent":
      return ["agents", "approvals", "status"];
    case "factory":
    case "adapter":
      return ["status"];
    case "signal":
    case "temperature":
      return ["temperature", "status"];
    case "project":
      return ["projects"];
    default:
      return [];
  }
}

/** A factory `change` event: tickets moved or dispatches started/finished. */
export const CHANGE_ROOTS: KeyRoot[] = ["tickets", "ticket", "dispatches", "dispatch", "status"];

/**
 * Collects roots and flushes them once per `delayMs`, so a burst of events
 * (a dispatch finishing writes several audit rows) causes one refetch per query.
 */
export function createDebouncedFlush(flush: (roots: Set<KeyRoot>) => void, delayMs = 300) {
  let pending = new Set<KeyRoot>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    add(roots: Iterable<KeyRoot>) {
      for (const r of roots) pending.add(r);
      if (pending.size === 0 || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const batch = pending;
        pending = new Set();
        flush(batch);
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = new Set();
    },
  };
}
