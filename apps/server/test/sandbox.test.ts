import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootApp, freePort } from "../src/app-runner.ts";
import { runSandboxed } from "../src/exec.ts";
import { probeGateIsolation } from "../src/probe.ts";
import { gateScratchRoot, hostRelay, LAUNCHER, sandboxed, sandboxEnv, srtNetwork, type Sandbox } from "../src/sandbox.ts";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

// srt needs sandbox-exec (macOS), bubblewrap + socat + ripgrep (Linux) or `srt windows-install` (Windows).
const srtAvailable = process.platform === "darwin" || process.env.TEMPER_TEST_SRT === "1";
const SRT: Sandbox = { mode: "srt", denyRead: [] };
const OFF: Sandbox = { mode: "off", denyRead: [] };

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)));

describe("sandboxEnv", () => {
  it("drops tokens and Temper settings, keeps PATH and points temp dirs at the private one", () => {
    Object.assign(process.env, { GH_TOKEN: "gho_x", TEMPER_BOARD_TOKEN: "board", ANTHROPIC_API_KEY: "sk-x" });
    const env = sandboxEnv({ PORT: "1234" }, "/tmp/private");
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("TEMPER_BOARD_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env).toMatchObject({ PORT: "1234", TMPDIR: "/tmp/private" });
  });
});

describe("srtNetwork", () => {
  it("allows no outbound network, and loopback only where each platform needs it", () => {
    expect(srtNetwork("darwin")).toEqual({ allowedDomains: [], deniedDomains: [], allowLocalBinding: true });
    expect(srtNetwork("linux")).toEqual({ allowedDomains: [], deniedDomains: [], allowLocalBinding: true });
    expect(srtNetwork("linux", 4321)).toMatchObject({ allowedDomains: ["127.0.0.1:4321"] });
    expect(srtNetwork("win32")).toMatchObject({ allowedDomains: ["localhost", "127.0.0.1"] });
  });
});

describe("sandboxed", () => {
  it("wraps the command in srt through the launcher, with the policy outside every writable path", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "wt-"));
    const cmd = await sandboxed({ mode: "srt", denyRead: ["/holdouts", "/home/.temper/secrets"] }, "pnpm test", { cwd, env: { PORT: "1" } }, "darwin");
    const settingsFile = cmd.args[2]!;
    const tmp = cmd.env.TMPDIR!;
    try {
      expect(cmd).toMatchObject({ file: process.execPath, shell: false });
      expect(cmd.args[0]).toMatch(/sandbox-runtime[\\/]dist[\\/]cli\.js$/);
      expect(cmd.args[1]).toBe("--settings");
      expect(cmd.args[3]).toBe("-c");
      expect(cmd.args[4]).toBe(`"${process.execPath}" "${join(tmp, "launch.mjs")}" "${join(tmp, "launch.json")}"`);
      const launch = JSON.parse(readFileSync(join(tmp, "launch.json"), "utf8"));
      expect(launch).toMatchObject({ command: "pnpm test", env: { PORT: "1", TMPDIR: tmp } });
      const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
      expect(settings.network).toEqual(srtNetwork("darwin"));
      expect(settings.filesystem.denyRead).toEqual(["/holdouts", "/home/.temper/secrets"]);
      expect(settings.filesystem.allowWrite).toEqual([cwd, tmp]);
      expect(settings.filesystem.allowWrite).not.toContain(dirname(settingsFile));
      // srt itself starts with the stripped environment; the command's variables travel in the file.
      expect(cmd.env).not.toHaveProperty("PORT");
    } finally {
      cmd.dispose();
    }
    expect(existsSync(settingsFile)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
  });

  it("asks srt for loopback through its proxy and Node to use it on Windows", async () => {
    const cmd = await sandboxed(SRT, "pnpm test", { cwd: mkdtempSync(join(tmpdir(), "wt-")) }, "win32");
    try {
      expect(JSON.parse(readFileSync(cmd.args[2]!, "utf8")).network).toEqual(srtNetwork("win32"));
      expect(JSON.parse(readFileSync(join(cmd.env.TMPDIR!, "launch.json"), "utf8")).env.NODE_USE_ENV_PROXY).toBe("1");
    } finally {
      cmd.dispose();
    }
  });
});

describe("runSandboxed", () => {
  it("runs the command without the server's secrets in its environment", async () => {
    process.env.GH_TOKEN = "gho_secret";
    const cwd = mkdtempSync(join(tmpdir(), "wt-"));
    const r = await runSandboxed(`node -e "console.log(process.env.GH_TOKEN ?? 'none')"`, OFF, { cwd });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("none");
  });
});

