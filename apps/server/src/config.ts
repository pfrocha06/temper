import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsGateRoot, type SandboxMode } from "./sandbox.ts";
import { DEFAULT_SETUP_DOMAINS } from "./setup.ts";

export type Config = {
  /** Root of all Temper state: releases, instances, worktrees. */
  home: string;
  /** Instance name; `main` for the live service, `rc` for a release candidate. */
  instance: string;
  dataDir: string;
  worktreesDir: string;
  port: number;
  /** The Temper checkout this process runs from (workflows/, skills/, apps/web/dist). */
  appRoot: string;
  heartbeatMs: number;
  claudeBin: string;
  codexBin: string;
  /** Temper's own CODEX_HOME (only the Codex login lives there); inside secrets, so no agent can read it. */
  codexHome: string;
  /**
   * Where projects' holdouts live unless the board names a folder (TEMPER_HOLDOUTS_ROOT). On Windows
   * the gate runs holdouts as srt's sandbox account, which cannot read inside the user's profile,
   * so they live under %ProgramData%	emper there; the Builder's code is denied them everywhere.
   */
  holdoutsRoot: string;
  /** Hosts setup commands may reach (TEMPER_SETUP_ALLOW_DOMAINS, comma-separated; default: public package registries). */
  setupDomains: string[];
  /** Board token file (mode 0600). Agents are always denied this directory. */
  secretsDir: string;
  /** Sandbox for Builder code the server runs itself (tests, the candidate app). `off` only for development. */
  gateSandbox: SandboxMode;
  /** Extra paths gate commands may read (Windows: per-user tool installs the sandbox account cannot see). */
  gateAllowRead: string[];
};

/** Temper's own secrets and data: no agent run and no sandboxed gate command may read them. */
export const protectedDirs = (c: Config) => [c.secretsDir, join(c.home, "instances"), join(c.home, "backups")];

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.TEMPER_HOME ?? join(homedir(), ".temper");
  const instance = env.TEMPER_INSTANCE ?? "main";
  return {
    home,
    instance,
    dataDir: join(home, "instances", instance, "db"),
    // On Windows the gate sandbox cannot reach inside your profile (see sandbox.ts).
    worktreesDir: env.TEMPER_WORKTREES ?? (process.platform === "win32" ? join(windowsGateRoot(), "worktrees", instance) : join(home, "worktrees")),
    port: Number(env.TEMPER_PORT ?? env.PORT ?? (instance === "rc" ? 4601 : 4600)),
    appRoot: env.TEMPER_APP_ROOT ?? appRoot,
    heartbeatMs: Number(env.TEMPER_HEARTBEAT_MS ?? 15_000),
    claudeBin: env.TEMPER_CLAUDE_BIN ?? "claude",
    codexBin: env.TEMPER_CODEX_BIN ?? "codex",
    codexHome: env.TEMPER_CODEX_HOME ?? join(home, "secrets", "codex"),
    secretsDir: join(home, "secrets"),
    setupDomains: env.TEMPER_SETUP_ALLOW_DOMAINS ? env.TEMPER_SETUP_ALLOW_DOMAINS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_SETUP_DOMAINS,
    holdoutsRoot: env.TEMPER_HOLDOUTS_ROOT ?? (process.platform === "win32" ? join(windowsGateRoot(), "holdouts") : join(home, "holdouts")),
    gateSandbox: env.TEMPER_GATE_SANDBOX === "off" ? "off" : "srt",
    gateAllowRead: (env.TEMPER_GATE_ALLOW_READ ?? "").split(delimiter).filter(Boolean),
  };
}
