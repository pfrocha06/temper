// SEC-01 (#36): the holdouts gate runs Verifier-written code. Under srt it reads the candidate
// and reaches the candidate app, and nothing else: no Temper secret, no other ticket's worktree,
// no user credential, no write to the holdouts or the candidate, no internet, no server env.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { srtAvailable } from "./helpers/srt.ts";
import type { Project, Ticket } from "@temper/core";
import { runSandboxed } from "../src/exec.ts";
import { holdouts, type GateContext } from "../src/gates/run.ts";
import { gateScratchRoot, type Sandbox } from "../src/sandbox.ts";


/** A holdout runner that tries every way out, then does what a real holdout does. */
const RUNNER = String.raw`
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import net from "node:net";
const a = JSON.parse(readFileSync(new URL("./args.json", import.meta.url), "utf8"));
const say = (l) => console.log(l);
const read = (label, f) => { try { say(label + " LEAK " + readFileSync(f, "utf8")); } catch (e) { say(label + " DENIED " + (e.code ?? "")); } };
read("secret", a.secret);
read("other-worktree", a.otherWorktree);
read("personal", a.personal);
try { say("child-secret LEAK " + execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", a.secret], { stdio: ["ignore", "pipe", "ignore"] })); } catch { say("child-secret DENIED"); }
try { writeFileSync(new URL("./tampered.txt", import.meta.url), "x"); say("write-holdouts LEAK"); } catch (e) { say("write-holdouts DENIED " + (e.code ?? "")); }
try { writeFileSync(a.candidate + "/tampered.txt", "x"); say("write-candidate LEAK"); } catch (e) { say("write-candidate DENIED " + (e.code ?? "")); }
say("env " + (process.env.TEMPER_PROBE_SECRET ? "LEAK " + process.env.TEMPER_PROBE_SECRET : "absent"));

// Through srt's proxy on Linux (the holdouts template does the same); directly elsewhere.
const get = (url) => process.env.TEMPER_APP_VIA_PROXY !== "1" ? fetch(url).then((r) => r.text()) : new Promise((resolve, reject) => {
  const proxy = new URL(process.env.HTTP_PROXY), target = new URL(url);
  const auth = proxy.username ? "Proxy-Authorization: Basic " + Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64") + "\r\n" : "";
  const s = net.connect(Number(proxy.port), proxy.hostname, () => s.write("CONNECT " + target.host + " HTTP/1.1\r\nHost: " + target.host + "\r\n" + auth + "\r\n"));
  let buf = "", stage = 0;
  s.on("data", (d) => {
    buf += d.toString("latin1");
    if (stage === 0 && buf.includes("\r\n\r\n")) {
      if (!/^HTTP\/1\.[01] 200/.test(buf)) return s.destroy(), reject(new Error(buf.split("\r\n")[0]));
      stage = 1; buf = ""; s.write("GET / HTTP/1.0\r\nHost: " + target.host + "\r\n\r\n");
    }
  });
  s.on("end", () => resolve(buf));
  s.on("error", reject);
  setTimeout(() => (s.destroy(), reject(new Error("timeout"))), 10000);
});

say(readFileSync(process.env.TEMPER_CANDIDATE_PATH + "/candidate.txt", "utf8") === "CANDIDATE" ? "AC-1: PASS read the candidate" : "AC-1: FAIL");
if (process.env.TEMPER_APP_URL) {
  const app = await get(process.env.TEMPER_APP_URL).catch((e) => "ERR " + e.message);
  say(app.includes("APP-OK") ? "AC-2: PASS reached the candidate app" : "AC-2: FAIL " + app.slice(0, 120));
}
say("internet " + (await fetch("https://example.com").then((r) => "LEAK " + r.status, () => "DENIED")));
say("other-port " + (await get(a.otherUrl).then((b) => (b.includes("NOT-THE-APP") ? "LEAK" : "DENIED"), () => "DENIED")));
`;

let root: string;
let ctx: GateContext;
let otherServer: { close: () => void };
const SECRET = "SECRET-holdouts-probe";

beforeAll(async () => {
  root = mkdtempSync(join(gateScratchRoot(), "temper-holdouts-sbx-"));
  const dir = (...p: string[]) => (mkdirSync(join(root, ...p), { recursive: true }), join(root, ...p));
  const secrets = dir("home", "secrets");
  const personal = dir("user", ".ssh");
  const worktrees = dir("worktrees");
  const candidate = dir("worktrees", "tkt_candidate");
  const other = dir("worktrees", "tkt_other");
  const holdoutsDir = dir("holdouts");
  writeFileSync(join(secrets, "board-token"), "CANARY-secret");
  writeFileSync(join(personal, "id_ed25519"), "CANARY-personal");
  writeFileSync(join(other, "notes.txt"), "CANARY-other");
  writeFileSync(join(candidate, "candidate.txt"), "CANDIDATE");
  writeFileSync(join(candidate, "app.js"), `require("http").createServer((q, s) => s.end("APP-OK")).listen(Number(process.env.PORT), "127.0.0.1");`);
  // Another service on the host's loopback that is not the app (stands in for the board API).
  const http = await import("node:http");
  const srv = http.createServer((_q, s) => s.end("NOT-THE-APP"));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  otherServer = srv;
  const otherUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  writeFileSync(join(holdoutsDir, "runner.mjs"), RUNNER);
  writeFileSync(join(holdoutsDir, "args.json"), JSON.stringify({ secret: join(secrets, "board-token"), personal: join(personal, "id_ed25519"), otherWorktree: join(other, "notes.txt"), candidate, otherUrl }));

  const project = { id: "p", holdoutsPath: holdoutsDir, holdoutsCommand: `"${process.execPath}" runner.mjs`, appCommand: `"${process.execPath}" app.js`, appHealthPath: "/" } as unknown as Project;
  const ticket = { id: "tkt_candidate", acceptanceCriteria: [{ id: "AC-1", text: "" }, { id: "AC-2", text: "" }] } as unknown as Ticket;
  const builder: Sandbox = { mode: "srt", denyRead: [secrets, personal, holdoutsDir] };
  const holdoutsSandbox: Sandbox = { mode: "srt", denyRead: [secrets, personal, worktrees], allowRead: [candidate, holdoutsDir] };
  ctx = { project, ticket, worktree: candidate, sandbox: builder, holdoutsSandbox };
});

