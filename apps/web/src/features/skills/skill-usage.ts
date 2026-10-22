import type { Agent, SkillEntry } from "@/lib/types";

/** Registry descriptions are read raw from SKILL.md front matter and may keep their YAML quotes. */
export function cleanDescription(d: string | undefined): string | undefined {
  return d?.replace(/^(["'])(.*)\1$/s, "$2").replace(/\\"/g, '"');
}

/** Skill name → names of the agents that load it. */
export function skillUsage(agents: Agent[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const a of agents) {
    for (const s of a.skills) {
      const list = usage.get(s) ?? [];
      list.push(a.name);
      usage.set(s, list);
    }
  }
  return usage;
}

/** Case-insensitive match on name, description, source, licence, origin or using agent. */
export function filterSkills(skills: SkillEntry[], query: string, usage: Map<string, string[]>): SkillEntry[] {
  const q = query.trim().toLowerCase();
  const sorted = skills.toSorted((a, b) => a.name.localeCompare(b.name));
  if (!q) return sorted;
  return sorted.filter((s) =>
    [s.name, s.description, s.source, s.license, s.origin, ...(usage.get(s.name) ?? [])].some((f) => f?.toLowerCase().includes(q)),
  );
}
