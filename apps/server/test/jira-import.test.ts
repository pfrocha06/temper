import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createTicket, openDb, recentAudit, updateTicket, type Db } from "@temper/core";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";
import type { Profile } from "../src/profile.ts";
import { startFakeJira, type FakeJira } from "../../../plugins/jira/test/fake-jira.ts";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const h = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });

let db: Db;
let close: () => Promise<void>;
let jira: FakeJira;
let projectId: string;
let app: ReturnType<typeof createApi>;
let imports: { title: string; markdown: string; autoStart: boolean }[];
let ticks: number;
let profile: Profile;

beforeEach(async () => {
  ({ db, close } = await openDb());
  projectId = (await createProject(db, { name: "p", repoPath: "/e/p" })).id;
  jira = await startFakeJira({
    issues: [
      { key: "P-1", summary: "Add export", description: doc(p("Users need CSV export."), h("Acceptance criteria"), p("Export downloads a file.")) },
      { key: "P-2", summary: "Fix login", description: doc(p("Login 500s.")) },
    ],
    email: "a@b.test",
    token: "tok",
  });
  const home = mkdtempSync(join(tmpdir(), "jira-import-"));
  const config = loadConfig({ TEMPER_HOME: home });
  mkdirSync(config.secretsDir, { recursive: true });
  writeFileSync(join(config.secretsDir, "jira-token"), "tok\n");
  profile = { mcpServers: {}, trackers: { jira: { baseUrl: jira.url, email: "a@b.test", tokenSecret: "jira-token" } } } as unknown as Profile;
  imports = [];
  ticks = 0;
  const factory = {
    tick: async () => void ticks++,
    status: () => ({}),
    on: () => {},
    off: () => {},
    importSpec: async (pid: string, title: string, markdown: string, autoStart: boolean) => {
      imports.push({ title, markdown, autoStart });
      return [await createTicket(db, { projectId: pid, type: "feature", title, spec: markdown, status: "backlog" })];
    },
  } as unknown as Factory;
  app = createApi(db, factory, config, { profile });
});
afterEach(async () => {
  await jira.close();
  await close();
});

const run = (body: Record<string, unknown>) =>
  app.request("/api/jira/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, ...body }) });
type Result = { results: { key: string; status: string; ticketIds: string[]; existingTicketId?: string }[] };

describe("jira import", () => {
  it("AC-1: imports an issue with summary, description and a link on each ticket", async () => {
    const res = await run({ issue: "P-1" });
    expect(res.status).toBe(201);
    const { results } = (await res.json()) as Result;
    expect(results[0]).toMatchObject({ key: "P-1", status: "imported" });
    expect(imports[0]!.markdown).toContain("Add export");
    expect(imports[0]!.markdown).toContain("Users need CSV export.");
    expect(imports[0]!.markdown).toContain("Acceptance criteria");
    expect(imports[0]!.markdown).toContain("Export downloads a file.");
    const t = await (await import("@temper/core")).getTicket(db, results[0]!.ticketIds[0]!);
    expect(t!.externalRef).toEqual({ tracker: "jira", key: "P-1", url: `${jira.url}/browse/P-1` });
    expect((await recentAudit(db)).some((e) => e.kind === "jira.imported" && e.subject === "P-1")).toBe(true);
  });

  it("AC-2: skips an issue that already has an open ticket", async () => {
    const first = (await (await run({ issue: "P-1" })).json()) as Result;
    const again = (await (await run({ issue: "P-1" })).json()) as Result;
    expect(again.results[0]).toMatchObject({ key: "P-1", status: "skipped", existingTicketId: first.results[0]!.ticketIds[0], ticketIds: [] });
    expect(imports).toHaveLength(1);
    await updateTicket(db, first.results[0]!.ticketIds[0]!, { status: "done" });
    expect(((await (await run({ issue: "P-1" })).json()) as Result).results[0]!.status).toBe("imported");
  });

  it("AC-3: --jql imports every match and --start starts the tickets", async () => {
    const { results } = (await (await run({ jql: "project = P", start: true })).json()) as Result;
    expect(results.map((r) => r.key).sort()).toEqual(["P-1", "P-2"]);
    expect(imports).toHaveLength(2);
    const { getTicket } = await import("@temper/core");
    for (const r of results) expect((await getTicket(db, r.ticketIds[0]!))!.status).toBe("ready");
    expect(ticks).toBeGreaterThan(0);
  });

  it("AC-4: without trackers.jira it fails with a configuration error", async () => {
    const config = loadConfig({ TEMPER_HOME: "/tmp/none" });
    const bare = createApi(db, { tick: async () => {}, status: () => ({}), on: () => {}, off: () => {} } as unknown as Factory, config, { profile: { mcpServers: {} } as Profile });
    const res = await bare.request("/api/jira/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, issue: "P-1" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/trackers\.jira/);
  });

  it("requires exactly one of issue or jql", async () => {
    expect((await run({})).status).toBe(400);
    expect((await run({ issue: "P-1", jql: "project = P" })).status).toBe(400);
  });
});
