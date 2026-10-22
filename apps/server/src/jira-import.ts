// Work intake from Jira: issues become Markdown specs, go through the Chief's importSpec,
// and every ticket created carries the issue link. The server alone holds the Jira token.
import { audit, findOpenTicketByRef, updateTicket, type Db, type Ticket } from "@temper/core";
import { JiraClient, jiraCredentials, type JiraIssue } from "../../../plugins/jira/src/index.ts";
import type { Profile } from "./profile.ts";

/** The profile or request is not usable for a Jira import; maps to HTTP 400. */
export class JiraImportError extends Error {
  override name = "JiraImportError";
}

export type JiraImportInput = { projectId: string; issue?: string; jql?: string; start?: boolean };
export type JiraImportResult = {
  key: string;
  url: string;
  status: "imported" | "skipped";
  ticketIds: string[];
  /** The open ticket that already holds the issue, when skipped. */
  existingTicketId?: string;
};

export type JiraImportDeps = {
  db: Db;
  profile: Profile | undefined;
  secretsDir: string;
  importSpec: (projectId: string, title: string, markdown: string, autoStart: boolean) => Promise<Ticket[]>;
  tick: () => Promise<void> | void;
  fetchFn?: typeof fetch;
};

const AC_HEADING = /^#{1,6}\s*acceptance criteria\s*:?\s*$/im;

/** Title, description and (when the description has one) an Acceptance criteria section. */
export function issueToMarkdown(issue: JiraIssue): string {
  const desc = issue.description.trim();
  const m = AC_HEADING.exec(desc);
  const body = m ? desc.slice(0, m.index).trim() : desc;
  const ac = m ? desc.slice(m.index + m[0].length).trim() : "";
  return [`# ${issue.summary}`, `Jira: ${issue.key} (${issue.url})`, body, ac && `## Acceptance criteria\n\n${ac}`].filter(Boolean).join("\n\n") + "\n";
}

export async function importFromJira(deps: JiraImportDeps, input: JiraImportInput): Promise<JiraImportResult[]> {
  if (!!input.issue === !!input.jql) throw new JiraImportError("give exactly one of issue or jql");
  const cfg = deps.profile?.trackers?.jira;
  if (!cfg) throw new JiraImportError("Jira is not configured: add trackers.jira (baseUrl, email, tokenSecret) to profile.json");
  let client: JiraClient;
  try {
    client = new JiraClient(jiraCredentials(cfg, deps.secretsDir), deps.fetchFn);
  } catch (e) {
    throw new JiraImportError((e as Error).message);
  }
  const issues = input.issue ? [await client.getIssue(input.issue)] : await client.search(input.jql!);

  const results: JiraImportResult[] = [];
  for (const issue of issues) {
    const existing = await findOpenTicketByRef(deps.db, "jira", issue.key);
    if (existing) {
      await audit(deps.db, { actor: "board", kind: "jira.imported", subject: issue.key, data: { skipped: true, existingTicketId: existing.id } });
      results.push({ key: issue.key, url: issue.url, status: "skipped", ticketIds: [], existingTicketId: existing.id });
      continue;
    }
    // Import unstarted so the link is on every ticket before any of them can be dispatched.
    const created = await deps.importSpec(input.projectId, issue.summary, issueToMarkdown(issue), false);
    const externalRef = { tracker: "jira", key: issue.key, url: issue.url };
    for (const t of created) {
      await updateTicket(deps.db, t.id, { externalRef, ...(input.start ? { status: "ready" as const } : {}) }, "board");
    }
    await audit(deps.db, { actor: "board", kind: "jira.imported", subject: issue.key, data: { ticketIds: created.map((t) => t.id), started: !!input.start } });
    results.push({ key: issue.key, url: issue.url, status: "imported", ticketIds: created.map((t) => t.id) });
  }
  if (input.start && results.some((r) => r.status === "imported")) void deps.tick();
  return results;
}

