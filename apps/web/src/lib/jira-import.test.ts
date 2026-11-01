import { describe, expect, it } from "vitest";
import { jiraImportBody, summarizeJiraImport, type JiraImportResult } from "./jira-import";

describe("jiraImportBody", () => {
  it("sends an issue key as issue", () => {
    expect(jiraImportBody("p1", " abc-12 ", true)).toEqual({ projectId: "p1", issue: "ABC-12", start: true });
  });
  it("sends anything else as JQL", () => {
    expect(jiraImportBody("p1", "project = ABC AND status = Open", false)).toEqual({ projectId: "p1", jql: "project = ABC AND status = Open", start: false });
  });
  it("rejects empty input", () => {
    expect(jiraImportBody("p1", "   ", false)).toBeNull();
  });
});

describe("summarizeJiraImport", () => {
  const results: JiraImportResult[] = [
    { key: "ABC-1", url: "https://x/browse/ABC-1", status: "imported", ticketIds: ["t1", "t2"] },
    { key: "ABC-2", url: "https://x/browse/ABC-2", status: "skipped", ticketIds: [], existingTicketId: "t9" },
  ];
  it("splits created from already linked", () => {
    const s = summarizeJiraImport(results);
    expect(s.created.map((r) => r.key)).toEqual(["ABC-1"]);
    expect(s.skipped.map((r) => r.key)).toEqual(["ABC-2"]);
    expect(s.ticketCount).toBe(2);
    expect(s.headline).toBe("Created 2 tickets; 1 issue already linked.");
  });
  it("says so when everything was already linked", () => {
    expect(summarizeJiraImport([results[1]!]).headline).toBe("ABC-2 is already linked to a ticket. Nothing new was created.");
  });
  it("handles no matches", () => {
    expect(summarizeJiraImport([]).headline).toBe("No Jira issues matched.");
  });
});
