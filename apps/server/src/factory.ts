import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
  audit,
  claimTicket,
  createDispatch,
  createTicket,
  openTicketsByRef,
  dispatchableTickets,
  finishDispatch,
  getAgent,
  getAgentVersion,
  getProject,
  getTicket,
  latestArtifacts,
  latestSnapshot,
  listTickets,
  nextStep,
  parseVerdict,
  pendingApprovals,
  recentDispatches,
  recordDispatchEvent,
  recordSignal,
  schema,
  refreshTemperature,
  requestApproval,
  saveArtifact,
  stageAttempts,
  startStage,
  ticketDispatches,
  updateTicket,
  addChatMessage,
  getApproval,
  resolveApproval,
  type Actor,
  getChat,
  getEnvironment,
  knowledgeDigest,
  listProjects,
  recordKnowledgeReads,
  searchKnowledge,
  type Agent,
  type AgentAdapter,
  type McpServerSpec,
  capReached,
  getCaps,
  recordLimit,
  recordUsage,
  usageWindows,
  type Approval,
  type Db,
  type Project,
  type Role,
  type RunEvent,
  type Stage,
  type Ticket,
  type TicketType,
  type Verdict,
  type Workflow,
} from "@temper/core";
import { createPullRequest, deleteRemoteBranch, mergePullRequest, prBody, prState } from "@temper/plugin-github";
import { bootApp } from "./app-runner.ts";
import { protectedDirs, type Config } from "./config.ts";
import { probeGateIsolation, type GateProbeResult } from "./probe.ts";
import type { Sandbox } from "./sandbox.ts";
import { diffGuard } from "./gates/diff-guard.ts";
import { builderFeedback as holdoutFeedback, parseHoldoutResults } from "./gates/holdout-results.ts";
import { runShell } from "./exec.ts";
import { issueLine } from "./github-import.ts";
import { scanThenPush } from "./gates/secret-scan.ts";
import { runChecks } from "./gates/run.ts";
import {
  changedBetween,
  changedFiles,
  commitAll,
  diffBetween,
  ensureWorktree,
  fetchBranch,
  headSha,
  mergeBase,
  pushBranch,
  removeWorktree,
} from "./git.ts";
import { parsePlan } from "./plan.ts";
import type { Auth } from "./auth.ts";
import type { Profile } from "./profile.ts";
import { buildPrompt, CHIEF_CHAT_PROMPT, CHIEF_DIGEST_PROMPT, CHIEF_INTAKE_PROMPT, FEEDBACK_ARTIFACT } from "./prompt.ts";
import { resolveSkills } from "./skills.ts";

export type FactoryOptions = {
  auth?: Auth;
  profile?: Profile;
  /** The account an adapter's CLI is signed in as (email), for profiles that pin one. */
  accountOf?: (adapter: string) => Promise<string | undefined>;
};

const ACCOUNT_CHECK_MS = 5 * 60_000;

type AgentStage = Extract<Stage, { kind: "agent" }>;
type GateStage = Extract<Stage, { kind: "gate" }>;

type Active = { dispatchId: string; ticketId: string; role: Role | "server"; agentId: string; controller: AbortController };

type StageOutcome = { verdict: Verdict; summary: string; artifact?: { name: string; content: string }; feedback?: string; waiting?: boolean };

const RATE_LIMIT_PAUSE_MS = 15 * 60_000;

/**
 * Environment for every agent process. Agents commit locally but cannot reach the user's
 * signing keys from the sandbox, so signing is disabled for their commits only (via git's
 * GIT_CONFIG_* variables; no config file changes). Merges happen on the git host.
 */
export const AGENT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "tag.gpgsign",
  GIT_CONFIG_VALUE_1: "false",
};
const MAX_GATE_CONCURRENCY = 2;

/** Base ref for worktrees and diffs: the remote branch when there is a remote. */
export const baseRef = (p: Project) => (p.remoteUrl ? `origin/${p.defaultBranch}` : p.defaultBranch);

export class Factory extends EventEmitter {
  private active = new Map<string, Active>();
  private pausedAdapters = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  paused = false;

  private db: Db;
  private config: Config;
  private adapters: Map<string, AgentAdapter>;
  private workflows: Map<TicketType, Workflow>;

  private options: FactoryOptions;

  constructor(db: Db, config: Config, adapters: Map<string, AgentAdapter>, workflows: Map<TicketType, Workflow>, options: FactoryOptions = {}) {
    super();
    this.db = db;
    this.config = config;
    this.adapters = adapters;
    this.workflows = workflows;
    this.options = options;
  }

  /** Adapters this server can run. */
  adapterIds(): string[] {
    return [...this.adapters.keys()];
  }

  // ── context for agent runs: capability, MCP servers, shared knowledge ────

  private environmentOf(project: Project): string {
    return project.environmentId ?? "env_default";
  }

  /**
   * MCP servers for one run: the built-in `temper` server (with a capability scoped to this run)
   * plus any profile servers assigned to the agent. Returns a release function.
   */
  private mcpFor(agent: Agent, scope: { environmentId: string; projectId?: string; dispatchId?: string; chatId?: string }): { servers: Record<string, McpServerSpec>; release: () => void } {
    const servers: Record<string, McpServerSpec> = {};
    let token: string | undefined;
    const { auth, profile } = this.options;
    if (agent.mcpServers.includes("temper") && auth) {
      token = auth.issue({ role: agent.role, ...scope });
      servers.temper = {
        command: process.execPath,
        args: [join(this.config.appRoot, "packages", "mcp-temper", "src", "main.ts")],
        env: { TEMPER_API_URL: `http://127.0.0.1:${this.config.port}`, TEMPER_CAPABILITY: token },
      };
    }
    for (const name of agent.mcpServers) {
      const cfg = profile?.mcpServers[name];
      if (cfg && name !== "temper") servers[name] = { command: cfg.command, args: cfg.args, env: cfg.env };
    }
    return { servers, release: () => token && auth?.revoke(token) };
  }

