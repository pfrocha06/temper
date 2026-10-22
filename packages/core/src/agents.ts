import { and, desc, eq } from "drizzle-orm";
import { requestApproval } from "./approvals.ts";
import { audit, type Actor } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { agents, type AgentPermissions } from "./db/schema.ts";

export const ROLES = ["chief", "builder", "verifier", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export type Agent = typeof agents.$inferSelect;
export type AgentDraft = Omit<Agent, "version" | "createdAt">;

const readOnlyTools = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(ls:*)"];
const neverTools = ["Bash(git push:*)", "Bash(git remote:*)", "Bash(gh:*)", "Bash(curl:*)", "Bash(wget:*)"];

const write: AgentPermissions = {
  allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  disallowedTools: neverTools,
};
const readOnly: AgentPermissions = { allowedTools: readOnlyTools, disallowedTools: [...neverTools, "Edit", "Write"] };

export const DEFAULT_AGENTS: AgentDraft[] = [
  {
    id: "chief",
    role: "chief",
    name: "Chief of Staff",
    adapter: "claude-cli",
    model: "opus",
    skills: ["grilling", "to-spec", "to-tickets", "domain-modeling", "research", "architect", "blast-radius", "retro", "writing-for-agents"],
    permissions: readOnly,
    mcpServers: ["temper"],
    maxConcurrency: 1,
    runsPerHour: 12,
    instructions: [
      "You are the Chief of Staff: the one agent that holds the whole picture.",
      "You gather context (from the board, tickets, runs and the knowledge base), turn it into specs and tickets, and delegate to the Builder, Verifier and Reviewer.",
      "You are the only agent that writes shared knowledge. Record durable facts about the environment, conventions, decisions, gotchas and how-tos.",
      "Never record claims about what the code does that you have not seen proven; never record secrets.",
    ].join(" "),
  },
  { id: "builder", role: "builder", name: "Builder", adapter: "claude-cli", model: "sonnet", skills: ["tdd", "codebase-design", "diagnosing-bugs", "typescript-best-practices", "principle-prove-it-works", "principle-fix-root-causes", "principle-subtract-before-you-add", "frontend-design", "shadcn", "react-best-practices", "web-design-guidelines", "composition-patterns"], permissions: write, mcpServers: ["temper"], maxConcurrency: 2, runsPerHour: 12, instructions: "" },
  { id: "verifier", role: "verifier", name: "Verifier", adapter: "claude-cli", model: "opus", skills: ["create-verification-skill", "maintain-verification-skill", "playwright-cli", "webapp-testing", "principle-test-behavior-not-implementation", "benchmark-checklist"], permissions: write, mcpServers: ["temper"], maxConcurrency: 1, runsPerHour: 12, instructions: "" },
  { id: "reviewer", role: "reviewer", name: "Reviewer", adapter: "claude-cli", model: "opus", skills: ["code-review", "interrogate", "blast-radius", "principle-explain-the-number"], permissions: readOnly, mcpServers: ["temper"], maxConcurrency: 1, runsPerHour: 12, instructions: "" },
];

/** Latest version of each agent. */
export async function listAgents(db: Db): Promise<Agent[]> {
  const rows = await db.select().from(agents).orderBy(agents.id, desc(agents.version));
  const latest = new Map<string, Agent>();
  for (const r of rows) if (!latest.has(r.id)) latest.set(r.id, r);
  return [...latest.values()];
}

export async function getAgent(db: Db, id: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).orderBy(desc(agents.version)).limit(1);
  return row;
}

export async function getAgentVersion(db: Db, id: string, version: number): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.version, version)));
  return row;
}

/**
 * Saves a new version of an agent. Verifier changes are board-gated: the new version is
 * recorded but an approval is requested, and the dispatcher keeps using the last approved one.
 */
export async function saveAgent(db: Db, draft: AgentDraft, actor: Actor = "board"): Promise<Agent> {
  const current = await getAgent(db, draft.id);
  const [row] = await db
    .insert(agents)
    .values({ ...draft, version: (current?.version ?? 0) + 1 })
    .returning();
  await audit(db, { actor, kind: "agent.saved", subject: `${row!.id}@${row!.version}`, data: { role: row!.role, model: row!.model } });
  if (current && draft.role === "verifier") {
    await requestApproval(db, {
      kind: "agent_change",
      title: `Verifier changed to v${row!.version}`,
      body: "Changes to the Verifier alter what counts as proof. Approve to start using this version.",
    });
  }
  return row!;
}

export async function seedAgents(db: Db): Promise<void> {
  for (const a of DEFAULT_AGENTS) if (!(await getAgent(db, a.id))) await saveAgent(db, a, "system");
}
