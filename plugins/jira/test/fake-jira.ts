// A local fake Jira Cloud REST v3 server for tests (here and in later tickets).
// Usage: const jira = await startFakeJira({ issues: [...] }); point baseUrl at jira.url; await jira.close().
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeIssue = {
  key: string;
  summary: string;
  description?: unknown;
  status?: string;
  issueType?: string;
  labels?: string[];
  /** Transition names this issue currently offers. */
  transitions?: string[];
  comments?: { id: string; body: unknown }[];
};

export type FakeJiraOptions = { issues?: FakeIssue[]; email?: string; token?: string };

export type FakeJira = {
  url: string;
  issues: Map<string, FakeIssue>;
  /** Every request received, in order. */
  requests: { method: string; path: string; body?: any; authorization?: string }[];
  /** Make the next calls fail with this status (for failure-path tests); pass undefined to clear. */
  failWith(status: number | undefined): void;
  close(): Promise<void>;
};

export async function startFakeJira(opts: FakeJiraOptions = {}): Promise<FakeJira> {
  const issues = new Map((opts.issues ?? []).map((i) => [i.key, i]));
  const requests: FakeJira["requests"] = [];
  let failStatus: number | undefined;
  let nextId = 10000;
  const expectedAuth = opts.email && opts.token ? "Basic " + Buffer.from(`${opts.email}:${opts.token}`).toString("base64") : undefined;

  const render = (i: FakeIssue) => ({
    id: String(10000 + [...issues.keys()].indexOf(i.key)),
    key: i.key,
    fields: {
      summary: i.summary,
      description: i.description ?? null,
      status: { name: i.status ?? "To Do" },
      issuetype: { name: i.issueType ?? "Task" },
      project: { key: i.key.split("-")[0] },
      labels: i.labels ?? [],
    },
  });

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : undefined;
      const method = req.method ?? "GET";
      requests.push({ method, path: url.pathname + url.search, body, authorization: req.headers.authorization });
      const send = (status: number, payload?: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      if (failStatus) return send(failStatus, { errorMessages: ["forced failure"] });
      if (expectedAuth && req.headers.authorization !== expectedAuth) return send(401, { errorMessages: ["unauthorized"] });

      const path = url.pathname;
      if (method === "GET" && path === "/rest/api/3/search/jql") {
        const jql = url.searchParams.get("jql") ?? "";
        const key = /key\s*=\s*"?([A-Z][A-Z0-9]*-\d+)"?/i.exec(jql)?.[1];
        const project = /project\s*=\s*"?([A-Z][A-Z0-9]*)"?/i.exec(jql)?.[1];
        const found = [...issues.values()].filter((i) => (key ? i.key === key : project ? i.key.startsWith(project + "-") : true));
        return send(200, { issues: found.map(render), isLast: true });
      }
      if (method === "POST" && path === "/rest/api/3/issue") {
        const f = body.fields;
        const project = f.project.key as string;
        const key = `${project}-${[...issues.keys()].filter((k) => k.startsWith(project + "-")).length + 1}`;
        issues.set(key, { key, summary: f.summary, description: f.description, issueType: f.issuetype?.name, labels: f.labels });
        return send(201, { id: String(nextId++), key });
      }
      const m = /^\/rest\/api\/3\/issue\/([^/]+)(?:\/(comment|transitions))?$/.exec(path);
      const issue = m ? issues.get(decodeURIComponent(m[1]!)) : undefined;
      if (!m) return send(404, { errorMessages: ["not found"] });
      if (!issue) return send(404, { errorMessages: ["Issue does not exist or you do not have permission to see it."] });
      const sub = m[2];
      if (!sub && method === "GET") return send(200, render(issue));
      if (!sub && method === "PUT") {
        const f = body.fields ?? {};
        if (f.summary !== undefined) issue.summary = f.summary;
        if (f.description !== undefined) issue.description = f.description;
        if (f.labels !== undefined) issue.labels = f.labels;
        return send(204);
      }
      if (sub === "comment" && method === "POST") {
        const c = { id: String(nextId++), body: body.body };
        (issue.comments ??= []).push(c);
        return send(201, c);
      }
      if (sub === "transitions" && method === "GET") {
        return send(200, { transitions: (issue.transitions ?? []).map((name, i) => ({ id: String(11 + i), name, to: { name } })) });
      }
      if (sub === "transitions" && method === "POST") {
        const names = issue.transitions ?? [];
        const idx = names.findIndex((_, i) => String(11 + i) === body.transition?.id);
        if (idx < 0) return send(400, { errorMessages: ["Invalid transition"] });
        issue.status = names[idx];
        return send(204);
      }
      send(405, { errorMessages: ["method not allowed"] });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    issues,
    requests,
    failWith: (s) => {
      failStatus = s;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
