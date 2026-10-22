// Jira Cloud REST v3 client. Used only by the server: agents never hold the token.
// Knows nothing about any site; baseUrl, email and token come from the caller.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { adfToMarkdown, textToAdf } from "./adf.ts";

export { adfToMarkdown, textToAdf } from "./adf.ts";
export type { AdfNode } from "./adf.ts";

export type JiraTransitionNames = { inProgress?: string; inReview?: string; done?: string };

/** Shape of `trackers.jira` in profile.json. */
export type JiraConfig = {
  baseUrl: string;
  email: string;
  tokenSecret: string;
  projects?: string[];
  transitions?: JiraTransitionNames;
};

export const DEFAULT_TRANSITIONS: Required<JiraTransitionNames> = { inProgress: "In Progress", inReview: "In Review", done: "Done" };

export type JiraCredentials = { baseUrl: string; email: string; token: string };

export type JiraIssue = {
  key: string;
  id: string;
  url: string;
  summary: string;
  /** Description converted from ADF to Markdown. */
  description: string;
  status: string;
  issueType: string;
  project: string;
  labels: string[];
};

export type JiraTransition = { id: string; name: string; to?: string };

export type TransitionResult = { ok: true; transition: JiraTransition } | { ok: false; reason: "transition not available"; name: string; available: string[] };

export type CreateIssueInput = { project: string; summary: string; description?: string; issueType?: string; labels?: string[] };
export type EditIssueInput = { summary?: string; description?: string; labels?: string[] };

export class JiraError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = "JiraError";
  }
}

/** Reads the API token from `<secretsDir>/<name>`. The error names the secret, never its value. */
export function readJiraToken(secretsDir: string, name: string): string {
  if (!name || /[\\/]|^\.\.?$/.test(name)) throw new JiraError(`Jira token secret name "${name}" is not a plain file name`);
  let raw: string;
  try {
    raw = readFileSync(join(secretsDir, name), "utf8");
  } catch {
    throw new JiraError(`Jira token secret "${name}" not found in ${secretsDir}`);
  }
  const token = raw.trim();
  if (!token) throw new JiraError(`Jira token secret "${name}" is empty`);
  return token;
}

export function jiraCredentials(config: JiraConfig, secretsDir: string): JiraCredentials {
  return { baseUrl: config.baseUrl, email: config.email, token: readJiraToken(secretsDir, config.tokenSecret) };
}

type Json = Record<string, any>;

export class JiraClient {
  private readonly base: string;
  private readonly auth: string;

  private readonly fetchFn: typeof fetch;

  constructor(creds: JiraCredentials, fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
    this.base = creds.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${creds.email}:${creds.token}`).toString("base64");
  }

  private async call(method: string, path: string, body?: unknown): Promise<Json | undefined> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { Authorization: this.auth, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new JiraError(`Jira ${method} ${path} unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new JiraError(`Jira ${method} ${path} failed: ${res.status} ${text}`.trim(), res.status);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as Json) : undefined;
  }

  private toIssue(raw: Json): JiraIssue {
    const f = raw.fields ?? {};
    return {
      key: raw.key,
      id: raw.id,
      url: `${this.base}/browse/${raw.key}`,
      summary: f.summary ?? "",
      description: adfToMarkdown(f.description),
      status: f.status?.name ?? "",
      issueType: f.issuetype?.name ?? "",
      project: f.project?.key ?? String(raw.key).split("-")[0],
      labels: f.labels ?? [],
    };
  }

  async search(jql: string, maxResults = 50): Promise<JiraIssue[]> {
    const fields = "summary,description,status,issuetype,project,labels";
    const res = await this.call("GET", `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`);
    return ((res?.issues ?? []) as Json[]).map((i) => this.toIssue(i));
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.toIssue((await this.call("GET", `/rest/api/3/issue/${encodeURIComponent(key)}`))!);
  }

  async addComment(key: string, text: string): Promise<{ id: string }> {
    const res = await this.call("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: textToAdf(text) });
    return { id: String(res?.id) };
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const res = await this.call("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return ((res?.transitions ?? []) as Json[]).map((t) => ({ id: String(t.id), name: t.name, to: t.to?.name }));
  }

  /** Applies a transition by name (case-insensitive). Never calls the API when the issue does not offer it. */
  async applyTransition(key: string, name: string): Promise<TransitionResult> {
    const available = await this.listTransitions(key);
    const match = available.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!match) return { ok: false, reason: "transition not available", name, available: available.map((t) => t.name) };
    await this.call("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
    return { ok: true, transition: match };
  }

  async createIssue(input: CreateIssueInput): Promise<{ key: string; id: string; url: string }> {
    const fields: Json = { project: { key: input.project }, summary: input.summary, issuetype: { name: input.issueType ?? "Task" } };
    if (input.description) fields.description = textToAdf(input.description);
    if (input.labels) fields.labels = input.labels;
    const res = await this.call("POST", "/rest/api/3/issue", { fields });
    return { key: res!.key, id: String(res!.id), url: `${this.base}/browse/${res!.key}` };
  }

  async editIssue(key: string, input: EditIssueInput): Promise<void> {
    const fields: Json = {};
    if (input.summary !== undefined) fields.summary = input.summary;
    if (input.description !== undefined) fields.description = textToAdf(input.description);
    if (input.labels !== undefined) fields.labels = input.labels;
    await this.call("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }
}
