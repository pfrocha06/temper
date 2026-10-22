import { Hono } from "hono";
import { z } from "zod";
import {
  addKnowledge,
  archiveKnowledge,
  createProject,
  createTicket,
  getApproval,
  getTicket,
  pendingApprovals,
  requestApproval,
  getKnowledge,
  getProject,
  KNOWLEDGE_KINDS,
  listProjects,
  listTickets,
  recordKnowledgeReads,
  searchKnowledge,
  TICKET_TYPES,
  updateKnowledge,
  type Db,
} from "@temper/core";
import type { Auth, Capability } from "./auth.ts";
import type { Factory } from "./factory.ts";

type Env = { Variables: { cap: Capability } };

const chiefOnly = (cap: Capability) => {
  if (cap.role !== "chief") throw Object.assign(new Error("only the Chief of Staff may do this"), { status: 403 });
};

/**
 * The API agents reach through the temper MCP server. Everything is scoped to the run's
 * environment; writes and delegation are reserved to the Chief of Staff.
 */
export function createAgentApi(db: Db, auth: Auth, factory: Factory): Hono<Env> {
  const onTicketsChanged = () => void factory.tick();
  const app = new Hono<Env>();
  app.use("*", auth.agent());
  app.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? (err instanceof z.ZodError ? 400 : 500)) as 400));

  const actor = (cap: Capability) => `agent:${cap.role}` as const;
  const envProjects = async (cap: Capability) => (await listProjects(db)).filter((p) => p.environmentId === cap.environmentId);

  app.get("/whoami", (c) => {
    const { role, environmentId, projectId } = c.get("cap");
    return c.json({ role, environmentId, projectId });
  });

  app.post("/knowledge/search", async (c) => {
    const cap = c.get("cap");
    const q = z
      .object({ query: z.string().optional(), kinds: z.array(z.enum(KNOWLEDGE_KINDS)).optional(), limit: z.number().int().min(1).max(50).optional() })
      .parse(await c.req.json());
    const hits = await searchKnowledge(db, { environmentId: cap.environmentId, projectId: cap.projectId, text: q.query, kinds: q.kinds, limit: q.limit ?? 20 });
    await recordKnowledgeReads(db, hits.map((h) => h.id), "search", cap.dispatchId);
    return c.json(hits.map(({ id, kind, title, abstract, area, projectId, updatedAt }) => ({ id, kind, title, abstract, area, projectId, updatedAt })));
  });

  app.get("/knowledge/:id", async (c) => {
    const cap = c.get("cap");
    const e = await getKnowledge(db, c.req.param("id"));
    if (!e || e.environmentId !== cap.environmentId) return c.json({ error: "not found" }, 404);
    await recordKnowledgeReads(db, [e.id], "get", cap.dispatchId);
    return c.json(e);
  });

  app.post("/knowledge", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const body = z
      .object({
        kind: z.enum(KNOWLEDGE_KINDS),
        title: z.string().min(3),
        abstract: z.string().min(10),
        body: z.string().optional(),
        projectId: z.string().optional(),
        area: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(await c.req.json());
    if (body.projectId && !(await envProjects(cap)).some((p) => p.id === body.projectId)) return c.json({ error: "project not in this environment" }, 400);
    return c.json(await addKnowledge(db, { ...body, environmentId: cap.environmentId, source: cap.dispatchId ?? "chief" }, actor(cap)), 201);
  });

  app.patch("/knowledge/:id", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const e = await getKnowledge(db, c.req.param("id"));
    if (!e || e.environmentId !== cap.environmentId) return c.json({ error: "not found" }, 404);
    const patch = z
      .object({ title: z.string().optional(), abstract: z.string().optional(), body: z.string().optional(), kind: z.enum(KNOWLEDGE_KINDS).optional(), area: z.string().optional(), tags: z.array(z.string()).optional() })
      .parse(await c.req.json());
    return c.json(await updateKnowledge(db, e.id, patch, actor(cap)));
  });

  app.post("/knowledge/:id/archive", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const e = await getKnowledge(db, c.req.param("id"));
    if (!e || e.environmentId !== cap.environmentId) return c.json({ error: "not found" }, 404);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(await c.req.json());
    return c.json(await archiveKnowledge(db, e.id, reason, actor(cap)));
  });

  app.get("/projects", async (c) => {
    chiefOnly(c.get("cap"));
    return c.json((await envProjects(c.get("cap"))).map(({ id, name, repoPath, defaultBranch }) => ({ id, name, repoPath, defaultBranch })));
  });

  app.get("/tickets", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const ids = new Set((await envProjects(cap)).map((p) => p.id));
    const projectId = c.req.query("projectId");
    const rows = (await listTickets(db)).filter((t) => ids.has(t.projectId) && (!projectId || t.projectId === projectId));
    return c.json(rows.map(({ id, projectId, type, title, status, stage, dependsOn, prUrl }) => ({ id, projectId, type, title, status, stage, dependsOn, prUrl })));
  });

  app.post("/tickets", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const t = z
      .object({
        projectId: z.string(),
        type: z.enum(TICKET_TYPES),
        title: z.string().min(3),
        spec: z.string(),
        acceptanceCriteria: z.array(z.string()).min(1),
        fileScope: z.array(z.string()).default([]),
        dependsOn: z.array(z.string()).default([]),
        start: z.boolean().default(false),
      })
      .parse(await c.req.json());
    const project = await getProject(db, t.projectId);
    if (!project || project.environmentId !== cap.environmentId) return c.json({ error: "project not in this environment" }, 400);
    const { start, acceptanceCriteria, ...rest } = t;
    const ticket = await createTicket(
      db,
      { ...rest, acceptanceCriteria: acceptanceCriteria.map((text, i) => ({ id: `AC-${i + 1}`, text })), status: start ? "ready" : "backlog" },
      actor(cap),
    );
    onTicketsChanged();
    return c.json(ticket, 201);
  });

  // ── operator tools (Chief only). Board decisions are proposals the board confirms. ──

  const ticketInEnv = async (cap: Capability, id: string) => {
    const t = await getTicket(db, id);
    const p = t && (await getProject(db, t.projectId));
    if (!t || !p || (p.environmentId ?? "env_default") !== cap.environmentId) throw Object.assign(new Error("ticket not in this environment"), { status: 404 });
    return t;
  };
  const operator = (cap: Capability) => actor(cap);

  app.post("/tickets/:id/start", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    await ticketInEnv(cap, c.req.param("id"));
    return c.json(await factory.startTicket(c.req.param("id"), operator(cap)));
  });
  app.post("/tickets/:id/cancel", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    await ticketInEnv(cap, c.req.param("id"));
    await factory.cancelTicket(c.req.param("id"), operator(cap));
    return c.json({ ok: true });
  });
  app.post("/tickets/:id/retry", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    await ticketInEnv(cap, c.req.param("id"));
    await factory.retryTicket(c.req.param("id"), operator(cap));
    return c.json({ ok: true });
  });
  app.post("/tickets/:id/digest", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    await ticketInEnv(cap, c.req.param("id"));
    void factory.digestTicket(c.req.param("id"));
    return c.json({ ok: true }, 202);
  });
  app.post("/factory/:state{pause|resume}", async (c) => {
    chiefOnly(c.get("cap"));
    await factory.setPaused(c.req.param("state") === "pause", operator(c.get("cap")));
    return c.json({ ok: true });
  });
  app.post("/projects", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const body = z
      .object({ name: z.string().min(1), repoPath: z.string().min(1), remoteUrl: z.string().optional(), defaultBranch: z.string().optional(), setupCommand: z.string().optional(), testCommand: z.string().optional() })
      .parse(await c.req.json());
    return c.json(await createProject(db, { ...body, environmentId: cap.environmentId }), 201);
  });
  app.get("/approvals", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const ids = new Set((await envProjects(cap)).map((p) => p.id));
    const tickets = new Map((await listTickets(db)).map((t) => [t.id, t]));
    const rows = (await pendingApprovals(db)).filter((a) => !a.ticketId || ids.has(tickets.get(a.ticketId)?.projectId ?? ""));
    return c.json(rows.map(({ id, kind, title, ticketId, options, createdAt }) => ({ id, kind, title, ticketId, options, createdAt })));
  });
  app.post("/proposals", async (c) => {
    const cap = c.get("cap");
    chiefOnly(cap);
    const body = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("resolve_approval"), approvalId: z.string(), resolution: z.string(), reason: z.string().min(3) }),
        z.object({ action: z.literal("deploy"), ref: z.string().default("main"), source: z.string(), reason: z.string().min(3) }),
      ])
      .parse(await c.req.json());
    let title: string;
    if (body.action === "resolve_approval") {
      const target = await getApproval(db, body.approvalId);
      if (!target || target.status !== "pending") return c.json({ error: "no such pending approval" }, 404);
      if (target.kind === "proposal") return c.json({ error: "cannot propose to resolve a proposal" }, 400);
      if (!target.options.includes(body.resolution)) return c.json({ error: `resolution must be one of ${target.options.join(", ")}` }, 400);
      title = `Chief proposes: ${body.resolution} — ${target.title}`;
    } else {
      if (!(await envProjects(cap)).some((p) => p.repoPath === body.source)) return c.json({ error: "source must be a project in this environment" }, 400);
      title = `Chief proposes: deploy ${body.ref} from ${body.source}`;
    }
    const { reason, ...payload } = body;
    const proposal = await requestApproval(db, { kind: "proposal", title, body: reason, payload, chatId: cap.chatId, options: ["confirm", "decline"] });
    onTicketsChanged();
    return c.json({ id: proposal.id, title, status: "waiting for the board" }, 201);
  });

  return app;
}
