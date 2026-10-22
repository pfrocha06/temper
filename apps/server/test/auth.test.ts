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
