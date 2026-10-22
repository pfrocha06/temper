// API row shapes. Only `import type` from core: core pulls Node dependencies at runtime.
import type {
  Agent as AgentRow,
  Approval as ApprovalRow,
  Artifact as ArtifactRow,
  Contribution,
  Dispatch as DispatchRow,
  DispatchEvent as DispatchEventRow,
  Project as ProjectRow,
  Regime,
  RegimePolicy,
  Role,
  RunEvent,
  Snapshot as SnapshotRow,
  Ticket as TicketRow,
  TicketStatus,
  TicketType,
} from "@temper/core";

/** What a row looks like after JSON: dates become ISO strings. */
export type Json<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Json<U>>
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type Project = Json<ProjectRow>;
export type Ticket = Json<TicketRow>;
export type Dispatch = Json<DispatchRow>;
export type Artifact = Json<ArtifactRow>;
export type Approval = Json<ApprovalRow>;
/** `approvedVersion` is what the dispatcher runs; a Verifier edit waits for board approval. */
export type Agent = Json<AgentRow> & { approvedVersion?: number };

type EventPayload<E> = E extends { kind: infer K } ? { kind: K; payload: Omit<E, "kind"> } : never;
/** A recorded dispatch event; `payload` is the RunEvent minus its kind. */
export type DispatchEvent = Omit<Json<DispatchEventRow>, "kind" | "payload"> & EventPayload<RunEvent>;

export type SnapshotContributions = { contributions: Contribution[]; cleanStreak: number };
export type Snapshot = Omit<Json<SnapshotRow>, "contributions" | "regime"> & {
  regime: Regime;
  contributions: SnapshotContributions;
};

export type ActiveDispatch = { dispatchId: string; ticketId: string; role: Role | "server"; agentId: string };

export type FactoryStatus = {
  paused: boolean;
  active: ActiveDispatch[];
  pausedAdapters: Record<string, number>;
  temperature: Snapshot | null;
  instance: string;
  pendingApprovals: number;
};

export type TicketDetail = { ticket: Ticket; dispatches: Dispatch[]; artifacts: Artifact[] };

export type TemperatureReport = {
  history: Snapshot[];
  policies: Record<Regime, RegimePolicy>;
  enforced: boolean;
};

export type SkillEntry = {
  name: string;
  origin: "vendor" | "local";
  path: string;
  source?: string;
  commit?: string;
  license?: string;
  description?: string;
};

export type AgentEdit = {
  name: string;
  model: string | null;
  skills: string[];
  permissions: { allowedTools: string[]; disallowedTools: string[] };
  maxConcurrency: number;
  runsPerHour: number;
  instructions: string;
};

export type NewTicketInput = {
  projectId: string;
  type: TicketType;
  title: string;
  spec: string;
  acceptanceCriteria: string[];
  fileScope: string[];
  ready: boolean;
};

export type { Contribution, Regime, RegimePolicy, Role, TicketStatus, TicketType };
