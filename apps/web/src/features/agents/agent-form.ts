import { parseLines } from "@/lib/board";
import type { Agent, AgentEdit } from "@/lib/types";

export type AgentFormValues = {
  name: string;
  model: string;
  skills: string[];
  mcpServers: string[];
  allowedTools: string;
  disallowedTools: string;
  maxConcurrency: string;
  runsPerHour: string;
  instructions: string;
};

export function toFormValues(a: Agent): AgentFormValues {
  return {
    name: a.name,
    model: a.model ?? "",
    skills: a.skills,
    mcpServers: a.mcpServers ?? [],
    allowedTools: a.permissions.allowedTools.join("\n"),
    disallowedTools: a.permissions.disallowedTools.join("\n"),
    maxConcurrency: String(a.maxConcurrency),
    runsPerHour: String(a.runsPerHour),
    instructions: a.instructions,
  };
}

export type FormErrors = Partial<Record<keyof AgentFormValues, string>>;

function intIn(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** Validates against the server's limits (api.ts AgentEdit) and builds the PUT body. */
export function toAgentEdit(v: AgentFormValues): { edit?: AgentEdit; errors: FormErrors } {
  const errors: FormErrors = {};
  const maxConcurrency = intIn(v.maxConcurrency, 0, 8);
  const runsPerHour = intIn(v.runsPerHour, 0, 120);
  if (!v.name.trim()) errors.name = "Name is required.";
  if (maxConcurrency === null) errors.maxConcurrency = "A whole number from 0 to 8.";
  if (runsPerHour === null) errors.runsPerHour = "A whole number from 0 to 120.";
  if (Object.keys(errors).length > 0 || maxConcurrency === null || runsPerHour === null) return { errors };
  return {
    errors,
    edit: {
      name: v.name.trim(),
      model: v.model.trim() || null,
      skills: v.skills,
      mcpServers: v.mcpServers,
      permissions: { allowedTools: parseLines(v.allowedTools), disallowedTools: parseLines(v.disallowedTools) },
      maxConcurrency,
      runsPerHour,
      instructions: v.instructions,
    },
  };
}
