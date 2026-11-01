// The permission profile, enforced for real by `codex sandbox` (no login, no model).
// Runs when TEMPER_TEST_CODEX=1 (CI installs the Codex CLI on every platform).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunRequest } from "@temper/core";
import { resolveBin, sandboxArgs } from "../src/index.ts";

const enabled = process.env.TEMPER_TEST_CODEX === "1";
// Codex refuses helper binaries under the temp dir, so CI may point this somewhere else.
const codexHome = process.env.TEMPER_TEST_CODEX_HOME ?? mkdtempSync(join(tmpdir(), "codex-home-"));
mkdirSync(codexHome, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "codex-sbx-"));
const dir = (name: string) => {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
};
const work = dir("work");
const extra = dir("extra");
const candidate = dir("candidate");
const holdouts = dir("holdouts");
writeFileSync(join(holdouts, "canary.txt"), "CANARY-codex-sbx");

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  cwd: work,
  prompt: "",
  allowedTools: [],
  disallowedTools: [],
  addDirs: [extra],
  readOnlyDirs: [candidate],
  denyDirs: [holdouts],
  ...over,
});

/** Runs a Node one-liner inside Codex's sandbox and returns what it printed. */
function inSandbox(code: string, r = req()): Promise<string> {
  const bin = resolveBin(process.env.TEMPER_CODEX_BIN ?? "codex");
  const args = [...bin.args, "sandbox", ...sandboxArgs(r), "--permissions-profile", "temper", "-C", r.cwd, "--", process.execPath, "-e", code];
  return new Promise((resolve) => {
    const child = spawn(bin.file, args, { cwd: r.cwd, env: { ...process.env, CODEX_HOME: codexHome } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out));
  });
}
const tryWrite = (file: string) => `try{require('fs').writeFileSync(${JSON.stringify(file)},'x');console.log('WROTE')}catch(e){console.log('DENIED',e.code)}`;

describe.runIf(enabled)("codex sandbox enforces the run's permission profile", () => {
  let app: Server;
  let appUrl = "";
  beforeAll(async () => {
    app = createServer((_q, s) => s.end("HOSTAPP")).listen(0, "127.0.0.1");
    await new Promise((r) => app.once("listening", r));
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  it("cannot read a denied directory by any route", async () => {
    const file = join(holdouts, "canary.txt");
    const out = await inSandbox(
      `const fs=require('fs');for(const f of [()=>fs.readFileSync(${JSON.stringify(file)},'utf8'),()=>fs.readdirSync(${JSON.stringify(holdouts)}).join(','),()=>require('child_process').execFileSync(process.execPath,['-e','process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))',${JSON.stringify(file)}]).toString()]){try{console.log('GOT',f())}catch(e){console.log('DENIED',e.code||e.status)}}`,
    );
    expect(out).not.toContain("CANARY-codex-sbx");
    expect(out).not.toContain("GOT");
    expect(out.match(/DENIED/g)?.length).toBe(3);
  });

  it("writes the workspace and extra dirs, never the candidate or a denied dir", async () => {
    expect(await inSandbox(tryWrite(join(work, "w.txt")))).toContain("WROTE");
    expect(await inSandbox(tryWrite(join(extra, "w.txt")))).toContain("WROTE");
    expect(await inSandbox(tryWrite(join(candidate, "w.txt")))).toContain("DENIED");
    expect(await inSandbox(tryWrite(join(holdouts, "w.txt")))).toContain("DENIED");
    expect(existsSync(join(candidate, "w.txt")) || existsSync(join(holdouts, "w.txt"))).toBe(false);
  });

  it("writes nothing at all in a read-only run", async () => {
    expect(await inSandbox(tryWrite(join(work, "ro.txt")), req({ readOnly: true }))).toContain("DENIED");
  });

  const net = `fetch('https://example.com').then(r=>console.log('NET',r.status)).catch(e=>console.log('NETERR',e.cause?.code||e.message))`;

  it("reaches its own servers, never the internet", async () => {
    const out = await inSandbox(`const s=require('http').createServer((q,r)=>r.end('SELF')).listen(0,'127.0.0.1',()=>fetch('http://127.0.0.1:'+s.address().port).then(r=>r.text()).then(t=>{console.log('SELF',t);s.close()},e=>{console.log('SELFERR',e.cause?.code||e.message);s.close()}));${net}`);
    expect(out).toContain("SELF SELF");
    expect(out).toContain("NETERR");
    expect(out).not.toMatch(/NET d/);
  });

  it("reaches the candidate app on the host's loopback when the run needs it, never the internet", async () => {
    const out = await inSandbox(`fetch(${JSON.stringify(appUrl)}).then(r=>r.text()).then(t=>console.log('LOOP',t)).catch(e=>console.log('LOOPERR',e.cause?.code||e.message));${net}`, req({ hostLoopback: true }));
    expect(out).toContain("LOOP HOSTAPP");
    expect(out).toContain("NETERR");
    expect(out).not.toMatch(/NET d/);
  });
});
