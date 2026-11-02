// Is a newer Temper on GitHub than the one running? The server fetches its source checkout's
// origin now and then and compares the running commit with the update target: the newest release
// tag (vX.Y.Z) on origin's branch by default, or the branch's head on the "main" channel.
// Applying an update runs `temper deploy` outside the service, which builds and verifies the new
// commit first and only then switches (see cli.ts deploy and service.ts spawnOutsideService).
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { repoFromRemote } from "@temper/plugin-github";
import { run } from "./exec.ts";
import { readState, releasesDir } from "./releases.ts";
import { serviceKind, spawnOutsideService, type ServiceKind } from "./service.ts";

export type UpdateCommit = { sha: string; subject: string };

/** "releases": the newest vX.Y.Z tag on origin's branch. "main": every commit merged there. */
export type UpdateChannel = "releases" | "main";

export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

export type UpdateStatus = {
  /** The commit this server runs. */
  current: string;
  /** What runs, as `git describe` says it: `v0.2.0`, or `v0.2.0-3-gabc1234` between releases. */
  version: string;
  branch: string;
  channel: UpdateChannel;
  /** The commit an update would install, after the last fetch. */
  latest?: string;
  /** Its name: the release tag, or the short commit on the main channel. */
  latestVersion?: string;
  /** The release's notes on GitHub, when origin is a GitHub repository. */
  notesUrl?: string;
  /** Commits in the update that the running commit does not have. */
  behind: number;
  /** Newest first, at most 30. */
  commits: UpdateCommit[];
  /** The running commit is not on origin/<branch> (a local or unmerged build): no update is offered. */
  diverged: boolean;
  checkedAt?: string;
  /** Why the last check failed (no network, not a git checkout, …). */
  error?: string;
  /** How an update is applied here; "none" means by hand. */
  service: ServiceKind;
  /** An update started from the console, and where its log is. */
  applying?: { startedAt: string; target: string; log: string; finished?: "ok" | "failed" };
};

const git = async (cwd: string, args: string[], timeoutMs = 60_000) => {
  const r = await run("git", args, { cwd, timeoutMs });
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
  return r.stdout.trim();
};

/**
 * The checkout updates are fetched into and releases are built from. A release is a clone of
 * that checkout (its `origin` is a local path); a checkout run directly is its own source.
 */
export async function updateSource(home: string, appRoot: string): Promise<string> {
  const recorded = readState(home).source;
  if (recorded && existsSync(join(recorded, ".git"))) return recorded;
  // Only a release (under <home>/releases) is a clone of the source; any other checkout is its own.
  const rel = relative(releasesDir(home), resolve(appRoot));
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    const origin = await git(appRoot, ["remote", "get-url", "origin"]).catch(() => "");
    if (origin && isAbsolute(origin) && existsSync(join(origin, ".git"))) return resolve(origin);
  }
  return appRoot;
}

export async function runningCommit(appRoot: string): Promise<string> {
  return git(appRoot, ["rev-parse", "HEAD"]);
}

/** `git describe` against release tags, or the short commit when there is none yet. */
export async function describeVersion(cwd: string): Promise<string> {
  const r = await run("git", ["describe", "--tags", "--match", "v[0-9]*", "--abbrev=7", "HEAD"], { cwd });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : git(cwd, ["rev-parse", "--short=7", "HEAD"]);
}

/** The newest release tag reachable from `ref`, by version order. */
export async function latestRelease(source: string, ref: string): Promise<string | undefined> {
  const tags = await git(source, ["tag", "--list", "v*", "--merged", ref, "--sort=-v:refname"]);
  return tags.split(/\r?\n/).find((t) => RELEASE_TAG.test(t.trim()))?.trim();
}

const isAncestor = async (cwd: string, a: string, b: string) => (await run("git", ["merge-base", "--is-ancestor", a, b], { cwd })).code === 0;

/** Fetches origin/<branch> and its tags into `source` and compares the channel's target with `current`. */
export async function compareWithOrigin(
  source: string,
  current: string,
  branch: string,
  channel: UpdateChannel = "releases",
): Promise<Pick<UpdateStatus, "latest" | "latestVersion" | "behind" | "commits" | "diverged">> {
  await git(source, ["fetch", "--quiet", "--tags", "--force", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], 120_000);
  const head = `origin/${branch}`;
  let latest: string;
  let latestVersion: string;
  if (channel === "main") {
    latest = await git(source, ["rev-parse", head]);
    latestVersion = latest.slice(0, 7);
  } else {
    const tag = await latestRelease(source, head);
    if (!tag) return { behind: 0, commits: [], diverged: false };
    latest = await git(source, ["rev-list", "-n", "1", tag]);
    latestVersion = tag;
  }
  // The running commit may only exist in a release clone, not in the source: then it is unknown here.
  const known = (await run("git", ["cat-file", "-e", `${current}^{commit}`], { cwd: source })).code === 0;
  // Already at or past the target (say, main ahead of the last release): nothing to install.
  if (known && (await isAncestor(source, latest, current))) return { latest, latestVersion, behind: 0, commits: [], diverged: false };
  if (!known || !(await isAncestor(source, current, latest))) return { latest, latestVersion, behind: 0, commits: [], diverged: true };
  const behind = Number(await git(source, ["rev-list", "--count", `${current}..${latest}`]));
  const log = behind ? await git(source, ["log", "--format=%h%x09%s", "-n", "30", `${current}..${latest}`]) : "";
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split("\t");
      return { sha: sha!, subject: rest.join("\t") };
    });
  return { latest, latestVersion, behind, commits, diverged: false };
}

