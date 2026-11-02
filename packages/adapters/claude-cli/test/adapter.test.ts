import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "@temper/core";
import { buildArgs, buildSkillPlugin, createClaudeCliAdapter, parseLine, writeMcpConfig } from "../src/index.ts";

const fixture = join(import.meta.dirname, "fixtures/echo-pass.jsonl");

describe("parseLine", () => {
  it("maps a real stream to events", () => {
    const events = readFileSync(fixture, "utf8").split("\n").flatMap(parseLine);
    expect(events.map((e) => e.kind)).toEqual(["init", "tool_use", "rate_limit", "tool_result", "text", "result"]);
    expect(events.at(-1)).toMatchObject({ kind: "result", text: "VERDICT: PASS", isError: false });
  });

  it("reports usage per model and every rate-limit window", () => {
    const usage = parseLine(JSON.stringify({ type: "result", is_error: false, result: "ok", duration_api_ms: 900, modelUsage: { "m-1": { inputTokens: 4, outputTokens: 85, cacheReadInputTokens: 10, cacheCreationInputTokens: 20, costUSD: 0.15 } } }));
    expect(usage.at(-1)).toEqual({ kind: "usage", apiMs: 900, models: { "m-1": { inputTokens: 4, outputTokens: 85, cacheReadTokens: 10, cacheWriteTokens: 20, costUsd: 0.15 } } });
    const allowed = parseLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1800000000 } }));
    expect(allowed).toEqual([{ kind: "rate_limit", limitType: "five_hour", status: "allowed", resetsAt: 1800000000, raw: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1800000000 } }]);
    const rejected = parseLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "seven_day" } }));
    expect(rejected.map((e) => e.kind)).toEqual(["rate_limit", "rate_limited"]);
  });

  it("flags rate limits", () => {
    const line = JSON.stringify({ type: "result", is_error: true, result: "Claude usage limit reached" });
    expect(parseLine(line).map((e) => e.kind)).toContain("rate_limited");
  });
});

describe("buildArgs", () => {
  it("always isolates runs from the user's own config", () => {
    const args = buildArgs({ cwd: "/w", prompt: "hi", allowedTools: ["Read"], disallowedTools: [], denyDirs: ["/holdouts"] });
    expect(args).toEqual(expect.arrayContaining(["--setting-sources", "project", "--strict-mcp-config"]));
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(settings.autoMemoryEnabled).toBe(false);
    expect(settings.permissions.deny).toContain("Read(//holdouts/**)");
    expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
    expect(settings.sandbox.network.allowLocalBinding).toBe(true);
    expect(settings.sandbox.network.allowedDomains).toBeUndefined();
  });

  it("lets a run reach the host's loopback through the sandbox proxy only when asked", () => {
    const args = buildArgs({ cwd: "/w", prompt: "hi", allowedTools: [], disallowedTools: [], denyDirs: ["/secrets"], hostLoopback: true });
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(settings.sandbox.network.allowedDomains).toEqual(["127.0.0.1"]);
  });
});

describe("mcp", () => {
  it("passes only the run's MCP servers and allows their tools", () => {
    const req = { cwd: "/w", prompt: "x", allowedTools: ["Read"], disallowedTools: [], mcpServers: { temper: { command: "node", args: ["s.ts"] } } };
    const file = writeMcpConfig(req);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mcpServers: { temper: { command: "node", args: ["s.ts"] } } });
    // Windows has no POSIX modes; the file sits in the user's own temp dir there.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const args = buildArgs(req, undefined, file);
    expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--mcp-config", file, "mcp__temper"]));
  });
});

describe("buildSkillPlugin", () => {
  it("exposes exactly the given skills", () => {
    const src = mkdtempSync(join(tmpdir(), "skill-"));
    mkdirSync(join(src, "tdd"));
    writeFileSync(join(src, "tdd", "SKILL.md"), "---\nname: tdd\n---\n");
    const dir = buildSkillPlugin([join(src, "tdd")])!;
    expect(existsSync(join(dir, "skills", "tdd", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude-plugin", "plugin.json"))).toBe(true);
  });
});

describe("run", () => {
  it("streams events from the CLI and returns the final text", async () => {
    // A Node script stands in for the CLI, so the test runs on every platform.
    const script = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude.mjs");
    writeFileSync(script, `import { readFileSync } from "node:fs";\nprocess.stdout.write(readFileSync(${JSON.stringify(fixture)}, "utf8"));\n`);
    const events: RunEvent[] = [];
    const result = await createClaudeCliAdapter({ bin: process.execPath, binArgs: [script] }).run(
      { cwd: tmpdir(), prompt: "x", allowedTools: [], disallowedTools: [] },
      (e) => events.push(e),
    );
    expect(result).toMatchObject({ finalText: "VERDICT: PASS", isError: false, exitCode: 0 });
    expect(result.sessionId).toBeTruthy();
    expect(events.length).toBeGreaterThan(3);
  });
});

// SEC-03 (#38): canaries in the server's environment never reach the CLI or what it starts.
describe("agent environment", () => {
  it("passes the allowlist and the run's variables, never the server's secrets", async () => {
    const canaries = { GH_TOKEN: "canary-gh", TEMPER_BOARD_TOKEN: "canary-board", JIRA_API_TOKEN: "canary-jira", AWS_SECRET_ACCESS_KEY: "canary-aws" };
    Object.assign(process.env, canaries);
    try {
      const adapter = createClaudeCliAdapter({ bin: process.execPath, binArgs: [join(import.meta.dirname, "fixtures", "fake-claude-env.mjs")] });
      const result = await adapter.run({ cwd: tmpdir(), prompt: "x", allowedTools: [], disallowedTools: [], env: { TEMPER_APP_URL: "http://127.0.0.1:9" } }, () => {});
      expect(JSON.parse(result.finalText)).toEqual({ leaked: [], childLeaked: [], hasPath: true, run: "http://127.0.0.1:9" });
    } finally {
      for (const k of Object.keys(canaries)) delete process.env[k];
    }
  });

  it("refuses a run variable that would load code into every process", async () => {
    const adapter = createClaudeCliAdapter({ bin: process.execPath, binArgs: [join(import.meta.dirname, "fixtures", "fake-claude-env.mjs")] });
    await expect(adapter.run({ cwd: tmpdir(), prompt: "x", allowedTools: [], disallowedTools: [], env: { NODE_OPTIONS: "--require /tmp/x.js" } }, () => {})).rejects.toThrow(/may not set NODE_OPTIONS/);
  });
});
