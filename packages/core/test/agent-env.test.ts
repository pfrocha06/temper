// SEC-03 (#38): an agent starts with an allowlisted environment, never the server's.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentEnv, UnsafeAgentEnvError } from "../src/agent-env.ts";

const server = {
  PATH: "/usr/bin",
  HOME: "/home/t",
  LC_ALL: "C.UTF-8",
  GH_TOKEN: "canary-gh",
  GITHUB_TOKEN: "canary-github",
  TEMPER_BOARD_TOKEN: "canary-board",
  AWS_SECRET_ACCESS_KEY: "canary-aws",
  JIRA_API_TOKEN: "canary-jira",
  DATABASE_URL: "canary-db",
  ANTHROPIC_API_KEY: "adapter-login",
};

describe("agentEnv", () => {
  it("keeps what a process needs and drops every other server variable", () => {
    const env = agentEnv([], {}, server);
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/t", LC_ALL: "C.UTF-8" });
    expect(JSON.stringify(env)).not.toMatch(/canary/);
  });

  it("passes an adapter's own login only when the adapter names it", () => {
    expect(agentEnv([], {}, server).ANTHROPIC_API_KEY).toBeUndefined();
    expect(agentEnv(["ANTHROPIC_API_KEY"], {}, server).ANTHROPIC_API_KEY).toBe("adapter-login");
  });

  it("matches names regardless of case, as Windows does", () => {
    expect(agentEnv([], {}, { Path: "C:\\bin", SystemRoot: "C:\\Windows", gh_token: "canary" })).toEqual({ Path: "C:\\bin", SystemRoot: "C:\\Windows" });
  });

  it("adds the run's own variables", () => {
    expect(agentEnv([], { TEMPER_APP_URL: "http://127.0.0.1:1" }, server).TEMPER_APP_URL).toBe("http://127.0.0.1:1");
  });

  it("refuses run variables that would load code into every process", () => {
    for (const k of ["LD_PRELOAD", "NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "node_options"]) {
      expect(() => agentEnv([], { [k]: "/tmp/x" }, server)).toThrow(UnsafeAgentEnvError);
    }
  });
});

// Guards the boundary itself: an agent process must never be spawned with the server's whole env.
describe("agent adapters", () => {
  it("never spread process.env into an agent's environment", () => {
    const root = join(import.meta.dirname, "../../adapters");
    const offenders = readdirSync(root).flatMap((pkg) => {
      const src = join(root, pkg, "src");
      return readdirSync(src)
        .filter((f) => f.endsWith(".ts"))
        .filter((f) => /\.\.\.\s*process\.env\b/.test(readFileSync(join(src, f), "utf8")))
        .map((f) => `${pkg}/src/${f}`);
    });
    expect(offenders).toEqual([]);
  });
});
