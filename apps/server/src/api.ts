import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  audit,
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
  addKnowledge,
  chatHistory,
  createChat,
  createEnvironment,
  getChat,
  getKnowledge,
  KNOWLEDGE_KINDS,
  knowledgeReadsFor,
  listChats,
  listEnvironments,
  searchKnowledge,
  setCaps,
  updateKnowledge,
  usageReport,
  type Db,
  type Role,
} from "@temper/core";
import type { Config } from "./config.ts";
import { defaultHoldoutsPath, initHoldouts, STARTER_HOLDOUTS_COMMAND } from "./holdouts.ts";
import type { Factory } from "./factory.ts";
import { setCookie } from "hono/cookie";
import { createAgentApi } from "./agent-api.ts";
import { BOARD_COOKIE, type Auth } from "./auth.ts";
import { createHealth } from "./health.ts";
import { GithubImportError, importFromGithub } from "./github-import.ts";
import { importFromJira, JiraImportError } from "./jira-import.ts";
import { githubFilters, importOne, IntakeError, intakeSources, jiraFilters, searchIntake, type IntakeDeps } from "./intake.ts";
import { JiraError } from "../../../plugins/jira/src/index.ts";
import { UpdateError, type Updater } from "./updates.ts";
import { loadProfile, type Profile } from "./profile.ts";
import { listProviders } from "./providers.ts";
import { inventory } from "./tools.ts";
import { readRegistry } from "./skills.ts";

const NewProject = z.object({
  name: z.string().min(1),
  environmentId: z.string().optional(),
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
  externalRef: z.object({ tracker: z.string().min(1), key: z.string().min(1), url: z.url({ protocol: /^https?$/ }) }).optional(),
  ready: z.boolean().default(false),
});

const AgentEdit = z.object({
  name: z.string().min(1),
  /** Which agent CLI runs this role; must be one the server has (the profile enables). */
  adapter: z.string().optional(),
  model: z.string().nullable(),
  skills: z.array(z.string()),
  mcpServers: z.array(z.string()).optional(),
  permissions: z.object({ allowedTools: z.array(z.string()), disallowedTools: z.array(z.string()) }),
  maxConcurrency: z.number().int().min(0).max(8),
  runsPerHour: z.number().int().min(0).max(120),
  instructions: z.string(),
});

