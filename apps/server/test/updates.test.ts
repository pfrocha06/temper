import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { serviceKind, systemdUnit, unitEnvironment } from "../src/service.ts";
import { UpdateError, Updater, updateSource } from "../src/updates.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const commit = (repo: string, msg: string) => {
  writeFileSync(join(repo, "f.txt"), msg);
  git(repo, "add", "f.txt");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD");
};

let root: string;
let upstream: string;
let app: string;
let home: string;
let first: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "updates-"));
  upstream = join(root, "upstream");
  app = join(root, "app");
  home = join(root, "home");
  execFileSync("git", ["init", "-q", "-b", "main", upstream]);
  first = commit(upstream, "first");
  execFileSync("git", ["clone", "-q", upstream, app]);
});

describe("update check", () => {
  it("lists the commits on origin/main that the running checkout lacks, newest first", async () => {
    commit(upstream, "second");
    commit(upstream, "third");
    const u = new Updater({ home, appRoot: app, channel: "main", service: "systemd" });
    const s = await u.check();
    expect(s).toMatchObject({ current: first, behind: 2, diverged: false, latest: git(upstream, "rev-parse", "HEAD") });
    expect(s.commits.map((c) => c.subject)).toEqual(["third", "second"]);
    expect(s.error).toBeUndefined();
    expect(s.checkedAt).toBeDefined();
  });

  it("is up to date when origin has nothing new", async () => {
    expect(await new Updater({ home, appRoot: app, channel: "main" }).check()).toMatchObject({ behind: 0, commits: [], diverged: false });
  });

  it("offers nothing for a local commit origin does not have", async () => {
    commit(app, "local only");
    commit(upstream, "second");
    expect(await new Updater({ home, appRoot: app, channel: "main" }).check()).toMatchObject({ diverged: true, behind: 0 });
  });

  it("reports a failed fetch instead of throwing", async () => {
    git(app, "remote", "set-url", "origin", join(root, "missing"));
    const s = await new Updater({ home, appRoot: app, channel: "main" }).check();
    expect(s.error).toMatch(/git fetch/);
  });

  it("fetches into the checkout a release was cloned from", async () => {
    const release = join(home, "releases", "2026-11-02-abc");
    execFileSync("git", ["clone", "-q", app, release]);
    expect(await updateSource(home, release)).toBe(app);
    // A checkout outside releases is its own source, even when cloned from a local path.
    expect(await updateSource(home, app)).toBe(app);
  });
});

describe("applying an update", () => {
  it("starts deploy of origin's commit outside the service, once", async () => {
    const latest = commit(upstream, "second");
    const spawned: string[][] = [];
    const u = new Updater({ home, appRoot: app, channel: "main", service: "systemd", spawn: async (args) => void spawned.push(args) });
    await u.check();
    const s = await u.apply();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.slice(1)).toEqual(["deploy", "--ref", latest, "--source", app, "--when-idle"]);
    expect(spawned[0]![0]).toMatch(/apps[\\/]server[\\/]src[\\/]cli\.ts$/);
    expect(s.applying).toMatchObject({ target: latest });
    await expect(u.apply()).rejects.toThrow(UpdateError);
  });

  it("refuses with nothing to apply, or no service to restart", async () => {
    const spawn = async () => {};
    const upToDate = new Updater({ home, appRoot: app, channel: "main", service: "systemd", spawn });
    await upToDate.check();
    await expect(upToDate.apply()).rejects.toThrow(/no update to apply/);
    commit(upstream, "second");
    const noService = new Updater({ home, appRoot: app, channel: "main", service: "none", spawn });
    await noService.check();
    await expect(noService.apply()).rejects.toThrow(/update by hand/);
  });
});