afterAll(() => {
  otherServer?.close();
  rmSync(root, { recursive: true, force: true });
});

async function runHoldouts(over: Partial<GateContext> = {}) {
  let output = "";
  process.env.TEMPER_PROBE_SECRET = SECRET;
  try {
    const r = await holdouts({ ...ctx, ...over, onOutput: (c) => (output += c) });
    return { ...r, output };
  } finally {
    delete process.env.TEMPER_PROBE_SECRET;
  }
}

describe("holdouts check", () => {
  it("fails closed when no holdouts sandbox is given", async () => {
    const r = await runHoldouts({ holdoutsSandbox: undefined });
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/never run unconfined/);
  });

  // The same hostile holdout without a sandbox: proves the test notices a missing boundary.
  it("lets the hostile holdout read and write when the sandbox is off", async () => {
    const off: Sandbox = { mode: "off", denyRead: [] };
    const r = await runHoldouts({ sandbox: off, holdoutsSandbox: off });
    expect(r.output).toMatch(/^secret LEAK CANARY-secret/m);
    expect(r.output).toMatch(/^write-holdouts LEAK/m);
    // The server's environment is stripped even then.
    expect(r.output).toMatch(/^env absent/m);
    rmSync(join(ctx.project.holdoutsPath!, "tampered.txt"), { force: true });
    rmSync(join(ctx.worktree, "tampered.txt"), { force: true });
  }, 60_000);

  // Windows runs every sandboxed command as one account (see the next test): there the holdouts
  // run without an app.
  const withApp = process.platform !== "win32";

  it.runIf(process.platform === "win32")("on Windows refuses to run holdouts against a sandboxed app", async () => {
    const r = await runHoldouts();
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/one account/);
  });

  it.runIf(srtAvailable)(
    "under srt: reads the candidate and reaches its app, and nothing else",
    async () => {
      const r = await runHoldouts(withApp ? {} : { project: { ...ctx.project, appCommand: null }, ticket: { ...ctx.ticket, acceptanceCriteria: [{ id: "AC-1", text: "" }] } as Ticket });
      const out = r.output;
      expect(out, r.report).toMatch(/AC-1: PASS/);
      expect(out).not.toMatch(/CANARY-|SECRET-holdouts/);
      for (const label of ["secret", "other-worktree", "personal", "child-secret", "write-holdouts", "write-candidate"]) {
        expect(out).toMatch(new RegExp(`^${label} DENIED`, "m"));
      }
      expect(out).toMatch(/^env absent/m);
      expect(out).toMatch(/^internet DENIED/m);
      // Linux confines loopback to the app's port; macOS and Windows sandboxes share the host's
      // loopback (the board API there refuses requests without the board token).
      if (process.platform === "linux") expect(out).toMatch(/^other-port DENIED/m);
      expect({ ok: r.ok, report: r.report }).toMatchObject({ ok: true });
      expect(r.report).toContain("AC-1: PASS");
      if (withApp) expect(r.report).toContain("AC-2: PASS");
    },
    180_000,
  );
});

// AC-2 (SEC-04): sandboxed code cannot leave a process behind. On Linux srt runs the command in its
// own PID namespace, which dies with it; macOS and Windows keep such a process inside the same
// sandbox profile, so there it outlives the run but stays confined (docs/security/execution-boundaries.md).
describe.runIf(srtAvailable && process.platform === "linux")("a holdout that leaves a process behind", () => {
  it("has it killed when the run ends", async () => {
    const out = mkdtempSync(join(gateScratchRoot(), "temper-linger-"));
    const beat = join(out, "heartbeat.txt");
    const code = `require("fs").appendFileSync(${JSON.stringify(beat)}, "C"); setInterval(() => require("fs").appendFileSync(${JSON.stringify(beat)}, "."), 100)`;
    writeFileSync(
      join(ctx.project.holdoutsPath!, "linger.mjs"),
      `import { spawn } from "node:child_process";
spawn(process.execPath, ["-e", ${JSON.stringify(code)}], { detached: true, stdio: "ignore" }).unref();
await new Promise((r) => setTimeout(r, 500));`,
    );
    try {
      // The holdouts policy, with a folder the test can watch from outside.
      const r = await runSandboxed(`"${process.execPath}" linger.mjs`, ctx.holdoutsSandbox!, { cwd: ctx.project.holdoutsPath!, readOnlyCwd: true, allowWrite: [out], timeoutMs: 30_000 });
      expect(r.code).toBe(0);
      const size = existsSync(beat) ? readFileSync(beat, "utf8").length : 0;
      // It did run while the holdout did, so the check below is not vacuous.
      expect(size).toBeGreaterThan(1);
      await new Promise((res) => setTimeout(res, 1000));
      expect(readFileSync(beat, "utf8").length).toBe(size);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
