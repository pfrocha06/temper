// Work intake from GitHub issues: each issue becomes a Markdown spec, goes through the Chief's
// importSpec, and every ticket created links back to it. PRs for those tickets close the issue.
import { audit, findOpenTicketByRef, getProject, updateTicket, type Db, type Ticket } from "@temper/core";
import { ghIssues, repoFromRemote, TRUSTED_ASSOCIATIONS, type GithubIssue, type IssueSource } from "@temper/plugin-github";

/** The request is not usable for a GitHub import; maps to HTTP 400. */
export class GithubImportError extends Error {
  override name = "GithubImportError";
}

export type GithubImportInput = {
  projectId: string;
  /** One issue number. */
  issue?: number;
  /** GitHub search terms over open issues, such as `label:roadmap` or `label:bug milestone:v1`. */
  search?: string;
  /** `owner/repo`; defaults to the project's GitHub remote. */
  repo?: string;
  start?: boolean;
  /**
   * Also import issues from people who cannot push to the repository. Off by default: on a public
   * repository anyone can open an issue, and its text becomes instructions for the agents.
   */
  anyAuthor?: boolean;
  limit?: number;
};

export type GithubImportResult = {
  key: string;
  url: string;
  status: "imported" | "skipped";
  ticketIds: string[];
  reason?: string;
  /** The open ticket that already holds the issue, when skipped for that reason. */
  existingTicketId?: string;
};

export type GithubImportDeps = {
  db: Db;
  importSpec: (projectId: string, title: string, markdown: string, autoStart: boolean) => Promise<Ticket[]>;
  tick: () => Promise<void> | void;
  issues?: IssueSource;
};

const AC_HEADING = /^#{1,6}\s*acceptance criteria\s*:?\s*$/im;

export const issueKey = (issue: Pick<GithubIssue, "repo" | "number">) => `${issue.repo}#${issue.number}`;

/** Title, the issue link and labels, the body, and (when the body has one) its Acceptance criteria. */
export function issueToMarkdown(issue: GithubIssue): string {
  const desc = issue.body.replace(/\r\n/g, "\n").trim();
  const m = AC_HEADING.exec(desc);
  const body = m ? desc.slice(0, m.index).trim() : desc;
  const ac = m ? desc.slice(m.index + m[0].length).trim() : "";
  const labels = issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "";
  return [`# ${issue.title}`, `GitHub: ${issueKey(issue)} (${issue.url})`, labels, body, ac && `## Acceptance criteria\n\n${ac}`].filter(Boolean).join("\n\n") + "\n";
}

export async function importFromGithub(deps: GithubImportDeps, input: GithubImportInput): Promise<GithubImportResult[]> {
  if ((input.issue === undefined) === !input.search) throw new GithubImportError("give exactly one of issue or search");
  const project = await getProject(deps.db, input.projectId);
  if (!project) throw new GithubImportError(`no project ${input.projectId}`);
  const repo = input.repo ?? repoFromRemote(project.remoteUrl);
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GithubImportError(`no GitHub repository: the project's remote is not on github.com; pass repo as owner/name`);

  const source = deps.issues ?? ghIssues;
  const issues = input.issue !== undefined ? [await source.get(repo, input.issue)] : await source.search(repo, input.search!, input.limit ?? 30);

  const results: GithubImportResult[] = [];
  const skip = async (issue: GithubIssue, reason: string, existingTicketId?: string) => {
    await audit(deps.db, { actor: "board", kind: "github.imported", subject: issueKey(issue), data: { skipped: true, reason, existingTicketId } });
    results.push({ key: issueKey(issue), url: issue.url, status: "skipped", ticketIds: [], reason, existingTicketId });
  };
  for (const issue of issues) {
    if (issue.state === "closed") {
      await skip(issue, "closed");
      continue;
    }
    if (!input.anyAuthor && !TRUSTED_ASSOCIATIONS.includes(issue.authorAssociation)) {
      await skip(issue, `opened by ${issue.author}, who cannot push to ${repo} (allow with anyAuthor after reading it)`);
      continue;
    }
    const existing = await findOpenTicketByRef(deps.db, "github", issueKey(issue));
    if (existing) {
      await skip(issue, `already linked to open ticket ${existing.id}`, existing.id);
      continue;
    }
    // Import unstarted so the link is on every ticket before any of them can be dispatched.
    const created = await deps.importSpec(input.projectId, issue.title, issueToMarkdown(issue), false);
    const externalRef = { tracker: "github", key: issueKey(issue), url: issue.url };
    for (const t of created) {
      await updateTicket(deps.db, t.id, { externalRef, ...(input.start ? { status: "ready" as const } : {}) }, "board");
    }
    await audit(deps.db, { actor: "board", kind: "github.imported", subject: issueKey(issue), data: { ticketIds: created.map((t) => t.id), started: !!input.start, author: issue.author } });
    results.push({ key: issueKey(issue), url: issue.url, status: "imported", ticketIds: created.map((t) => t.id) });
  }
  if (input.start && results.some((r) => r.status === "imported")) void deps.tick();
  return results;
}

/**
 * The line a ticket's PR carries for the GitHub issue it came from: `Closes` when it is the last
 * open ticket from that issue (merging it closes the issue), otherwise `Part of`.
 */
export function issueLine(externalRef: { tracker: string; key: string } | null | undefined, otherOpenTickets: number): string | undefined {
  if (externalRef?.tracker !== "github" || !/^[\w.-]+\/[\w.-]+#\d+$/.test(externalRef.key)) return undefined;
  return `${otherOpenTickets > 0 ? "Part of" : "Closes"} ${externalRef.key}`;
}
