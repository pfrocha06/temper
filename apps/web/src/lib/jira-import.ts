/** One issue's outcome from `POST /api/jira/import`. */
export type JiraImportResult = {
  key: string;
  url: string;
  status: "imported" | "skipped";
  ticketIds: string[];
  /** The open ticket that already holds the issue, when skipped. */
  existingTicketId?: string;
};

export type JiraImportBody = { projectId: string; issue?: string; jql?: string; start: boolean };

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** A bare issue key imports that issue; anything else is taken as JQL. Null when there is nothing to import. */
export function jiraImportBody(projectId: string, text: string, start: boolean): JiraImportBody | null {
  const q = text.trim();
  if (!q) return null;
  return ISSUE_KEY.test(q) ? { projectId, issue: q.toUpperCase(), start } : { projectId, jql: q, start };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarizeJiraImport(results: JiraImportResult[]) {
  const created = results.filter((r) => r.status === "imported");
  const skipped = results.filter((r) => r.status === "skipped");
  const ticketCount = created.reduce((n, r) => n + r.ticketIds.length, 0);
  let headline: string;
  if (results.length === 0) headline = "No Jira issues matched.";
  else if (created.length === 0) {
    headline = skipped.length === 1 ? `${skipped[0]!.key} is already linked to a ticket. Nothing new was created.` : `All ${skipped.length} issues are already linked to tickets. Nothing new was created.`;
  } else {
    headline = `Created ${plural(ticketCount, "ticket")}${skipped.length ? `; ${plural(skipped.length, "issue")} already linked` : ""}.`;
  }
  return { created, skipped, ticketCount, headline };
}
