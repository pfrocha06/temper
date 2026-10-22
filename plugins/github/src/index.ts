// Git host plugin for GitHub, via the `gh` CLI. Used only by the server (ADR 2).
import { execFile } from "node:child_process";
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

export async function mergePullRequest(cwd: string, url: string): Promise<void> {
  await exec("gh", ["pr", "merge", url, "--squash", "--delete-branch"], { cwd });
}

export async function prState(cwd: string, url: string): Promise<PullRequest> {
  const { stdout } = await exec("gh", ["pr", "view", url, "--json", "url,number,state,mergeable"], { cwd });
  return JSON.parse(stdout) as PullRequest;
}
