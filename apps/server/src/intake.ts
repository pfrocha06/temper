// The console's issue picker: which trackers a project can import from, what each can be
// filtered by, a search that returns candidates without importing anything, and an import of
// one issue at a time (so a long batch is many short requests, never one that times out).
import { findOpenTicketByRef, getProject, type Db, type Ticket } from "@temper/core";
import {
  ghIssues,
  ghRepoFilters,
  repoFromRemote,
  searchTerm,
  TRUSTED_ASSOCIATIONS,
  type IssueSource,
  type RepoFilters,
  type RepoLabel,
  type RepoMilestone,
} from "@temper/plugin-github";
import { JIRA_ISSUE_KEY, JIRA_PROJECT_KEY, JiraClient, jiraCredentials, jqlString, type JiraProject } from "../../../plugins/jira/src/index.ts";
import { importFromGithub, issueKey, type GithubImportResult } from "./github-import.ts";
import { importFromJira, type JiraImportResult } from "./jira-import.ts";
import type { Profile } from "./profile.ts";

export type IntakeSourceId = "github" | "jira";

/** The request cannot be served as asked; maps to HTTP 400. */
export class IntakeError extends Error {
  override name = "IntakeError";
}

export type IntakeSources = {
  github: { available: true; repo: string } | { available: false; reason: string };
  jira: { available: true; baseUrl: string } | { available: false; reason: string };
};

export type GithubFilters = { labels: RepoLabel[]; milestones: RepoMilestone[] };
export type JiraFilters = { projects: JiraProject[]; epics: Array<{ key: string; summary: string }> };

export type GithubQuery = { source: "github"; query?: string; labels?: string[]; milestone?: string };
/** Either raw JQL, or the fields the console's pickers fill in (a project or an epic is required). */
export type JiraQuery = { source: "jira"; jql?: string; project?: string; epic?: string; text?: string; includeDone?: boolean };
export type IntakeQuery = (GithubQuery | JiraQuery) & { projectId: string; limit?: number };

export type IntakeCandidate = {
  source: IntakeSourceId;
  key: string;
  title: string;
  url: string;
  status: string;
  labels: string[];
  type?: string;
  /** Jira: the epic or parent issue. */
  parent?: { key: string; summary: string };
  /** GitHub: who opened it, and whether they can push (only they are imported by default). */
  author?: string;
  trusted: boolean;
  /** The open ticket that already holds this issue. */
  ticketId?: string;
};

export type IntakeImportResult = GithubImportResult | JiraImportResult;

export type IntakeDeps = {
  db: Db;
  profile: Profile | undefined;
  secretsDir: string;
  importSpec: (projectId: string, title: string, markdown: string, autoStart: boolean) => Promise<Ticket[]>;
  tick: () => Promise<void> | void;
  issues?: IssueSource;
  repoFilters?: RepoFilters;
  fetchFn?: typeof fetch;
};

async function projectRepo(db: Db, projectId: string): Promise<string | undefined> {
  const project = await getProject(db, projectId);
  if (!project) throw new IntakeError(`no project ${projectId}`);
  return repoFromRemote(project.remoteUrl);
}

function jiraClient(deps: IntakeDeps): JiraClient {
  const cfg = deps.profile?.trackers?.jira;
  if (!cfg) throw new IntakeError("Jira is not configured: add trackers.jira (baseUrl, email, tokenSecret) to profile.json");
  try {
    return new JiraClient(jiraCredentials(cfg, deps.secretsDir), deps.fetchFn);
  } catch (e) {
    throw new IntakeError((e as Error).message);
  }
}

export async function intakeSources(deps: IntakeDeps, projectId: string): Promise<IntakeSources> {
  const repo = await projectRepo(deps.db, projectId);
  const cfg = deps.profile?.trackers?.jira;
  return {
    github: repo ? { available: true, repo } : { available: false, reason: "The project's remote is not on github.com." },
    jira: cfg ? { available: true, baseUrl: cfg.baseUrl } : { available: false, reason: "Jira is not configured: add trackers.jira to profile.json." },
  };
}

export async function githubFilters(deps: IntakeDeps, projectId: string): Promise<GithubFilters> {
  const repo = await projectRepo(deps.db, projectId);
  if (!repo) throw new IntakeError("the project's remote is not on github.com");
  const meta = deps.repoFilters ?? ghRepoFilters;
  const [labels, milestones] = await Promise.all([meta.labels(repo), meta.milestones(repo)]);
  return { labels, milestones };
}

