import { sql } from "drizzle-orm";
import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A folder holding several related projects/repos. Knowledge is shared at this level. */
export const environments = pgTable("environments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  createdAt: createdAt(),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  environmentId: text("environment_id").references(() => environments.id),
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull(),
  remoteUrl: text("remote_url"),
  holdoutsPath: text("holdouts_path"),
  defaultBranch: text("default_branch").notNull().default("main"),
  /** Prepares a fresh worktree (e.g. installs dependencies). Runs on the server, outside agent sandboxes. */
  setupCommand: text("setup_command"),
  /** Runs the project's own tests in a worktree. */
  testCommand: text("test_command").notNull().default("pnpm test"),
  /** Boots the app from a worktree; receives PORT. Empty when there is no app to run. */
  appCommand: text("app_command"),
  appHealthPath: text("app_health_path").notNull().default("/"),
  /** Prepares the holdouts checkout (e.g. installs Playwright). Re-runs when its manifests change. */
  holdoutsSetupCommand: text("holdouts_setup_command"),
  /** Runs holdouts from the holdouts checkout; receives TEMPER_APP_URL. Prints `AC-<id>: PASS|FAIL <msg>` lines. */
  holdoutsCommand: text("holdouts_command"),
  createdAt: createdAt(),
});

export type AgentPermissions = {
  allowedTools: string[];
  disallowedTools: string[];
};

export const agents = pgTable(
  "agents",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    role: text("role").notNull(),
    name: text("name").notNull(),
    adapter: text("adapter").notNull(),
    model: text("model"),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    /** MCP servers (by profile name, plus the built-in `temper`) this role may use. */
    mcpServers: jsonb("mcp_servers").$type<string[]>().notNull().default(["temper"]),
    permissions: jsonb("permissions").$type<AgentPermissions>().notNull(),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    runsPerHour: integer("runs_per_hour").notNull().default(6),
    instructions: text("instructions").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);

export type AcceptanceCriterion = { id: string; text: string };

/** A ticket's counterpart in an external tracker such as Jira. */
export type ExternalRef = { tracker: string; key: string; url: string };

export const tickets = pgTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    spec: text("spec").notNull().default(""),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<AcceptanceCriterion[]>().notNull().default([]),
    fileScope: jsonb("file_scope").$type<string[]>().notNull().default([]),
    dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
    parentId: text("parent_id"),
    status: text("status").notNull().default("backlog"),
    stage: text("stage"),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    prUrl: text("pr_url"),
    externalRef: jsonb("external_ref").$type<ExternalRef>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tickets_status_idx").on(t.status)],
);

export const dispatches = pgTable(
  "dispatches",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    stage: text("stage").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull().default("queued"),
    verdict: text("verdict"),
    summary: text("summary"),
    sessionId: text("session_id"),
    temperatureSnapshotId: integer("temperature_snapshot_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("dispatches_ticket_idx").on(t.ticketId), index("dispatches_status_idx").on(t.status)],
);

export const dispatchEvents = pgTable(
  "dispatch_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatches.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dispatch_events_dispatch_idx").on(t.dispatchId, t.id)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    dispatchId: text("dispatch_id").references(() => dispatches.id),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_ticket_idx").on(t.ticketId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").references(() => tickets.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    options: jsonb("options").$type<string[]>().notNull().default(["approve", "reject"]),
    status: text("status").notNull().default("pending"),
    resolution: text("resolution"),
    note: text("note"),
    /** For proposals: the action the board confirms, e.g. { action: "resolve_approval", approvalId, resolution }. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** The Chief conversation a proposal came from. */
    chatId: text("chat_id"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("audit_events_kind_idx").on(t.kind, t.at)],
);

export const temperatureSnapshots = pgTable("temperature_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  value: doublePrecision("value").notNull(),
  regime: text("regime").notNull(),
  contributions: jsonb("contributions").notNull(),
});

export const KNOWLEDGE_KINDS = ["convention", "gotcha", "decision", "howto", "environment", "context"] as const;

/**
 * Shared project knowledge. Addressed like a path (`env/project/area/slug`) and loaded in
 * tiers: `title` (L0) and `abstract` (L1) go into prompts; `body` (L2) is fetched on demand.
 * Only the Chief of Staff writes entries.
 */
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id),
    projectId: text("project_id").references(() => projects.id),
    /** Optional path prefix inside the project the entry is about, e.g. `apps/web/`. */
    area: text("area"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    body: text("body").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"),
    pinned: integer("pinned").notNull().default(0),
    version: integer("version").notNull().default(1),
    /** Where it was learned: a dispatch id, a ticket id, or `board`. */
    source: text("source"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_env_idx").on(t.environmentId, t.status)],
);

/** Which entries a run actually loaded: the retrieval trail for debugging memory. */
export const knowledgeReads = pgTable(
  "knowledge_reads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => knowledgeEntries.id),
    dispatchId: text("dispatch_id"),
    via: text("via").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_reads_entry_idx").on(t.entryId)],
);

/** A conversation between the board and the Chief of Staff (brainstorms, intake, questions). */
export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  environmentId: text("environment_id")
    .notNull()
    .references(() => environments.id),
  title: text("title").notNull(),
  /** The agent CLI session, resumed on every turn so the Chief keeps the thread. */
  sessionId: text("session_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id),
    author: text("author").notNull(),
    content: text("content").notNull(),
    /** Tool calls the Chief made during this turn (knowledge writes, tickets created). */
    actions: jsonb("actions").$type<Array<{ tool: string; summary: string }>>().notNull().default([]),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_chat_idx").on(t.chatId, t.id)],
);

/** Usage reported by an agent provider for one run (stage, digest, chat turn, trial). */
export const providerUsage = pgTable(
  "provider_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adapter: text("adapter").notNull(),
    model: text("model").notNull(),
    dispatchId: text("dispatch_id"),
    chatId: text("chat_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** List-price equivalent the provider reports; subscriptions are not billed per token. */
    costUsd: doublePrecision("cost_usd"),
    apiMs: integer("api_ms"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_usage_adapter_idx").on(t.adapter, t.at)],
);

/** Rate-limit / subscription window reports, appended as the provider emits them. */
export const providerLimits = pgTable(
  "provider_limits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adapter: text("adapter").notNull(),
    limitType: text("limit_type").notNull(),
    status: text("status").notNull(),
    resetsAt: timestamp("resets_at", { withTimezone: true }),
    raw: jsonb("raw").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_limits_adapter_idx").on(t.adapter, t.limitType, t.at)],
);

export type ProviderCaps = {
  runsPerDay?: number;
  tokensPerDay?: number;
  runsPerSession?: number;
  tokensPerSession?: number;
  runsPerWeek?: number;
  tokensPerWeek?: number;
  /** Length of the provider's session window in hours (5 for Claude subscriptions). */
  sessionHours?: number;
};

export const providerSettings = pgTable("provider_settings", {
  adapter: text("adapter").primaryKey(),
  caps: jsonb("caps").$type<ProviderCaps>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
