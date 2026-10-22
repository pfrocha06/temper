import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEnvironment, createProject, openDb, seedAgents, type Db } from "@temper/core";
import { createApi } from "../src/api.ts";
import { Auth } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";

let db: Db;
let close: () => Promise<void>;
let auth: Auth;
let app: ReturnType<typeof createApi>;
let env: string;
let project: string;

const fakeFactory = { tick: async () => {}, status: () => ({}), on: () => {}, off: () => {} } as unknown as Factory;
const H = { host: "127.0.0.1:4600" };

beforeEach(async () => {
  ({ db, close } = await openDb());
  await seedAgents(db);
  env = (await createEnvironment(db, { name: "e", rootPath: "/e" })).id;
  project = (await createProject(db, { name: "p", repoPath: "/e/p", environmentId: env })).id;
  auth = new Auth("board-secret", 4600);
  app = createApi(db, fakeFactory, loadConfig({ TEMPER_HOME: "/tmp/none" }), { auth });
});
afterEach(() => close());

describe("board auth", () => {
  it("rejects board routes without the token, allows health", async () => {
    expect((await app.request("/api/approvals", { headers: H })).status).toBe(401);
    expect((await app.request("/api/approvals/x/resolve", { method: "POST", headers: H })).status).toBe(401);
    expect((await app.request("/api/health", { headers: H })).status).toBe(200);
  });

  it("accepts the bearer token and sets a cookie through /auth", async () => {
    expect((await app.request("/api/projects", { headers: { ...H, authorization: "Bearer board-secret" } })).status).toBe(200);
    const res = await app.request("/auth?token=board-secret", { headers: H });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toMatch(/temper_board=board-secret; .*HttpOnly.*SameSite=Strict/i);
    expect((await app.request("/api/projects", { headers: { ...H, cookie: "temper_board=board-secret" } })).status).toBe(200);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    expect((await app.request("/api/health", { headers: { host: "evil.example:4600" } })).status).toBe(403);
  });

  it("does not let an agent capability act as the board", async () => {
    const cap = auth.issue({ role: "chief", environmentId: env });
    expect((await app.request("/api/approvals", { headers: { ...H, authorization: `Bearer ${cap}` } })).status).toBe(401);
  });
});

describe("agent API", () => {
  const as = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...H, authorization: `Bearer ${token}`, "content-type": "application/json" } });

  it("lets workers read knowledge but only the Chief write it or create tickets", async () => {
    const builder = auth.issue({ role: "builder", environmentId: env, projectId: project });
    const chief = auth.issue({ role: "chief", environmentId: env });
    const entry = { kind: "gotcha", title: "Install offline", abstract: "Use pnpm install --prefer-offline in worktrees." };
    expect((await app.request("/api/agent/knowledge", as(builder, { method: "POST", body: JSON.stringify(entry) }))).status).toBe(403);
    expect((await app.request("/api/agent/knowledge", as(chief, { method: "POST", body: JSON.stringify(entry) }))).status).toBe(201);
    const hits = (await (await app.request("/api/agent/knowledge/search", as(builder, { method: "POST", body: JSON.stringify({ query: "offline" }) }))).json()) as unknown[];
    expect(hits).toHaveLength(1);
    const ticket = { projectId: project, type: "chore", title: "Bump x", spec: "s", acceptanceCriteria: ["a"] };
    expect((await app.request("/api/agent/tickets", as(builder, { method: "POST", body: JSON.stringify(ticket) }))).status).toBe(403);
    expect((await app.request("/api/agent/tickets", as(chief, { method: "POST", body: JSON.stringify(ticket) }))).status).toBe(201);
  });

  it("rejects revoked and unknown capabilities", async () => {
    const cap = auth.issue({ role: "builder", environmentId: env });
    auth.revoke(cap);
    expect((await app.request("/api/agent/whoami", as(cap))).status).toBe(401);
    expect((await app.request("/api/agent/whoami", as("cap_nope"))).status).toBe(401);
  });
});

describe("provider caps", () => {
  it("validates and stores caps per provider", async () => {
    const H2 = { ...H, authorization: "Bearer board-secret", "content-type": "application/json" };
    expect((await app.request("/api/providers/claude-cli/caps", { method: "PUT", headers: H2, body: JSON.stringify({ runsPerSession: -1 }) })).status).toBe(400);
    expect((await app.request("/api/providers/claude-cli/caps", { method: "PUT", headers: H2, body: JSON.stringify({ unknown: 1 }) })).status).toBe(400);
    const ok = await app.request("/api/providers/claude-cli/caps", { method: "PUT", headers: H2, body: JSON.stringify({ runsPerSession: 20, sessionHours: 5 }) });
    expect(await ok.json()).toEqual({ runsPerSession: 20, sessionHours: 5 });
  });
});

describe("Chief operator tools", () => {
  const as = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...H, authorization: `Bearer ${token}`, "content-type": "application/json" } });

  it("can only propose board decisions; the board's confirm executes them", async () => {
    const { requestApproval, getApproval } = await import("@temper/core");
    const merge = await requestApproval(db, { kind: "merge", title: "Merge: x", options: ["approve", "reject"] });
    const chief = auth.issue({ role: "chief", environmentId: env, chatId: "chat_1" });
    const builder = auth.issue({ role: "builder", environmentId: env });

    // No agent route resolves approvals directly.
    expect((await app.request(`/api/approvals/${merge.id}/resolve`, as(chief, { method: "POST", body: JSON.stringify({ resolution: "approve" }) }))).status).toBe(401);
    // Workers cannot propose.
    expect((await app.request("/api/agent/proposals", as(builder, { method: "POST", body: JSON.stringify({ action: "resolve_approval", approvalId: merge.id, resolution: "approve", reason: "gates passed" }) }))).status).toBe(403);
    // Invalid resolution is refused.
    expect((await app.request("/api/agent/proposals", as(chief, { method: "POST", body: JSON.stringify({ action: "resolve_approval", approvalId: merge.id, resolution: "yolo", reason: "x" }) }))).status).toBe(400);

    const res = await app.request("/api/agent/proposals", as(chief, { method: "POST", body: JSON.stringify({ action: "resolve_approval", approvalId: merge.id, resolution: "reject", reason: "spec unclear" }) }));
    expect(res.status).toBe(201);
    const proposalId = ((await res.json()) as { id: string }).id;
    expect((await getApproval(db, merge.id))!.status).toBe("pending");
    const proposal = (await getApproval(db, proposalId))!;
    expect(proposal).toMatchObject({ kind: "proposal", chatId: "chat_1" });
  });
});