  /**
   * Wraps a run's event handler to record provider usage and limit reports, and to pause the
   * provider until the reset time it reports when a limit is hit.
   */
  private observe(adapter: string, ctx: { dispatchId?: string; chatId?: string }, next?: (e: RunEvent) => void): (e: RunEvent) => void {
    return (e) => {
      if (e.kind === "usage") void recordUsage(this.db, adapter, e.models, { ...ctx, apiMs: e.apiMs });
      if (e.kind === "rate_limit") {
        void recordLimit(this.db, adapter, e);
        if (e.status !== "allowed") {
          const until = e.resetsAt ? e.resetsAt * 1000 : Date.now() + RATE_LIMIT_PAUSE_MS;
          this.pausedAdapters.set(adapter, Math.max(until, this.pausedAdapters.get(adapter) ?? 0));
        }
      }
      next?.(e);
    };
  }

  private capNotices = new Set<string>();
  private refusalNotices = new Set<string>();
  private accounts = new Map<string, { email: string | undefined; at: number }>();

  /**
   * Why work may not go to an adapter, or undefined when it may: the profile must enable it, and
   * when the profile pins an account for it, the CLI must be signed in as exactly that account.
   */
  async adapterRefusal(adapter: string): Promise<string | undefined> {
    const profile = this.options.profile;
    const enabled = profile?.adapters ?? ["claude-cli"];
    if (!enabled.includes(adapter)) return `profile "${profile?.name ?? "default"}" does not allow the ${adapter} adapter`;
    if (!this.adapters.has(adapter)) return `adapter '${adapter}' is not installed`;
    const pinned = profile?.accounts?.[adapter];
    if (!pinned) return undefined;
    let cached = this.accounts.get(adapter);
    if (!cached || Date.now() - cached.at > ACCOUNT_CHECK_MS) {
      cached = { email: await this.options.accountOf?.(adapter).catch(() => undefined), at: Date.now() };
      this.accounts.set(adapter, cached);
    }
    if (cached.email?.toLowerCase() !== pinned.toLowerCase()) {
      return `${adapter} is signed in as ${cached.email ?? "nobody"}, but profile "${profile?.name ?? "default"}" allows only ${pinned}`;
    }
    return undefined;
  }

  /** The adapter for an agent's run, refused (audited, the board told once a day) when not allowed. */
  private async adapterFor(agent: Agent): Promise<AgentAdapter> {
    const refusal = await this.adapterRefusal(agent.adapter);
    if (refusal) {
      await this.refuse(agent, refusal);
      throw new Error(`dispatch refused: ${refusal}`);
    }
    return this.adapters.get(agent.adapter)!;
  }

  private async refuse(agent: Agent, reason: string): Promise<void> {
    const key = `${agent.id}:${reason}:${new Date().toDateString()}`;
    if (this.refusalNotices.has(key)) return;
    this.refusalNotices.add(key);
    await audit(this.db, { actor: "system", kind: "dispatch.refused", subject: agent.adapter, data: { agent: agent.id, role: agent.role, reason } });
    await requestApproval(this.db, {
      kind: "notice",
      title: `${agent.name} gets no work: ${reason}`,
      body: "Temper only dispatches to adapters the profile allows, signed in as the account it names. Change the agent's adapter on the Agents screen, or fix the profile or the CLI's login.",
      options: ["dismiss"],
    });
  }

  /** A provider at one of its board-set caps takes no new work; the board hears about it once per window. */
  private async providerCapped(adapter: string): Promise<boolean> {
    const caps = await getCaps(this.db, adapter);
    if (Object.keys(caps).length === 0) return false;
    const windows = await usageWindows(this.db, adapter, caps);
    const hit = capReached(caps, windows);
    if (!hit) return false;
    const key = `${adapter}:${hit.cap}:${new Date().toDateString()}`;
    if (!this.capNotices.has(key)) {
      this.capNotices.add(key);
      await requestApproval(this.db, {
        kind: "notice",
        title: `${adapter} reached its ${hit.cap} cap (${hit.used}/${hit.limit})`,
        body: "New work for this provider waits until the window resets. Raise the cap in Settings → Providers to continue now.",
        options: ["dismiss"],
      });
    }
    return true;
  }

  /** The L0/L1 knowledge digest for a run, recorded as read by that dispatch. */
  private async knowledgeFor(environmentId: string, projectId: string | undefined, paths: string[], dispatchId?: string): Promise<string | undefined> {
    const entries = await searchKnowledge(this.db, { environmentId, projectId, paths, limit: 30 });
    if (entries.length === 0) return undefined;
    await recordKnowledgeReads(this.db, entries.map((e) => e.id), "prompt", dispatchId);
    return knowledgeDigest(entries);
  }

  // ── the sandbox for Builder code the server runs (tests, the candidate app) ──

  private gateProbe: Promise<GateProbeResult> | undefined;
  private gateNoticeSent = false;

  /**
   * The sandbox for one project's gate commands. With srt on, the first use runs the gate
   * isolation probe; if it fails, every stage that would run Builder code goes to the board.
   */
  private async sandboxFor(project: Project): Promise<Sandbox> {
    const sandbox: Sandbox = {
      mode: this.config.gateSandbox,
      allowRead: this.config.gateAllowRead,
      denyRead: [...protectedDirs(this.config), ...(project.holdoutsPath ? [project.holdoutsPath] : [])],
    };
    if (sandbox.mode === "off") return sandbox;
    this.gateProbe ??= this.probeGateSandbox();
    const probe = await this.gateProbe;
    if (!probe.isolated) throw new Error(`the gate sandbox failed its isolation probe: ${probe.problems.join("; ")}`);
    return sandbox;
  }

