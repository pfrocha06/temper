import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAdapter, McpServerSpec, ModelUsage, RunEvent, RunRequest, RunResult } from "@temper/core";

export type CodexCliOptions = {
  /** The `codex` binary. On Windows an npm `codex.cmd` shim is resolved to its `codex.js`. */
  bin?: string;
  /** Arguments placed before the run's own, for a `bin` that is an interpreter (tests: `node fake-codex.mjs`). */
  binArgs?: string[];
  /**
   * CODEX_HOME for every run: Temper's own, holding only the login (`temper codex login`).
   * Keeping it apart from `~/.codex` keeps the user's config, AGENTS.md, hooks, plugins,
   * memories and sessions out of agent runs, and pins the account the board approved.
   */
  codexHome: string;
  /** Directories no run may ever read (Temper's own secrets and database), on top of each request's. */
  alwaysDenyDirs?: string[];
  /** Where user-level skills live (`~/.agents/skills`); each is disabled for agent runs. */
  userSkillsDir?: string;
};

/** Features that would reach outside the run's explicit tools, or bring in user state. */
const DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "plugins",
  "skill_mcp_dependency_install",
  "tool_suggest",
];

/** TOML for a `-c key=value` override. JSON strings are valid TOML basic strings once DEL is escaped. */
export function toml(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v).replace(/\x7f/g, "\\u007f");
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(toml).join(", ")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${toml(k)} = ${toml(x)}`)
      .join(", ")}}`;
  }
  throw new Error(`cannot express ${String(v)} in TOML`);
}

const norm = (p: string) => p.replace(/[\\/]+$/, "");

/**
 * The run's permission profile: Codex's own sandbox (Seatbelt, bubblewrap, or the Windows
 * sandbox) with the workspace writable, protected directories unreadable, and the network
 * limited to loopback.
 *
 * Loopback is open for every run: with the network off, Codex's sandbox refuses even a local
 * listen, so a project's own tests could not start a stub server. Domain rules only hold while
 * Codex's network proxy runs, so every run enables it, and the isolation probe checks that the
 * internet stays unreachable.
 *
 * Local binding (tests listen, and reach their own servers directly) is on unless the run needs
 * the host's loopback (`hostLoopback`, the Verifier on Linux): there the sandbox has its own
 * network namespace, and only the proxy reaches the candidate app on the host. On macOS, local
 * binding may also let commands reach private-network addresses.
 */
export function permissionProfile(req: RunRequest): Record<string, unknown> {
  const filesystem: Record<string, string> = {};
  if (!req.readOnly) for (const d of req.addDirs ?? []) filesystem[norm(d)] = "write";
  for (const d of req.readOnlyDirs ?? []) filesystem[norm(d)] = "read";
  for (const d of req.denyDirs ?? []) filesystem[norm(d)] = "deny";
  return {
    extends: req.readOnly ? ":read-only" : ":workspace",
    filesystem,
    network: { enabled: true, allow_local_binding: !req.hostLoopback, domains: { localhost: "allow", "127.0.0.1": "allow" } },
  };
}

/**
 * The sandbox part of a run's arguments, shared with `codex sandbox` (the isolation tests).
 * Windows needs Codex's MXC sandbox or its elevated one (set up once by `temper codex setup`):
 * the unelevated fallback cannot deny reads.
 */
export function sandboxArgs(req: RunRequest, platform = process.platform): string[] {
  const c = (key: string, value: unknown) => ["-c", `${key}=${toml(value)}`];
  return [
    ...c("default_permissions", "temper"),
    ...c("permissions", { temper: permissionProfile(req) }),
    "--enable",
    "network_proxy",
    ...(platform === "win32" ? [...c("windows.sandbox", "elevated"), "--enable", "prefer_mxc"] : []),
  ];
}

/** Skills as an index the agent reads on demand, the way Codex presents its own. */
export function skillIndex(skillDirs: string[]): string | undefined {
  const entries = skillDirs.flatMap((dir) => {
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) return [];
    const head = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    const field = (k: string) => head.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
    return [`- ${field("name") ?? dir.split(/[\\/]/).pop()}: ${field("description") ?? ""} (read ${file})`];
  });
  if (!entries.length) return undefined;
  return ["## Skills", "Each skill is a SKILL.md file. When one applies to the task, read it first and follow it.", ...entries].join("\n");
}

/** User-level skills (`~/.agents/skills/*\/SKILL.md`), each switched off for the run. */
export function userSkills(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => join(dir, e.name, "SKILL.md"));
}

/**
 * MCP servers for the run. Their environment (the run's capability token, profile secrets) goes
 * into Codex's own environment and is forwarded by name, so no value appears in the process's
 * arguments; `secretEnv` lists those names so shell commands never inherit them.
 */
