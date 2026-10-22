import type { Dispatch, Ticket } from "./types";
import { isDigest, stagesFor, type StageActor, type StageDef } from "./workflows";

/**
 * - `pending`: not reached yet (or an earlier result made stale by a loop back).
 * - `queued`: the ticket sits at this stage waiting for a free agent.
 * - `running`: a dispatch is running now.
 * - `waiting`: the stage passed its part and waits for the board (a merge, a decision).
 */
export type NodeState = "pending" | "queued" | "running" | "pass" | "fail" | "blocked" | "waiting" | "cancelled";

export type PipelineNode = {
  stage: string;
  kind: StageDef["kind"];
  actor: StageActor;
  state: NodeState;
  /** Dispatches of this stage, oldest first. */
  attempts: Dispatch[];
  latest: Dispatch | undefined;
  /** The stage the ticket is at. */
  current: boolean;
  /** The latest result predates a loop back to an earlier stage, so it no longer counts. */
  stale: boolean;
};

type PipelineTicket = Pick<Ticket, "type" | "status" | "stage">;

function actorOf(d: Dispatch): StageActor {
  return d.agentId === "server" ? "server" : (d.agentId as StageActor);
}

function resultState(d: Dispatch): NodeState {
  if (d.status === "running") return "running";
  if (d.status === "queued") return "queued";
  if (d.verdict === "PASS") return "pass";
  if (d.verdict === "FAIL") return "fail";
  if (d.verdict === "BLOCKED") return "blocked";
  if (d.status === "succeeded") return "pass";
  if (d.status === "failed") return "fail";
  return "cancelled";
}

const order = (a: Dispatch, b: Dispatch) => a.createdAt.localeCompare(b.createdAt) || a.attempt - b.attempt;

/**
 * A ticket's workflow as a row of stage nodes with their live state, from its dispatches.
 * Stages come from the ticket type's workflow; stages seen only in dispatches are appended.
 */
export function derivePipeline(ticket: PipelineTicket, dispatches: Dispatch[]): PipelineNode[] {
  const byStage = new Map<string, Dispatch[]>();
  for (const d of dispatches.toSorted(order)) {
    if (isDigest(d)) continue;
    const list = byStage.get(d.stage) ?? [];
    list.push(d);
    byStage.set(d.stage, list);
  }
  const defs: StageDef[] = [...(stagesFor(ticket.type) ?? [])];
  for (const [stage, list] of byStage) {
    if (!defs.some((s) => s.id === stage)) defs.push({ id: stage, kind: list[0]!.agentId === "server" ? "gate" : "agent", actor: actorOf(list[0]!) });
  }

  const currentIdx = ticket.stage ? defs.findIndex((s) => s.id === ticket.stage) : -1;
  const currentLatest = currentIdx >= 0 ? byStage.get(defs[currentIdx]!.id)?.at(-1) : undefined;
  const active = ticket.status === "in_progress" || ticket.status === "awaiting_board" || ticket.status === "ready";

  return defs.map((def, i) => {
    const attempts = byStage.get(def.id) ?? [];
    const latest = attempts.at(-1);
    const current = i === currentIdx;
    let state: NodeState = latest ? resultState(latest) : "pending";
    let stale = false;

    if (current && ticket.status === "awaiting_board") {
      state = latest && (state === "fail" || state === "blocked") ? state : "waiting";
    } else if (current && ticket.status === "in_progress" && state !== "running" && state !== "queued") {
      // At this stage with nothing running: its next dispatch waits for a free slot.
      state = "queued";
    } else if (current && ticket.status === "cancelled") {
      state = "cancelled";
    }

    // A later stage whose result is older than the current stage's latest dispatch was undone by a loop back.
    if (active && currentIdx >= 0 && i > currentIdx && latest && (!currentLatest || latest.createdAt < currentLatest.createdAt)) {
      stale = true;
      state = "pending";
    }
    if (ticket.status === "backlog") state = latest ? state : "pending";
    return { stage: def.id, kind: def.kind, actor: latest ? actorOf(latest) : def.actor, state, attempts, latest, current, stale };
  });
}

/** The node the eye should go to first: running, waiting, then the current stage, then the last one touched. */
export function focusNode(nodes: PipelineNode[]): PipelineNode | undefined {
  return (
    nodes.find((n) => n.state === "running") ??
    nodes.find((n) => n.state === "waiting" || n.state === "blocked") ??
    nodes.find((n) => n.current) ??
    nodes.findLast((n) => n.latest)
  );
}

/** Dispatches grouped by ticket id. */
export function dispatchesByTicket(dispatches: Dispatch[]): Map<string, Dispatch[]> {
  const map = new Map<string, Dispatch[]>();
  for (const d of dispatches) {
    const list = map.get(d.ticketId) ?? [];
    list.push(d);
    map.set(d.ticketId, list);
  }
  return map;
}
