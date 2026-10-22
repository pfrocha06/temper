import { describe, expect, it } from "vitest";
import type { Agent, SkillEntry } from "@/lib/types";
import { cleanDescription, filterSkills, skillUsage } from "./skill-usage";

const agents = [
  { name: "Builder", skills: ["tdd", "shadcn"] },
  { name: "Reviewer", skills: ["code-review", "tdd"] },
] as Agent[];
const skills: SkillEntry[] = [
  { name: "tdd", origin: "vendor", path: "x", source: "someone/skills", description: "Red, green, refactor" },
  { name: "code-review", origin: "vendor", path: "y", license: "MIT" },
  { name: "local-thing", origin: "local", path: "z" },
];

describe("skill usage", () => {
  it("lists the agents that load each skill", () => {
    const usage = skillUsage(agents);
    expect(usage.get("tdd")).toEqual(["Builder", "Reviewer"]);
    expect(usage.get("local-thing")).toBeUndefined();
  });

  it("filters by name, source, licence or using agent, sorted by name", () => {
    const usage = skillUsage(agents);
    expect(filterSkills(skills, "", usage).map((s) => s.name)).toEqual(["code-review", "local-thing", "tdd"]);
    expect(filterSkills(skills, "reviewer", usage).map((s) => s.name)).toEqual(["code-review", "tdd"]);
    expect(filterSkills(skills, "SOMEONE", usage).map((s) => s.name)).toEqual(["tdd"]);
    expect(filterSkills(skills, "local", usage).map((s) => s.name)).toEqual(["local-thing"]);
  });

  it("strips YAML quotes left on descriptions", () => {
    expect(cleanDescription('"Use for \\"x\\" things"')).toBe('Use for "x" things');
    expect(cleanDescription("plain")).toBe("plain");
    expect(cleanDescription(undefined)).toBeUndefined();
  });
});
