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
 * Squash-merges on GitHub only. Runs outside any checkout: inside one, gh also tries to
 * switch the local branch, which fails when that branch is checked out in another worktree.
 */
export async function mergePullRequest(url: string): Promise<void> {
  await exec("gh", ["pr", "merge", url, "--squash"], { cwd: tmpdir() });
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

export { ghIssues, repoFromRemote, TRUSTED_ASSOCIATIONS } from "./issues.ts";
export type { GithubIssue, IssueSource } from "./issues.ts";
