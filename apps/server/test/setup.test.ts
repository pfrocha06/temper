// SEC-02 (#37): setup commands run repository code (install scripts). They run in the sandbox,
// writing only their folder and the package caches and reaching only the package registries;
// a setup counts as done only when it last succeeded for this exact command and these lockfiles.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecResult } from "../src/exec.ts";
import { gateScratchRoot, type Sandbox } from "../src/sandbox.ts";
import { runSetupCommand, runSetupOnce, setupKey } from "../src/setup.ts";

const srtAvailable = process.platform === "darwin" || process.env.TEMPER_TEST_SRT === "1";
const done = (code: number | null, timedOut = false): ExecResult => ({ code, stdout: "", stderr: "", timedOut });

describe("runSetupOnce", () => {
  const dir = mkdtempSync(join(tmpdir(), "temper-setup-"));
  const marker = join(dir, "setup-ok");

  it("records a success and skips the same setup next time", async () => {
    let runs = 0;
    const run = async () => (runs++, done(0));
    expect((await runSetupOnce(marker, "k1", run)).ran).toBe(true);
    expect((await runSetupOnce(marker, "k1", run)).ran).toBe(false);
    expect(runs).toBe(1);
  });

  it("runs again when the command or the lockfiles change", async () => {
    expect((await runSetupOnce(marker, "k2", async () => done(0))).ran).toBe(true);
  });

  it("never leaves a marker after a failure or a timeout, even a stale one", async () => {
    expect(existsSync(marker)).toBe(true);
    await runSetupOnce(marker, "k3", async () => done(1));
    expect(existsSync(marker)).toBe(false);
    await runSetupOnce(marker, "k3", async () => done(0, true));
    expect(existsSync(marker)).toBe(false);
    // So the failed setup is retried rather than skipped.
    let retried = false;
    await runSetupOnce(marker, "k3", async () => ((retried = true), done(0)));
    expect(retried).toBe(true);
  });

  it("keys a setup on the command and the lockfiles", () => {
    const cwd = mkdtempSync(join(tmpdir(), "temper-setup-key-"));
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "a: 1\n");
    const k = setupKey("pnpm install", cwd);
    expect(setupKey("pnpm install --prod", cwd)).not.toBe(k);
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "a: 2\n");
    expect(setupKey("pnpm install", cwd)).not.toBe(k);
  });
});

/** A postinstall that tries every way out, then does what an install does. */
const POSTINSTALL = String.raw`
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import net from "node:net";
const a = JSON.parse(readFileSync("args.json", "utf8"));
const say = (l) => console.log(l);
const read = (label, f) => { try { say(label + " LEAK " + readFileSync(f, "utf8")); } catch (e) { say(label + " DENIED " + (e.code ?? "")); } };
read("secret", a.secret);
read("holdouts", a.holdout);
read("other-worktree", a.otherWorktree);
read("personal", a.personal);
try { say("child-secret LEAK " + execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", a.secret], { stdio: ["ignore", "pipe", "ignore"] })); } catch { say("child-secret DENIED"); }
try { writeFileSync(a.outside + "/planted.txt", "x"); say("write-outside LEAK"); } catch (e) { say("write-outside DENIED " + (e.code ?? "")); }
say("env " + (process.env.TEMPER_PROBE_SECRET ? "LEAK " + process.env.TEMPER_PROBE_SECRET : "absent"));

// Package managers go through srt's proxy (HTTPS_PROXY); a CONNECT shows what it lets through.
const viaProxy = (host) => new Promise((resolve) => {
  const p = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!p) return resolve("no-proxy");
  const proxy = new URL(p);
  const auth = proxy.username ? "Proxy-Authorization: Basic " + Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64") + "\r\n" : "";
  const s = net.connect(Number(proxy.port), proxy.hostname, () => s.write("CONNECT " + host + " HTTP/1.1\r\nHost: " + host + "\r\n" + auth + "\r\n"));
  s.once("data", (d) => { resolve(/^HTTP\/1\.[01] 200/.test(d.toString("latin1")) ? "OPEN" : "REFUSED"); s.destroy(); });
  s.on("error", () => resolve("REFUSED"));
  setTimeout(() => (s.destroy(), resolve("REFUSED")), 10000);
});
say("registry " + (await viaProxy(a.registry)));
say("internet " + (await viaProxy("example.com:443")));
say("direct-internet " + (await fetch("https://example.com").then((r) => "LEAK " + r.status, () => "DENIED")));

// What a real install does: write into the project and the package cache.
mkdirSync("node_modules/dep", { recursive: true });
writeFileSync("node_modules/dep/index.js", "module.exports = 1;");
writeFileSync(a.cache + "/entry", "cached");
say("install OK");
`;

