import { describe, expect, it } from "vitest";
import type { Agent, SkillEntry } from "@/lib/types";
import { cleanDescription, filterSkills, groupBySource, skillRoles, skillUsage } from "./skill-usage";

const agents = [
  { name: "Reviewer", role: "reviewer", skills: ["code-review", "tdd"] },
  { name: "Builder", role: "builder", skills: ["tdd", "shadcn"] },
] as Agent[];
const skills: SkillEntry[] = [
  { name: "tdd", origin: "vendor", path: "x", source: "someone/skills", description: "Red, green, refactor" },
  { name: "code-review", origin: "vendor", path: "y", license: "MIT" },
  { name: "local-thing", origin: "local", path: "z" },
];

describe("skill usage", () => {
  it("lists the agents that load each skill", () => {
    const usage = skillUsage(agents);
    expect(usage.get("tdd")).toEqual(["Reviewer", "Builder"]);
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

describe("skill roles and sources", () => {
  it("lists roles per skill in role order", () => {
    expect(skillRoles(agents).get("tdd")).toEqual(["builder", "reviewer"]);
  });

  it("groups by source, local first, larger groups next", () => {
    const more: SkillEntry[] = [...skills, { name: "x", origin: "vendor", path: "w", source: "someone/skills" }];
    expect(groupBySource(more).map((g) => [g.source, g.skills.length])).toEqual([
      ["local", 1],
      ["someone/skills", 2],
      ["unknown source", 1],
    ]);
  });
});
