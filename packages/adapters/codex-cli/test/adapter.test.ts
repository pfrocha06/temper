import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunRequest } from "@temper/core";
import { buildArgs, codexAccount, createCodexCliAdapter, mcpConfig, parseLine, permissionProfile, resolveBin, sandboxArgs, skillIndex, toml, userSkills } from "../src/index.ts";

const base: RunRequest = { cwd: "/w", prompt: "hi", allowedTools: [], disallowedTools: [] };
const configOf = (args: string[], key: string) => args.find((a, i) => args[i - 1] === "-c" && a.startsWith(`${key}=`))?.slice(key.length + 1);

describe("toml", () => {
  it("writes inline values Codex can parse", () => {
    expect(toml({ a: 'x"y', "C:\\p": ["deny", 1, true] })).toBe('{"a" = "x\\"y", "C:\\\\p" = ["deny", 1, true]}');
  });
});

describe("permissionProfile", () => {
  it("writes the workspace and extra dirs, denies protected dirs, keeps the candidate read-only", () => {
    const p = permissionProfile({ ...base, addDirs: ["/repo/.git/"], readOnlyDirs: ["/cand"], denyDirs: ["/holdouts", "/secrets"] });
    expect(p).toEqual({
      extends: ":workspace",
      filesystem: { "/repo/.git": "write", "/cand": "read", "/holdouts": "deny", "/secrets": "deny" },
      network: { enabled: true, allow_local_binding: true, domains: { localhost: "allow", "127.0.0.1": "allow" } },
    });
  });

  it("reaches the host's loopback through the proxy only when the run needs the candidate app", () => {
    expect(permissionProfile({ ...base, hostLoopback: true }).network).toEqual({ enabled: true, allow_local_binding: false, domains: { localhost: "allow", "127.0.0.1": "allow" } });
  });

  it("starts read-only runs from the read-only profile and grants no writes", () => {
    const p = permissionProfile({ ...base, readOnly: true, addDirs: ["/x"] });
    expect(p.extends).toBe(":read-only");
    expect(p.filesystem).toEqual({});
  });

  it("always runs the network proxy, and asks for the elevated sandbox on Windows", () => {
    expect(sandboxArgs(base, "linux")).toContain("network_proxy");
    expect(sandboxArgs(base, "linux").join(" ")).not.toContain("windows.sandbox");
    expect(sandboxArgs(base, "win32").join(" ")).toContain('windows.sandbox="elevated"');
  });
});

describe("buildArgs", () => {
  it("isolates runs from the user's Codex config and reads the prompt from stdin", () => {
    const args = buildArgs({ ...base, model: "gpt-5.5-codex" }, { disabledSkills: ["/u/.agents/skills/x/SKILL.md"], secretEnv: ["TEMPER_CAPABILITY"] });
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]));
    expect(configOf(args, "approval_policy")).toBe('"never"');
    expect(configOf(args, "web_search")).toBe('"disabled"');
    expect(configOf(args, "skills")).toBe('{"config" = [{"path" = "/u/.agents/skills/x/SKILL.md", "enabled" = false}]}');
    expect(configOf(args, "shell_environment_policy")).toContain('"exclude" = ["TEMPER_CAPABILITY"]');
    for (const f of ["hooks", "plugins", "memories", "apps", "computer_use"]) expect(args[args.indexOf(f) - 1]).toBe("--disable");
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5-codex");
    expect(args.at(-1)).toBe("-");
    expect(args).not.toContain("hi");
  });

  it("leaves Claude model names to Codex's default", () => {
    expect(buildArgs({ ...base, model: "opus" })).not.toContain("-m");
    expect(buildArgs({ ...base, model: "claude-sonnet-4-5" })).not.toContain("-m");
  });

  it("resumes a session, and puts instructions and skills in developer instructions", () => {
    const skills = mkdtempSync(join(tmpdir(), "cx-skill-"));
    mkdirSync(join(skills, "tdd"));
    writeFileSync(join(skills, "tdd", "SKILL.md"), "---\nname: tdd\ndescription: Red, green, refactor.\n---\nBody\n");
    const args = buildArgs({ ...base, resumeSessionId: "s-1", appendSystemPrompt: "Be brief.", skillDirs: [join(skills, "tdd")] });
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "s-1"]);
    const dev = JSON.parse(configOf(args, "developer_instructions")!) as string;
    expect(dev).toContain("Be brief.");
    expect(dev).toContain("- tdd: Red, green, refactor.");
    expect(dev).toContain(join(skills, "tdd", "SKILL.md"));
  });
});

describe("skills", () => {
  it("lists user skills so each can be switched off", () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-user-skills-"));
    mkdirSync(join(dir, "a"));
    writeFileSync(join(dir, "a", "SKILL.md"), "---\nname: a\n---\n");
    mkdirSync(join(dir, "not-a-skill"));
    expect(userSkills(dir)).toEqual([join(dir, "a", "SKILL.md")]);
    expect(userSkills(join(dir, "missing"))).toEqual([]);
    expect(skillIndex([])).toBeUndefined();
  });
});

