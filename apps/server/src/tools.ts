import type { Agent } from "@temper/core";
import { run } from "./exec.ts";
import { codexAccount, resolveBin } from "@temper/adapter-codex-cli";
import type { Config } from "./config.ts";
import type { Profile } from "./profile.ts";

export type ToolStatus = "ok" | "missing" | "error";

export type CliInfo = { name: string; purpose: string; status: ToolStatus; version?: string };
export type McpInfo = {
  name: string;
  builtIn: boolean;
  description: string;
  command: string;
  envKeys: string[];
  roles: string[];
};
export type ToolsInventory = {
  adapters: Array<{ id: string; status: ToolStatus; version?: string; isolated: boolean; note: string }>;
  clis: CliInfo[];
  mcpServers: McpInfo[];
  connectors: Array<{ id: string; status: ToolStatus; detail: string }>;
};

const CLIS: Array<{ name: string; args: string[]; purpose: string }> = [
  { name: "git", args: ["--version"], purpose: "worktrees, commits, diffs" },
  { name: "gh", args: ["--version"], purpose: "pull requests and merges (server only)" },
  { name: "node", args: ["--version"], purpose: "runs Temper and project tooling" },
  { name: "pnpm", args: ["--version"], purpose: "installs dependencies in worktrees" },
  { name: "gitleaks", args: ["version"], purpose: "secret scan gate (falls back to a built-in scan)" },
];

async function version(cmd: string, args: string[]): Promise<{ status: ToolStatus; version?: string }> {
  const r = await run(cmd, args, { cwd: process.cwd(), timeoutMs: 10_000 });
  if (r.code === null && /ENOENT/.test(r.stderr)) return { status: "missing" };
  if (r.code !== 0) return { status: "error" };
  return { status: "ok", version: (r.stdout || r.stderr).trim().split("\n")[0]?.slice(0, 80) };
}

/** What agents can use, and what is installed: never includes secret values, only their names. */
export async function inventory(profile: Profile, agents: Agent[], config: Pick<Config, "claudeBin" | "codexBin" | "codexHome">): Promise<ToolsInventory> {
  const rolesWith = (name: string) => agents.filter((a) => a.mcpServers.includes(name)).map((a) => a.role);
  const claude = await version(config.claudeBin, ["--version"]);
  const codexBin = resolveBin(config.codexBin);
  const codex = await version(codexBin.file, [...codexBin.args, "--version"]);
  const codexLogin = codexAccount(config.codexHome);
  const github = profile.github?.user;
  return {
    adapters: [
      {
        id: "claude-cli",
        ...claude,
        isolated: true,
        note: "Each run uses the logged-in CLI with only Temper-assigned skills and MCP servers; no user skills, plugins, hooks or memory.",
      },
      ...(profile.adapters.includes("codex-cli") || codex.status === "ok"
        ? [
            {
              id: "codex-cli",
              ...codex,
              isolated: true,
              note: codexLogin.loggedIn
                ? "Each run uses Temper's own Codex login (not ~/.codex) with only Temper-assigned skills and MCP servers; no user config, AGENTS.md, hooks, plugins or memories."
                : "Not signed in for Temper: run `temper codex login`. Temper keeps its own Codex login, apart from ~/.codex.",
            },
          ]
        : []),
    ],
    clis: await Promise.all(CLIS.map(async (c) => ({ name: c.name, purpose: c.purpose, ...(await version(c.name, c.args)) }))),
    mcpServers: [
      {
        name: "temper",
        builtIn: true,
        description: "Temper's own server: knowledge search for every agent; knowledge writes and ticket delegation for the Chief of Staff.",
        command: "temper-mcp (per run, scoped capability token)",
        envKeys: ["TEMPER_API_URL", "TEMPER_CAPABILITY"],
        roles: rolesWith("temper"),
      },
      ...Object.entries(profile.mcpServers).map(([name, cfg]) => ({
        name,
        builtIn: false,
        description: cfg.description ?? "",
        command: [cfg.command, ...(cfg.args ?? [])].join(" ").slice(0, 200),
        envKeys: Object.keys(cfg.env ?? {}),
        roles: rolesWith(name),
      })),
    ],
    connectors: [
      {
        id: "github",
        status: github ? "ok" : "missing",
        detail: github ? `PRs, merges and branch cleanup as ${github}` : "No GitHub account pinned in the profile; the server would use gh's active account.",
      },
    ],
  };
}
