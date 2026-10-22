import { Hono } from "hono";
import { z } from "zod";
import {
  addKnowledge,
  archiveKnowledge,
  createTicket,
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

type Env = { Variables: { cap: Capability } };

const chiefOnly = (cap: Capability) => {
  if (cap.role !== "chief") throw Object.assign(new Error("only the Chief of Staff may do this"), { status: 403 });
};

/**
 * The API agents reach through the temper MCP server. Everything is scoped to the run's
 * environment; writes and delegation are reserved to the Chief of Staff.
 */
export function createAgentApi(db: Db, auth: Auth, onTicketsChanged: () => void): Hono<Env> {
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

  return app;
}
