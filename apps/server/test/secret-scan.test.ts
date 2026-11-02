// SEC-05 (#40): the secret scan before any push is gitleaks or nothing. A missing, outdated,
// failing or stuck scanner fails the gate; only a clean gitleaks run passes it.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanCommits, scanThenPush } from "../src/gates/secret-scan.ts";

const fake = (mode: string) => [process.execPath, join(import.meta.dirname, "fixtures", "fake-gitleaks.mjs"), mode];
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A fake AWS key in gitleaks' own test format; not a real credential.
const FAKE_KEY = ["AKIA", "QYLPMN5HHHFPZAM2"].join("");

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "temper-scan-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "ticket");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("scanCommits fails closed", () => {
  it("fails when gitleaks is not installed, saying how to install it", async () => {
    const r = await scanCommits(repo, "main", ["temper-no-such-gitleaks"]);
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/gitleaks is required/);
    expect(r.report).toMatch(/TEMPER_GITLEAKS/);
  });

  it("fails on a gitleaks older than the minimum", async () => {
    const r = await scanCommits(repo, "main", fake("old"));
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/8\.0\.0 is older than 8\.18\.0/);
  });

  it("fails when the scan errors, rather than counting it as clean", async () => {
    const r = await scanCommits(repo, "main", fake("error"));
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/gitleaks failed \(exit 2\)/);
  });

  it("fails when the scan times out", async () => {
    const r = await scanCommits(repo, "main", fake("hang"), { timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/timed out/);
  });

  it("reports findings by rule, file and line, never the secret", async () => {
    const r = await scanCommits(repo, "main", fake("leak"));
    expect(r.ok).toBe(false);
    expect(r.report).toContain("aws-access-token in src/config.ts:3 (commit abc1234de)");
    expect(r.report).not.toContain("REDACTED");
  });

  it("passes a clean scan", async () => {
    expect(await scanCommits(repo, "main", fake("clean"))).toEqual({ ok: true, report: "gitleaks 8.30.1: no leaks in main..HEAD" });
  });
});

const gitleaks = spawnSync("gitleaks", ["version"]).status === 0;

// CI installs a pinned gitleaks on every platform; locally these run when it is on PATH.
describe.runIf(gitleaks || process.env.CI)("scanCommits with the real gitleaks", () => {
  it("passes clean commits", async () => {
    writeFileSync(join(repo, "notes.md"), "nothing secret here\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "clean");
    const r = await scanCommits(repo, "main", ["gitleaks"]);
    expect(r).toMatchObject({ ok: true });
  });

  it("blocks a commit that adds a key, without echoing it", async () => {
    writeFileSync(join(repo, "config.ts"), `export const awsKey = "${FAKE_KEY}";\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "oops");
    const r = await scanCommits(repo, "main", ["gitleaks"]);
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/config\.ts:1/);
    expect(r.report).not.toContain(FAKE_KEY);
  });
});

describe("scanThenPush", () => {
  const remoteHas = (remote: string, branch: string) => git(remote, "branch", "--list", branch) !== "";

  it("pushes nothing when the scan does not pass, and pushes a clean branch", async () => {
    const remote = mkdtempSync(join(tmpdir(), "temper-remote-"));
    try {
      git(remote, "init", "-q", "--bare");
      const push = async (cwd: string, branch: string) => void git(cwd, "push", "-q", remote, `${branch}:${branch}`);

      for (const bin of [["temper-no-such-gitleaks"], fake("leak"), fake("error")]) {
        expect((await scanThenPush(repo, "main", "ticket", bin, push)).ok).toBe(false);
        expect(remoteHas(remote, "ticket")).toBe(false);
      }
      expect((await scanThenPush(repo, "main", "ticket", fake("clean"), push)).ok).toBe(true);
      expect(remoteHas(remote, "ticket")).toBe(true);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });
});
