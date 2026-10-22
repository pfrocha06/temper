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
  type Agent,
  type AgentAdapter,
  type Approval,
  type Db,
  type Project,
  type Role,
  type Stage,
  type Ticket,
  type TicketType,
  type Verdict,
  type Workflow,
} from "@temper/core";
import { createPullRequest, deleteRemoteBranch, mergePullRequest, prBody, prState } from "@temper/plugin-github";
import { bootApp } from "./app-runner.ts";
import type { Config } from "./config.ts";
import { diffGuard } from "./gates/diff-guard.ts";
import { builderFeedback as holdoutFeedback, parseHoldoutResults } from "./gates/holdout-results.ts";
import { runShell } from "./exec.ts";
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
import { buildPrompt, FEEDBACK_ARTIFACT, PLANNER_PROMPT } from "./prompt.ts";
import { resolveSkills } from "./skills.ts";

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

  constructor(db: Db, config: Config, adapters: Map<string, AgentAdapter>, workflows: Map<TicketType, Workflow>) {
    super();
    this.db = db;
    this.config = config;
    this.adapters = adapters;
    this.workflows = workflows;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.recoverOrphans();
    await refreshTemperature(this.db);
    this.timer = setInterval(() => void this.tick(), this.config.heartbeatMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const a of this.active.values()) a.controller.abort();
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await audit(this.db, { actor: "board", kind: paused ? "factory.paused" : "factory.resumed" });
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
    if ((this.pausedAdapters.get(agent.adapter) ?? 0) > Date.now()) return false;
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
    const adapter = this.adapters.get(agent.adapter);
    if (!adapter) throw new Error(`adapter '${agent.adapter}' is not installed`);
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
      if (project.appCommand) app = await bootApp(project.appCommand, worktree, project.appHealthPath).catch(() => undefined);
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

    const prompt = buildPrompt({
      ticket,
      stage,
      artifacts,
      feedback,
      appUrl: app?.url,
      holdoutsPath: project.holdoutsPath,
      worktreePath: worktree,
      context,
    });
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
          skillDirs,
          appendSystemPrompt: agent.instructions || undefined,
          env:
            stage.role === "verifier"
              ? {
                  ...AGENT_ENV,
                  TEMPER_APP_URL: app?.url ?? "",
                  TEMPER_CANDIDATE_PATH: worktree,
                  TEMPER_TICKET_ID: ticket.id,
                  TEMPER_REGRESSION_TICKETS: (await this.regressionTickets(ticket.projectId)).join(","),
                }
              : AGENT_ENV,
          signal,
        },
        (e) => void recordDispatchEvent(this.db, dispatchId, e),
      );
      if (result.rateLimited) {
        this.pausedAdapters.set(agent.adapter, Date.now() + RATE_LIMIT_PAUSE_MS);
        await audit(this.db, { actor: "system", kind: "adapter.rate_limited", subject: agent.adapter });
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
    const outcome = await runChecks(stage.checks, {
      project: { ...project, defaultBranch: baseRef(project) },
      ticket,
      worktree,
      regressionTickets: await this.regressionTickets(project.id),
      signal,
    });
    for (const r of outcome.results) {
      await recordDispatchEvent(this.db, dispatchId, { kind: "text", text: `${r.check}: ${r.ok ? "PASS" : "FAIL"}` });
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
      await pushBranch(worktree, ticket.branch!);
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

  private async escalate(ticket: Ticket, stageId: string, body: string, decision = false): Promise<void> {
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
  }

  private async cleanup(ticket: Ticket): Promise<void> {
    if (!ticket.worktreePath) return;
    const project = await this.project(ticket);
    await removeWorktree(project.repoPath, ticket.worktreePath).catch(() => {});
  }

  // ── board actions ───────────────────────────────────────────────────────

  async onApprovalResolved(approval: Approval): Promise<void> {
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

  async cancelTicket(id: string): Promise<void> {
    const t = await getTicket(this.db, id);
    if (!t) throw new Error(`ticket ${id} not found`);
    await updateTicket(this.db, id, { status: "cancelled" }, "board");
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
    const agent = await this.agentFor("planner");
    const adapter = this.adapters.get(agent.adapter);
    if (!adapter) throw new Error(`adapter '${agent.adapter}' is not installed`);
    await audit(this.db, { actor: "board", kind: "spec.imported", subject: projectId, data: { title } });
    const { dirs } = resolveSkills(this.config.appRoot, agent.skills);
    const result = await adapter.run(
      {
        cwd: project.repoPath,
        prompt: PLANNER_PROMPT(title, markdown),
        model: agent.model,
        allowedTools: agent.permissions.allowedTools,
        disallowedTools: [...agent.permissions.disallowedTools, "Edit", "Write"],
        denyDirs: project.holdoutsPath ? [project.holdoutsPath] : [],
        skillDirs: dirs,
      },
      () => {},
    );
    if (result.isError) throw new Error(`planner failed: ${result.finalText.slice(0, 500)}`);
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
        "agent:planner",
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
