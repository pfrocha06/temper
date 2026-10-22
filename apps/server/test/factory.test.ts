import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import {
  createProject,
  createTicket,
  getTicket,
  latestArtifacts,
  loadWorkflows,
  openDb,
  pendingApprovals,
  recentAudit,
  seedAgents,
  ticketDispatches,
  type Db,
} from "@temper/core";
import { loadConfig } from "../src/config.ts";
import { Factory } from "../src/factory.ts";

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
  const config = { ...loadConfig({ TEMPER_HOME: home }), appRoot: root, heartbeatMs: 60_000 };
  factory = new Factory(db, config, new Map([["claude-cli", createClaudeCliAdapter({ bin: fakeClaude })]]), loadWorkflows(join(root, "workflows")));
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
      setupCommand: "true",
      testCommand: "test -f hello.txt",
      holdoutsCommand: "sh check.sh",
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
