import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addKnowledge,
  archiveKnowledge,
  createEnvironment,
  createProject,
  knowledgeDigest,
  openDb,
  recentAudit,
  searchKnowledge,
  updateKnowledge,
  type Db,
} from "../src/index.ts";

let db: Db;
let close: () => Promise<void>;
let env: string;
let web: string;
let api: string;

beforeEach(async () => {
  ({ db, close } = await openDb());
  env = (await createEnvironment(db, { name: "work", rootPath: "/w" })).id;
  web = (await createProject(db, { name: "web", repoPath: "/w/web", environmentId: env })).id;
  api = (await createProject(db, { name: "api", repoPath: "/w/api", environmentId: env })).id;
});
afterEach(() => close());

const add = (title: string, extra: Partial<Parameters<typeof addKnowledge>[1]> = {}) =>
  addKnowledge(db, { environmentId: env, kind: "gotcha", title, abstract: `${title} abstract`, ...extra }, "agent:chief");

describe("knowledge", () => {
  it("searches full text within the environment", async () => {
    await add("Install dependencies offline", { body: "pnpm install --prefer-offline inside worktrees" });
    await add("Gates take two minutes");
    const hits = await searchKnowledge(db, { environmentId: env, text: "prefer-offline install" });
    expect(hits.map((h) => h.title)).toEqual(["Install dependencies offline"]);
  });

  it("returns environment-wide entries plus the project's own, never another project's", async () => {
    await add("Shared convention");
    await add("Web only", { projectId: web });
    await add("API only", { projectId: api });
    const titles = (await searchKnowledge(db, { environmentId: env, projectId: web })).map((h) => h.title).sort();
    expect(titles).toEqual(["Shared convention", "Web only"]);
  });

  it("ranks entries about the touched area first", async () => {
    await add("General");
    await add("Board quirks", { projectId: web, area: "apps/web/src/features/board/" });
    const hits = await searchKnowledge(db, { environmentId: env, projectId: web, paths: ["apps/web/src/features/board/card.tsx"] });
    expect(hits[0]!.title).toBe("Board quirks");
  });

  it("hides archived entries and versions updates", async () => {
    const e = await add("Old fact");
    const updated = await updateKnowledge(db, e.id, { abstract: "corrected" }, "agent:chief");
    expect(updated.version).toBe(2);
    expect((await updateKnowledge(db, e.id, { pinned: 1 }, "board")).version).toBe(2);
    await archiveKnowledge(db, e.id, "superseded", "agent:chief");
    expect(await searchKnowledge(db, { environmentId: env })).toHaveLength(0);
    expect((await recentAudit(db, 20)).map((a) => a.kind)).toContain("knowledge.archived");
  });

  it("redacts secrets and builds a compact digest", async () => {
    const e = await add("Token handling", { body: "API_KEY=hunter2 lives in the vault" });
    expect(e.body).not.toContain("hunter2");
    expect(knowledgeDigest([e])).toContain(`[gotcha] Token handling (${e.id})`);
  });
});
