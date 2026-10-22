import { z } from "zod";
import { TICKET_TYPES } from "@temper/core";

const PlannedTicket = z.object({
  key: z.string(),
  type: z.enum(TICKET_TYPES),
  title: z.string().min(1),
  spec: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  fileScope: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});
export type PlannedTicket = z.infer<typeof PlannedTicket>;

/** Extracts and validates the planner's JSON block. Unknown dependency keys are an error. */
export function parsePlan(text: string): PlannedTicket[] {
  const block = /```json\s*([\s\S]*?)```/.exec(text)?.[1];
  if (!block) throw new Error("planner reply has no ```json block");
  const { tickets } = z.object({ tickets: z.array(PlannedTicket).min(1) }).parse(JSON.parse(block));
  const keys = new Set(tickets.map((t) => t.key));
  for (const t of tickets) {
    for (const d of t.dependsOn) if (!keys.has(d)) throw new Error(`${t.key} depends on unknown ${d}`);
  }
  return tickets;
}
