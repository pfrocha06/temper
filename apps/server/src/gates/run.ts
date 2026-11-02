import { createHash } from "node:crypto";
import type { GateCheck, Project, RunEvent, Ticket, Verdict } from "@temper/core";
import { bootApp } from "../app-runner.ts";
import { runSandboxed, runShell } from "../exec.ts";
import type { Sandbox } from "../sandbox.ts";
import { changedFiles, commitsAhead, diff, hasUncommittedChanges, headSha } from "../git.ts";
import { diffGuard, isTestFile } from "./diff-guard.ts";
import { builderFeedback, parseHoldoutResults } from "./holdout-results.ts";
import { throttleOutput } from "./progress.ts";
import { scanCommits } from "./secret-scan.ts";

export type CheckResult = { check: GateCheck; ok: boolean; report: string; builderFeedback?: string };

export type GateContext = {
  project: Project;
  ticket: Ticket;
  worktree: string;
  /** Confines the Builder's code (the test command, the candidate app). */
  sandbox: Sandbox;
  /** The gitleaks command (file and leading args); `["gitleaks"]` by default. */
  gitleaks?: string[];
  /** Merged tickets whose holdouts run as regression checks. */
  regressionTickets?: string[];
  signal?: AbortSignal;
  /** Progress as run events: each check as a step, its streamed output, its outcome, then the result. */
  onEvent?: (event: RunEvent) => void;
  /** Streamed output of the command a check runs; set per check by `runChecks`. */
  onOutput?: (chunk: string) => void;
  /** How often streamed output is reported (ms). */
  outputIntervalMs?: number;
};

const fence = (s: string) => "```\n" + s.trim().slice(-4000) + "\n```";

export async function builderTests(ctx: GateContext): Promise<CheckResult> {
  if (await hasUncommittedChanges(ctx.worktree)) {
    return { check: "builder_tests", ok: false, report: "Uncommitted changes in the worktree.", builderFeedback: "Commit all your work before finishing." };
  }
  if ((await commitsAhead(ctx.worktree, ctx.project.defaultBranch)) === 0) {
    return { check: "builder_tests", ok: false, report: "No commits on the ticket branch.", builderFeedback: "No commits were made." };
  }
  // The tests are the Builder's code and their output goes back to the Builder: run them where
  // they cannot read holdouts or secrets.
  const r = await runSandboxed(ctx.project.testCommand, ctx.sandbox, { cwd: ctx.worktree, signal: ctx.signal, timeoutMs: 20 * 60_000, onOutput: ctx.onOutput });
  const sha = await headSha(ctx.worktree);
  const outHash = createHash("sha256").update(r.stdout + r.stderr).digest("hex").slice(0, 12);
  const ok = r.code === 0;
  const report = `\`${ctx.project.testCommand}\` at ${sha.slice(0, 10)} exited ${r.code}${r.timedOut ? " (timed out)" : ""}; output sha256:${outHash}\n${fence(r.stdout + r.stderr)}`;
  return { check: "builder_tests", ok, report, builderFeedback: ok ? undefined : `Tests failed:\n${fence(r.stdout + r.stderr)}` };
}

export async function diffGuardCheck(ctx: GateContext): Promise<CheckResult> {
  const changes = await changedFiles(ctx.worktree, ctx.project.defaultBranch);
  const existing = changes.filter((c) => isTestFile(c.path) && c.status !== "A").map((c) => c.path);
  const existingTestDiff = existing.length ? await diff(ctx.worktree, ctx.project.defaultBranch, existing) : "";
  const r = diffGuard({ ticketType: ctx.ticket.type, fileScope: ctx.ticket.fileScope, changes, existingTestDiff });
  const report = r.ok ? `${changes.length} files changed, all allowed.` : r.problems.map((p) => `- ${p}`).join("\n");
  return { check: "diff_guard", ok: r.ok, report, builderFeedback: r.ok ? undefined : report };
}

export async function secretScan(ctx: GateContext): Promise<CheckResult> {
  const r = await scanCommits(ctx.worktree, ctx.project.defaultBranch, ctx.gitleaks ?? ["gitleaks"]);
  // Only findings are the Builder's to fix; a missing or failing scanner is the board's.
  const found = !r.ok && r.report.startsWith("gitleaks found");
  return {
    check: "secret_scan",
    ok: r.ok,
    report: r.report,
    builderFeedback: found ? `Secrets detected in your commits. Remove them and rewrite the commits.\n${r.report}` : undefined,
  };
}

