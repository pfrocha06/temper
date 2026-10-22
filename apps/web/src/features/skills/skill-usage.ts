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
  return sorted.filter((s) => [s.name, s.description, s.source, s.license, s.origin, ...(usage.get(s.name) ?? [])].some((f) => f?.toLowerCase().includes(q)));
}

/** Skill name → roles of the agents that load it, in role order. */
export function skillRoles(agents: Agent[]): Map<string, string[]> {
  const order = ["planner", "builder", "verifier", "reviewer"];
  const roles = new Map<string, string[]>();
  for (const a of agents.toSorted((x, y) => order.indexOf(x.role) - order.indexOf(y.role))) {
    for (const s of a.skills) {
      const list = roles.get(s) ?? [];
      if (!list.includes(a.role)) list.push(a.role);
      roles.set(s, list);
    }
  }
  return roles;
}

/** Where a skill comes from: its upstream repository, or `local`. */
export const sourceOf = (s: SkillEntry): string => (s.origin === "local" ? "local" : (s.source ?? "unknown source"));

/** Skills grouped by source, local first, then by group size. Keeps the input order within a group. */
export function groupBySource(skills: SkillEntry[]): Array<{ source: string; skills: SkillEntry[] }> {
  const groups = new Map<string, SkillEntry[]>();
  for (const s of skills) {
    const key = sourceOf(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups]
    .map(([source, list]) => ({ source, skills: list }))
    .sort((a, b) => Number(b.source === "local") - Number(a.source === "local") || b.skills.length - a.skills.length || a.source.localeCompare(b.source));
}
