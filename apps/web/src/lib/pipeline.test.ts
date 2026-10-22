import { describe, expect, it } from "vitest";
import { derivePipeline, focusNode } from "./pipeline";
import type { Dispatch } from "./types";

let seq = 0;
const d = (stage: string, agentId: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({
    id: `dsp_${++seq}`,
    ticketId: "t",
    stage,
    agentId,
    agentVersion: 1,
    attempt: 1,
    status: "succeeded",
    verdict: "PASS",
    summary: null,
    createdAt: `2026-10-22T13:${String(seq).padStart(2, "0")}:00.000Z`,
    startedAt: null,
    finishedAt: null,
    ...over,
  }) as Dispatch;

const states = (nodes: ReturnType<typeof derivePipeline>) => nodes.map((n) => `${n.stage}:${n.state}`);

describe("derivePipeline", () => {
  it("lays out the workflow's stages, all pending before any dispatch", () => {
    const nodes = derivePipeline({ type: "feature", status: "backlog", stage: null }, []);
    expect(states(nodes)).toEqual(["build:pending", "verify:pending", "gates:pending", "review:pending", "pr:pending"]);
    expect(nodes.map((n) => n.actor)).toEqual(["builder", "verifier", "server", "reviewer", "server"]);
  });

  it("shows the running stage, passed stages before it and pending ones after", () => {
    seq = 0;
    const nodes = derivePipeline({ type: "feature", status: "in_progress", stage: "verify" }, [
      d("build", "builder"),
      d("verify", "verifier", { status: "running", verdict: null }),
    ]);
    expect(states(nodes)).toEqual(["build:pass", "verify:running", "gates:pending", "review:pending", "pr:pending"]);
    expect(focusNode(nodes)?.stage).toBe("verify");
  });

  it("uses the latest attempt and keeps every attempt", () => {
    seq = 0;
    const nodes = derivePipeline({ type: "feature", status: "in_progress", stage: "verify" }, [
      d("build", "builder", { verdict: "BLOCKED", status: "failed" }),
      d("build", "builder", { attempt: 2 }),
      d("verify", "verifier", { status: "running", verdict: null }),
    ]);
    expect(nodes[0]!.state).toBe("pass");
    expect(nodes[0]!.attempts).toHaveLength(2);
  });

  it("marks the board's stage as waiting, or as stuck when its verdict was BLOCKED", () => {
    seq = 0;
    const merge = derivePipeline({ type: "chore", status: "awaiting_board", stage: "pr" }, [
      d("build", "builder"),
      d("gates", "server"),
      d("review", "reviewer"),
      d("pr", "server", { verdict: null, summary: "waiting for the board to merge" }),
    ]);
    expect(states(merge)).toEqual(["build:pass", "gates:pass", "review:pass", "pr:waiting"]);

    seq = 0;
    const stuck = derivePipeline({ type: "chore", status: "awaiting_board", stage: "build" }, [
      d("build", "builder", { verdict: "BLOCKED", status: "failed" }),
    ]);
    expect(stuck[0]!.state).toBe("blocked");
    expect(focusNode(stuck)?.stage).toBe("build");
  });

  it("treats results after a loop back as stale", () => {
    seq = 0;
    const nodes = derivePipeline({ type: "chore", status: "in_progress", stage: "build" }, [
      d("build", "builder"),
      d("gates", "server"),
      d("review", "reviewer", { verdict: "FAIL" }),
      d("build", "builder", { attempt: 2, status: "running", verdict: null }),
    ]);
    expect(states(nodes)).toEqual(["build:running", "gates:pending", "review:pending", "pr:pending"]);
    expect(nodes[2]!.stale).toBe(true);
    expect(nodes[2]!.latest?.verdict).toBe("FAIL");
  });

  it("shows a stage waiting for a free agent as queued", () => {
    seq = 0;
    const nodes = derivePipeline({ type: "chore", status: "in_progress", stage: "gates" }, [d("build", "builder")]);
    expect(states(nodes).slice(0, 2)).toEqual(["build:pass", "gates:queued"]);
  });

  it("marks the current stage of a cancelled ticket and appends stages the workflow map does not know", () => {
    seq = 0;
    const nodes = derivePipeline({ type: "chore", status: "cancelled", stage: "build" }, [
      d("build", "builder", { status: "cancelled", verdict: null }),
      d("extra", "server"),
    ]);
    expect(nodes[0]!.state).toBe("cancelled");
    expect(nodes.at(-1)).toMatchObject({ stage: "extra", kind: "gate", actor: "server", state: "pass" });
  });
});