describe("mcpConfig", () => {
  it("forwards server secrets by name only and marks them for exclusion from shells", () => {
    const m = mcpConfig({ temper: { command: "node", args: ["s.ts"], env: { TEMPER_CAPABILITY: "cap-1", TEMPER_API_URL: "http://127.0.0.1:1" } } });
    expect(m.config).toEqual({ temper: { command: "node", args: ["s.ts"], env_vars: ["TEMPER_CAPABILITY", "TEMPER_API_URL"], default_tools_approval_mode: "approve" } });
    expect(m.env).toEqual({ TEMPER_CAPABILITY: "cap-1", TEMPER_API_URL: "http://127.0.0.1:1" });
    expect(JSON.stringify(buildArgs(base, { mcpServers: m.config, secretEnv: m.secretEnv }))).not.toContain("cap-1");
    expect(() => mcpConfig({ a: { command: "x", env: { K: "1" } }, b: { command: "y", env: { K: "2" } } })).toThrow(/disagree on K/);
  });
});

describe("parseLine", () => {
  it("maps Codex events to run events", () => {
    expect(parseLine(JSON.stringify({ type: "thread.started", thread_id: "t1" }), "m")).toEqual([{ kind: "init", sessionId: "t1", model: "m" }]);
    expect(parseLine(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "ls" } }))).toEqual([{ kind: "tool_use", tool: "shell", input: { command: "ls" } }]);
    expect(parseLine(JSON.stringify({ type: "item.completed", item: { type: "command_execution", aggregated_output: "no", exit_code: 1, status: "failed" } }))).toEqual([{ kind: "tool_result", isError: true, content: "no" }]);
    expect(parseLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }))).toEqual([{ kind: "text", text: "done" }]);
    expect(parseLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } }), "gpt")).toEqual([
      { kind: "usage", models: { gpt: { inputTokens: 60, outputTokens: 7, cacheReadTokens: 40, cacheWriteTokens: 0 } } },
    ]);
    expect(parseLine(JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit" } })).map((e) => e.kind)).toEqual(["stderr", "rate_limited"]);
    expect(parseLine("not json")).toEqual([{ kind: "stderr", text: "not json" }]);
  });
});

describe("resolveBin", () => {
  it("runs an npm shim's script on Windows and the binary elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-bin-"));
    writeFileSync(join(dir, "codex.cmd"), "");
    mkdirSync(join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"), "");
    expect(resolveBin("codex", "win32", dir)).toEqual({ file: process.execPath, args: [join(dir, "node_modules", "@openai", "codex", "bin", "codex.js")] });
    expect(resolveBin("codex", "linux", dir)).toEqual({ file: "codex", args: [] });
  });
});

describe("codexAccount", () => {
  it("reads the account from the login's id token without exposing tokens", () => {
    const home = mkdtempSync(join(tmpdir(), "cx-home-"));
    expect(codexAccount(home)).toEqual({ loggedIn: false });
    const claims = Buffer.from(JSON.stringify({ email: "a@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })).toString("base64url");
    writeFileSync(join(home, "auth.json"), JSON.stringify({ tokens: { id_token: `h.${claims}.s`, access_token: "secret" } }));
    expect(codexAccount(home)).toEqual({ loggedIn: true, method: "chatgpt", email: "a@example.com", plan: "pro" });
  });
});

describe("run", () => {
  it("streams events, pipes the prompt, uses Temper's CODEX_HOME and returns the last message", async () => {
    const fake = join(import.meta.dirname, "fixtures", "fake-codex.mjs");
    const events: RunEvent[] = [];
    const codexHome = mkdtempSync(join(tmpdir(), "cx-home-"));
    writeFileSync(join(codexHome, "auth.json"), "{}");
    const adapter = createCodexCliAdapter({ bin: process.execPath, binArgs: [fake], codexHome, userSkillsDir: join(tmpdir(), "none") });
    const result = await adapter.run(
      { ...base, cwd: tmpdir(), prompt: "do the thing", mcpServers: { temper: { command: "node", env: { TEMPER_CAPABILITY: "cap-9" } } } },
      (e) => events.push(e),
    );
    expect(result).toMatchObject({ finalText: "VERDICT: PASS", sessionId: "thread-123", isError: false, exitCode: 0 });
    const echoed = JSON.parse((events.find((e) => e.kind === "text") as { text: string }).text);
    expect(echoed).toMatchObject({ stdin: "do the thing", home: codexHome, capability: "cap-9" });
    expect(JSON.stringify(echoed.args)).not.toContain("cap-9");
    expect(events.map((e) => e.kind)).toEqual(["init", "tool_use", "tool_result", "text", "text", "usage", "result"]);
  });

  it("refuses to run before Temper's Codex login exists", async () => {
    const adapter = createCodexCliAdapter({ bin: process.execPath, codexHome: join(tmpdir(), "no-such-codex-home") });
    await expect(adapter.run(base, () => {})).rejects.toThrow(/temper codex login/);
  });
});
