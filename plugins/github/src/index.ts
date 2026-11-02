// Git host plugin for GitHub, via the `gh` CLI. Used only by the server (ADR 2).
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { githubEnv } from "./auth.ts";

export { GIT_CREDENTIAL_ARGS, githubEnv, useGithubUser } from "./auth.ts";

const execRaw = promisify(execFile);
const exec = (cmd: string, args: string[], opts: { cwd: string }) => execRaw(cmd, args, { ...opts, env: githubEnv() });

export type PullRequest = { url: string; number: number; state: "OPEN" | "CLOSED" | "MERGED"; mergeable?: string };

export type PrBodyInput = {
  ticketId: string;
  title: string;
  changes?: string;
  verification?: string;
  review?: string;
  gates?: string;
  filesChanged: number;
  areas: string[];
  /** `Closes owner/repo#N` (or `Part of …`) for the issue the ticket came from. */
  issue?: string;
};

/** Merge risk from blast radius: how much and how widely the change reaches. */
export function mergeRisk(filesChanged: number, areas: string[]): "low" | "medium" | "high" {
  if (filesChanged > 25 || areas.length > 3) return "high";
  if (filesChanged > 8 || areas.length > 1) return "medium";
  return "low";
}

const section = (title: string, body?: string) => (body?.trim() ? `## ${title}\n\n${body.trim()}\n` : "");
const stripVerdict = (s?: string) => s?.replace(/^\s*VERDICT:.*$/gm, "").trim();

export function prBody(input: PrBodyInput): string {
  const risk = mergeRisk(input.filesChanged, input.areas);
  return [
    `Temper ticket \`${input.ticketId}\` · **merge risk: ${risk}** (${input.filesChanged} files across ${input.areas.join(", ") || "root"})\n`,
    section("What changed", stripVerdict(input.changes)),
    section("Evidence", stripVerdict(input.verification)),
    section("Gates", input.gates),
    section("Review", stripVerdict(input.review)),
    input.issue ? `${input.issue}
` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createPullRequest(
  cwd: string,
  input: { base: string; head: string; title: string; body: string },
): Promise<PullRequest> {
  const existing = await findPullRequest(cwd, input.head);
  if (existing) return existing;
  await exec("gh", ["pr", "create", "--base", input.base, "--head", input.head, "--title", input.title, "--body", input.body], { cwd });
  const pr = await findPullRequest(cwd, input.head);
  if (!pr) throw new Error(`created PR for ${input.head} but cannot find it`);
  return pr;
}

export async function findPullRequest(cwd: string, head: string): Promise<PullRequest | undefined> {
  const { stdout } = await exec("gh", ["pr", "list", "--head", head, "--state", "all", "--json", "url,number,state", "--limit", "1"], { cwd });
  const [pr] = JSON.parse(stdout) as PullRequest[];
  return pr;
}

/** `https://github.com/<owner>/<repo>/pull/<n>` → `<owner>/<repo>`. */
export function repoOf(prUrl: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl);
  if (!m) throw new Error(`not a GitHub pull request URL: ${prUrl}`);
  return m[1]!;
}

/**
 * Squash-merges on GitHub only, and only the commit the board approved: GitHub refuses the merge
 * if the PR's head moved. Runs outside any checkout: inside one, gh also tries to switch the
 * local branch, which fails when that branch is checked out in another worktree.
 */
export async function mergePullRequest(url: string, head: string): Promise<void> {
  await exec("gh", ["pr", "merge", url, "--squash", "--match-head-commit", head], { cwd: tmpdir() });
}

/** One required check on a PR's head commit, as `gh pr checks` buckets it. */
export type CheckRun = { name: string; bucket: "pass" | "fail" | "pending" | "skipping" | "cancel"; state: string; link?: string };

/** A PR as merging needs it: its head commit, GitHub's merge state and the required checks on that head. */
export type PrStatus = { state: PullRequest["state"]; head: string; mergeState: string; checks: CheckRun[] };

export async function prStatus(url: string): Promise<PrStatus> {
  const { stdout } = await exec("gh", ["pr", "view", url, "--json", "state,headRefOid,mergeStateStatus"], { cwd: tmpdir() });
  const view = JSON.parse(stdout) as { state: PullRequest["state"]; headRefOid: string; mergeStateStatus: string };
  let checks: CheckRun[] = [];
  try {
    const out = await exec("gh", ["pr", "checks", url, "--required", "--json", "name,state,bucket,link"], { cwd: tmpdir() });
    checks = JSON.parse(out.stdout || "[]") as CheckRun[];
  } catch (err) {
    // A repository without required checks, or one GitHub has not reported checks for yet.
    if (!/no (required )?checks reported/i.test(String((err as { stderr?: string }).stderr ?? err))) throw err;
  }
  return { state: view.state, head: view.headRefOid, mergeState: view.mergeStateStatus, checks };
}

export type Readiness =
  | { kind: "ready" }
  /** Worth waiting for: required checks still running, or GitHub not allowing the merge yet. */
  | { kind: "pending"; detail: string }
  /** A required check failed: the change needs work. */
  | { kind: "failed"; failed: CheckRun[] }
  /** Waiting will not fix it: the board decides. */
  | { kind: "blocked"; reason: string };

/**
 * Whether the PR can be merged at `head`, the commit Temper pushed and the gates passed. Checks
 * belong to the PR's current head, so they count only while that head is `head`.
 */
export function mergeReadiness(pr: PrStatus, head: string): Readiness {
  if (pr.state === "CLOSED") return { kind: "blocked", reason: "the PR was closed on GitHub" };
  if (pr.head !== head) return { kind: "blocked", reason: `the PR's head is ${pr.head.slice(0, 7)}, not ${head.slice(0, 7)}, the commit Temper pushed and checked` };
  const failed = pr.checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failed.length) return { kind: "failed", failed };
  const pending = pr.checks.filter((c) => c.bucket === "pending");
  if (pending.length) {
    const done = pr.checks.length - pending.length;
    return { kind: "pending", detail: `${done} of ${pr.checks.length} required checks done; waiting for ${pending.map((c) => c.name).join(", ")}` };
  }
  switch (pr.mergeState) {
    case "CLEAN":
    case "UNSTABLE": // only checks GitHub does not require are failing
    case "HAS_HOOKS":
      return { kind: "ready" };
    case "DIRTY":
      return { kind: "blocked", reason: "the branch conflicts with the base branch" };
    case "BEHIND":
      return { kind: "blocked", reason: "the branch is behind the base branch, and the repository requires it up to date" };
    case "DRAFT":
      return { kind: "blocked", reason: "the PR is a draft" };
    default:
      // BLOCKED with every reported check passed: a required check GitHub has not listed yet, or a
      // required review. UNKNOWN: GitHub is still computing. Waiting resolves the first and last.
      return { kind: "pending", detail: `GitHub does not allow the merge yet (${pr.mergeState.toLowerCase()})` };
  }
}

