import type { Regime, TicketStatus, TicketType } from "./types";

// Mirrors of core's runtime constants. Kept here because core cannot be imported at runtime.
export const TICKET_TYPES = [
  "feature",
  "bugfix",
  "refactor",
  "investigation",
  "prototype",
  "perf",
  "chore",
  "skill",
  "verification",
] as const satisfies readonly TicketType[];

export const TICKET_STATUSES = [
  "backlog",
  "ready",
  "in_progress",
  "awaiting_board",
  "done",
  "cancelled",
] as const satisfies readonly TicketStatus[];

export const REGIMES = ["cool", "warm", "hot", "fever"] as const satisfies readonly Regime[];

/** Lower bound of each regime's temperature band (core: temperature.ts). */
export const REGIME_FLOOR: Record<Regime, number> = { cool: 0, warm: 0.25, hot: 0.5, fever: 0.75 };

export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  awaiting_board: "Awaiting board",
  done: "Done",
  cancelled: "Cancelled",
};

export const REGIME_LABEL: Record<Regime, string> = { cool: "Cool", warm: "Warm", hot: "Hot", fever: "Fever" };
