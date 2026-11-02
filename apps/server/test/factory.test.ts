import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import {
  createProject,
  createTicket,
  dispatchEventsAfter,
  getTicket,
  latestArtifacts,
  loadWorkflows,
  openDb,
  pendingApprovals,
  recentAudit,
  resolveApproval,
  seedAgents,
  ticketDispatches,
  type Db,
} from "@temper/core";
import { loadConfig } from "../src/config.ts";
import type { CheckRun, PrStatus } from "@temper/plugin-github";
import { Factory, type GithubOps } from "../src/factory.ts";

const root = join(import.meta.dirname, "../../..");
const fakeClaude = join(import.meta.dirname, "fixtures/fake-claude.mjs");

function gitRepo(dir: string) {
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "test");
  writeFileSync(join(dir, "README.md"), "x\n");
  g("add", "-A");
  g("commit", "-q", "-m", "init");
}

async function until<T>(fn: () => Promise<T | undefined>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

let db: Db;
let close: () => Promise<void>;
let factory: Factory;

beforeEach(async () => {
  ({ db, close } = await openDb());
  await seedAgents(db);
  const home = mkdtempSync(join(tmpdir(), "temper-home-"));
  // The fake CLI and test commands are trusted here; sandboxing itself is covered in sandbox.test.ts.
  const config = { ...loadConfig({ TEMPER_HOME: home, TEMPER_WORKTREES: join(home, "worktrees"), TEMPER_GATE_SANDBOX: "off" }), appRoot: root, heartbeatMs: 60_000, gitleaks: [process.execPath, join(import.meta.dirname, "fixtures", "fake-gitleaks.mjs"), "clean"] };
  factory = new Factory(db, config, new Map([["claude-cli", createClaudeCliAdapter({ bin: process.execPath, binArgs: [fakeClaude] })]]), loadWorkflows(join(root, "workflows")));
});
afterEach(async () => {
  await factory.stop();
  await close();
});

describe("feature ticket end to end", () => {
  it("loops on a failed gate with feedback, verifies with holdouts, and stops at the board without a remote", async () => {
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    const holdouts = mkdtempSync(join(tmpdir(), "holdouts-"));
    gitRepo(repo);
    gitRepo(holdouts);
    const project = await createProject(db, {
      name: "demo",
      repoPath: repo,
      holdoutsPath: holdouts,
      // Node one-liners rather than sh, so the test runs on every platform.
      setupCommand: "node --version",
      testCommand: `node -e "process.exit(require('fs').existsSync('hello.txt') ? 0 : 1)"`,
      holdoutsCommand: "node check.mjs",
    });
    const ticket = await createTicket(db, {
      projectId: project.id,
      type: "feature",
      title: "Say hello",
      acceptanceCriteria: [{ id: "AC-1", text: "hello.txt exists" }],
      status: "ready",
    });

    await factory.start();
    const done = await until(async () => {
      await factory.tick();
      const t = await getTicket(db, ticket.id);
      return t?.status === "awaiting_board" ? t : undefined;
    });

    expect(done.stage).toBe("pr");
    const stages = (await ticketDispatches(db, ticket.id)).map((d) => `${d.stage}:${d.verdict}`);
    expect(stages).toEqual(["build:PASS", "verify:PASS", "gates:FAIL", "build:PASS", "verify:PASS", "gates:PASS", "review:PASS", "pr:BLOCKED"]);

    const names = (await latestArtifacts(db, ticket.id)).map((a) => a.name).sort();
    expect(names).toEqual(expect.arrayContaining(["changes.md", "feedback.md", "gates.md", "review.md", "verification.md"]));
    expect((await pendingApprovals(db)).map((a) => a.kind)).toEqual(["escalation"]);
    expect((await recentAudit(db, 500)).filter((e) => e.kind === "worktree.setup")).toHaveLength(1);
  }, 60_000);
});

describe("proposals", () => {
  it("execute only after the board confirms", async () => {
    const { requestApproval, resolveApproval, getApproval } = await import("@temper/core");
    const target = await requestApproval(db, { kind: "decision", title: "Decide", options: ["accept", "retry", "cancel"] });
    const proposal = await requestApproval(db, {
      kind: "proposal",
      title: "Chief proposes: accept",
      options: ["confirm", "decline"],
      payload: { action: "resolve_approval", approvalId: target.id, resolution: "accept" },
    });
    await factory.onApprovalResolved(await resolveApproval(db, proposal.id, "decline"));
    expect((await getApproval(db, target.id))!.status).toBe("pending");

    const again = await requestApproval(db, { kind: "proposal", title: "Chief proposes: accept", options: ["confirm", "decline"], payload: proposal.payload! });
    await factory.onApprovalResolved(await resolveApproval(db, again.id, "confirm"));
    expect((await getApproval(db, target.id))!).toMatchObject({ status: "resolved", resolution: "accept" });
  });
});

// Merge readiness (#5, AC-1): the board is asked to merge only once GitHub's required checks pass
// on the exact commit Temper pushed; a failed check goes back to the Builder with the job's log.
describe("pr gate and CI", () => {
  type Ci = { mergeState: string; checks: CheckRun[] };
  const job = (name: string, bucket: CheckRun["bucket"]): CheckRun => ({ name, bucket, state: bucket.toUpperCase(), link: "https://github.com/acme/shop/actions/runs/7/job/9" });

  /** A repo with a bare origin, a fake GitHub serving one PR over it, and CI decided per head commit. */
  async function setup(ciFor: (head: string, firstHead: string) => Ci, opts: { headOnGitHub?: (pushed: string) => string } = {}) {
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    const origin = mkdtempSync(join(tmpdir(), "origin-"));
    gitRepo(repo);
    execFileSync("git", ["init", "-q", "--bare", origin]);
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: repo });
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: repo, stdio: "ignore" });
    const remoteHead = () => execFileSync("git", ["for-each-ref", "--format=%(objectname)", "refs/heads/temper/"], { cwd: origin, encoding: "utf8" }).trim();
    const gh = { created: 0, merged: [] as string[], firstHead: "" };
    const github: GithubOps = {
      createPullRequest: async () => {
        gh.created++;
        gh.firstHead ||= remoteHead();
        return { url: "https://github.com/acme/shop/pull/1", number: 1, state: "OPEN" };
      },
      prStatus: async (): Promise<PrStatus> => {
        const head = gh.created && opts.headOnGitHub ? opts.headOnGitHub(remoteHead()) : remoteHead();
        return { state: gh.merged.includes(head) ? "MERGED" : "OPEN", head, ...ciFor(head, gh.firstHead) };
      },
      mergePullRequest: async (_url, head) => {
        gh.merged.push(head);
      },
      deleteRemoteBranch: async () => {},
      failedJobLog: async () => "FAIL test/api.test.ts > expected 200, got 500",
    };
    const home = mkdtempSync(join(tmpdir(), "temper-home-"));
    const config = {
      ...loadConfig({ TEMPER_HOME: home, TEMPER_WORKTREES: join(home, "worktrees"), TEMPER_GATE_SANDBOX: "off" }),
      appRoot: root,
      heartbeatMs: 60_000,
      ciPollMs: 50,
      gitleaks: [process.execPath, join(import.meta.dirname, "fixtures", "fake-gitleaks.mjs"), "clean"],
    };
    factory = new Factory(db, config, new Map([["claude-cli", createClaudeCliAdapter({ bin: process.execPath, binArgs: [fakeClaude] })]]), loadWorkflows(join(root, "workflows")), { github });
    const project = await createProject(db, { name: "shop", repoPath: repo, remoteUrl: origin, setupCommand: "node --version", testCommand: "node --version" });
    const ticket = await createTicket(db, { projectId: project.id, type: "chore", title: "Say hello", acceptanceCriteria: [{ id: "AC-1", text: "hello.txt exists" }], status: "ready" });
    await factory.start();
    const status = (want: string) =>
      until(async () => {
        await factory.tick();
        const t = await getTicket(db, ticket.id);
        return t?.status === want ? t : undefined;
      }, 40_000);
    return { ticket, gh, remoteHead, status };
  }

  it("asks the board to merge only after the required checks pass, then merges that commit", async () => {
    let ci: Ci = { mergeState: "BLOCKED", checks: [job("test", "pass"), job("e2e", "pending")] };
    const { ticket, gh, remoteHead, status } = await setup(() => ci);

    const waiting = await until(async () => {
      await factory.tick();
      const pr = (await ticketDispatches(db, ticket.id)).find((d) => d.stage === "pr");
      const events = pr ? await dispatchEventsAfter(db, pr.id) : [];
      return events.find((e) => JSON.stringify(e).includes("waiting for e2e")) ? pr : undefined;
    }, 40_000);
    expect(waiting).toBeDefined();
    expect((await getTicket(db, ticket.id))?.status).toBe("in_progress");
    expect((await pendingApprovals(db)).filter((a) => a.kind === "merge")).toEqual([]);

    ci = { mergeState: "CLEAN", checks: [job("test", "pass"), job("e2e", "pass")] };
    await status("awaiting_board");
    const [approval] = (await pendingApprovals(db)).filter((a) => a.kind === "merge");
    expect(approval?.payload).toEqual({ head: remoteHead() });

    await factory.onApprovalResolved(await resolveApproval(db, approval!.id, "approve"));
    await status("done");
    expect(gh.merged).toEqual([remoteHead()]);
    expect((await recentAudit(db, 500)).map((e) => e.kind)).toContain("pr.merged");
  }, 60_000);

  it("sends a failed required check back to the Builder with the job's log, and pushes the fix to the same PR", async () => {
    const { ticket, gh, remoteHead, status } = await setup((head, first) =>
      head === first ? { mergeState: "BLOCKED", checks: [job("test", "fail"), job("e2e", "pending")] } : { mergeState: "CLEAN", checks: [job("test", "pass"), job("e2e", "pass")] },
    );

    await status("awaiting_board");
    const stages = (await ticketDispatches(db, ticket.id)).map((d) => `${d.stage}:${d.verdict}`);
    expect(stages.slice(stages.indexOf("pr:FAIL"))).toEqual(["pr:FAIL", "build:PASS", "gates:PASS", "review:PASS", "pr:null"]);
    const feedback = (await latestArtifacts(db, ticket.id)).find((a) => a.name === "feedback.md")?.content;
    expect(feedback).toContain("expected 200, got 500");
    expect(feedback).toContain("https://github.com/acme/shop/actions/runs/7/job/9");

    expect(gh.created).toBe(1);
    expect(remoteHead()).not.toBe(gh.firstHead);
    const [approval] = (await pendingApprovals(db)).filter((a) => a.kind === "merge");
    expect(approval?.payload).toEqual({ head: remoteHead() });
    const kinds = (await recentAudit(db, 500)).map((e) => e.kind);
    expect(kinds).toContain("pr.checks_failed");
    expect(kinds).toContain("pr.updated");
  }, 60_000);

  it("hands the board what waiting cannot fix: a PR whose head moved on GitHub", async () => {
    // Someone pushes to the PR branch on GitHub: its head is no longer what Temper checked.
    const { ticket, gh } = await setup(() => ({ mergeState: "CLEAN", checks: [job("test", "pass")] }), { headOnGitHub: () => "f".repeat(40) });

    const t = await until(async () => {
      await factory.tick();
      const t = await getTicket(db, ticket.id);
      return t?.status === "awaiting_board" ? t : undefined;
    }, 40_000);
    expect(t.stage).toBe("pr");
    expect((await pendingApprovals(db)).map((a) => a.kind)).toEqual(["escalation"]);
    const pr = (await ticketDispatches(db, ticket.id)).filter((d) => d.stage === "pr").at(-1);
    expect(pr?.verdict).toBe("BLOCKED");
    expect(pr?.summary).toMatch(/ffffff.*not/);
    expect(gh.merged).toEqual([]);
  }, 60_000);
});
