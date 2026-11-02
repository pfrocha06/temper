// API row shapes. Only `import type` from core: core pulls Node dependencies at runtime.
import type {
  Agent as AgentRow,
  Approval as ApprovalRow,
  Artifact as ArtifactRow,
  Chat as ChatRow,
  ChatMessage as ChatMessageRow,
  Contribution,
  Dispatch as DispatchRow,
  DispatchEvent as DispatchEventRow,
  Environment as EnvironmentRow,
  KnowledgeEntry as KnowledgeEntryRow,
  KnowledgeKind,
  ModelUsage,
  Project as ProjectRow,
  ProviderCaps,
  Regime,
  RegimePolicy,
  Role,
  RunEvent,
  Snapshot as SnapshotRow,
  Ticket as TicketRow,
  TicketStatus,
  TicketType,
  UsageWindow,
  UsageReport as UsageReportRow,
  UsageBucket,
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
  adapter?: string;
  model: string | null;
  skills: string[];
  mcpServers: string[];
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

export type Environment = Json<EnvironmentRow>;
export type KnowledgeEntry = Json<KnowledgeEntryRow>;
/** One time a run loaded an entry: the retrieval trail. */
export type KnowledgeRead = { id: number; entryId: string; dispatchId: string | null; via: string; at: string };
export type KnowledgeDetail = KnowledgeEntry & { reads: KnowledgeRead[] };
export type KnowledgeInput = {
  environmentId: string;
  projectId?: string | null;
  area?: string | null;
  kind: KnowledgeKind;
  title: string;
  abstract: string;
  body?: string;
  tags?: string[];
};
export type KnowledgePatch = Partial<Omit<KnowledgeInput, "environmentId">> & { pinned?: 0 | 1; status?: "active" | "archived" };

export type Chat = Json<ChatRow>;
export type ChatMessage = Json<ChatMessageRow>;
export type ChatAction = ChatMessage["actions"][number];
export type ChatDetail = { chat: Chat; messages: ChatMessage[]; thinking: boolean };
/** The `chat` SSE event: a turn started, one of the Chief's run events, or the turn finished. */
export type ChatStreamMessage = { chatId: string; kind: "started" | "event" | "finished"; event?: RunEvent };

export type ToolStatus = "ok" | "missing" | "error";
/** GET /api/tools. Secret values never leave the server: MCP servers list env key names only. */
export type ToolsInventory = {
  adapters: Array<{ id: string; status: ToolStatus; version?: string; isolated: boolean; note: string }>;
  clis: Array<{ name: string; purpose: string; status: ToolStatus; version?: string }>;
  mcpServers: Array<{ name: string; builtIn: boolean; description: string; command: string; envKeys: string[]; roles: string[] }>;
  connectors: Array<{ id: string; status: ToolStatus; detail: string }>;
};

export type UsageReport = Json<UsageReportRow>;
export type TicketUsage = UsageReport["byTicket"][number];

export type { UsageBucket, Contribution, KnowledgeKind, ModelUsage, ProviderCaps, UsageWindow, Regime, RegimePolicy, Role, RunEvent, TicketStatus, TicketType };

// Issue intake (the board's "Import issues" picker); shapes from apps/server/src/intake.ts.
export type IntakeSourceId = "github" | "jira";
export type IntakeSources = {
  github: { available: true; repo: string } | { available: false; reason: string };
  jira: { available: true; baseUrl: string } | { available: false; reason: string };
};
export type GithubFilters = { labels: Array<{ name: string; color: string; description: string }>; milestones: Array<{ number: number; title: string }> };
export type JiraFilters = { projects: Array<{ key: string; name: string }>; epics: Array<{ key: string; summary: string }> };
export type GithubIntakeQuery = { source: "github"; query?: string; labels?: string[]; milestone?: string };
export type JiraIntakeQuery = { source: "jira"; jql?: string; project?: string; epic?: string; text?: string; includeDone?: boolean };
export type IntakeQuery = (GithubIntakeQuery | JiraIntakeQuery) & { projectId: string; limit?: number };
export type IntakeCandidate = {
  source: IntakeSourceId;
  key: string;
  title: string;
  url: string;
  status: string;
  labels: string[];
  type?: string;
  parent?: { key: string; summary: string };
  author?: string;
  trusted: boolean;
  ticketId?: string;
};
export type IntakeImportResult = { key: string; url: string; status: "imported" | "skipped"; ticketIds: string[]; reason?: string; existingTicketId?: string };

// Updates (the top bar's "Update available"); shape from apps/server/src/updates.ts.
export type UpdateStatus = {
  current: string;
  /** `git describe`: v0.2.0, or v0.2.0-3-gabc1234 between releases. */
  version: string;
  branch: string;
  channel: "releases" | "main";
  latest?: string;
  latestVersion?: string;
  notesUrl?: string;
  behind: number;
  commits: Array<{ sha: string; subject: string }>;
  diverged: boolean;
  checkedAt?: string;
  error?: string;
  service: "launchd" | "systemd" | "none";
  applying?: { startedAt: string; target: string; log: string; finished?: "ok" | "failed" };
};