export type UpdaterOptions = {
  home: string;
  appRoot: string;
  branch?: string;
  channel?: UpdateChannel;
  /** Overrides for tests. */
  service?: ServiceKind;
  spawn?: (args: string[], env: Record<string, string>, logFile: string) => Promise<void>;
};

/** Holds the last check, checks on a timer, and starts an update when the board asks. */
export class Updater {
  private status: UpdateStatus;
  private checking: Promise<UpdateStatus> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly branch: string;
  private readonly channel: UpdateChannel;
  private readonly opts: UpdaterOptions;

  constructor(opts: UpdaterOptions) {
    this.opts = opts;
    this.branch = opts.branch ?? "main";
    this.channel = opts.channel ?? "releases";
    this.status = { current: "", version: "", branch: this.branch, channel: this.channel, behind: 0, commits: [], diverged: false, service: opts.service ?? serviceKind() };
  }

  get(): UpdateStatus {
    const a = this.status.applying;
    if (a && !a.finished) {
      const finished = deployOutcome(this.logTail(400));
      if (finished) this.status = { ...this.status, applying: { ...a, finished } };
    }
    return this.status;
  }

  /** One check at a time; a second caller waits for the one in flight. */
  check(): Promise<UpdateStatus> {
    this.checking ??= this.doCheck().finally(() => (this.checking = undefined));
    return this.checking;
  }

  private async doCheck(): Promise<UpdateStatus> {
    const base = { ...this.status, checkedAt: new Date().toISOString() };
    try {
      const current = await runningCommit(this.opts.appRoot);
      const version = await describeVersion(this.opts.appRoot);
      const source = await updateSource(this.opts.home, this.opts.appRoot);
      const { latest, latestVersion, ...rest } = await compareWithOrigin(source, current, this.branch, this.channel);
      const repo = repoFromRemote(await git(source, ["remote", "get-url", "origin"]).catch(() => ""));
      const notesUrl = repo && latestVersion && RELEASE_TAG.test(latestVersion) ? `https://github.com/${repo}/releases/tag/${latestVersion}` : undefined;
      this.status = { ...base, current, version, latest, latestVersion, notesUrl, ...rest, error: undefined };
    } catch (e) {
      this.status = { ...base, error: (e as Error).message };
    }
    return this.status;
  }

  /** Checks now and then every `everyMs`; the timer never keeps the process alive. */
  start(everyMs = 30 * 60_000): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Starts `temper deploy` for origin/<branch> outside the service. It builds and runs the
   * checks first while the factory keeps working, then pauses dispatching, waits for running
   * work to finish, switches, and rolls back if the new release is not healthy.
   */
  async apply(): Promise<UpdateStatus> {
    const s = this.status;
    if (s.service === "none") throw new UpdateError("no service manager here to restart Temper; update by hand: git pull, then restart `temper serve`");
    if (s.applying && this.get().applying?.finished !== "failed") throw new UpdateError(`an update to ${s.applying.target.slice(0, 10)} is already running`);
    if (!s.latest || s.diverged || s.behind === 0) throw new UpdateError("no update to apply; check again first");
    const source = await updateSource(this.opts.home, this.opts.appRoot);
    const log = join(this.opts.home, "logs", "update.log");
    const args = [join(this.opts.appRoot, "apps", "server", "src", "cli.ts"), "deploy", "--ref", s.latest, "--source", source, "--when-idle"];
    const env: Record<string, string> = { TEMPER_HOME: this.opts.home, PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
    if (process.env.HOME) env.HOME = process.env.HOME;
    await (this.opts.spawn ?? ((a, e, l) => spawnOutsideService(this.opts.home, a, e, l)))(args, env, log);
    this.status = { ...s, applying: { startedAt: new Date().toISOString(), target: s.latest, log } };
    return this.status;
  }

  /** The end of the update log, for the console to show while an update runs. */
  logTail(lines = 60): string {
    const file = this.status.applying?.log ?? join(this.opts.home, "logs", "update.log");
    if (!existsSync(file)) return "";
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  }
}

/** How the last deploy in a log ended, or undefined while it runs. */
export function deployOutcome(log: string): "ok" | "failed" | undefined {
  const last = log.lastIndexOf("== deploy ");
  if (last < 0) return undefined;
  return /^== done: (ok|failed)$/m.exec(log.slice(last))?.[1] as "ok" | "failed" | undefined;
}

/** The board asked for something that cannot be done now; maps to HTTP 409. */
export class UpdateError extends Error {
  override name = "UpdateError";
}