/** `https://github.com/<owner>/<repo>/actions/runs/<run>/job/<job>` → its repo and job id. */
export function jobOf(link: string | undefined): { repo: string; job: string } | undefined {
  const m = link ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/.exec(link) : null;
  return m ? { repo: m[1]!, job: m[2]! } : undefined;
}

/** The last `lines` lines of a failed Actions job's failed steps; empty when GitHub has no log for it. */
export async function failedJobLog(link: string | undefined, lines = 60): Promise<string> {
  const job = jobOf(link);
  if (!job) return "";
  try {
    const { stdout } = await exec("gh", ["run", "view", "--job", job.job, "-R", job.repo, "--log-failed"], { cwd: tmpdir() });
    return stdout.trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Deletes a branch on GitHub. Idempotent: a branch that is already gone is not an error. */
export async function deleteRemoteBranch(prUrl: string, branch: string): Promise<void> {
  try {
    await exec("gh", ["api", "-X", "DELETE", `repos/${repoOf(prUrl)}/git/refs/heads/${branch}`], { cwd: tmpdir() });
  } catch (err) {
    if (!/Reference does not exist|HTTP 422|HTTP 404/.test(String((err as { stderr?: string }).stderr ?? err))) throw err;
  }
}

export async function prState(url: string): Promise<PullRequest> {
  const { stdout } = await exec("gh", ["pr", "view", url, "--json", "url,number,state,mergeable"], { cwd: tmpdir() });
  return JSON.parse(stdout) as PullRequest;
}

export { ghIssues, ghRepoFilters, repoFromRemote, searchTerm, TRUSTED_ASSOCIATIONS } from "./issues.ts";
export type { GithubIssue, IssueSource, RepoFilters, RepoLabel, RepoMilestone } from "./issues.ts";
