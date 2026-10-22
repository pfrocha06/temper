import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SkillEntry = {
  name: string;
  origin: "vendor" | "local";
  path: string;
  source?: string;
  commit?: string;
  license?: string;
  description?: string;
};

export function readRegistry(appRoot: string): SkillEntry[] {
  const file = join(appRoot, "skills", "registry.json");
  if (!existsSync(file)) return [];
  const entries = (JSON.parse(readFileSync(file, "utf8")) as { skills: SkillEntry[] }).skills;
  return entries.map((e) => ({ ...e, description: e.description ?? describe(join(appRoot, e.path)) }));
}

function describe(dir: string): string | undefined {
  const md = join(dir, "SKILL.md");
  if (!existsSync(md)) return undefined;
  return /^description:\s*(.+)$/m.exec(readFileSync(md, "utf8"))?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/** Absolute skill directories for the given names. Unknown names are reported, not fatal. */
export function resolveSkills(appRoot: string, names: string[]): { dirs: string[]; missing: string[] } {
  const registry = new Map(readRegistry(appRoot).map((e) => [e.name, e]));
  const dirs: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const e = registry.get(n);
    const dir = e && join(appRoot, e.path);
    if (dir && existsSync(join(dir, "SKILL.md"))) dirs.push(dir);
    else missing.push(n);
  }
  return { dirs, missing };
}