describe("systemd service", () => {
  it("is used on Linux with systemd, launchd on macOS, none elsewhere", () => {
    expect(serviceKind("linux", true)).toBe("systemd");
    expect(serviceKind("linux", false)).toBe("none");
    expect(serviceKind("darwin", false)).toBe("launchd");
    expect(serviceKind("win32", false)).toBe("none");
  });

  it("reads Environment= lines, quoted or not, several per line", () => {
    const unit = '[Service]\nEnvironment=HOME=/root\nEnvironment="A=one two" B=2\nExecStart=/usr/bin/node x\n';
    expect(unitEnvironment(unit)).toEqual({ HOME: "/root", A: "one two", B: "2" });
  });

  it("runs the current release, keeps the owner's environment and logs under TEMPER_HOME", () => {
    const unit = systemdUnit({ home: "/root/.temper", node: "/usr/bin/node", path: "/usr/bin:/bin", keepEnv: { HOME: "/root", TEMPER_HOME: "/elsewhere" }, user: false });
    expect(unit).toContain("WorkingDirectory=/root/.temper/current");
    expect(unit).toContain("ExecStart=/usr/bin/node /root/.temper/current/apps/server/src/main.ts");
    expect(unit).toContain('Environment="HOME=/root"');
    expect(unit).toContain('Environment="TEMPER_HOME=/root/.temper"');
    expect(unit).not.toContain("/elsewhere");
    expect(unit).toContain("StandardOutput=append:/root/.temper/logs/main.log");
    expect(unit).toContain("WantedBy=multi-user.target");
  });

  it("escapes quotes and percent signs in values", () => {
    const unit = systemdUnit({ home: "/h", node: "/n", path: "/p", keepEnv: { X: 'a"b%c' }, user: true });
    expect(unit).toContain('Environment="X=a\\"b%%c"');
    expect(unit).toContain("WantedBy=default.target");
  });
});

describe("update API", () => {
  it("reports status, refuses an apply with nothing new (409), and audits a started update", async () => {
    const { openDb, recentAudit } = await import("@temper/core");
    const { createApi } = await import("../src/api.ts");
    const { loadConfig } = await import("../src/config.ts");
    const { db, close } = await openDb();
    try {
      const updater = new Updater({ home, appRoot: app, channel: "main", service: "systemd", spawn: async () => {} });
      const api = createApi(db, {} as never, loadConfig({ TEMPER_HOME: home }), { updater });
      expect(await (await api.request("/api/update/check", { method: "POST" })).json()).toMatchObject({ current: first, behind: 0 });
      expect((await api.request("/api/update/apply", { method: "POST" })).status).toBe(409);
      const latest = commit(upstream, "second");
      expect(await (await api.request("/api/update/check", { method: "POST" })).json()).toMatchObject({ behind: 1 });
      const res = await api.request("/api/update/apply", { method: "POST" });
      expect(res.status).toBe(202);
      expect(await (await api.request("/api/update")).json()).toMatchObject({ applying: { target: latest } });
      expect((await recentAudit(db)).some((e) => e.kind === "update.started" && e.subject === latest)).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("deployOutcome", () => {
  it("reads how the latest deploy in the log ended", async () => {
    const { deployOutcome } = await import("../src/updates.ts");
    expect(deployOutcome("")).toBeUndefined();
    expect(deployOutcome("== deploy a\n→ install\n")).toBeUndefined();
    expect(deployOutcome("== deploy a\n✗ check failed\n== done: failed\n")).toBe("failed");
    expect(deployOutcome("== deploy a\n== done: failed\n== deploy b\n✓ deployed b\n== done: ok\n")).toBe("ok");
    expect(deployOutcome("== deploy a\n== done: ok\n== deploy b\n→ clone\n")).toBeUndefined();
  });
});

describe("releases channel", () => {
  const tag = (repo: string, name: string) => git(repo, "tag", name);

  it("offers nothing until there is a release", async () => {
    commit(upstream, "second");
    const s = await new Updater({ home, appRoot: app }).check();
    expect(s).toMatchObject({ channel: "releases", behind: 0, diverged: false });
    expect(s.latest).toBeUndefined();
    expect(s.version).toBe(first.slice(0, 7));
  });

  it("targets the newest vX.Y.Z tag on main, by version order, not the head", async () => {
    commit(upstream, "second");
    tag(upstream, "v0.9.0");
    const v010 = commit(upstream, "third");
    tag(upstream, "v0.10.0");
    tag(upstream, "v0.11.0-rc.1"); // not a release
    commit(upstream, "unreleased");
    const s = await new Updater({ home, appRoot: app }).check();
    expect(s).toMatchObject({ latest: v010, latestVersion: "v0.10.0", behind: 2, diverged: false });
    expect(s.commits.map((c) => c.subject)).toEqual(["third", "second"]);
  });

  it("is current when running the release, and when running main past it", async () => {
    tag(upstream, "v0.1.0");
    git(app, "fetch", "-q", "--tags");
    expect(await new Updater({ home, appRoot: app }).check()).toMatchObject({ version: "v0.1.0", behind: 0, diverged: false });
    commit(upstream, "after the release");
    git(app, "pull", "-q");
    const ahead = await new Updater({ home, appRoot: app }).check();
    expect(ahead).toMatchObject({ behind: 0, diverged: false, latestVersion: "v0.1.0" });
    expect(ahead.version).toMatch(/^v0\.1\.0-1-g[0-9a-f]{7}$/);
  });
});