export function mcpConfig(servers: Record<string, McpServerSpec>): { config: Record<string, unknown>; env: Record<string, string>; secretEnv: string[] } {
  const config: Record<string, unknown> = {};
  const env: Record<string, string> = {};
  for (const [name, s] of Object.entries(servers)) {
    for (const [k, v] of Object.entries(s.env ?? {})) {
      if (k in env && env[k] !== v) throw new Error(`MCP servers disagree on ${k}; give each its own variable name`);
      env[k] = v;
    }
    config[name] = {
      command: s.command,
      args: s.args ?? [],
      env_vars: Object.keys(s.env ?? {}),
      // Non-interactive runs cannot answer prompts; the run's tools are Temper's choice.
      default_tools_approval_mode: "approve",
    };
  }
  return { config, env, secretEnv: Object.keys(env) };
}

export function buildArgs(req: RunRequest, opts: { disabledSkills?: string[]; secretEnv?: string[]; mcpServers?: Record<string, unknown>; platform?: NodeJS.Platform } = {}): string[] {
  const c = (key: string, value: unknown) => ["-c", `${key}=${toml(value)}`];
  const instructions = [req.appendSystemPrompt, skillIndex(req.skillDirs ?? [])].filter(Boolean).join("\n\n");
  const args = [
    "exec",
    ...(req.resumeSessionId ? ["resume", req.resumeSessionId] : []),
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    ...c("approval_policy", "never"),
    ...c("web_search", "disabled"),
    ...sandboxArgs(req, opts.platform),
    ...c("shell_environment_policy", { inherit: "all", ignore_default_excludes: false, exclude: opts.secretEnv ?? [] }),
    ...c("mcp_servers", opts.mcpServers ?? {}),
    ...(opts.disabledSkills?.length ? c("skills", { config: opts.disabledSkills.map((path) => ({ path, enabled: false })) }) : []),
    ...(instructions ? c("developer_instructions", instructions) : []),
    ...DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
  ];
  // Role models default to Claude names; those mean nothing to Codex, which then uses its default.
  if (req.model && !/^(claude|opus|sonnet|haiku)/i.test(req.model)) args.push("-m", req.model);
  args.push("-"); // the prompt comes on stdin: no argument-length limit, nothing in the process list
  return args;
}

const RATE_LIMIT = /usage limit|rate limit|too many requests|429/i;

type Item = { id?: string; type?: string; text?: string; command?: string; aggregated_output?: string; exit_code?: number | null; status?: string; changes?: unknown; server?: string; tool?: string; arguments?: unknown; result?: unknown; error?: { message?: string }; message?: string };

/** Maps one `codex exec --json` line to zero or more run events. Unknown lines are ignored. */
export function parseLine(line: string, model?: string): RunEvent[] {
  let d: Record<string, any>;
  try {
    d = JSON.parse(line);
  } catch {
    return line.trim() ? [{ kind: "stderr", text: line }] : [];
  }
  switch (d.type) {
    case "thread.started":
      return [{ kind: "init", sessionId: d.thread_id, model }];
    case "item.started": {
      const it: Item = d.item ?? {};
      if (it.type === "command_execution") return [{ kind: "tool_use", tool: "shell", input: { command: it.command } }];
      if (it.type === "mcp_tool_call") return [{ kind: "tool_use", tool: `mcp__${it.server}__${it.tool}`, input: it.arguments }];
      return [];
    }
    case "item.completed": {
      const it: Item = d.item ?? {};
      switch (it.type) {
        case "agent_message":
          return it.text ? [{ kind: "text", text: it.text }] : [];
        case "command_execution":
          return [{ kind: "tool_result", isError: it.status === "failed" || (it.exit_code ?? 0) !== 0, content: String(it.aggregated_output ?? "").slice(0, 4000) }];
        case "file_change":
          return [{ kind: "tool_use", tool: "apply_patch", input: it.changes }];
        case "mcp_tool_call":
          return [{ kind: "tool_result", isError: it.status === "failed", content: JSON.stringify(it.result ?? it.error ?? "").slice(0, 4000) }];
        case "error":
          return [{ kind: "stderr", text: it.message ?? "error" }];
        default:
          return [];
      }
    }
    case "turn.completed": {
      const u = d.usage ?? {};
      const usage: ModelUsage = {
        // Codex reports cached input inside input_tokens; split it out like the other adapter.
        inputTokens: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cached_input_tokens ?? 0,
        cacheWriteTokens: 0,
      };
      return [{ kind: "usage", models: { [model ?? "codex"]: usage } }];
    }
    case "turn.failed": {
      const text = d.error?.message ?? "turn failed";
      return RATE_LIMIT.test(text) ? [{ kind: "stderr", text }, { kind: "rate_limited", text }] : [{ kind: "stderr", text }];
    }
    case "error": {
      const text = d.message ?? "error";
      return RATE_LIMIT.test(text) ? [{ kind: "stderr", text }, { kind: "rate_limited", text }] : [{ kind: "stderr", text }];
    }
    default:
      return [];
  }
}

