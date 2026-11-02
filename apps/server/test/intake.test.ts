import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createTicket, getTicket, openDb, updateTicket, type Db } from "@temper/core";
import type { GithubIssue, IssueSource, RepoFilters } from "@temper/plugin-github";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";
import { githubQueryToSearch, IntakeError, jiraQueryToJql } from "../src/intake.ts";
import type { Profile } from "../src/profile.ts";
import { startFakeJira, type FakeJira } from "../../../plugins/jira/test/fake-jira.ts";

const gh = (number: number, over: Partial<GithubIssue> = {}): GithubIssue => ({
  repo: "acme/shop",
  number,
  title: `Issue ${number}`,
  body: "Body.",
  url: `https://github.com/acme/shop/issues/${number}`,
  state: "open",
  labels: ["roadmap"],
  author: "owner",
  authorAssociation: "OWNER",
  ...over,
});

let db: Db;
let close: () => Promise<void>;
let jira: FakeJira;
let projectId: string;
let app: ReturnType<typeof createApi>;
let imports: string[];
let issues: GithubIssue[];
let searched: string[];

const source: IssueSource = {
  get: async (repo, n) => {
    const found = issues.find((i) => i.repo === repo && i.number === n);
    if (!found) throw new Error("not found");
    return found;
  },
  search: async (_repo, query) => {
    searched.push(query);
    return issues;
  },
};
const repoFilters: RepoFilters = {
  labels: async () => [{ name: "roadmap", color: "0e8a16", description: "Planned work" }],
  milestones: async () => [{ number: 1, title: "v1" }],
};

beforeEach(async () => {
  ({ db, close } = await openDb());
  projectId = (await createProject(db, { name: "shop", repoPath: "/e/shop", remoteUrl: "https://github.com/acme/shop.git" })).id;
  jira = await startFakeJira({
    issues: [
      { key: "P-1", summary: "Checkout epic", issueType: "Epic" },
      { key: "P-2", summary: "Fix login" },
      { key: "Q-1", summary: "Other project" },
    ],
    email: "a@b.test",
    token: "tok",
  });
  const config = loadConfig({ TEMPER_HOME: mkdtempSync(join(tmpdir(), "intake-")) });
  mkdirSync(config.secretsDir, { recursive: true });
  writeFileSync(join(config.secretsDir, "jira-token"), "tok\n");
  const profile = { mcpServers: {}, trackers: { jira: { baseUrl: jira.url, email: "a@b.test", tokenSecret: "jira-token" } } } as unknown as Profile;
  imports = [];
  searched = [];
  issues = [gh(1), gh(2, { author: "stranger", authorAssociation: "NONE" })];
  const factory = {
    tick: async () => {},
    importSpec: async (pid: string, title: string, markdown: string) => {
      imports.push(title);
      return [await createTicket(db, { projectId: pid, type: "feature", title, spec: markdown, status: "backlog" })];
    },
  } as unknown as Factory;
  app = createApi(db, factory, config, { profile, intake: { issues: source, repoFilters } });
});
afterEach(async () => {
  await jira.close();
  await close();
});

const get = (path: string) => app.request(path);
const post = (path: string, body: Record<string, unknown>) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, ...body }) });

describe("intake sources and filters", () => {
  it("lists GitHub from the project's remote and Jira from the profile", async () => {
    const res = await get(`/api/intake/sources?projectId=${projectId}`);
    expect(await res.json()).toEqual({ github: { available: true, repo: "acme/shop" }, jira: { available: true, baseUrl: jira.url } });
  });

  it("offers the repo's labels and milestones", async () => {
    const res = await get(`/api/intake/github/filters?projectId=${projectId}`);
    expect(await res.json()).toEqual({ labels: [{ name: "roadmap", color: "0e8a16", description: "Planned work" }], milestones: [{ number: 1, title: "v1" }] });
  });

  it("offers Jira projects, and the open epics of the chosen one", async () => {
    expect(await (await get("/api/intake/jira/filters")).json()).toEqual({
      projects: [
        { key: "P", name: "Project P" },
        { key: "Q", name: "Project Q" },
      ],
      epics: [],
    });
    await get("/api/intake/jira/filters?project=P");
    const sent = jira.requests.map((r) => decodeURIComponent(r.path)).find((p) => p.includes("issuetype = Epic"));
    expect(sent).toContain('project = "P" AND issuetype = Epic AND statusCategory != Done');
  });

  it("refuses a project key that is not one", async () => {
    const res = await get("/api/intake/jira/filters?project=P%22%20OR%201%3D1");
    expect(res.status).toBe(400);
  });
});

