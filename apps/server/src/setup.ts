// Setup commands (SEC-02): the project's install in each worktree and the holdouts' own install.
// They run repository-controlled code (install scripts, postinstall hooks), so they run in the
// sandbox like the Builder's tests: no Temper secret, no user credential, no other worktree, and
// network only to package registries. A setup is done only when it last succeeded for exactly
// this command and these lockfiles.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runSandboxed, type ExecResult } from "./exec.ts";
import { windowsGateRoot, type Sandbox } from "./sandbox.ts";

/** Package registries a setup may reach unless TEMPER_SETUP_ALLOW_DOMAINS says otherwise. */
export const DEFAULT_SETUP_DOMAINS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "registry.npmmirror.com",
  // git and tarball dependencies, and binaries packages download in postinstall (Playwright's too)
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "cdn.playwright.dev",
  "playwright.download.prss.microsoft.com",
];

/**
 * Package-manager caches a setup may write: pnpm's store, npm's and yarn's caches, the XDG cache.
 * On Windows srt's account cannot reach the user's profile, so Temper keeps one under ProgramData
 * and points pnpm and npm at it (see setupEnv).
 */
export function setupCaches(home = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [join(windowsGateRoot(), "cache")];
  const candidates = [".cache", ".npm", ".local/share/pnpm", ".yarn", "Library/pnpm", "Library/Caches"];
  return candidates.map((p) => join(home, p)).filter((p) => existsSync(p));
}

/** Variables that send package managers to caches the sandbox may write. */
export function setupEnv(platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (platform !== "win32") return {};
  const cache = join(windowsGateRoot(), "cache");
  mkdirSync(cache, { recursive: true });
  return { npm_config_store_dir: join(cache, "pnpm-store"), npm_config_cache: join(cache, "npm") };
}

const LOCKFILES = ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];

/** What a finished setup was for: the command and the manifests it installed. */
export function setupKey(command: string, cwd: string): string {
  const manifests = LOCKFILES.map((f) => join(cwd, f))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\0");
  return createHash("sha256").update(command + "\0" + manifests).digest("hex").slice(0, 32);
}

/**
 * Runs `run` unless `marker` records a success for `key`. The marker is cleared first and written
 * only after a success, so a failed, cancelled or timed-out setup is retried, never skipped.
 */
export async function runSetupOnce(marker: string, key: string, run: () => Promise<ExecResult>): Promise<{ ran: boolean; result?: ExecResult }> {
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === key) return { ran: false };
  rmSync(marker, { force: true });
  const result = await run();
  if (result.code === 0 && !result.timedOut) writeFileSync(marker, key);
  return { ran: true, result };
}

/** Runs one setup command under the sandbox: writes `cwd` and the caches, reaches `domains`. */
export function runSetupCommand(
  command: string,
  sandbox: Sandbox,
  opts: { cwd: string; domains: string[]; caches: string[]; signal?: AbortSignal; timeoutMs?: number },
): Promise<ExecResult> {
  return runSandboxed(command, sandbox, {
    cwd: opts.cwd,
    allowWrite: opts.caches,
    domains: opts.domains,
    env: setupEnv(),
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 20 * 60_000,
  });
}
