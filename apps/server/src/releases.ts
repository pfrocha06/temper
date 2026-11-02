import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, runShell } from "./exec.ts";

export type ReleaseState = {
  current?: string;
  previous?: string;
  /** The checkout releases are built from, and updates fetched into. */
  source?: string;
  history: Array<{ tag: string; at: string; event: string }>;
};

export const releasesDir = (home: string) => join(home, "releases");
export const currentLink = (home: string) => join(home, "current");
const stateFile = (home: string) => join(releasesDir(home), "state.json");

export function readState(home: string): ReleaseState {
  return existsSync(stateFile(home)) ? JSON.parse(readFileSync(stateFile(home), "utf8")) : { history: [] };
}

function writeState(home: string, s: ReleaseState) {
  mkdirSync(releasesDir(home), { recursive: true });
  writeFileSync(stateFile(home), JSON.stringify(s, null, 2) + "\n");
}

/**
 * Points `current` at a release and records the transition. Pure filesystem; no restarts.
 * A deploy makes the old current the previous; a rollback swaps current and previous.
 */
export function activate(home: string, tag: string, event: "deploy" | "rollback", source?: string): ReleaseState {
  const target = join(releasesDir(home), tag);
  if (!existsSync(target)) throw new Error(`release ${tag} is not built`);
  const state = readState(home);
  const link = currentLink(home);
  if (existsSync(link) || lstatSafe(link)) unlinkSync(link);
  symlinkSync(target, link);
  const next: ReleaseState = {
    ...((source ?? state.source) ? { source: source ?? state.source } : {}),
    current: tag,
    previous: state.current === tag ? state.previous : state.current,
    history: [...state.history, { tag, at: new Date().toISOString(), event }].slice(-50),
  };
  writeState(home, next);
  return next;
}

function lstatSafe(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export type Log = (line: string) => void;

/** Builds a release from a git ref of the source repo into releases/<tag>, then verifies it. */
export async function buildRelease(home: string, sourceRepo: string, ref: string, log: Log): Promise<string> {
  const sha = (await run("git", ["rev-parse", "--short=10", ref], { cwd: sourceRepo })).stdout.trim();
  if (!sha) throw new Error(`unknown ref ${ref}`);
  const tag = `${new Date().toISOString().slice(0, 10)}-${sha}`;
  const dir = join(releasesDir(home), tag);
  if (existsSync(dir)) {
    log(`release ${tag} already built`);
    return tag;
  }
  mkdirSync(releasesDir(home), { recursive: true });
  const step = async (what: string, cmd: string, cwd: string) => {
    log(`→ ${what}`);
    const r = await runShell(cmd, { cwd, timeoutMs: 30 * 60_000 });
    if (r.code !== 0) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`${what} failed:\n${(r.stdout + r.stderr).slice(-3000)}`);
    }
  };
  await step("clone", `git clone -q --no-hardlinks "${sourceRepo}" "${dir}" && git -C "${dir}" checkout -q ${sha}`, home);
  await step("install", "pnpm install --frozen-lockfile", dir);
  await step("verify (pnpm check)", "pnpm check", dir);
  if (existsSync(join(dir, "apps/web/package.json"))) await step("build web", "pnpm --filter @temper/web build", dir);
  return tag;
}

/** Copies the live database aside before a deploy touches it. The service must be stopped. */
export function backupDatabase(home: string, instance = "main"): string | undefined {
  const db = join(home, "instances", instance, "db");
  if (!existsSync(db)) return undefined;
  const dest = join(home, "backups", `${instance}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(join(home, "backups"), { recursive: true });
  try {
    cpSync(db, dest, { recursive: true });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err;
  }
  return dest;
}

/** Waits until nothing answers on the port: the old server has exited and closed its database. */
export async function waitStopped(port: number, timeoutMs = 30_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      // Connection refused: give the process a moment to release file handles after its socket closes.
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export function restoreDatabase(home: string, backup: string, instance = "main"): void {
  const db = join(home, "instances", instance, "db");
  rmSync(db, { recursive: true, force: true });
  cpSync(backup, db, { recursive: true });
}

export async function waitHealthy(port: number, timeoutMs = 30_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok && ((await res.json()) as { ok?: unknown }).ok === true) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