describe("intake search", () => {
  it("returns GitHub candidates with trust and the ticket already holding one, importing nothing", async () => {
    const held = await createTicket(db, { projectId, type: "feature", title: "x", spec: "", status: "backlog" });
    await updateTicket(db, held.id, { externalRef: { tracker: "github", key: "acme/shop#1", url: "u" } }, "board");
    const res = await post("/api/intake/search", { source: "github", query: "sort:updated", labels: ["roadmap", "good first issue"], milestone: "v1" });
    expect(res.status).toBe(200);
    const { candidates } = (await res.json()) as { candidates: Array<Record<string, unknown>> };
    expect(searched).toEqual(['sort:updated label:"roadmap" label:"good first issue" milestone:"v1"']);
    expect(candidates).toMatchObject([
      { source: "github", key: "acme/shop#1", trusted: true, ticketId: held.id },
      { source: "github", key: "acme/shop#2", trusted: false, author: "stranger" },
    ]);
    expect(candidates[1]).not.toHaveProperty("ticketId");
    expect(imports).toEqual([]);
  });

  it("builds JQL from the Jira pickers, with every value quoted", async () => {
    const res = await post("/api/intake/search", { source: "jira", project: "P", text: 'say "hi" \\ bye' });
    expect(res.status).toBe(200);
    const { candidates } = (await res.json()) as { candidates: Array<{ key: string }> };
    expect(candidates.map((c) => c.key).sort()).toEqual(["P-1", "P-2"]);
    const sent = decodeURIComponent(jira.requests.at(-1)!.path);
    expect(sent).toContain('project = "P" AND issuetype != Epic AND statusCategory != Done AND text ~ "say \\"hi\\" \\\\ bye" ORDER BY created DESC');
  });

  it("refuses an unbounded Jira search and a malformed epic", async () => {
    expect((await post("/api/intake/search", { source: "jira" })).status).toBe(400);
    expect((await post("/api/intake/search", { source: "jira", epic: 'P-1" OR project = Q' })).status).toBe(400);
  });
});

describe("intake import, one issue per request", () => {
  it("imports a trusted GitHub issue and links its tickets", async () => {
    const res = await post("/api/intake/import", { source: "github", key: "acme/shop#1" });
    expect(res.status).toBe(201);
    const r = (await res.json()) as { status: string; ticketIds: string[] };
    expect(r.status).toBe("imported");
    expect((await getTicket(db, r.ticketIds[0]!))!.externalRef).toMatchObject({ tracker: "github", key: "acme/shop#1" });
  });

  it("skips an untrusted author unless anyAuthor", async () => {
    expect(await (await post("/api/intake/import", { source: "github", key: "acme/shop#2" })).json()).toMatchObject({ status: "skipped" });
    expect(await (await post("/api/intake/import", { source: "github", key: "acme/shop#2", anyAuthor: true })).json()).toMatchObject({ status: "imported" });
  });

  it("refuses an issue from another repository", async () => {
    const res = await post("/api/intake/import", { source: "github", key: "evil/repo#1" });
    expect(res.status).toBe(400);
    expect(imports).toEqual([]);
  });

  it("imports a Jira issue by key", async () => {
    const res = await post("/api/intake/import", { source: "jira", key: "P-2" });
    expect(await res.json()).toMatchObject({ key: "P-2", status: "imported" });
    expect(imports).toEqual(["Fix login"]);
  });
});

describe("query builders", () => {
  it("passes raw JQL as typed", () => {
    expect(jiraQueryToJql({ jql: " project = X ORDER BY rank " })).toBe("project = X ORDER BY rank");
  });

  it("includes done issues only when asked, and scopes to an epic's children", () => {
    expect(jiraQueryToJql({ epic: "P-1", includeDone: true })).toBe('parent = "P-1" AND issuetype != Epic ORDER BY created DESC');
  });

  it("refuses GitHub labels with quotes, which search syntax cannot escape", () => {
    expect(() => githubQueryToSearch({ labels: ['x" repo:other/repo'] })).toThrow(IntakeError);
  });
});