/** The command to spawn: Node can't run an npm `.cmd` shim without a shell, so run its script. */
export function resolveBin(bin: string, platform = process.platform, path = process.env.PATH ?? ""): { file: string; args: string[] } {
  if (platform !== "win32" || /[\\/]|\.\w+$/.test(bin)) return { file: bin, args: [] };
  for (const dir of path.split(delimiter).filter(Boolean)) {
    if (existsSync(join(dir, `${bin}.exe`))) return { file: join(dir, `${bin}.exe`), args: [] };
    const script = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(join(dir, `${bin}.cmd`)) && existsSync(script)) return { file: process.execPath, args: [script] };
  }
  return { file: bin, args: [] };
}

/** The account the Codex login belongs to, from the id token's claims (no network, nothing stored). */
export function codexAccount(codexHome: string): { loggedIn: boolean; method?: string; email?: string; plan?: string } {
  const file = join(codexHome, "auth.json");
  if (!existsSync(file)) return { loggedIn: false };
  try {
    const auth = JSON.parse(readFileSync(file, "utf8")) as { OPENAI_API_KEY?: string | null; tokens?: { id_token?: string } };
    const idToken = auth.tokens?.id_token;
    if (idToken) {
      const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, any>;
      return { loggedIn: true, method: "chatgpt", email: claims.email, plan: claims["https://api.openai.com/auth"]?.chatgpt_plan_type };
    }
    return auth.OPENAI_API_KEY ? { loggedIn: true, method: "api-key" } : { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

export function createCodexCliAdapter(options: CodexCliOptions): AgentAdapter {
  const resolved = options.binArgs ? { file: options.bin ?? "codex", args: options.binArgs } : resolveBin(options.bin ?? "codex");
  const userSkillsDir = options.userSkillsDir ?? join(homedir(), ".agents", "skills");
  return {
    id: "codex-cli",
    isolated: true,
    run(req, onEvent) {
      if (!existsSync(join(options.codexHome, "auth.json"))) {
        return Promise.reject(new Error(`Codex is not signed in for Temper: run 'temper codex login' (CODEX_HOME ${options.codexHome})`));
      }
      req = { ...req, denyDirs: [...(options.alwaysDenyDirs ?? []), ...(req.denyDirs ?? [])] };
      const mcp = mcpConfig(req.mcpServers ?? {});
      const args = buildArgs(req, { disabledSkills: userSkills(userSkillsDir), secretEnv: mcp.secretEnv, mcpServers: mcp.config });
      return new Promise<RunResult>((resolve, reject) => {
        const child = spawn(resolved.file, [...resolved.args, ...args], {
          cwd: req.cwd,
          env: { ...process.env, ...req.env, ...mcp.env, CODEX_HOME: options.codexHome },
          stdio: ["pipe", "pipe", "pipe"],
          signal: req.signal,
        });
        child.stdin.end(req.prompt);
        let sessionId: string | undefined;
        let finalText = "";
        let failed = false;
        let rateLimited = false;
        const handle = (e: RunEvent) => {
          if (e.kind === "init") sessionId = e.sessionId;
          if (e.kind === "text") finalText = e.text; // the last agent message is the run's answer
          if (e.kind === "rate_limited") rateLimited = true;
          onEvent(e);
        };
        createInterface({ input: child.stdout }).on("line", (l) => {
          const events = parseLine(l, req.model ?? undefined);
          if (/"type":"turn\.failed"/.test(l)) failed = true;
          events.forEach(handle);
        });
        createInterface({ input: child.stderr }).on("line", (l) => l.trim() && handle({ kind: "stderr", text: l }));
        child.on("error", (err) => {
          if ((err as NodeJS.ErrnoException).name === "AbortError") resolve({ finalText, sessionId, exitCode: null, isError: true, rateLimited });
          else reject(err);
        });
        child.on("close", (exitCode) => {
          const isError = failed || exitCode !== 0;
          onEvent({ kind: "result", text: finalText, isError });
          resolve({ finalText, sessionId, exitCode, isError, rateLimited });
        });
      });
    },
  };
}

export const defaultCodexHome = (secretsDir: string) => join(secretsDir, "codex");
