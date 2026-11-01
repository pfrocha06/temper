import { describe, expect, it } from "vitest";
import type { Agent } from "@/lib/types";
import { toAgentEdit, toFormValues } from "./agent-form";

const agent = {
  id: "builder",
  version: 3,
  role: "builder",
  name: "Builder",
  adapter: "claude-cli",
  model: "sonnet",
  skills: ["tdd"],
  mcpServers: ["temper"],
  permissions: { allowedTools: ["Read", "Bash"], disallowedTools: ["Bash(git push:*)"] },
  maxConcurrency: 2,
  runsPerHour: 12,
  instructions: "",
  createdAt: "2026-10-22T10:00:00.000Z",
} satisfies Agent;

describe("agent form", () => {
  it("round-trips an agent into the PUT body", () => {
    const { edit, errors } = toAgentEdit(toFormValues(agent));
    expect(errors).toEqual({});
    expect(edit).toEqual({
      name: "Builder",
      adapter: "claude-cli",
      model: "sonnet",
      skills: ["tdd"],
      mcpServers: ["temper"],
      permissions: agent.permissions,
      maxConcurrency: 2,
      runsPerHour: 12,
      instructions: "",
    });
  });

  it("sends a blank model as null so the adapter default applies", () => {
    expect(toAgentEdit({ ...toFormValues(agent), model: "  " }).edit?.model).toBeNull();
  });

  it("enforces the server's limits", () => {
    const { edit, errors } = toAgentEdit({ ...toFormValues(agent), name: " ", maxConcurrency: "9", runsPerHour: "1.5" });
    expect(edit).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["maxConcurrency", "name", "runsPerHour"]);
  });
});