export async function holdouts(ctx: GateContext): Promise<CheckResult> {
  const { project } = ctx;
  if (!project.holdoutsPath || !project.holdoutsCommand) {
    return { check: "holdouts", ok: false, report: "Holdouts are not configured for this project (holdoutsPath and holdoutsCommand)." };
  }
  let app: Awaited<ReturnType<typeof bootApp>> | undefined;
  try {
    if (project.appCommand) app = await bootApp(project.appCommand, ctx.worktree, project.appHealthPath, ctx.sandbox);
    const r = await runShell(project.holdoutsCommand, {
      cwd: project.holdoutsPath,
      env: { ...process.env, TEMPER_APP_URL: app?.url ?? "", TEMPER_APP_TOKEN: app?.token ?? "", TEMPER_CANDIDATE_PATH: ctx.worktree, TEMPER_TICKET_ID: ctx.ticket.id, TEMPER_REGRESSION_TICKETS: (ctx.regressionTickets ?? []).join(",") },
      signal: ctx.signal,
      timeoutMs: 20 * 60_000,
      onOutput: ctx.onOutput,
    });
    const results = parseHoldoutResults(r.stdout + "\n" + r.stderr);
    const expected = ctx.ticket.acceptanceCriteria.map((c) => c.id);
    const missing = expected.filter((id) => !results.some((x) => x.id === id));
    const failing = results.filter((x) => x.status === "FAIL");
    const ok = r.code === 0 && failing.length === 0 && missing.length === 0;
    const lines = results.map((x) => `- ${x.id}: ${x.status}${x.message ? ` — ${x.message}` : ""}`);
    if (missing.length) lines.push(`- no holdout result for: ${missing.join(", ")}`);
    return {
      check: "holdouts",
      ok,
      report: `Holdouts exited ${r.code}.\n${lines.join("\n")}`,
      builderFeedback: ok ? undefined : builderFeedback(results, project.holdoutsPath),
    };
  } catch (err) {
    return { check: "holdouts", ok: false, report: `Could not run holdouts: ${(err as Error).message}`, builderFeedback: "The app failed to start for verification. Make sure it boots." };
  } finally {
    app?.stop();
  }
}

export const CHECKS: Partial<Record<GateCheck, (ctx: GateContext) => Promise<CheckResult>>> = {
  builder_tests: builderTests,
  diff_guard: diffGuardCheck,
  secret_scan: secretScan,
  holdouts,
};

export type GateOutcome = { verdict: Verdict; report: string; builderFeedback: string; results: CheckResult[] };

/** Checks that run a project command (the others are built-in). */
const SHELL_CHECKS = new Set<GateCheck>(["builder_tests", "holdouts"]);

/** What a check runs, shown when it starts. */
export function checkCommand(check: GateCheck, project: Project): string {
  switch (check) {
    case "builder_tests":
      return project.testCommand;
    case "holdouts":
      return project.holdoutsCommand ?? "holdouts";
    case "diff_guard":
      return "diff guard: file scope and test changes";
    case "secret_scan":
      return "secret scan of the ticket's commits";
    default:
      return check;
  }
}

/** The first line of a check's report, for the one-line outcome. */
function outcomeLine(r: CheckResult, ms: number): string {
  const first = r.report.split("\n").find((l) => l.trim() && !l.startsWith("```")) ?? "";
  const line = `${r.ok ? "PASS" : "FAIL"} in ${formatMs(ms)}${first ? ` — ${first.trim()}` : ""}`;
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Runs checks in order, stopping at the first failure. */
export async function runChecks(checks: GateCheck[], ctx: GateContext): Promise<GateOutcome> {
  const results: CheckResult[] = [];
  const emit = ctx.onEvent ?? (() => {});
  const startedAll = Date.now();
  for (const c of checks) {
    const fn = CHECKS[c];
    if (!fn) throw new Error(`check '${c}' is not a local check`);
    const what = checkCommand(c, ctx.project);
    emit({ kind: "tool_use", tool: `gate:${c}`, input: SHELL_CHECKS.has(c) ? { command: what } : { description: what } });
    const output = throttleOutput({ emit: (text) => emit({ kind: "text", text }), intervalMs: ctx.outputIntervalMs });
    const started = Date.now();
    let r: CheckResult;
    try {
      r = await fn({ ...ctx, onOutput: (chunk) => output.push(chunk) });
    } catch (err) {
      output.close();
      emit({ kind: "tool_result", isError: true, content: `crashed: ${(err as Error).message}`.slice(0, 300) });
      throw err;
    }
    output.close();
    emit({ kind: "tool_result", isError: !r.ok, content: outcomeLine(r, Date.now() - started) });
    results.push(r);
    if (!r.ok) break;
  }
  const verdict: Verdict = results.every((r) => r.ok) ? "PASS" : "FAIL";
  const report = results.map((r) => `## ${r.check}: ${r.ok ? "PASS" : "FAIL"}\n${r.report}`).join("\n\n");
  emit({ kind: "result", text: report, isError: verdict !== "PASS", durationMs: Date.now() - startedAll });
  const builderFeedbackText = results
    .filter((r) => !r.ok && r.builderFeedback)
    .map((r) => `${r.check}: ${r.builderFeedback}`)
    .join("\n\n");
  return { verdict, report, builderFeedback: builderFeedbackText, results };
}
