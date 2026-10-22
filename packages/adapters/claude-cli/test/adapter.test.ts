import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "@temper/core";
import { buildArgs, buildSkillPlugin, createClaudeCliAdapter, parseLine, writeMcpConfig } from "../src/index.ts";

const fixture = join(import.meta.dirname, "fixtures/echo-pass.jsonl");

describe("parseLine", () => {
  it("maps a real stream to events", () => {
    const events = readFileSync(fixture, "utf8").split("\n").flatMap(parseLine);
    expect(events.map((e) => e.kind)).toEqual(["init", "tool_use", "tool_result", "text", "result"]);
    expect(events.at(-1)).toMatchObject({ kind: "result", text: "VERDICT: PASS", isError: false });
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
  });
});

describe("mcp", () => {
  it("passes only the run's MCP servers and allows their tools", () => {
    const req = { cwd: "/w", prompt: "x", allowedTools: ["Read"], disallowedTools: [], mcpServers: { temper: { command: "node", args: ["s.ts"] } } };
    const file = writeMcpConfig(req);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mcpServers: { temper: { command: "node", args: ["s.ts"] } } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
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
    const bin = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
    writeFileSync(bin, `#!/bin/sh\ncat "${fixture}"\n`);
    chmodSync(bin, 0o755);
    const events: RunEvent[] = [];
    const result = await createClaudeCliAdapter({ bin }).run(
      { cwd: tmpdir(), prompt: "x", allowedTools: [], disallowedTools: [] },
      (e) => events.push(e),
    );
    expect(result).toMatchObject({ finalText: "VERDICT: PASS", isError: false, exitCode: 0 });
    expect(result.sessionId).toBeTruthy();
    expect(events.length).toBeGreaterThan(3);
  });
});