describe("runSetupCommand", () => {
  let root: string;
  let registry: Server;
  let args: Record<string, string>;
  let policy: (mode: Sandbox["mode"]) => { sandbox: Sandbox; cwd: string; caches: string[]; domains: string[] };

  beforeAll(async () => {
    root = mkdtempSync(join(gateScratchRoot(), "temper-setup-sbx-"));
    const dir = (...p: string[]) => (mkdirSync(join(root, ...p), { recursive: true }), join(root, ...p));
    const secrets = dir("home", "secrets");
    const personal = dir("user", ".aws");
    const worktrees = dir("worktrees");
    const cwd = dir("worktrees", "tkt_a");
    const other = dir("worktrees", "tkt_b");
    const holdouts = dir("holdouts");
    const cache = dir("cache");
    const outside = dir("outside");
    writeFileSync(join(secrets, "board-token"), "CANARY-secret");
    writeFileSync(join(personal, "credentials"), "CANARY-personal");
    writeFileSync(join(other, "notes.txt"), "CANARY-other");
    writeFileSync(join(holdouts, "a.holdout.mjs"), "CANARY-holdout");
    // Stands in for a package registry on the host.
    registry = createServer((_q, s) => s.end("{}"));
    await new Promise<void>((r) => registry.listen(0, "127.0.0.1", r));
    const reg = `127.0.0.1:${(registry.address() as { port: number }).port}`;
    args = { secret: join(secrets, "board-token"), personal: join(personal, "credentials"), otherWorktree: join(other, "notes.txt"), holdout: join(holdouts, "a.holdout.mjs"), outside, cache, registry: reg };
    writeFileSync(join(cwd, "postinstall.mjs"), POSTINSTALL);
    writeFileSync(join(cwd, "args.json"), JSON.stringify(args));
    // The project setup's policy, as the factory builds it.
    policy = (mode) => ({
      sandbox: { mode, denyRead: [secrets, personal, worktrees, holdouts], allowRead: [cwd] },
      cwd,
      caches: [cache],
      domains: [reg],
    });
  });

  afterAll(() => {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function setup(mode: Sandbox["mode"]) {
    const p = policy(mode);
    process.env.TEMPER_PROBE_SECRET = "SECRET-setup-probe";
    try {
      const r = await runSetupCommand(`"${process.execPath}" postinstall.mjs`, p.sandbox, { cwd: p.cwd, caches: p.caches, domains: p.domains, timeoutMs: 120_000 });
      return r.stdout + r.stderr;
    } finally {
      delete process.env.TEMPER_PROBE_SECRET;
    }
  }

  // Without the sandbox the same script gets out: proves the test notices a missing boundary.
  it("lets a hostile install script read and write when the sandbox is off", async () => {
    const out = await setup("off");
    expect(out).toMatch(/^secret LEAK CANARY-secret/m);
    expect(out).toMatch(/^write-outside LEAK/m);
    expect(out).toMatch(/^env absent/m);
    rmSync(join(args.outside!, "planted.txt"), { force: true });
  }, 60_000);

  it.runIf(srtAvailable)(
    "under srt: installs into the project and the cache, reaches the registry, and nothing else",
    async () => {
      const out = await setup("srt");
      expect(out, out).toMatch(/^install OK/m);
      expect(out).not.toMatch(/CANARY-|SECRET-setup/);
      for (const label of ["secret", "holdouts", "other-worktree", "personal", "child-secret", "write-outside"]) {
        expect(out).toMatch(new RegExp(`^${label} DENIED`, "m"));
      }
      expect(out).toMatch(/^env absent/m);
      expect(out).toMatch(/^registry OPEN/m);
      expect(out).toMatch(/^internet REFUSED/m);
      expect(out).toMatch(/^direct-internet DENIED/m);
      expect(readFileSync(join(args.cache!, "entry"), "utf8")).toBe("cached");
      expect(existsSync(join(args.outside!, "planted.txt"))).toBe(false);
    },
    180_000,
  );
});
