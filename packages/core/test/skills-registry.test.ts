import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS } from "../src/agents.ts";

const root = join(import.meta.dirname, "../../..");

describe("skill registry", () => {
  it("contains every skill a default agent is assigned, with a SKILL.md on disk", () => {
    const { skills } = JSON.parse(readFileSync(join(root, "skills/registry.json"), "utf8")) as { skills: { name: string; path: string }[] };
    const byName = new Map(skills.map((s) => [s.name, s]));
    for (const agent of DEFAULT_AGENTS) {
      for (const name of agent.skills) {
        const entry = byName.get(name);
        expect(entry, `${agent.id} → ${name}`).toBeDefined();
        expect(existsSync(join(root, entry!.path, "SKILL.md"))).toBe(true);
      }
    }
  });
});
