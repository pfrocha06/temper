import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAdapter, ModelUsage, RunEvent, RunRequest, RunResult } from "@temper/core";
import { agentEnv } from "@temper/core/agent-env";

export type ClaudeCliOptions = {
  /** Path to the `claude` binary. */
  bin?: string;
  /** Arguments placed before the run's own, for a `bin` that is an interpreter (tests: `node fake-claude.mjs`). */
  binArgs?: string[];
  /** Directories no run may ever read (Temper's own secrets and database), on top of each request's. */
  alwaysDenyDirs?: string[];
  /** Server variables to pass on top of the allowlist (TEMPER_AGENT_ENV), e.g. a Bedrock setup's. */
  passEnv?: string[];
};

/**
 * How the CLI may sign in when not through its own stored login: the only server variables a
 * Claude run gets beyond the base allowlist (see agentEnv).
 */
export const CLAUDE_AUTH_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"];

/**
 * Settings passed to every run. Together with `--setting-sources project` and
 * `--strict-mcp-config`, this keeps the user's own skills, plugins, hooks, CLAUDE.md,
 * memory and MCP servers out of agent runs while reusing the user's login.
 */
export function runSettings(req: Pick<RunRequest, "denyDirs" | "hostLoopback">): Record<string, unknown> {
  // In permission rules a single leading `/` is relative to the settings source; `//` is absolute.
  const abs = (d: string) => (d.startsWith("/") ? `/${d}` : d);
  const deny = (req.denyDirs ?? []).flatMap((d) => ["Read", "Edit", "Write", "Grep", "Glob"].map((t) => `${t}(${abs(d)}/**)`));
  return {
    autoMemoryEnabled: false,
    permissions: { deny },
    sandbox: req.denyDirs?.length
      ? {
          enabled: true,
          allowUnsandboxedCommands: false,
          filesystem: { denyRead: req.denyDirs },
          // Tests commonly start stub servers on 127.0.0.1; outbound network stays blocked.
          // On Linux the sandbox's loopback is not the host's: the host's is reached through the proxy.
          network: { allowLocalBinding: true, ...(req.hostLoopback ? { allowedDomains: ["127.0.0.1"] } : {}) },
        }
      : undefined,
  };
}

/** Writes the run's MCP config (mode 0600: it carries the run's capability token). */
export function writeMcpConfig(req: Pick<RunRequest, "mcpServers">): string {
  const dir = mkdtempSync(join(tmpdir(), "temper-mcp-"));
  const file = join(dir, "mcp.json");
  writeFileSync(file, JSON.stringify({ mcpServers: req.mcpServers ?? {} }), { mode: 0o600 });
  return file;
}

export function buildArgs(req: RunRequest, pluginDir?: string, mcpConfig?: string): string[] {
  const args = [
    "-p",
    req.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    ...(mcpConfig ? ["--mcp-config", mcpConfig] : []),
    "--permission-mode",
    "dontAsk",
    "--settings",
    JSON.stringify(runSettings(req)),
  ];
  if (req.model) args.push("--model", req.model);
  if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
  // MCP tools must be allowed by name in non-interactive mode.
  const mcpTools = Object.keys(req.mcpServers ?? {}).map((name) => `mcp__${name}`);
  const allowed = [...req.allowedTools, ...mcpTools];
  if (allowed.length) args.push("--allowedTools", ...allowed);
  if (req.disallowedTools.length) args.push("--disallowedTools", ...req.disallowedTools);
  for (const d of req.addDirs ?? []) args.push("--add-dir", d);
  if (pluginDir) args.push("--plugin-dir", pluginDir);
  if (req.appendSystemPrompt) args.push("--append-system-prompt", req.appendSystemPrompt);
  return args;
}

const RATE_LIMIT = /usage limit|rate limit|too many requests|429/i;

type Block = { type: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: Block) => c.text ?? "").join("");
  return "";
}

