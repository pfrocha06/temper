import type { Role, TicketType } from "./types";

/** Who runs a stage: an agent role, or the server for gate stages. */
export type StageActor = Role | "server";
export type StageDef = { id: string; kind: "agent" | "gate"; actor: StageActor };

const agent = (id: string, role: Role): StageDef => ({ id, kind: "agent", actor: role });
const gate = (id: string): StageDef => ({ id, kind: "gate", actor: "server" });

/**
 * The main path of each workflow in `workflows/<type>.yaml`, in order. The API does not
 * serve workflows, so this mirrors them by hand; loops (FAIL → build) are not drawn.
 */
export const WORKFLOW_STAGES: Record<TicketType, StageDef[]> = {
  feature: [agent("build", "builder"), agent("verify", "verifier"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  bugfix: [agent("reproduce", "builder"), agent("fix", "builder"), agent("verify", "verifier"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  refactor: [agent("build", "builder"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  investigation: [agent("investigate", "chief"), agent("review", "reviewer")],
  prototype: [agent("sketch", "builder"), agent("review", "reviewer")],
  perf: [agent("baseline", "builder"), agent("build", "builder"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  chore: [agent("build", "builder"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  skill: [agent("author", "builder"), agent("eval", "verifier"), gate("gates"), agent("review", "reviewer"), gate("pr")],
  verification: [agent("author", "verifier"), agent("review", "reviewer")],
};

/**
 * After a ticket is done, the Chief of Staff runs a `digest` dispatch on it to curate shared
 * knowledge. It is not a workflow stage: pipelines leave it out and show it as a note instead.
 */
export const DIGEST_STAGE = "digest";
export const isDigest = (d: { stage: string }) => d.stage === DIGEST_STAGE;

export function stagesFor(type: string): StageDef[] | undefined {
  return WORKFLOW_STAGES[type as TicketType];
}
