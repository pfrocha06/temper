// GitHub issues as a work source, read through `gh api` with the pinned account (ADR 2).
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { githubEnv } from "./auth.ts";

const exec = promisify(execFile);

export type GithubIssue = {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  author: string;
  /** OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, … as GitHub reports it. */
  authorAssociation: string;
};

/** Authors who can push to the repository: their issues are the board's own words. */
export const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

export type IssueSource = {
  get(repo: string, number: number): Promise<GithubIssue>;
  /** Open issues (not pull requests) matching GitHub search syntax, newest first. */
  search(repo: string, query: string, limit?: number): Promise<GithubIssue[]>;
};

type RestIssue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: Array<string | { name?: string }>;
  user: { login: string } | null;
  author_association: string;
  pull_request?: unknown;
};

const toIssue = (repo: string, i: RestIssue): GithubIssue => ({
  repo,
  number: i.number,
  title: i.title,
  body: i.body ?? "",
  url: i.html_url,
  state: i.state === "closed" ? "closed" : "open",
  labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
  author: i.user?.login ?? "ghost",
  authorAssociation: i.author_association,
});

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const args = ["api", "-X", "GET", path, ...Object.entries(params).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
  const { stdout } = await exec("gh", args, { cwd: tmpdir(), env: githubEnv(), maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

/** Issues through the GitHub REST API, as the account `useGithubUser` pinned. */
export const ghIssues: IssueSource = {
  async get(repo, number) {
    const i = await api<RestIssue>(`repos/${repo}/issues/${number}`);
    if (i.pull_request) throw new Error(`${repo}#${number} is a pull request, not an issue`);
    return toIssue(repo, i);
  },
  async search(repo, query, limit = 30) {
    const q = `repo:${repo} is:issue is:open ${query}`.trim();
    const r = await api<{ items: RestIssue[] }>("search/issues", { q, per_page: String(Math.min(limit, 100)), sort: "created", order: "desc" });
    return r.items.map((i) => toIssue(repo, i));
  },
};

export type RepoLabel = { name: string; color: string; description: string };
export type RepoMilestone = { number: number; title: string };

/** What a repository's issues can be filtered by, for the console's import picker. */
export type RepoFilters = {
  labels(repo: string): Promise<RepoLabel[]>;
  milestones(repo: string): Promise<RepoMilestone[]>;
};

export const ghRepoFilters: RepoFilters = {
  async labels(repo) {
    const r = await api<Array<{ name: string; color?: string; description?: string | null }>>(`repos/${repo}/labels`, { per_page: "100" });
    return r.map((l) => ({ name: l.name, color: l.color ?? "", description: l.description ?? "" }));
  },
  async milestones(repo) {
    const r = await api<Array<{ number: number; title: string }>>(`repos/${repo}/milestones`, { state: "open", per_page: "100" });
    return r.map((m) => ({ number: m.number, title: m.title }));
  },
};

/** A value inside GitHub search syntax (`label:"…"`): quotes cannot be escaped there, so they are refused. */
export function searchTerm(qualifier: string, value: string): string {
  if (/["\r\n]/.test(value)) throw new Error(`${qualifier} "${value}" cannot be searched: it contains a quote or newline`);
  return `${qualifier}:"${value}"`;
}

const HOST = "github.com";
const NAME = /^[\w.-]+$/;

/**
 * `owner/repo` from a GitHub remote (https or ssh), or undefined for any other host. Parsed by
 * hand: remotes come from project settings, and a backtracking regex over them is a ReDoS risk.
 */
export function repoFromRemote(remote: string | null | undefined): string | undefined {
  let s = (remote ?? "").trim();
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (s.endsWith(".git")) s = s.slice(0, -".git".length);
  const at = s.indexOf(HOST);
  const sep = at < 0 ? undefined : s[at + HOST.length];
  // The host itself, not a longer name ending in it: start, scheme, `git@`, or a subdomain dot.
  if (at > 0 && !["/", "@", "."].includes(s[at - 1]!)) return undefined;
  if (sep !== "/" && sep !== ":") return undefined;
  const parts = s.slice(at + HOST.length + 1).split("/");
  return parts.length === 2 && NAME.test(parts[0]!) && NAME.test(parts[1]!) ? `${parts[0]}/${parts[1]}` : undefined;
}
