import { createHash } from "node:crypto";
import type { GateCheck, Project, Ticket, Verdict } from "@temper/core";
import { bootApp } from "../app-runner.ts";
import { run, runShell } from "../exec.ts";
import { changedFiles, commitsAhead, diff, hasUncommittedChanges, headSha } from "../git.ts";
import { diffGuard, isTestFile } from "./diff-guard.ts";
import { builderFeedback, parseHoldoutResults } from "./holdout-results.ts";
import { scanAddedLines } from "./secret-scan.ts";

export type CheckResult = { check: GateCheck; ok: boolean; report: string; builderFeedback?: string };

export type GateContext = { project: Project; ticket: Ticket; worktree: string; signal?: AbortSignal };

const fence = (s: string) => "```\n" + s.trim().slice(-4000) + "\n```";

export async function builderTests(ctx: GateContext): Promise<CheckResult> {
  if (await hasUncommittedChanges(ctx.worktree)) {
    return { check: "builder_tests", ok: false, report: "Uncommitted changes in the worktree.", builderFeedback: "Commit all your work before finishing." };
  }
  if ((await commitsAhead(ctx.worktree, ctx.project.defaultBranch)) === 0) {
    return { check: "builder_tests", ok: false, report: "No commits on the ticket branch.", builderFeedback: "No commits were made." };
  }
  const r = await runShell(ctx.project.testCommand, { cwd: ctx.worktree, signal: ctx.signal, timeoutMs: 20 * 60_000 });
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
  const gitleaks = await run("gitleaks", ["version"], { cwd: ctx.worktree });
  if (gitleaks.code === 0) {
    const r = await run(
      "gitleaks",
      ["git", "--no-banner", "--redact", "--log-opts", `${ctx.project.defaultBranch}..HEAD`, "."],
      { cwd: ctx.worktree },
    );
    const ok = r.code === 0;
    return { check: "secret_scan", ok, report: ok ? "gitleaks: clean" : `gitleaks found leaks:\n${fence(r.stdout + r.stderr)}`, builderFeedback: ok ? undefined : "Secrets detected in your commits. Remove them and rewrite the commits." };
  }
  const hits = scanAddedLines(await diff(ctx.worktree, ctx.project.defaultBranch));
  const ok = hits.length === 0;
  return {
    check: "secret_scan",
    ok,
    report: `gitleaks not installed; built-in scan: ${ok ? "clean" : hits.join(", ")}`,
    builderFeedback: ok ? undefined : `Possible secrets: ${hits.join(", ")}`,
  };
}

export async function holdouts(ctx: GateContext): Promise<CheckResult> {
  const { project } = ctx;
  if (!project.holdoutsPath || !project.holdoutsCommand) {
    return { check: "holdouts", ok: false, report: "Holdouts are not configured for this project (holdoutsPath and holdoutsCommand)." };
  }
  let app: Awaited<ReturnType<typeof bootApp>> | undefined;
  try {
    if (project.appCommand) app = await bootApp(project.appCommand, ctx.worktree, project.appHealthPath);
    const r = await runShell(project.holdoutsCommand, {
      cwd: project.holdoutsPath,
      env: { ...process.env, TEMPER_APP_URL: app?.url ?? "", TEMPER_CANDIDATE_PATH: ctx.worktree, TEMPER_TICKET_ID: ctx.ticket.id },
      signal: ctx.signal,
      timeoutMs: 20 * 60_000,
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

/** Runs checks in order, stopping at the first failure. */
export async function runChecks(checks: GateCheck[], ctx: GateContext): Promise<GateOutcome> {
  const results: CheckResult[] = [];
  for (const c of checks) {
    const fn = CHECKS[c];
    if (!fn) throw new Error(`check '${c}' is not a local check`);
    const r = await fn(ctx);
    results.push(r);
    if (!r.ok) break;
  }
  const verdict: Verdict = results.every((r) => r.ok) ? "PASS" : "FAIL";
  const report = results.map((r) => `## ${r.check}: ${r.ok ? "PASS" : "FAIL"}\n${r.report}`).join("\n\n");
  const builderFeedbackText = results
    .filter((r) => !r.ok && r.builderFeedback)
    .map((r) => `${r.check}: ${r.builderFeedback}`)
    .join("\n\n");
  return { verdict, report, builderFeedback: builderFeedbackText, results };
}
