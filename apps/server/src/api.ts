import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createProject,
  createTicket,
  dispatchEventsAfter,
  getDispatch,
  getTicket,
  listAgents,
  listProjects,
  listTickets,
  onAudit,
  onDispatchEvent,
  pendingApprovals,
  recentAudit,
  recentDispatches,
  REGIME_POLICIES,
  resolveApproval,
  saveAgent,
  snapshotHistory,
  TICKET_TYPES,
  updateProject,
  updateTicket,
  type Db,
  type Role,
} from "@temper/core";
import type { Config } from "./config.ts";
import type { Factory } from "./factory.ts";
import { readRegistry } from "./skills.ts";

const NewProject = z.object({
  name: z.string().min(1),
  repoPath: z.string().min(1),
  remoteUrl: z.string().optional(),
  holdoutsPath: z.string().optional(),
  defaultBranch: z.string().optional(),
  setupCommand: z.string().optional(),
  testCommand: z.string().optional(),
  appCommand: z.string().optional(),
  appHealthPath: z.string().optional(),
  holdoutsCommand: z.string().optional(),
  holdoutsSetupCommand: z.string().optional(),
});

const NewTicket = z.object({
  projectId: z.string(),
  type: z.enum(TICKET_TYPES),
  title: z.string().min(1),
  spec: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  fileScope: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  ready: z.boolean().default(false),
});

const AgentEdit = z.object({
  name: z.string().min(1),
  model: z.string().nullable(),
  skills: z.array(z.string()),
  permissions: z.object({ allowedTools: z.array(z.string()), disallowedTools: z.array(z.string()) }),
  maxConcurrency: z.number().int().min(0).max(8),
  runsPerHour: z.number().int().min(0).max(120),
  instructions: z.string(),
});

export function createApi(db: Db, factory: Factory, config: Config): Hono {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, err instanceof z.ZodError ? 400 : 500));

  app.get("/api/status", async (c) => {
    const [latest] = await snapshotHistory(db, 1);
    return c.json({ ...factory.status(), temperature: latest ?? null, instance: config.instance, pendingApprovals: (await pendingApprovals(db)).length });
  });
  app.post("/api/pause", async (c) => (await factory.setPaused(true), c.json({ ok: true })));
  app.post("/api/resume", async (c) => (await factory.setPaused(false), c.json({ ok: true })));

  app.get("/api/projects", async (c) => c.json(await listProjects(db)));
  app.post("/api/projects", async (c) => c.json(await createProject(db, NewProject.parse(await c.req.json())), 201));
  app.patch("/api/projects/:id", async (c) => c.json(await updateProject(db, c.req.param("id"), NewProject.partial().parse(await c.req.json()))));

  app.get("/api/tickets", async (c) => c.json(await listTickets(db, c.req.query("projectId"))));
  app.post("/api/tickets", async (c) => {
    const { ready, acceptanceCriteria, ...t } = NewTicket.parse(await c.req.json());
    const ticket = await createTicket(db, {
      ...t,
      acceptanceCriteria: acceptanceCriteria.map((text, i) => ({ id: `AC-${i + 1}`, text })),
      status: ready ? "ready" : "backlog",
    });
    if (ready) void factory.tick();
    return c.json(ticket, 201);
  });
  app.get("/api/tickets/:id", async (c) => {
    const detail = await factory.ticketDetail(c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/tickets/:id/start", async (c) => {
    const t = await getTicket(db, c.req.param("id"));
    if (!t || t.status !== "backlog") return c.json({ error: "only backlog tickets can be started" }, 409);
    const updated = await updateTicket(db, t.id, { status: "ready" }, "board");
    void factory.tick();
    return c.json(updated);
  });
  app.post("/api/tickets/:id/cancel", async (c) => (await factory.cancelTicket(c.req.param("id")), c.json({ ok: true })));
  app.post("/api/tickets/:id/escape", async (c) => {
    const { description } = z.object({ description: z.string().min(1) }).parse(await c.req.json());
    return c.json(await factory.reportEscape(c.req.param("id"), description), 201);
  });

  app.post("/api/specs/import", async (c) => {
    const body = z
      .object({ projectId: z.string(), title: z.string().min(1), markdown: z.string().min(1), autoStart: z.boolean().default(false) })
      .parse(await c.req.json());
    return c.json(await factory.importSpec(body.projectId, body.title, body.markdown, body.autoStart), 201);
  });

  app.get("/api/dispatches", async (c) => c.json(await recentDispatches(db, Number(c.req.query("limit") ?? 50))));
  app.get("/api/dispatches/:id", async (c) => {
    const d = await getDispatch(db, c.req.param("id"));
    return d ? c.json(d) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/dispatches/:id/events", async (c) => c.json(await dispatchEventsAfter(db, c.req.param("id"), Number(c.req.query("after") ?? 0))));

  app.get("/api/approvals", async (c) => c.json(await pendingApprovals(db)));
  app.post("/api/approvals/:id/resolve", async (c) => {
    const { resolution, note } = z.object({ resolution: z.string(), note: z.string().optional() }).parse(await c.req.json());
    const approval = await resolveApproval(db, c.req.param("id"), resolution, note);
    await factory.onApprovalResolved(approval);
    return c.json(approval);
  });

  app.get("/api/agents", async (c) => {
    const agents = await listAgents(db);
    // The version the dispatcher actually runs (a Verifier edit waits for board approval).
    return c.json(await Promise.all(agents.map(async (a) => ({ ...a, approvedVersion: (await factory.agentFor(a.role as Role)).version }))));
  });
  app.put("/api/agents/:id", async (c) => {
    const current = (await listAgents(db)).find((a) => a.id === c.req.param("id"));
    if (!current) return c.json({ error: "not found" }, 404);
    const edit = AgentEdit.parse(await c.req.json());
    return c.json(await saveAgent(db, { id: current.id, role: current.role, adapter: current.adapter, ...edit }));
  });

  app.get("/api/temperature", async (c) => c.json({ history: await snapshotHistory(db, 200), policies: REGIME_POLICIES, enforced: false }));
  app.get("/api/skills", (c) => c.json(readRegistry(config.appRoot)));
  app.get("/api/audit", async (c) => c.json(await recentAudit(db, Number(c.req.query("limit") ?? 100))));

  app.get("/api/stream", (c) =>
    streamSSE(c, async (stream) => {
      const dispatchFilter = c.req.query("dispatch");
      const queue: Array<{ event: string; data: string }> = [];
      let wake: (() => void) | undefined;
      const push = (event: string, data: unknown) => {
        queue.push({ event, data: JSON.stringify(data) });
        wake?.();
      };
      const offAudit = onAudit((e) => push("audit", e));
      // Agent output is high-volume: only streamed to clients following a specific dispatch.
      const offEvents = onDispatchEvent((e) => dispatchFilter !== undefined && e.dispatchId === dispatchFilter && push("dispatch_event", e));
      const onChange = () => push("change", {});
      factory.on("change", onChange);
      stream.onAbort(() => {
        offAudit();
        offEvents();
        factory.off("change", onChange);
        wake?.();
      });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE(queue.shift()!);
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(25_000)]);
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    }),
  );

  const dist = join(config.appRoot, "apps", "web", "dist");
  if (existsSync(dist)) {
    app.use("/*", serveStatic({ root: dist }));
    app.get("*", serveStatic({ path: join(dist, "index.html") }));
  }
  return app;
}
