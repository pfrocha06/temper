import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimTicket,
  createProject,
  createTicket,
  dispatchableTickets,
  listAgents,
  openDb,
  pendingApprovals,
  requestApproval,
  resolveApproval,
  saveAgent,
  seedAgents,
  scopesOverlap,
  updateTicket,
  type Db,
} from "../src/index.ts";
import { auditEvents } from "../src/db/schema.ts";

let db: Db;
let close: () => Promise<void>;
let projectId: string;

beforeEach(async () => {
  ({ db, close } = await openDb());
  projectId = (await createProject(db, { name: "temper", repoPath: "/tmp/temper" })).id;
});
afterEach(() => close());

describe("audit log", () => {
  it("rejects updates and deletes", async () => {
    await expect(db.update(auditEvents).set({ kind: "tampered" })).rejects.toThrow();
    await expect(db.delete(auditEvents)).rejects.toThrow();
  });

  it("redacts secrets on write", async () => {
    await createTicket(db, { projectId, type: "chore", title: "API_KEY=hunter2 leaked" });
    const rows = await db.select().from(auditEvents);
    expect(JSON.stringify(rows)).not.toContain("hunter2");
  });
});

describe("dispatch", () => {
  it("claims a ready ticket exactly once", async () => {
    const t = await createTicket(db, { projectId, type: "feature", title: "x", status: "ready" });
    const results = await Promise.all([claimTicket(db, t.id, "build"), claimTicket(db, t.id, "build")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("waits for dependencies to be done", async () => {
    const dep = await createTicket(db, { projectId, type: "feature", title: "dep", status: "ready" });
    const t = await createTicket(db, { projectId, type: "feature", title: "t", status: "ready", dependsOn: [dep.id] });
    expect((await dispatchableTickets(db)).map((x) => x.id)).toEqual([dep.id]);
    await updateTicket(db, dep.id, { status: "done" });
    expect((await dispatchableTickets(db)).map((x) => x.id)).toEqual([t.id]);
  });

  it("holds back tickets whose file scope overlaps in-progress work", async () => {
    await createTicket(db, { projectId, type: "feature", title: "a", status: "in_progress", fileScope: ["apps/web/src/*"] });
    await createTicket(db, { projectId, type: "feature", title: "b", status: "ready", fileScope: ["apps/web/src/board/*"] });
    const c = await createTicket(db, { projectId, type: "feature", title: "c", status: "ready", fileScope: ["packages/core/*"] });
    expect((await dispatchableTickets(db)).map((x) => x.id)).toEqual([c.id]);
  });

  it("detects scope overlap by prefix", () => {
    expect(scopesOverlap(["a/b/*"], ["a/*"])).toBe(true);
    expect(scopesOverlap(["a/b"], ["c/d"])).toBe(false);
  });
});

describe("agents", () => {
  it("seeds four roles and versions edits", async () => {
    await seedAgents(db);
    const all = await listAgents(db);
    expect(all.map((a) => a.role).sort()).toEqual(["builder", "chief", "reviewer", "verifier"]);
    const builder = all.find((a) => a.id === "builder")!;
    const v2 = await saveAgent(db, { ...builder, model: "opus" });
    expect(v2.version).toBe(2);
  });

  it("gates verifier changes behind the board", async () => {
    await seedAgents(db);
    const verifier = (await listAgents(db)).find((a) => a.id === "verifier")!;
    await saveAgent(db, { ...verifier, model: "sonnet" });
    expect((await pendingApprovals(db)).map((a) => a.kind)).toContain("agent_change");
  });
});

describe("approvals", () => {
  it("resolves once, with an allowed option", async () => {
    const a = await requestApproval(db, { kind: "merge", title: "merge?" });
    await expect(resolveApproval(db, a.id, "maybe")).rejects.toThrow(/not one of/);
    await resolveApproval(db, a.id, "approve");
    await expect(resolveApproval(db, a.id, "approve")).rejects.toThrow(/already resolved/);
  });
});