/** Projects (the profile's list when it names some, else all the account can see) and the open epics of one. */
export async function jiraFilters(deps: IntakeDeps, project?: string): Promise<JiraFilters> {
  if (project !== undefined && !JIRA_PROJECT_KEY.test(project)) throw new IntakeError(`"${project}" is not a Jira project key`);
  const client = jiraClient(deps);
  const pinned = deps.profile?.trackers?.jira?.projects ?? [];
  const projects = pinned.length ? pinned.map((key) => ({ key, name: key })) : await client.listProjects();
  const epics = project
    ? (await client.search(`project = ${jqlString(project)} AND issuetype = Epic AND statusCategory != Done ORDER BY created DESC`, 100)).map((e) => ({
        key: e.key,
        summary: e.summary,
      }))
    : [];
  return { projects, epics };
}

/** The JQL the console's Jira pickers stand for. Every value is quoted; raw JQL passes as typed. */
export function jiraQueryToJql(q: Omit<JiraQuery, "source">): string {
  if (q.jql?.trim()) return q.jql.trim();
  if (q.project && !JIRA_PROJECT_KEY.test(q.project)) throw new IntakeError(`"${q.project}" is not a Jira project key`);
  if (q.epic && !JIRA_ISSUE_KEY.test(q.epic)) throw new IntakeError(`"${q.epic}" is not a Jira issue key`);
  if (!q.project && !q.epic) throw new IntakeError("pick a Jira project or an epic, or write JQL");
  const clauses = [
    q.project && `project = ${jqlString(q.project)}`,
    q.epic && `parent = ${jqlString(q.epic)}`,
    // Epics are containers; picking one means its children.
    "issuetype != Epic",
    !q.includeDone && "statusCategory != Done",
    q.text?.trim() && `text ~ ${jqlString(q.text.trim())}`,
  ].filter(Boolean);
  return `${clauses.join(" AND ")} ORDER BY created DESC`;
}

/** The GitHub search the console's pickers stand for, over open issues of the project's repo. */
export function githubQueryToSearch(q: Omit<GithubQuery, "source">): string {
  try {
    return [q.query?.trim(), ...(q.labels ?? []).map((l) => searchTerm("label", l)), q.milestone && searchTerm("milestone", q.milestone)]
      .filter(Boolean)
      .join(" ");
  } catch (e) {
    throw new IntakeError((e as Error).message);
  }
}

/** Candidates for import, each marked with the open ticket that already holds it. Imports nothing. */
export async function searchIntake(deps: IntakeDeps, q: IntakeQuery): Promise<IntakeCandidate[]> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  let found: Omit<IntakeCandidate, "ticketId">[];
  if (q.source === "github") {
    const repo = await projectRepo(deps.db, q.projectId);
    if (!repo) throw new IntakeError("the project's remote is not on github.com");
    const issues = await (deps.issues ?? ghIssues).search(repo, githubQueryToSearch(q), limit);
    found = issues.map((i) => ({
      source: "github",
      key: issueKey(i),
      title: i.title,
      url: i.url,
      status: i.state,
      labels: i.labels,
      author: i.author,
      trusted: TRUSTED_ASSOCIATIONS.includes(i.authorAssociation),
    }));
  } else {
    await projectRepo(deps.db, q.projectId);
    const issues = await jiraClient(deps).search(jiraQueryToJql(q), limit);
    found = issues.map((i) => ({
      source: "jira",
      key: i.key,
      title: i.summary,
      url: i.url,
      status: i.status,
      labels: i.labels,
      type: i.issueType,
      ...(i.parent ? { parent: i.parent } : {}),
      // Jira is a closed workspace the profile signs in to; its issues are the board's own.
      trusted: true,
    }));
  }
  return Promise.all(
    found.map(async (c) => {
      const open = await findOpenTicketByRef(deps.db, c.source, c.key);
      return open ? { ...c, ticketId: open.id } : c;
    }),
  );
}

export type IntakeImportInput = { projectId: string; source: IntakeSourceId; key: string; start?: boolean; anyAuthor?: boolean };

/** One issue through the Chief's importSpec, with the same checks as the CLI imports. */
export async function importOne(deps: IntakeDeps, input: IntakeImportInput): Promise<IntakeImportResult> {
  if (input.source === "github") {
    const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(input.key);
    if (!m) throw new IntakeError(`"${input.key}" is not a GitHub issue (owner/repo#N)`);
    const repo = await projectRepo(deps.db, input.projectId);
    if (m[1] !== repo) throw new IntakeError(`${input.key} is not in this project's repository (${repo ?? "none"})`);
    const [result] = await importFromGithub(deps, { projectId: input.projectId, repo, issue: Number(m[2]), start: input.start, anyAuthor: input.anyAuthor });
    return result!;
  }
  if (!JIRA_ISSUE_KEY.test(input.key)) throw new IntakeError(`"${input.key}" is not a Jira issue key`);
  const [result] = await importFromJira(deps, { projectId: input.projectId, issue: input.key, start: input.start });
  return result!;
}
