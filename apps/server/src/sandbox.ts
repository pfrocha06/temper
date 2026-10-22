import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * How commands that run Builder-controlled code (the test command, the candidate app) are
 * confined. `srt` is Anthropic's sandbox runtime, the same one agent runs use; `off` runs them
 * directly and is only for development on platforms srt does not support.
 */
export type SandboxMode = "srt" | "off";

export type Sandbox = {
  mode: SandboxMode;
  /** Directories the command may never read: holdouts and Temper's own secrets and data. */
  denyRead: string[];
};

/** A command ready to spawn without a shell, and what to remove once it exits. */
export type SandboxedCommand = { file: string; args: string[]; shell: boolean; env: NodeJS.ProcessEnv; dispose: () => void };

/**
 * Environment a sandboxed command keeps. Everything else (git host and API tokens, the board
 * token, TEMPER_*) is dropped: the command is the Builder's code.
 */
const KEEP_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "CI", "PNPM_HOME", "SYSTEMROOT", "COMSPEC", "PATHEXT"];

export function sandboxEnv(extra: Record<string, string> = {}, tmp?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (tmp) Object.assign(env, { TMPDIR: tmp, TMP: tmp, TEMP: tmp });
  return { ...env, ...extra };
}

const srtCli = () => createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime/dist/cli.js");

/** The srt settings for one command: no outbound network, writes only to `allowWrite`. */
export function srtSettings(denyRead: string[], allowWrite: string[]): Record<string, unknown> {
  return {
    // Tests and the candidate app listen on 127.0.0.1, and holdouts reach the app there.
    network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: true },
    filesystem: { denyRead, allowRead: [], allowWrite, denyWrite: [] },
  };
}

/**
 * Prepares `command` (a shell command line) to run in `cwd` under the sandbox. The command may
 * write only `cwd`, a private temp dir (its TMPDIR) and `allowWrite`.
 */
export function sandboxed(sandbox: Sandbox, command: string, opts: { cwd: string; allowWrite?: string[]; env?: Record<string, string> }): SandboxedCommand {
  const tmp = mkdtempSync(join(tmpdir(), "temper-gate-tmp-"));
  const env = sandboxEnv(opts.env, tmp);
  if (sandbox.mode === "off") {
    return { file: command, args: [], shell: true, env, dispose: () => rmSync(tmp, { recursive: true, force: true }) };
  }
  // The settings live outside every writable path, so the command cannot rewrite its own policy.
  const settingsDir = mkdtempSync(join(tmpdir(), "temper-srt-"));
  const settings = join(settingsDir, "srt-settings.json");
  writeFileSync(settings, JSON.stringify(srtSettings(sandbox.denyRead, [opts.cwd, tmp, ...(opts.allowWrite ?? [])])), { mode: 0o600 });
  return {
    file: process.execPath,
    args: [srtCli(), "--settings", settings, "-c", command],
    shell: false,
    env,
    dispose: () => {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(settingsDir, { recursive: true, force: true });
    },
  };
}
