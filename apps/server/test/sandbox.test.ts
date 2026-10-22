import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSandboxed } from "../src/exec.ts";
import { probeGateIsolation } from "../src/probe.ts";
import { sandboxed, sandboxEnv } from "../src/sandbox.ts";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

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

describe("sandboxed", () => {
  it("wraps the command in srt with a policy written outside every writable path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "wt-"));
    const cmd = sandboxed({ mode: "srt", denyRead: ["/holdouts", "/home/.temper/secrets"] }, "pnpm test", { cwd });
    try {
      expect(cmd.shell).toBe(false);
      expect(cmd.file).toBe(process.execPath);
      expect(cmd.args[0]).toMatch(/sandbox-runtime[\\/]dist[\\/]cli\.js$/);
      expect(cmd.args.slice(1, 2)).toEqual(["--settings"]);
      expect(cmd.args.slice(3)).toEqual(["-c", "pnpm test"]);
      const settings = JSON.parse(readFileSync(cmd.args[2]!, "utf8"));
      expect(settings.network).toEqual({ allowedDomains: [], deniedDomains: [], allowLocalBinding: true });
      expect(settings.filesystem.denyRead).toEqual(["/holdouts", "/home/.temper/secrets"]);
      expect(settings.filesystem.allowWrite).toEqual([cwd, cmd.env.TMPDIR]);
      expect(settings.filesystem.allowWrite).not.toContain(dirname(cmd.args[2]!));
    } finally {
      cmd.dispose();
    }
    expect(existsSync(cmd.args[2]!)).toBe(false);
    expect(existsSync(cmd.env.TMPDIR!)).toBe(false);
  });
});

describe("runSandboxed", () => {
  it("runs the command without the server's secrets in its environment", async () => {
    process.env.GH_TOKEN = "gho_secret";
    const cwd = mkdtempSync(join(tmpdir(), "wt-"));
    const r = await runSandboxed(`node -e "console.log(process.env.GH_TOKEN ?? 'none')"`, { mode: "off", denyRead: [] }, { cwd });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("none");
  });
});

describe("probeGateIsolation", () => {
  const dirs = () => [mkdtempSync(join(tmpdir(), "holdouts-")), mkdtempSync(join(tmpdir(), "secrets-"))];

  it("catches Builder code reading and writing protected directories when the sandbox is off", async () => {
    const protectedDirs = dirs();
    const r = await probeGateIsolation({ mode: "off", denyRead: [] }, protectedDirs, "http://127.0.0.1:9");
    expect(r.isolated).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^read a canary/), expect.stringMatching(/^wrote into/)]));
    // The environment is stripped even without the sandbox.
    expect(r.problems).not.toContain("saw the server's environment");
    // Canaries and write markers are cleaned up.
    for (const d of protectedDirs) expect(readdirSync(d)).toEqual([]);
  });

  // srt needs sandbox-exec (macOS) or bubblewrap and socat (Linux); opt in where they exist.
  it.runIf(process.platform === "darwin" || process.env.TEMPER_TEST_SRT === "1")(
    "finds nothing to leak under srt",
    async () => {
      const r = await probeGateIsolation({ mode: "srt", denyRead: [] }, dirs(), "http://127.0.0.1:9");
      expect(r.problems).toEqual([]);
      expect(r.isolated).toBe(true);
    },
    60_000,
  );
});
