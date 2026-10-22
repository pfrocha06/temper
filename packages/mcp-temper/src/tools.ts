// Tool definitions for the `temper` MCP server. Every tool is a thin call to Temper's agent API,
// authorised by the run's capability token; the server decides what each role may do.
import { z } from "zod";

export type Call = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) => Promise<unknown>;

export type Tool = {
  name: string;
  description: string;
  input: z.ZodRawShape;
  /** Roles that get the tool. Empty means every role. */
  roles: string[];
  run: (call: Call, args: Record<string, unknown>) => Promise<unknown>;
};

const KINDS = ["convention", "gotcha", "decision", "howto", "environment", "context"] as const;

export const TOOLS: Tool[] = [
  {
    name: "knowledge_search",
    description:
      "Search the shared knowledge base for this environment: conventions, gotchas, decisions, how-tos. Returns titles and abstracts; use knowledge_get for full detail.",
    input: { query: z.string().optional(), kinds: z.array(z.enum(KINDS)).optional(), limit: z.number().int().min(1).max(50).optional() },
    roles: [],
    run: (call, a) => call("POST", "/api/agent/knowledge/search", a),
  },
  {
    name: "knowledge_get",
    description: "Read one knowledge entry in full by id.",
    input: { id: z.string() },
    roles: [],
    run: (call, a) => call("GET", `/api/agent/knowledge/${encodeURIComponent(String(a.id))}`),
  },
  {
    name: "knowledge_add",
    description:
      "Record a durable fact for every agent in this environment. Only facts about the environment, conventions, decisions, gotchas and how-tos; never unproven claims about code behaviour, never secrets.",
    input: {
      kind: z.enum(KINDS),
      title: z.string().min(3),
      abstract: z.string().min(10).describe("One or two sentences that stand alone in a prompt."),
      body: z.string().optional(),
      projectId: z.string().optional().describe("Omit for environment-wide knowledge."),
      area: z.string().optional().describe("Path prefix the fact is about, e.g. apps/web/."),
      tags: z.array(z.string()).optional(),
    },
    roles: ["chief"],
    run: (call, a) => call("POST", "/api/agent/knowledge", a),
  },
  {
    name: "knowledge_update",
    description: "Correct or refine an existing entry.",
    input: {
      id: z.string(),
      title: z.string().optional(),
      abstract: z.string().optional(),
      body: z.string().optional(),
      kind: z.enum(KINDS).optional(),
      area: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    roles: ["chief"],
    run: (call, { id, ...patch }) => call("PATCH", `/api/agent/knowledge/${encodeURIComponent(String(id))}`, patch),
  },
  {
    name: "knowledge_archive",
    description: "Retire an entry that is wrong or no longer true, with the reason.",
    input: { id: z.string(), reason: z.string().min(3) },
    roles: ["chief"],
    run: (call, { id, reason }) => call("POST", `/api/agent/knowledge/${encodeURIComponent(String(id))}/archive`, { reason }),
  },
  {
    name: "projects_list",
    description: "List the projects in this environment with their ids and repositories.",
    input: {},
    roles: ["chief"],
    run: (call) => call("GET", "/api/agent/projects"),
  },
  {
    name: "tickets_list",
    description: "List tickets in this environment with status and stage.",
    input: { projectId: z.string().optional() },
    roles: ["chief"],
    run: (call, a) => call("GET", `/api/agent/tickets${a.projectId ? `?projectId=${encodeURIComponent(String(a.projectId))}` : ""}`),
  },
  {
    name: "ticket_create",
    description:
      "Create a ticket and delegate it. Tracer-bullet sized: one vertical slice. Acceptance criteria must be checkable against the running app. Set start=true to queue it for the Builder now.",
    input: {
      projectId: z.string(),
      type: z.enum(["feature", "bugfix", "refactor", "investigation", "prototype", "perf", "chore", "skill", "verification"]),
      title: z.string().min(3),
      spec: z.string(),
      acceptanceCriteria: z.array(z.string()).min(1),
      fileScope: z.array(z.string()).optional(),
      dependsOn: z.array(z.string()).optional(),
      start: z.boolean().optional(),
    },
    roles: ["chief"],
    run: (call, a) => call("POST", "/api/agent/tickets", a),
  },
];

export function toolsForRole(role: string): Tool[] {
  return TOOLS.filter((t) => t.roles.length === 0 || t.roles.includes(role));
}

export function httpCaller(apiUrl: string, capability: string): Call {
  return async (method, path, body) => {
    const res = await fetch(apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}
