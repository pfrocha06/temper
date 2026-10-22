import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const TICKET_TYPES = [
  "feature",
  "bugfix",
  "refactor",
  "investigation",
  "prototype",
  "perf",
  "chore",
  "skill",
  "verification",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const VERDICTS = ["PASS", "FAIL", "BLOCKED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const GATE_CHECKS = ["builder_tests", "holdouts", "diff_guard", "secret_scan", "open_pr", "await_merge"] as const;
export type GateCheck = (typeof GATE_CHECKS)[number];

/** Where a transition leads: another stage, `done`, or `board` (escalate to the human). */
const Target = z.string().min(1);

const Transitions = z
  .object({ PASS: Target, FAIL: Target.optional(), BLOCKED: Target.optional() })
  .strict();

const AgentStage = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    kind: z.literal("agent"),
    role: z.enum(["chief", "builder", "verifier", "reviewer"]),
    instructions: z.string().min(1),
    artifact: z.string().optional(),
    readOnly: z.boolean().default(false),
    maxLoops: z.number().int().positive().default(3),
    on: Transitions,
  })
  .strict();

const GateStage = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    kind: z.literal("gate"),
    checks: z.array(z.enum(GATE_CHECKS)).min(1),
    maxLoops: z.number().int().positive().default(3),
    on: Transitions,
  })
  .strict();

export const Stage = z.discriminatedUnion("kind", [AgentStage, GateStage]);
export type Stage = z.infer<typeof Stage>;

export const Workflow = z
  .object({
    type: z.enum(TICKET_TYPES),
    description: z.string(),
    requiresBoardApproval: z.boolean().default(false),
    start: z.string(),
    stages: z.array(Stage).min(1),
  })
  .strict()
  .superRefine((wf, ctx) => {
    const ids = new Set(wf.stages.map((s) => s.id));
    if (ids.size !== wf.stages.length) ctx.addIssue({ code: "custom", message: "duplicate stage ids" });
    if (!ids.has(wf.start)) ctx.addIssue({ code: "custom", message: `start stage '${wf.start}' does not exist` });
    for (const s of wf.stages) {
      for (const target of Object.values(s.on)) {
        if (target && target !== "done" && target !== "board" && !ids.has(target)) {
          ctx.addIssue({ code: "custom", message: `stage '${s.id}' routes to unknown '${target}'` });
        }
      }
    }
  });
export type Workflow = z.infer<typeof Workflow>;

export function parseWorkflow(source: string): Workflow {
  return Workflow.parse(parse(source));
}

export function loadWorkflows(dir: string): Map<TicketType, Workflow> {
  const out = new Map<TicketType, Workflow>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    const wf = parseWorkflow(readFileSync(join(dir, file), "utf8"));
    if (out.has(wf.type)) throw new Error(`duplicate workflow for type '${wf.type}' in ${file}`);
    out.set(wf.type, wf);
  }
  return out;
}

/** The verdict is the last `VERDICT: X` line in an agent's final message. Anything else is FAIL. */
export function parseVerdict(text: string): Verdict {
  const matches = [...text.matchAll(/^\s*VERDICT:\s*(PASS|FAIL|BLOCKED)\b/gm)];
  const last = matches.at(-1);
  return (last?.[1] as Verdict | undefined) ?? "FAIL";
}

export type Next =
  | { kind: "stage"; stage: Stage }
  | { kind: "done" }
  | { kind: "board"; reason: string };

/**
 * Decides where a ticket goes after `stageId` ends with `verdict`.
 * `attempts` counts dispatches per stage so far for this ticket; exceeding a stage's
 * `maxLoops` escalates to the board instead of looping forever.
 */
export function nextStep(wf: Workflow, stageId: string, verdict: Verdict, attempts: Record<string, number>): Next {
  const stage = wf.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`unknown stage '${stageId}'`);
  const target = stage.on[verdict] ?? "board";
  if (target === "done") return { kind: "done" };
  if (target === "board") return { kind: "board", reason: `${stageId} ended ${verdict}` };
  const next = wf.stages.find((s) => s.id === target)!;
  if ((attempts[next.id] ?? 0) >= next.maxLoops) {
    return { kind: "board", reason: `${next.id} hit its loop cap of ${next.maxLoops}` };
  }
  return { kind: "stage", stage: next };
}

export function startStage(wf: Workflow): Stage {
  return wf.stages.find((s) => s.id === wf.start)!;
}
