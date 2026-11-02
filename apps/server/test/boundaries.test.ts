// SEC-04 (#39): the execution boundaries as a whole. Every path that runs code Temper does not
// control is listed in docs/security/execution-boundaries.md with its sandbox policy and its
// tests; these tests guard the parts no single policy test covers.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createTicket, getTicket, loadWorkflows, openDb, recentAudit, seedAgents, type Db } from "@temper/core";
import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import { loadConfig } from "../src/config.ts";
import { Factory } from "../src/factory.ts";

const root = join(import.meta.dirname, "../../..");

describe("a sandbox that fails its probe", () => {
  let db: Db;
  let close: () => Promise<void>;
  let factory: Factory;
  beforeEach(async () => {
    ({ db, close } = await openDb());
    await seedAgents(db);
    const home = mkdtempSync(join(tmpdir(), "temper-home-"));
    const config = { ...loadConfig({ TEMPER_HOME: home, TEMPER_WORKTREES: join(home, "worktrees") }), appRoot: root, heartbeatMs: 60_000, gateSandbox: "srt" as const };
    factory = new Factory(db, config, new Map([["claude-cli", createClaudeCliAdapter({ bin: process.execPath, binArgs: ["-e", ""] })]]), loadWorkflows(join(root, "workflows")), {
      probeGate: async () => ({ isolated: false, problems: ["read a canary in /secrets"], output: "" }),
    });
  });
  afterEach(async () => {
    await factory.stop();
    await close();
  });

  it("runs nothing on the host, stops the ticket at the board and records why", async () => {
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
    // A setup command that leaves a mark if it ever runs.
    const project = await createProject(db, { name: "p", repoPath: repo, setupCommand: `node -e "require('fs').writeFileSync('setup-ran', '1')"`, testCommand: "node --version" });
    const ticket = await createTicket(db, { projectId: project.id, type: "chore", title: "t", acceptanceCriteria: [{ id: "AC-1", text: "x" }], status: "ready" });
    await factory.start();
    let t = await getTicket(db, ticket.id);
    for (let i = 0; i < 100 && t?.status !== "awaiting_board"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      t = await getTicket(db, ticket.id);
    }
    expect(t?.status).toBe("awaiting_board");
    expect(existsSync(join(t!.worktreePath!, "setup-ran"))).toBe(false);
    const audit = await recentAudit(db, 50);
    expect(audit.find((e) => e.kind === "gate_sandbox.failed")?.data).toEqual({ problems: ["read a canary in /secrets"] });
  });
});

/**
 * Where the server starts processes, and why each may. A new call site fails this test until it
 * is added here and to docs/security/execution-boundaries.md: code Temper does not control must go
 * through `runSandboxed`/`sandboxed`, never `runShell` or a bare spawn.
 */
const SPAWN_SITES: Record<string, number> = {
  // Temper's own commands with fixed arguments (git, gh, gitleaks), via run(); the shell-less runner.
  "apps/server/src/exec.ts": 4,
  // The candidate app, wrapped by sandboxed() first.
  "apps/server/src/app-runner.ts": 2,
  // Inside the sandbox: the launcher that starts the sandboxed command.
  "apps/server/src/sandbox.ts": 1,
  // `temper codex login`, run by the user.
  "apps/server/src/cli.ts": 1,
  // A board-approved deploy of Temper itself.
  "apps/server/src/factory.ts": 1,
  "apps/server/src/service.ts": 1,
  "apps/server/src/releases.ts": 1,
  // `git rev-parse` for /api/health.
  "apps/server/src/health.ts": 1,
  // The probe script's own child, inside the sandbox.
  "apps/server/src/probe.ts": 1,
  // The agent CLIs, with an allowlisted environment (agentEnv) and their own sandbox.
  "packages/adapters/claude-cli/src/index.ts": 1,
  "packages/adapters/codex-cli/src/index.ts": 1,
};

const SPAWN = /\b(runShell|spawn|spawnSync|execFile|execFileSync|execSync|fork)\(/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" || e.name === "test" ? [] : sources(join(dir, e.name))) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

describe("process call sites", () => {
  it("are all accounted for", () => {
    const found: Record<string, number> = {};
    for (const dir of ["apps/server/src", "packages/adapters"]) {
      for (const file of sources(join(root, dir))) {
        const code = readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
        const n = code.join("\n").match(SPAWN)?.length ?? 0;
        if (n) found[relative(root, file).replaceAll("\\", "/")] = n;
      }
    }
    expect(found).toEqual(SPAWN_SITES);
  });

  it("never run a project's command with runShell", () => {
    const users = sources(join(root, "apps/server/src"))
      .filter((f) => /\brunShell\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f).replaceAll("\\", "/"));
    // releases.ts builds Temper itself (a board-approved deploy); exec.ts defines it.
    expect(users.sort()).toEqual(["apps/server/src/exec.ts", "apps/server/src/releases.ts"]);
  });
});