/** Maps one stream-json line to zero or more run events. Unknown lines are ignored. */
export function parseLine(line: string): RunEvent[] {
  let d: Record<string, any>;
  try {
    d = JSON.parse(line);
  } catch {
    return line.trim() ? [{ kind: "stderr", text: line }] : [];
  }
  switch (d.type) {
    case "system":
      return d.subtype === "init" ? [{ kind: "init", sessionId: d.session_id, model: d.model }] : [];
    case "assistant":
      return (d.message?.content ?? []).flatMap((c: Block): RunEvent[] => {
        if (c.type === "text" && c.text) return [{ kind: "text", text: c.text }];
        if (c.type === "tool_use") return [{ kind: "tool_use", tool: c.name ?? "?", input: c.input }];
        return [];
      });
    case "user":
      return (d.message?.content ?? [])
        .filter((c: Block) => c.type === "tool_result")
        .map((c: Block): RunEvent => ({ kind: "tool_result", isError: !!c.is_error, content: contentText(c.content).slice(0, 4000) }));
    case "rate_limit_event": {
      const info = d.rate_limit_info ?? {};
      if (!info.status) return [];
      const report: RunEvent = {
        kind: "rate_limit",
        limitType: String(info.rateLimitType ?? "unknown"),
        status: String(info.status),
        resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
        raw: info,
      };
      return info.status === "allowed" ? [report] : [report, { kind: "rate_limited", text: JSON.stringify(info) }];
    }
    case "result": {
      const text = typeof d.result === "string" ? d.result : "";
      const events: RunEvent[] = [
        { kind: "result", text, isError: !!d.is_error, turns: d.num_turns, durationMs: d.duration_ms },
      ];
      if (d.modelUsage && typeof d.modelUsage === "object") {
        const models: Record<string, ModelUsage> = {};
        for (const [model, m] of Object.entries(d.modelUsage as Record<string, Record<string, number>>)) {
          models[model] = {
            inputTokens: m.inputTokens ?? 0,
            outputTokens: m.outputTokens ?? 0,
            cacheReadTokens: m.cacheReadInputTokens ?? 0,
            cacheWriteTokens: m.cacheCreationInputTokens ?? 0,
            costUsd: typeof m.costUSD === "number" ? m.costUSD : undefined,
          };
        }
        events.push({ kind: "usage", models, apiMs: d.duration_api_ms });
      }
      if (d.is_error && RATE_LIMIT.test(text)) events.push({ kind: "rate_limited", text });
      return events;
    }
    default:
      return [];
  }
}

/** Builds a throwaway plugin exposing exactly the given skill directories. */
export function buildSkillPlugin(skillDirs: string[]): string | undefined {
  if (skillDirs.length === 0) return undefined;
  const dir = mkdtempSync(join(tmpdir(), "temper-skills-"));
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "temper-role-skills", version: "0.0.0" }));
  for (const s of skillDirs) cpSync(s, join(dir, "skills", basename(s)), { recursive: true });
  return dir;
}

export function createClaudeCliAdapter(options: ClaudeCliOptions = {}): AgentAdapter {
  const bin = options.bin ?? "claude";
  return {
    id: "claude-cli",
    isolated: true,
    run(req, onEvent) {
      req = { ...req, denyDirs: [...(options.alwaysDenyDirs ?? []), ...(req.denyDirs ?? [])] };
      const pluginDir = buildSkillPlugin(req.skillDirs ?? []);
      const mcpConfig = req.mcpServers && Object.keys(req.mcpServers).length ? writeMcpConfig(req) : undefined;
      const cleanup = () => {
        if (pluginDir) rmSync(pluginDir, { recursive: true, force: true });
        if (mcpConfig) rmSync(dirname(mcpConfig), { recursive: true, force: true });
      };
      return new Promise<RunResult>((resolve, reject) => {
        const child = spawn(bin, [...(options.binArgs ?? []), ...buildArgs(req, pluginDir, mcpConfig)], {
          cwd: req.cwd,
          env: agentEnv([...CLAUDE_AUTH_ENV, ...(options.passEnv ?? [])], req.env),
          stdio: ["ignore", "pipe", "pipe"],
          signal: req.signal,
        });
        let sessionId: string | undefined;
        let finalText = "";
        let isError = false;
        let rateLimited = false;
        const handle = (e: RunEvent) => {
          if (e.kind === "init") sessionId = e.sessionId;
          if (e.kind === "result") {
            finalText = e.text;
            isError = e.isError;
          }
          if (e.kind === "rate_limited") rateLimited = true;
          onEvent(e);
        };
        createInterface({ input: child.stdout }).on("line", (l) => parseLine(l).forEach(handle));
        createInterface({ input: child.stderr }).on("line", (l) => l.trim() && handle({ kind: "stderr", text: l }));
        child.on("error", (err) => {
          cleanup();
          if ((err as NodeJS.ErrnoException).name === "AbortError") {
            resolve({ finalText, sessionId, exitCode: null, isError: true, rateLimited });
          } else reject(err);
        });
        child.on("close", (exitCode) => {
          cleanup();
          resolve({ finalText, sessionId, exitCode, isError: isError || exitCode !== 0, rateLimited });
        });
      });
    },
  };
}
