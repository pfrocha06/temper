import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadJiraTracker, loadProfile } from "../../../apps/server/src/profile.ts";
import { JiraClient, readJiraToken } from "../src/index.ts";
import { startFakeJira, type FakeJira } from "./fake-jira.ts";

const adf = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

let jira: FakeJira;
let client: JiraClient;
beforeEach(async () => {
  jira = await startFakeJira({
    email: "me@example.test",
    token: "s3cret",
    issues: [
      { key: "ABC-1", summary: "First", description: adf("Do the thing"), status: "To Do", transitions: ["In Progress", "Done"] },
      { key: "ABC-2", summary: "Second", status: "To Do", transitions: ["In Progress"] },
    ],
  });
  client = new JiraClient({ baseUrl: jira.url, email: "me@example.test", token: "s3cret" });
});
afterEach(() => jira.close());

describe("JiraClient against the fake Jira", () => {
  it("searches by JQL", async () => {
    const found = await client.search("project = ABC ORDER BY key");
    expect(found.map((i) => i.key)).toEqual(["ABC-1", "ABC-2"]);
    expect(jira.requests[0]!.authorization).toBe("Basic " + Buffer.from("me@example.test:s3cret").toString("base64"));
    expect((await client.search('key = "ABC-2"')).map((i) => i.key)).toEqual(["ABC-2"]);
  });

  it("gets an issue with the description as Markdown", async () => {
    const i = await client.getIssue("ABC-1");
    expect(i).toMatchObject({ key: "ABC-1", summary: "First", description: "Do the thing", status: "To Do", project: "ABC", url: `${jira.url}/browse/ABC-1` });
  });

  it("adds a comment", async () => {
    const c = await client.addComment("ABC-1", "Temper started work");
    expect(c.id).toBeTruthy();
    expect(JSON.stringify(jira.issues.get("ABC-1")!.comments)).toContain("Temper started work");
  });

  it("lists transitions", async () => {
    expect((await client.listTransitions("ABC-1")).map((t) => t.name)).toEqual(["In Progress", "Done"]);
  });

  it("applies a transition by name", async () => {
    const r = await client.applyTransition("ABC-1", "in progress");
    expect(r.ok).toBe(true);
    expect(jira.issues.get("ABC-1")!.status).toBe("In Progress");
  });

  it("creates and edits an issue", async () => {
    const created = await client.createIssue({ project: "ABC", summary: "New one", description: "Body", labels: ["x"] });
    expect(created.key).toBe("ABC-3");
    await client.editIssue("ABC-3", { summary: "Renamed", description: "Changed" });
    const got = await client.getIssue("ABC-3");
    expect(got).toMatchObject({ summary: "Renamed", description: "Changed", labels: ["x"] });
  });

  it("reports API failures with the status", async () => {
    jira.failWith(500);
    await expect(client.getIssue("ABC-1")).rejects.toMatchObject({ status: 500 });
  });

  it("does not call the API for a transition the issue does not offer", async () => {
    const r = await client.applyTransition("ABC-2", "Done");
    expect(r).toMatchObject({ ok: false, reason: "transition not available", name: "Done", available: ["In Progress"] });
    expect(jira.requests.filter((q) => q.method === "POST")).toHaveLength(0);
    expect(jira.issues.get("ABC-2")!.status).toBe("To Do");
  });
});

describe("profile trackers.jira", () => {
  const home = () => mkdtempSync(join(tmpdir(), "temper-jira-"));
  const profileWith = (h: string) =>
    writeFileSync(join(h, "profile.json"), JSON.stringify({ name: "p", trackers: { jira: { baseUrl: "http://jira.invalid", email: "a@b.test", tokenSecret: "jira-token", projects: ["ABC"], transitions: { done: "Closed" } } } }));

  it("loads and resolves the token from the secrets dir", () => {
    const h = home();
    profileWith(h);
    writeFileSync(join(h, "jira-token"), "tok\n");
    const jiraCfg = loadJiraTracker(loadProfile(h), h);
    expect(jiraCfg).toMatchObject({ baseUrl: "http://jira.invalid", token: "tok", projects: ["ABC"], transitions: { done: "Closed" } });
    expect(readJiraToken(h, "jira-token")).toBe("tok");
  });

  it("names the secret, never a value, when the file is missing", () => {
    const h = home();
    profileWith(h);
    const profile = loadProfile(h);
    expect(() => loadJiraTracker(profile, h)).toThrow(/"jira-token"/);
    expect(() => readJiraToken(h, "jira-token")).toThrow(/"jira-token"/);
  });

  it("returns undefined without trackers.jira and rejects incomplete config", () => {
    const h = home();
    expect(loadJiraTracker(loadProfile(h), h)).toBeUndefined();
    writeFileSync(join(h, "profile.json"), JSON.stringify({ trackers: { jira: { baseUrl: "http://x" } } }));
    expect(() => loadProfile(h)).toThrow(/trackers\.jira\.email/);
  });
});