  private async probeGateSandbox(): Promise<GateProbeResult> {
    const probe = await probeGateIsolation({ mode: this.config.gateSandbox, denyRead: [], allowRead: this.config.gateAllowRead }, protectedDirs(this.config), `http://127.0.0.1:${this.config.port}`).catch(
      (err): GateProbeResult => ({ isolated: false, problems: [`the probe crashed: ${(err as Error).message}`], output: "" }),
    );
    await audit(this.db, { actor: "system", kind: probe.isolated ? "gate_sandbox.verified" : "gate_sandbox.failed", data: { problems: probe.problems } });
    this.gateNoticeSent &&= !probe.isolated;
    if (!probe.isolated) {
      // Probe again next time: the fix may be outside Temper (installing a sandbox dependency).
      this.gateProbe = undefined;
      if (this.gateNoticeSent) return probe;
      this.gateNoticeSent = true;
      await requestApproval(this.db, {
        kind: "notice",
        title: "Gate sandbox is not isolating Builder code",
        body: `Stages that run the Builder's tests or app are blocked until it is.\n\n${probe.problems.map((p) => `- ${p}`).join("\n")}\n\nRun \`temper probe-isolation\` after fixing it.`,
        options: ["dismiss"],
      });
    }
    return probe;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.config.gateSandbox === "off") await audit(this.db, { actor: "system", kind: "gate_sandbox.off", data: { reason: "TEMPER_GATE_SANDBOX=off" } });
    await this.recoverOrphans();
    await refreshTemperature(this.db);
    this.timer = setInterval(() => void this.tick(), this.config.heartbeatMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const a of this.active.values()) a.controller.abort();
  }

  async setPaused(paused: boolean, actor: Actor = "board"): Promise<void> {
    this.paused = paused;
    await audit(this.db, { actor, kind: paused ? "factory.paused" : "factory.resumed" });
    if (!paused) void this.tick();
  }

  status() {
    return {
      paused: this.paused,
      active: [...this.active.values()].map(({ controller: _c, ...a }) => a),
      pausedAdapters: Object.fromEntries([...this.pausedAdapters].filter(([, until]) => until > Date.now())),
    };
  }

  /** Dispatches left `running` by a previous process can never finish; close them. */
  private async recoverOrphans(): Promise<void> {
    for (const d of await recentDispatches(this.db, 500)) {
      if (d.status === "running" && !this.active.has(d.id)) {
        await finishDispatch(this.db, d.id, { status: "failed", summary: "orphaned by a restart" });
      }
    }
  }

  // ── heartbeat: reconcile, then dispatch ─────────────────────────────────

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcile();
      await refreshTemperature(this.db);
      if (this.paused) return;
      await this.dispatchInProgress();
      await this.claimReady();
    } catch (err) {
      await audit(this.db, { actor: "system", kind: "heartbeat.error", data: { error: (err as Error).message } });
    } finally {
      this.ticking = false;
    }
  }

  private async reconcile(): Promise<void> {
    for (const a of this.active.values()) {
      const t = await getTicket(this.db, a.ticketId);
      if (!t || t.status !== "in_progress") a.controller.abort();
    }
  }

  private async dispatchInProgress(): Promise<void> {
    const busy = new Set([...this.active.values()].map((a) => a.ticketId));
    for (const t of (await listTickets(this.db)).filter((t) => t.status === "in_progress" && !busy.has(t.id))) {
      const wf = this.workflowFor(t);
      const stage = wf.stages.find((s) => s.id === t.stage) ?? startStage(wf);
      if (await this.hasCapacity(stage)) void this.runStage(t, wf, stage);
    }
  }

  private async claimReady(): Promise<void> {
    for (const t of await dispatchableTickets(this.db)) {
      const wf = this.workflowFor(t);
      const stage = startStage(wf);
      if (!(await this.hasCapacity(stage))) continue;
      if (!(await claimTicket(this.db, t.id, stage.id))) continue;
      try {
        const ticket = await this.prepareWorktree(t);
        void this.runStage(ticket, wf, stage);
      } catch (err) {
        await this.escalate(t, stage.id, `Could not prepare a worktree: ${(err as Error).message}`);
      }
    }
  }

  private async hasCapacity(stage: Stage): Promise<boolean> {
    const active = [...this.active.values()];
    if (stage.kind === "gate") return active.filter((a) => a.role === "server").length < MAX_GATE_CONCURRENCY;
    const agent = await this.agentFor(stage.role);
    const refusal = await this.adapterRefusal(agent.adapter);
    if (refusal) {
      await this.refuse(agent, refusal);
      return false;
    }
    if ((this.pausedAdapters.get(agent.adapter) ?? 0) > Date.now()) return false;
    if (await this.providerCapped(agent.adapter)) return false;
    if (active.filter((a) => a.agentId === agent.id).length >= agent.maxConcurrency) return false;
    const hourAgo = Date.now() - 3_600_000;
    const recent = (await recentDispatches(this.db, 200)).filter((d) => d.agentId === agent.id && d.createdAt.getTime() > hourAgo);
    return recent.length < agent.runsPerHour;
  }

  private workflowFor(t: Ticket): Workflow {
    const wf = this.workflows.get(t.type as TicketType);
    if (!wf) throw new Error(`no workflow for ticket type '${t.type}'`);
    return wf;
  }

  /**
   * The agent for a role. A Verifier version is only used once the board approved it;
   * until then the previous version keeps running.
   */
  async agentFor(role: Role): Promise<Agent> {
    const agent = await getAgent(this.db, role);
    if (!agent) throw new Error(`no agent for role '${role}'`);
    if (role !== "verifier" || agent.version === 1) return agent;
    const approvals = (await pendingApprovals(this.db)).filter((a) => a.kind === "agent_change" && a.title.endsWith(`v${agent.version}`));
    if (approvals.length === 0) return agent;
    return (await getAgentVersion(this.db, role, agent.version - 1)) ?? agent;
  }

  private async prepareWorktree(t: Ticket): Promise<Ticket> {
    const project = await this.project(t);
    if (project.remoteUrl) await fetchBranch(project.repoPath, project.defaultBranch);
    const { path, branch } = await ensureWorktree(project.repoPath, this.config.worktreesDir, t.id, baseRef(project));
    return updateTicket(this.db, t.id, { worktreePath: path, branch });
  }

  /** Installs the holdouts' own dependencies whenever their manifests change. */
  private async ensureHoldoutsSetup(project: Project): Promise<void> {
    if (!project.holdoutsSetupCommand || !project.holdoutsPath) return;
    const manifests = ["package.json", "pnpm-lock.yaml", "package-lock.json"]
      .map((f) => join(project.holdoutsPath!, f))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f, "utf8"))
      .join("\0");
    const hash = createHash("sha256").update(project.holdoutsSetupCommand + manifests).digest("hex").slice(0, 16);
    const marker = join(project.holdoutsPath, ".git", `temper-setup-${hash}`);
    if (existsSync(marker)) return;
    const r = await runShell(project.holdoutsSetupCommand, { cwd: project.holdoutsPath, timeoutMs: 20 * 60_000 });
    if (r.code !== 0) throw new Error(`holdouts setup failed (exit ${r.code}):\n${(r.stdout + r.stderr).slice(-2000)}`);
    writeFileSync(marker, new Date().toISOString());
    await audit(this.db, { actor: "system", kind: "holdouts.setup", subject: project.id });
  }

  /** Done tickets of a project: their holdouts are regression checks for everything after. */
  private async regressionTickets(projectId: string): Promise<string[]> {
    return (await listTickets(this.db, projectId)).filter((t) => t.status === "done").map((t) => t.id);
  }

  /**
   * Runs the project's setup command once per worktree, on the server and outside any agent
   * sandbox (agents have no network). A marker next to the worktree records success.
   */
  private async ensureSetup(ticket: Ticket, project: Project): Promise<void> {
    if (!project.setupCommand || !ticket.worktreePath) return;
    const marker = `${ticket.worktreePath}.setup-ok`;
    if (existsSync(marker)) return;
    const r = await runShell(project.setupCommand, { cwd: ticket.worktreePath, timeoutMs: 20 * 60_000 });
    if (r.code !== 0) throw new Error(`setup command failed (exit ${r.code}):\n${(r.stdout + r.stderr).slice(-2000)}`);
    writeFileSync(marker, new Date().toISOString());
    await audit(this.db, { actor: "system", kind: "worktree.setup", subject: ticket.id });
  }

  private async project(t: Ticket): Promise<Project> {
    const p = await getProject(this.db, t.projectId);
    if (!p) throw new Error(`project ${t.projectId} not found`);
    return p;
  }

  // ── running a stage ─────────────────────────────────────────────────────

  private async runStage(ticket: Ticket, wf: Workflow, stage: Stage): Promise<void> {
    const agent = stage.kind === "agent" ? await this.agentFor(stage.role) : undefined;
    const snapshot = await latestSnapshot(this.db);
    const dispatch = await createDispatch(this.db, {
      ticketId: ticket.id,
      stage: stage.id,
      agentId: agent?.id ?? "server",
      agentVersion: agent?.version ?? 0,
      temperatureSnapshotId: snapshot?.id,
    });
    const controller = new AbortController();
    this.active.set(dispatch.id, {
      dispatchId: dispatch.id,
      ticketId: ticket.id,
      role: agent ? (agent.role as Role) : "server",
      agentId: agent?.id ?? "server",
      controller,
    });
    this.emit("change");
    try {
      if (ticket.stage !== stage.id) ticket = await updateTicket(this.db, ticket.id, { stage: stage.id });
      await this.ensureSetup(ticket, await this.project(ticket));
      const outcome =
        stage.kind === "agent"
          ? await this.runAgentStage(ticket, stage, agent!, dispatch.id, controller.signal)
          : await this.runGateStage(ticket, stage, dispatch.id, controller.signal);
      if (controller.signal.aborted) {
        await finishDispatch(this.db, dispatch.id, { status: "cancelled", summary: "cancelled" });
        return;
      }
      if (outcome.artifact) await saveArtifact(this.db, { ticketId: ticket.id, dispatchId: dispatch.id, ...outcome.artifact });
      await finishDispatch(this.db, dispatch.id, {
        status: outcome.verdict === "PASS" || outcome.waiting ? "succeeded" : "failed",
        verdict: outcome.waiting ? undefined : outcome.verdict,
        summary: outcome.summary.slice(0, 2000),
      });
      if (outcome.waiting) return;
      await this.recordStageSignals(ticket, stage, outcome.verdict);
      await this.advance(ticket, wf, stage, outcome);
    } catch (err) {
      const message = (err as Error).message;
      await finishDispatch(this.db, dispatch.id, { status: "failed", summary: message.slice(0, 2000) }).catch(() => {});
      if (!controller.signal.aborted) await this.escalate(ticket, stage.id, `Stage ${stage.id} crashed: ${message}`);
    } finally {
      this.active.delete(dispatch.id);
      this.emit("change");
    }
  }

  private async runAgentStage(ticket: Ticket, stage: AgentStage, agent: Agent, dispatchId: string, signal: AbortSignal): Promise<StageOutcome> {
    const project = await this.project(ticket);
    const adapter = await this.adapterFor(agent);
    const artifacts = await latestArtifacts(this.db, ticket.id);

    // Feedback reaches only the stage that is retrying, and only if newer than its last output.
    const feedbackArt = artifacts.find((a) => a.name === FEEDBACK_ARTIFACT);
    const ownArt = artifacts.find((a) => a.name === stage.artifact);
    const feedback = feedbackArt && (!ownArt || feedbackArt.id > ownArt.id) ? feedbackArt.content : undefined;

    const worktree = ticket.worktreePath ?? project.repoPath;
    let cwd = worktree;
    const addDirs: string[] = [];
    const denyDirs: string[] = [];
    const disallowed = [...agent.permissions.disallowedTools];
    let app: Awaited<ReturnType<typeof bootApp>> | undefined;
    let holdoutsBefore: string | undefined;
    let context: string | undefined;

    if (stage.role === "verifier") {
      if (!project.holdoutsPath) {
        return { verdict: "BLOCKED", summary: "No holdouts repository is configured for this project." };
      }
      cwd = project.holdoutsPath;
      await this.ensureHoldoutsSetup(project);
      addDirs.push(worktree);
      disallowed.push(`Edit(${worktree}/**)`, `Write(${worktree}/**)`);
      holdoutsBefore = await headSha(cwd);
      if (project.appCommand && adapter.reachesHostLoopback === false) {
        return { verdict: "BLOCKED", summary: `The ${agent.adapter} adapter cannot reach the candidate app from its sandbox on this platform. Run the Verifier on another adapter (Agents screen).` };
      }
      if (project.appCommand) {
        const sandbox = await this.sandboxFor(project);
        app = await bootApp(project.appCommand, worktree, project.appHealthPath, sandbox).catch(() => undefined);
      }
    } else {
      if (project.holdoutsPath) denyDirs.push(project.holdoutsPath);
      // A worktree's git metadata lives in the main repository; commits must be able to write it.
      if (ticket.worktreePath && !stage.readOnly) addDirs.push(join(project.repoPath, ".git"));
    }
    if (stage.role === "reviewer" && ticket.worktreePath) {
      const mb = await mergeBase(worktree, baseRef(project));
      context = `Review the ticket branch: \`git diff ${mb}..HEAD\` in ${worktree}.`;
    }

    const { dirs: skillDirs, missing } = resolveSkills(this.config.appRoot, agent.skills);
    if (missing.length) await recordDispatchEvent(this.db, dispatchId, { kind: "stderr", text: `skills not installed: ${missing.join(", ")}` });

    const environmentId = this.environmentOf(project);
    const knowledge = await this.knowledgeFor(environmentId, project.id, ticket.fileScope, dispatchId);
    const mcp = this.mcpFor(agent, { environmentId, projectId: project.id, dispatchId });
    const prompt = buildPrompt({
      ticket,
      stage,
      artifacts,
      feedback,
      appUrl: app?.url,
      holdoutsPath: project.holdoutsPath,
      worktreePath: worktree,
      context,
      knowledge,
    });
    // A Linux sandbox has its own network namespace: the Verifier reaches the app through the sandbox proxy.
    const appViaProxy = stage.role === "verifier" && Boolean(app) && process.platform === "linux";
    try {
      const result = await adapter.run(
        {
          cwd,
          prompt,
          model: agent.model,
          allowedTools: stage.readOnly ? agent.permissions.allowedTools.filter((t) => t !== "Edit" && t !== "Write") : agent.permissions.allowedTools,
          disallowedTools: stage.readOnly ? [...disallowed, "Edit", "Write"] : disallowed,
          addDirs,
          denyDirs,
          readOnlyDirs: stage.role === "verifier" ? [worktree] : undefined,
          readOnly: stage.readOnly || undefined,
          hostLoopback: appViaProxy,
          skillDirs,
          appendSystemPrompt: agent.instructions || undefined,
          mcpServers: mcp.servers,
          env:
            stage.role === "verifier"
              ? {
                  ...AGENT_ENV,
                  TEMPER_APP_URL: app?.url ?? "",
                  TEMPER_APP_TOKEN: app?.token ?? "",
                  ...(appViaProxy ? { TEMPER_APP_VIA_PROXY: "1" } : {}),
                  TEMPER_CANDIDATE_PATH: worktree,
                  TEMPER_TICKET_ID: ticket.id,
                  TEMPER_REGRESSION_TICKETS: (await this.regressionTickets(ticket.projectId)).join(","),
                }
              : AGENT_ENV,
          signal,
        },
        this.observe(agent.adapter, { dispatchId }, (e) => void recordDispatchEvent(this.db, dispatchId, e)),
      );
      if (result.rateLimited) {
        if ((this.pausedAdapters.get(agent.adapter) ?? 0) < Date.now()) this.pausedAdapters.set(agent.adapter, Date.now() + RATE_LIMIT_PAUSE_MS);
        await audit(this.db, { actor: "system", kind: "adapter.rate_limited", subject: agent.adapter, data: { until: new Date(this.pausedAdapters.get(agent.adapter)!).toISOString() } });
      }
      let verdict: Verdict = result.isError ? "FAIL" : parseVerdict(result.finalText);
      let summary = result.finalText || (result.isError ? "agent run failed" : "");
      let outFeedback: string | undefined;

      if (stage.role === "verifier") {
        const guard = await this.guardHoldouts(project.holdoutsPath!, holdoutsBefore!, ticket);
        if (!guard.ok) {
          verdict = "BLOCKED";
          summary = `${summary}\n\nHoldout guard: ${guard.problems.join("; ")}`;
        }
        if (verdict === "FAIL") outFeedback = holdoutFeedback(parseHoldoutResults(result.finalText), project.holdoutsPath ?? undefined);
      } else if (stage.role === "reviewer" && verdict === "FAIL") {
        outFeedback = `The reviewer found blocking issues:\n${result.finalText}`;
      }
      return {
        verdict,
        summary,
        artifact: stage.artifact ? { name: stage.artifact, content: result.finalText } : undefined,
        feedback: outFeedback,
      };
    } finally {
      app?.stop();
      mcp.release();
    }
  }

  /**
   * The Verifier may add holdouts freely, but weakening or deleting existing ones outside a
   * verification ticket needs the board. The server commits the Verifier's work locally.
   */
  private async guardHoldouts(holdoutsPath: string, before: string, ticket: Ticket): Promise<{ ok: boolean; problems: string[] }> {
    await commitAll(holdoutsPath, `holdouts: ${ticket.id} ${ticket.title}`);
    const after = await headSha(holdoutsPath);
    if (after === before) return { ok: true, problems: [] };
    const changes = (await changedBetween(holdoutsPath, before, after)).map((c) => ({ ...c, path: `holdouts/${c.path}` }));
    const existing = changes.filter((c) => c.status !== "A").map((c) => c.path.slice("holdouts/".length));
    const existingTestDiff = existing.length ? await diffBetween(holdoutsPath, before, after, existing) : "";
    return diffGuard({ ticketType: ticket.type === "verification" ? "verification" : "feature", fileScope: [], changes, existingTestDiff });
  }

  private async runGateStage(ticket: Ticket, stage: GateStage, dispatchId: string, signal: AbortSignal): Promise<StageOutcome> {
    const project = await this.project(ticket);
    const worktree = ticket.worktreePath;
    if (!worktree) throw new Error("ticket has no worktree");

    if (stage.checks.includes("open_pr") || stage.checks.includes("await_merge")) {
      return this.runPrGate(ticket, stage, project, worktree);
    }
    if (stage.checks.includes("holdouts")) await this.ensureHoldoutsSetup(project);
    // Progress is written in order, without holding up the checks themselves.
    let written: Promise<void> = Promise.resolve();
    const onEvent = (event: RunEvent) => {
      written = written.then(() => recordDispatchEvent(this.db, dispatchId, event)).catch(() => {});
    };
    let outcome: Awaited<ReturnType<typeof runChecks>>;
    try {
      outcome = await runChecks(stage.checks, {
        project: { ...project, defaultBranch: baseRef(project) },
        ticket,
        worktree,
        sandbox: await this.sandboxFor(project),
        gitleaks: this.config.gitleaks,
        regressionTickets: await this.regressionTickets(project.id),
        signal,
        onEvent,
      });
    } finally {
      await written;
    }
    for (const r of outcome.results) {
      if (r.check === "holdouts" && !r.ok) await recordSignal(this.db, "holdout_failure", ticket.id);
    }
    return {
      verdict: outcome.verdict,
      summary: outcome.report,
      artifact: { name: "gates.md", content: outcome.report },
      feedback: outcome.verdict === "FAIL" ? outcome.builderFeedback || "A gate failed." : undefined,
    };
  }

  private async runPrGate(ticket: Ticket, stage: GateStage, project: Project, worktree: string): Promise<StageOutcome> {
    if (stage.checks.includes("open_pr") && !ticket.prUrl) {
      if (!project.remoteUrl) return { verdict: "BLOCKED", summary: "Project has no remote; cannot open a PR." };
      // Whatever reaches the remote is scanned right before it goes, whichever gates ran earlier.
      const scan = await scanThenPush(worktree, baseRef(project), ticket.branch!, this.config.gitleaks, pushBranch);
      if (!scan.ok) {
        await audit(this.db, { actor: "system", kind: "secret_scan.blocked_push", subject: ticket.id, data: { report: scan.report.slice(0, 2000) } });
        return { verdict: "FAIL", summary: `Not pushed: the secret scan did not pass.\n\n${scan.report}` };
      }
      const arts = new Map((await latestArtifacts(this.db, ticket.id)).map((a) => [a.name, a.content]));
      const changes = await changedFiles(worktree, baseRef(project));
      const areas = [...new Set(changes.map((c) => c.path.split("/").slice(0, 2).join("/")))];
      const pr = await createPullRequest(worktree, {
        base: project.defaultBranch,
        head: ticket.branch!,
        title: `${ticket.title} [${ticket.type}]`,
        body: prBody({
          ticketId: ticket.id,
          title: ticket.title,
          changes: arts.get("changes.md") ?? arts.get("reproduction.md"),
          verification: arts.get("verification.md"),
          review: arts.get("review.md"),
          gates: arts.get("gates.md"),
          filesChanged: changes.length,
          areas,
          issue: ticket.externalRef
            ? issueLine(ticket.externalRef, (await openTicketsByRef(this.db, ticket.externalRef.tracker, ticket.externalRef.key)).filter((t) => t.id !== ticket.id).length)
            : undefined,
        }),
      });
      ticket = await updateTicket(this.db, ticket.id, { prUrl: pr.url });
      await audit(this.db, { actor: "system", kind: "pr.opened", subject: ticket.id, data: { url: pr.url } });
    }
    if (!stage.checks.includes("await_merge")) return { verdict: "PASS", summary: `PR: ${ticket.prUrl}` };

    // Autonomy level 0: the board merges. Find this ticket's latest merge approval.
    const decision = await this.latestApproval(ticket.id, "merge");
    if (!decision || decision.status === "pending") {
      if (!decision) {
        await requestApproval(this.db, {
          kind: "merge",
          ticketId: ticket.id,
          title: `Merge: ${ticket.title}`,
          body: `${ticket.prUrl}\n\nAll gates passed and the reviewer found no blockers. Approve to squash-merge.`,
          options: ["approve", "reject"],
        });
      }
      await updateTicket(this.db, ticket.id, { status: "awaiting_board" });
      return { verdict: "PASS", summary: "waiting for the board to merge", waiting: true };
    }
    if (decision.resolution !== "approve") return { verdict: "FAIL", summary: `Board rejected the merge${decision.note ? `: ${decision.note}` : ""}` };
    // Recoverable: a retry after a partial failure finds the PR merged and only finishes cleanup.
    const state = await prState(ticket.prUrl!);
    if (state.state !== "MERGED") await mergePullRequest(ticket.prUrl!);
    await deleteRemoteBranch(ticket.prUrl!, ticket.branch!);
    await recordSignal(this.db, "clean_merge", ticket.id);
    await audit(this.db, { actor: "system", kind: "pr.merged", subject: ticket.id, data: { url: ticket.prUrl } });
    return { verdict: "PASS", summary: `Merged ${ticket.prUrl}` };
  }

  private async latestApproval(ticketId: string, kind: string): Promise<Approval | undefined> {
    const { approvals } = schema;
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.ticketId, ticketId), eq(approvals.kind, kind)))
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    return row;
  }

  private async recordStageSignals(ticket: Ticket, stage: Stage, verdict: Verdict): Promise<void> {
    if (stage.kind !== "agent" || verdict !== "FAIL") return;
    if (stage.role === "reviewer") await recordSignal(this.db, "review_disagreement", ticket.id, { stage: stage.id });
    if (stage.role === "verifier") await recordSignal(this.db, "holdout_failure", ticket.id, { stage: stage.id });
  }

  // ── routing ─────────────────────────────────────────────────────────────

  private async advance(ticket: Ticket, wf: Workflow, stage: Stage, outcome: StageOutcome): Promise<void> {
    const next = nextStep(wf, stage.id, outcome.verdict, await stageAttempts(this.db, ticket.id));
    if (outcome.feedback && next.kind === "stage") {
      await saveArtifact(this.db, { ticketId: ticket.id, name: FEEDBACK_ARTIFACT, content: outcome.feedback });
    }
    if (next.kind === "done") return this.complete(ticket);
    if (next.kind === "board") {
      const decision = outcome.verdict === "PASS";
      return this.escalate(ticket, stage.id, decision ? `${stage.id} passed and needs your decision.\n\n${outcome.summary}` : `${next.reason}\n\n${outcome.summary}`, decision);
    }
    await updateTicket(this.db, ticket.id, { stage: next.stage.id });
    this.emit("change");
    void this.tick();
  }

  /** The question an agent wants answered: its "Decision needed" line, else the text after its BLOCKED verdict. */
  static decisionAsked(text: string): string | undefined {
    const asked = /^\s*(?:\*\*)?(?:Decision needed|Question|Need(?:s)? (?:a )?(?:human )?decision)[^:\n]*:(?:\*\*)?\s*(.+)$/im.exec(text)?.[1];
    if (asked) return asked.trim();
    const after = /VERDICT:\s*BLOCKED\s*[—:-]?\s*(.+)$/im.exec(text)?.[1];
    return after?.trim() || undefined;
  }

  private async escalate(ticket: Ticket, stageId: string, body: string, decision = false): Promise<void> {
    const asked = Factory.decisionAsked(body);
    if (asked) body = `**Decision needed:** ${asked}\n\n${body}`;
    await updateTicket(this.db, ticket.id, { status: "awaiting_board", stage: stageId });
    await requestApproval(this.db, {
      kind: decision ? "decision" : "escalation",
      ticketId: ticket.id,
      title: `${decision ? "Decide" : "Stuck"}: ${ticket.title} (${stageId})`,
      body: body.slice(0, 8000),
      options: ["accept", "retry", "cancel"],
    });
    this.emit("change");
  }

  private async complete(ticket: Ticket): Promise<void> {
    await updateTicket(this.db, ticket.id, { status: "done" });
    await this.cleanup(ticket);
    this.emit("change");
    void this.digestTicket(ticket.id).catch((err) =>
      audit(this.db, { actor: "system", kind: "digest.failed", subject: ticket.id, data: { error: (err as Error).message } }),
    );
  }

  /**
   * After a ticket finishes, the Chief of Staff reads what the workers reported and curates the
   * shared knowledge: adds durable facts, corrects or archives stale ones. It is the only writer.
   */
  async digestTicket(ticketId: string): Promise<void> {
    const ticket = await getTicket(this.db, ticketId);
    if (!ticket) return;
    const project = await this.project(ticket);
    const agent = await this.agentFor("chief");
    if (!agent.mcpServers.includes("temper") || !this.options.auth) return;
    const adapter = await this.adapterFor(agent).catch(() => undefined);
    if (!adapter) return;
    const environmentId = this.environmentOf(project);
    const dispatch = await createDispatch(this.db, { ticketId, stage: "digest", agentId: agent.id, agentVersion: agent.version });
    const mcp = this.mcpFor(agent, { environmentId, projectId: project.id, dispatchId: dispatch.id });
    try {
      const artifacts = await latestArtifacts(this.db, ticketId);
      const knowledge = await this.knowledgeFor(environmentId, project.id, ticket.fileScope, dispatch.id);
      const result = await adapter.run(
        {
          cwd: project.repoPath,
          prompt: CHIEF_DIGEST_PROMPT(ticket, project.name, artifacts, knowledge),
          model: agent.model,
          allowedTools: agent.permissions.allowedTools,
          disallowedTools: [...agent.permissions.disallowedTools, "Edit", "Write"],
          denyDirs: project.holdoutsPath ? [project.holdoutsPath] : [],
          appendSystemPrompt: agent.instructions || undefined,
          mcpServers: mcp.servers,
          env: AGENT_ENV,
        },
        this.observe(agent.adapter, { dispatchId: dispatch.id }, (e) => void recordDispatchEvent(this.db, dispatch.id, e)),
      );
      await finishDispatch(this.db, dispatch.id, {
        status: result.isError ? "failed" : "succeeded",
        verdict: result.isError ? "FAIL" : "PASS",
        summary: result.finalText.slice(0, 2000),
      });
    } catch (err) {
      await finishDispatch(this.db, dispatch.id, { status: "failed", summary: (err as Error).message.slice(0, 2000) }).catch(() => {});
      throw err;
    } finally {
      mcp.release();
      this.emit("change");
    }
  }

  // ── conversations with the Chief of Staff ───────────────────────────────

  private chatting = new Set<string>();

  /** One turn of a conversation with the Chief: it can search/record knowledge and create tickets. */
  async chat(chatId: string, message: string): Promise<void> {
    const chat = await getChat(this.db, chatId);
    if (!chat) throw new Error(`chat ${chatId} not found`);
    if (this.chatting.has(chatId)) throw new Error("the Chief is still answering the previous message");
    const env = await getEnvironment(this.db, chat.environmentId);
    const agent = await this.agentFor("chief");
    if (!env) throw new Error("no environment for this chat");
    const adapter = await this.adapterFor(agent);
    await addChatMessage(this.db, chatId, "board", message);
    this.chatting.add(chatId);
    this.emit("chat", { chatId, kind: "started" });
    const mcp = this.mcpFor(agent, { environmentId: env.id, chatId });
    const actions: Array<{ tool: string; summary: string }> = [];
    void (async () => {
      try {
        const knowledge = chat.sessionId ? undefined : await this.knowledgeFor(env.id, undefined, []);
        const { dirs } = resolveSkills(this.config.appRoot, agent.skills);
        const result = await adapter.run(
          {
            cwd: env.rootPath,
            prompt: chat.sessionId ? message : CHIEF_CHAT_PROMPT(env.name, env.rootPath, knowledge, message),
            resumeSessionId: chat.sessionId ?? undefined,
            model: agent.model,
            allowedTools: agent.permissions.allowedTools,
            disallowedTools: [...agent.permissions.disallowedTools, "Edit", "Write"],
            denyDirs: (await listProjects(this.db)).flatMap((p) => (p.holdoutsPath ? [p.holdoutsPath] : [])),
            skillDirs: dirs,
            appendSystemPrompt: agent.instructions || undefined,
            mcpServers: mcp.servers,
            env: AGENT_ENV,
          },
          this.observe(agent.adapter, { chatId }, (e) => {
            if (e.kind === "tool_use" && e.tool.startsWith("mcp__temper__")) {
              const input = e.input as Record<string, unknown>;
              actions.push({ tool: e.tool.slice("mcp__temper__".length), summary: String(input.title ?? input.query ?? input.id ?? "").slice(0, 120) });
            }
            this.emit("chat", { chatId, kind: "event", event: e });
          }),
        );
        await addChatMessage(this.db, chatId, "chief", result.finalText || "(no reply)", actions, result.sessionId);
      } catch (err) {
        await addChatMessage(this.db, chatId, "chief", `I hit an error: ${(err as Error).message}`, actions);
      } finally {
        mcp.release();
        this.chatting.delete(chatId);
        this.emit("chat", { chatId, kind: "finished" });
        this.emit("change");
      }
    })();
  }

  isChatting(chatId: string): boolean {
    return this.chatting.has(chatId);
  }

  private async cleanup(ticket: Ticket): Promise<void> {
    if (!ticket.worktreePath) return;
    const project = await this.project(ticket);
    await removeWorktree(project.repoPath, ticket.worktreePath).catch(() => {});
  }

  // ── board actions ───────────────────────────────────────────────────────

  async onApprovalResolved(approval: Approval): Promise<void> {
    if (approval.kind === "proposal") {
      if (approval.resolution === "confirm") await this.executeProposal(approval);
      return;
    }
    if (!approval.ticketId) return;
    const ticket = await getTicket(this.db, approval.ticketId);
    if (!ticket || ticket.status !== "awaiting_board") return;
    const wf = this.workflowFor(ticket);

    if (approval.kind === "merge") {
      await updateTicket(this.db, ticket.id, { status: "in_progress" }, "board");
    } else if (approval.resolution === "retry") {
      await updateTicket(this.db, ticket.id, { status: "in_progress" }, "board");
    } else if (approval.resolution === "cancel") {
      await updateTicket(this.db, ticket.id, { status: "cancelled" }, "board");
      await this.cleanup(ticket);
    } else if (approval.resolution === "accept") {
      // Accept = treat the stage as passed.
      const stage = wf.stages.find((s) => s.id === ticket.stage);
      const target = stage?.on.PASS;
      if (!target || target === "done" || target === "board") await this.complete({ ...ticket, status: "in_progress" });
      else await updateTicket(this.db, ticket.id, { status: "in_progress", stage: target }, "board");
    }
    this.emit("change");
    void this.tick();
  }

  /** Backlog → ready. */
  async startTicket(id: string, actor: Actor = "board"): Promise<Ticket> {
    const t = await getTicket(this.db, id);
    if (!t || t.status !== "backlog") throw new Error("only backlog tickets can be started");
    const updated = await updateTicket(this.db, id, { status: "ready" }, actor);
    void this.tick();
    return updated;
  }

  /** Re-run a stuck ticket's current stage. Operational, not a board decision: nothing is accepted. */
  async retryTicket(id: string, actor: Actor): Promise<void> {
    const pending = (await pendingApprovals(this.db)).find((a) => a.ticketId === id && (a.kind === "escalation" || a.kind === "decision"));
    if (!pending) throw new Error("this ticket is not waiting on a retryable escalation");
    const resolved = await resolveApproval(this.db, pending.id, "retry", `retried by ${actor}`, actor);
    await this.onApprovalResolved(resolved);
  }

  /**
   * Runs what a proposal describes once the board confirmed it. Proposals are how the Chief of
   * Staff asks for board decisions; it can never resolve them itself.
   */
  private async executeProposal(proposal: Approval): Promise<void> {
    const p = proposal.payload ?? {};
    const note = `confirmed proposal ${proposal.id}${proposal.chatId ? ` from chat ${proposal.chatId}` : ""}`;
    if (p.action === "resolve_approval") {
      const target = await getApproval(this.db, String(p.approvalId));
      if (!target || target.status !== "pending") throw new Error("the proposed approval is no longer pending");
      const resolved = await resolveApproval(this.db, target.id, String(p.resolution), note, "board");
      await this.onApprovalResolved(resolved);
    } else if (p.action === "deploy") {
      const cli = join(this.config.appRoot, "apps", "server", "src", "cli.ts");
      const child = spawn(process.execPath, [cli, "deploy", "--ref", String(p.ref ?? "main"), "--source", String(p.source)], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, TEMPER_HOME: this.config.home },
      });
      child.unref();
      await audit(this.db, { actor: "board", kind: "deploy.requested", data: { ref: p.ref, source: p.source, note } });
    } else {
      throw new Error(`unknown proposal action ${String(p.action)}`);
    }
  }

  async cancelTicket(id: string, actor: Actor = "board"): Promise<void> {
    const t = await getTicket(this.db, id);
    if (!t) throw new Error(`ticket ${id} not found`);
    await updateTicket(this.db, id, { status: "cancelled" }, actor);
    for (const a of this.active.values()) if (a.ticketId === id) a.controller.abort();
    await this.cleanup(t);
    this.emit("change");
  }

  /** Board reports a bug that escaped verification on a done ticket. */
  async reportEscape(ticketId: string, description: string): Promise<Ticket> {
    const t = await getTicket(this.db, ticketId);
    if (!t) throw new Error(`ticket ${ticketId} not found`);
    await recordSignal(this.db, "escaped_bug", ticketId, { description });
    return createTicket(this.db, {
      projectId: t.projectId,
      type: "bugfix",
      title: `Escaped from ${t.title}`,
      spec: description,
      acceptanceCriteria: [{ id: "AC-1", text: "The reported behaviour no longer occurs." }],
      fileScope: t.fileScope,
      status: "ready",
    });
  }

  // ── planning ────────────────────────────────────────────────────────────

  /** Imports a spec: the Planner splits it into tickets. */
  async importSpec(projectId: string, title: string, markdown: string, autoStart = false): Promise<Ticket[]> {
    const project = await getProject(this.db, projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    const agent = await this.agentFor("chief");
    const mcp = this.mcpFor(agent, { environmentId: this.environmentOf(project) });
    const adapter = await this.adapterFor(agent);
    await audit(this.db, { actor: "board", kind: "spec.imported", subject: projectId, data: { title } });
    const { dirs } = resolveSkills(this.config.appRoot, agent.skills);
    const result = await adapter.run(
      {
        cwd: project.repoPath,
        prompt: CHIEF_INTAKE_PROMPT(title, markdown),
        model: agent.model,
        allowedTools: agent.permissions.allowedTools,
        disallowedTools: [...agent.permissions.disallowedTools, "Edit", "Write"],
        denyDirs: project.holdoutsPath ? [project.holdoutsPath] : [],
        skillDirs: dirs,
        appendSystemPrompt: agent.instructions || undefined,
        mcpServers: mcp.servers,
        env: AGENT_ENV,
      },
      this.observe(agent.adapter, {}),
    ).finally(() => mcp.release());
    if (result.isError) throw new Error(`the Chief of Staff failed: ${result.finalText.slice(0, 500)}`);
    const planned = parsePlan(result.finalText);
    const ids = new Map<string, string>();
    const created: Ticket[] = [];
    for (const p of planned) {
      const t = await createTicket(
        this.db,
        {
          projectId,
          type: p.type,
          title: p.title,
          spec: `${p.spec}\n\nFrom spec: ${title}`,
          acceptanceCriteria: p.acceptanceCriteria.map((text, i) => ({ id: `AC-${i + 1}`, text })),
          fileScope: p.fileScope,
          dependsOn: p.dependsOn.map((k) => ids.get(k)!).filter(Boolean),
          status: autoStart ? "ready" : "backlog",
        },
        "agent:chief",
      );
      ids.set(p.key, t.id);
      created.push(t);
    }
    await saveArtifact(this.db, { ticketId: created[0]!.id, name: "spec.md", content: `# ${title}\n\n${markdown}` });
    this.emit("change");
    if (autoStart) void this.tick();
    return created;
  }

  async ticketDetail(id: string) {
    const ticket = await getTicket(this.db, id);
    if (!ticket) return undefined;
    return {
      ticket,
      dispatches: await ticketDispatches(this.db, id),
      artifacts: await latestArtifacts(this.db, id),
    };
  }
}