describe("the Linux bridge", () => {
  /** Stands in for srt's HTTP proxy: answers CONNECT and splices the two sockets. */
  async function fakeProxy(): Promise<{ url: string; close: () => void }> {
    const server = createServer((c) => {
      c.once("data", (d) => {
        const [, host, port] = /^CONNECT ([^:]+):(\d+) /.exec(d.toString()) ?? [];
        const up = connect(Number(port), host, () => {
          c.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          c.pipe(up);
          up.pipe(c);
        });
        up.on("error", () => c.destroy());
        c.on("error", () => up.destroy());
      });
    });
    const port = await listen(server);
    return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
  }

  it("rejects tunnels that do not present the token", async () => {
    const relay = await hostRelay("right-token");
    try {
      const s = connect(relay.relayPort, "127.0.0.1");
      s.write("wrong-token\n");
      await new Promise((r) => s.on("close", r));
    } finally {
      relay.close();
    }
  });

  it("carries host requests into the sandboxed app through the proxy", async () => {
    const proxy = await fakeProxy();
    const relay = await hostRelay("tok");
    const appPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), "launch-"));
    writeFileSync(join(dir, "launch.mjs"), LAUNCHER);
    const app = `require('http').createServer((q, s) => s.end('hello ' + process.env.GREETING)).listen(${appPort}, '127.0.0.1')`;
    writeFileSync(join(dir, "launch.json"), JSON.stringify({
      env: { GREETING: "from inside" },
      command: `"${process.execPath}" -e "${app}"`,
      bridge: { relayPort: relay.relayPort, token: "tok", appPort },
    }));
    const child = spawn(process.execPath, [join(dir, "launch.mjs"), join(dir, "launch.json")], { env: { ...process.env, HTTP_PROXY: proxy.url } });
    try {
      let body = "";
      for (let i = 0; i < 40 && !body; i++) {
        body = await fetch(relay.url).then((r) => r.text(), () => "");
        if (!body) await new Promise((r) => setTimeout(r, 250));
      }
      expect(body).toBe("hello from inside");
      // Several requests in a row each get a fresh tunnel.
      for (let i = 0; i < 6; i++) expect(await (await fetch(relay.url)).text()).toBe("hello from inside");
    } finally {
      child.kill();
      relay.close();
      proxy.close();
    }
  }, 30_000);
});

describe("probeGateIsolation", () => {
  const dirs = () => [mkdtempSync(join(tmpdir(), "holdouts-")), mkdtempSync(join(tmpdir(), "secrets-"))];

  it("catches Builder code reading and writing protected directories when the sandbox is off", async () => {
    const protectedDirs = dirs();
    const r = await probeGateIsolation(OFF, protectedDirs, "http://127.0.0.1:9");
    expect(r.isolated).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^read a canary/), expect.stringMatching(/^wrote into/)]));
    // The environment is stripped even without the sandbox.
    expect(r.problems).not.toContain("saw the server's environment");
    // Canaries and write markers are cleaned up.
    for (const d of protectedDirs) expect(readdirSync(d)).toEqual([]);
  });

  it.runIf(srtAvailable)(
    "finds nothing to leak under srt",
    async () => {
      const r = await probeGateIsolation(SRT, dirs(), "http://127.0.0.1:9");
      expect(r.problems).toEqual([]);
      expect(r.isolated).toBe(true);
    },
    120_000,
  );
});

describe.runIf(srtAvailable)("bootApp under srt", () => {
  it("serves the sandboxed app to the host, with its variables and without the holdouts", async () => {
    const holdouts = mkdtempSync(join(tmpdir(), "holdouts-"));
    writeFileSync(join(holdouts, "secret.holdout.mjs"), "CANARY-holdout");
    const cwd = mkdtempSync(join(gateScratchRoot(), "wt-"));
    const server = `require('http').createServer((q, s) => { let h = 'denied'; try { h = require('fs').readFileSync(process.argv[1] + '/secret.holdout.mjs', 'utf8') } catch {} s.end(JSON.stringify({ token: !!process.env.TEMPER_BOARD_TOKEN, holdout: h })) }).listen(Number(process.env.PORT), '127.0.0.1')`;
    writeFileSync(join(cwd, "app.js"), server.replace("process.argv[1]", JSON.stringify(holdouts)));
    const app = await bootApp(`"${process.execPath}" app.js`, cwd, "/", { mode: "srt", denyRead: [holdouts] }, 60_000);
    try {
      expect(await (await fetch(app.url)).json()).toEqual({ token: true, holdout: "denied" });
    } finally {
      app.stop();
    }
  }, 90_000);
});