export function createApi(db: Db, factory: Factory, config: Config, opts: { uptime?: () => number; auth?: Auth; profile?: Profile; intake?: Pick<IntakeDeps, "issues" | "repoFilters" | "fetchFn">; updater?: Updater } = {}): Hono {
  const app = new Hono();
  const health = createHealth(config, opts.uptime);
  const auth = opts.auth;

  if (auth) {
    app.use("*", auth.hostGuard());
    // `temper open` sends the board here once; the token becomes an HttpOnly, same-site cookie.
    app.get("/auth", (c) => {
      if (!auth.isBoard(c.req.query("token"))) return c.text("invalid token", 401);
      setCookie(c, BOARD_COOKIE, auth.boardToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 365 * 86_400 });
      return c.redirect("/");
    });
    app.route("/api/agent", createAgentApi(db, auth, factory));
    const board = auth.board();
    app.use("/api/*", async (c, next) => (c.req.path === "/api/health" || c.req.path.startsWith("/api/agent/") ? next() : board(c, next)));
  }

  app.onError((err, c) => c.json({ error: err.message }, err instanceof z.ZodError ? 400 : 500));

  app.get("/api/health", (c) => c.json(health()));

  app.get("/api/status", async (c) => {
    const [latest] = await snapshotHistory(db, 1);
    return c.json({ ...factory.status(), temperature: latest ?? null, instance: config.instance, pendingApprovals: (await pendingApprovals(db)).length });
  });
  app.post("/api/pause", async (c) => (await factory.setPaused(true), c.json({ ok: true })));
  app.post("/api/resume", async (c) => (await factory.setPaused(false), c.json({ ok: true })));

  app.get("/api/projects", async (c) => c.json(await listProjects(db)));
  app.post("/api/projects", async (c) => {
    const input = NewProject.parse(await c.req.json());
    // Every project gets a holdouts folder: the one named, or one Temper keeps, started from the template.
    const holdoutsPath = input.holdoutsPath ?? defaultHoldoutsPath(config.home, input.name);
    let created: boolean;
    try {
      ({ created } = await initHoldouts(holdoutsPath, join(config.appRoot, "templates", "holdouts")));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    const holdoutsCommand = input.holdoutsCommand ?? (created ? STARTER_HOLDOUTS_COMMAND : undefined);
    return c.json(await createProject(db, { ...input, holdoutsPath, holdoutsCommand }), 201);
  });
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

  app.post("/api/jira/import", async (c) => {
    const body = z
      .object({ projectId: z.string(), issue: z.string().min(1).optional(), jql: z.string().min(1).optional(), start: z.boolean().default(false) })
      .parse(await c.req.json());
    try {
      const deps = { db, profile: opts.profile ?? loadProfile(config.home), secretsDir: config.secretsDir, importSpec: (pid: string, title: string, md: string, start: boolean) => factory.importSpec(pid, title, md, start), tick: () => factory.tick() };
      return c.json({ results: await importFromJira(deps, body) }, 201);
    } catch (e) {
      if (e instanceof JiraImportError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  app.post("/api/github/import", async (c) => {
    const body = z
      .object({
        projectId: z.string(),
        issue: z.number().int().positive().optional(),
        search: z.string().min(1).optional(),
        repo: z.string().optional(),
        start: z.boolean().default(false),
        anyAuthor: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(await c.req.json());
    try {
      const deps = { db, importSpec: (pid: string, title: string, md: string, start: boolean) => factory.importSpec(pid, title, md, start), tick: () => factory.tick() };
      return c.json({ results: await importFromGithub(deps, body) }, 201);
    } catch (e) {
      if (e instanceof GithubImportError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });

  // Updates: is a newer commit on origin, and apply it (build, verify, drain, switch) on request.
  app.get("/api/update", (c) => (opts.updater ? c.json(opts.updater.get()) : c.json({ error: "update checks are off" }, 404)));
  app.post("/api/update/check", async (c) => (opts.updater ? c.json(await opts.updater.check()) : c.json({ error: "update checks are off" }, 404)));
  app.post("/api/update/apply", async (c) => {
    if (!opts.updater) return c.json({ error: "update checks are off" }, 404);
    try {
      const status = await opts.updater.apply();
      await audit(db, { actor: "board", kind: "update.started", subject: status.applying!.target });
      return c.json(status, 202);
    } catch (e) {
      if (e instanceof UpdateError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });
  app.get("/api/update/log", (c) => (opts.updater ? c.json({ log: opts.updater.logTail() }) : c.json({ error: "update checks are off" }, 404)));

  // The console's issue picker: sources, filters, a search that imports nothing, one-issue imports.
  const intakeDeps = (): IntakeDeps => ({
    db,
    profile: opts.profile ?? loadProfile(config.home),
    secretsDir: config.secretsDir,
    importSpec: (pid, title, md, start) => factory.importSpec(pid, title, md, start),
    tick: () => factory.tick(),
    ...opts.intake,
  });
  const intake = async (c: Context, run: () => Promise<unknown>, status: 200 | 201 = 200) => {
    try {
      return c.json(await run(), status);
    } catch (e) {
      if (e instanceof IntakeError || e instanceof GithubImportError || e instanceof JiraImportError || e instanceof z.ZodError) {
        return c.json({ error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e.message }, 400);
      }
      // The tracker refused or could not be reached: say so instead of a bare 500.
      if (e instanceof JiraError) return c.json({ error: e.message }, 502);
      const stderr = (e as { stderr?: string }).stderr?.trim();
      if (stderr) return c.json({ error: `gh: ${stderr.split("\n")[0]}` }, 502);
      throw e;
    }
  };
  const IntakeQueryBody = z.discriminatedUnion("source", [
    z.object({
      source: z.literal("github"),
      projectId: z.string(),
      query: z.string().max(500).optional(),
      labels: z.array(z.string().max(100)).max(20).optional(),
      milestone: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    z.object({
      source: z.literal("jira"),
      projectId: z.string(),
      jql: z.string().max(2000).optional(),
      project: z.string().max(50).optional(),
      epic: z.string().max(64).optional(),
      text: z.string().max(500).optional(),
      includeDone: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  ]);
  app.get("/api/intake/sources", (c) => intake(c, () => intakeSources(intakeDeps(), c.req.query("projectId") ?? "")));
  app.get("/api/intake/github/filters", (c) => intake(c, () => githubFilters(intakeDeps(), c.req.query("projectId") ?? "")));
  app.get("/api/intake/jira/filters", (c) => intake(c, () => jiraFilters(intakeDeps(), c.req.query("project") || undefined)));
  app.post("/api/intake/search", async (c) => {
    const body = await c.req.json();
    return intake(c, async () => ({ candidates: await searchIntake(intakeDeps(), IntakeQueryBody.parse(body)) }));
  });
  app.post("/api/intake/import", async (c) => {
    const body = await c.req.json();
    const Input = z.object({
      projectId: z.string(),
      source: z.enum(["github", "jira"]),
      key: z.string().min(1).max(200),
      start: z.boolean().default(false),
      anyAuthor: z.boolean().default(false),
    });
    return intake(c, () => importOne(intakeDeps(), Input.parse(body)), 201);
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
    const adapter = edit.adapter ?? current.adapter;
    if (adapter !== current.adapter && !factory.adapterIds().includes(adapter)) {
      return c.json({ error: `adapter '${adapter}' is not enabled; add it to the profile's adapters (available: ${factory.adapterIds().join(", ")})` }, 400);
    }
    return c.json(await saveAgent(db, { id: current.id, role: current.role, ...edit, adapter, mcpServers: edit.mcpServers ?? current.mcpServers }));
  });

  // ── environments, knowledge, Chief conversations, tools ─────────────────
  app.get("/api/environments", async (c) => c.json(await listEnvironments(db)));
  app.post("/api/environments", async (c) =>
    c.json(await createEnvironment(db, z.object({ name: z.string().min(1), rootPath: z.string().min(1) }).parse(await c.req.json())), 201),
  );

  app.get("/api/knowledge", async (c) => {
    const environmentId = c.req.query("environmentId") ?? "env_default";
    return c.json(
      await searchKnowledge(db, {
        environmentId,
        projectId: c.req.query("projectId"),
        text: c.req.query("q"),
        includeArchived: c.req.query("archived") === "1",
        limit: 200,
      }),
    );
  });
  const KnowledgeBody = z.object({
    environmentId: z.string(),
    projectId: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    kind: z.enum(KNOWLEDGE_KINDS),
    title: z.string().min(3),
    abstract: z.string().min(3),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
  });
  app.post("/api/knowledge", async (c) => c.json(await addKnowledge(db, { ...KnowledgeBody.parse(await c.req.json()), source: "board" }, "board"), 201));
  app.get("/api/knowledge/:id", async (c) => {
    const e = await getKnowledge(db, c.req.param("id"));
    return e ? c.json({ ...e, reads: await knowledgeReadsFor(db, e.id) }) : c.json({ error: "not found" }, 404);
  });
  app.patch("/api/knowledge/:id", async (c) => {
    const patch = KnowledgeBody.omit({ environmentId: true })
      .partial()
      .extend({ pinned: z.number().int().min(0).max(1).optional(), status: z.enum(["active", "archived"]).optional() })
      .parse(await c.req.json());
    return c.json(await updateKnowledge(db, c.req.param("id"), patch, "board"));
  });

  app.get("/api/chats", async (c) => c.json(await listChats(db, c.req.query("environmentId"))));
  app.post("/api/chats", async (c) => {
    const { environmentId, title, message } = z
      .object({ environmentId: z.string(), title: z.string().min(1).max(120), message: z.string().min(1) })
      .parse(await c.req.json());
    const chat = await createChat(db, environmentId, title);
    await factory.chat(chat.id, message);
    return c.json(chat, 201);
  });
  app.get("/api/chats/:id", async (c) => {
    const chat = await getChat(db, c.req.param("id"));
    return chat ? c.json({ chat, messages: await chatHistory(db, chat.id), thinking: factory.isChatting(chat.id) }) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/chats/:id/messages", async (c) => {
    const { message } = z.object({ message: z.string().min(1) }).parse(await c.req.json());
    await factory.chat(c.req.param("id"), message);
    return c.json({ ok: true }, 202);
  });

  app.get("/api/providers", async (c) =>
    c.json(await listProviders(db, await listAgents(db), { claudeBin: config.claudeBin, codexBin: config.codexBin, codexHome: config.codexHome, enabled: factory.adapterIds(), pausedAdapters: (factory.status().pausedAdapters ?? {}) as Record<string, number> })),
  );
  app.get("/api/usage", async (c) => {
    const to = c.req.query("to") ? new Date(c.req.query("to")!) : new Date();
    const from = c.req.query("from") ? new Date(c.req.query("from")!) : new Date(to.getTime() - 7 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return c.json({ error: "invalid range" }, 400);
    return c.json(await usageReport(db, { from, to, projectId: c.req.query("projectId") }));
  });
  app.put("/api/providers/:id/caps", async (c) => {
    const n = z.number().int().min(0).optional();
    const caps = z
      .object({ runsPerDay: n, tokensPerDay: n, runsPerSession: n, tokensPerSession: n, runsPerWeek: n, tokensPerWeek: n, sessionHours: z.number().min(1).max(24).optional() })
      .strict()
      .parse(await c.req.json());
    return c.json(await setCaps(db, c.req.param("id"), caps));
  });

  app.get("/api/tools", async (c) => c.json(await inventory(opts.profile ?? loadProfile(config.home), await listAgents(db), config)));

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
      const chatFilter = c.req.query("chat");
      const onChat = (e: { chatId: string }) => chatFilter !== undefined && e.chatId === chatFilter && push("chat", e);
      factory.on("chat", onChat);
      stream.onAbort(() => {
        offAudit();
        offEvents();
        factory.off("change", onChange);
        factory.off("chat", onChat);
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
