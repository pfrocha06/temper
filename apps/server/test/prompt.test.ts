import { describe, expect, it } from "vitest";
import type { Artifact, Ticket } from "@temper/core";
import { buildPrompt } from "../src/prompt.ts";
import { Factory } from "../src/factory.ts";
import { parsePlan } from "../src/plan.ts";

const ticket = {
  id: "tkt_1",
  title: "Archive projects",
  type: "feature",
  spec: "Users can archive a project.",
  acceptanceCriteria: [{ id: "AC-1", text: "Archived projects leave the board" }],
  fileScope: ["apps/web/src/*"],
} as Ticket;

const art = (id: number, name: string, content: string) => ({ id, name, content }) as Artifact;
const artifacts = [art(1, "changes.md", "built it"), art(2, "verification.md", "holdout source: expect(board)..."), art(3, "review.md", "nit")];
const stage = (role: "builder" | "reviewer") => ({ id: "s", kind: "agent" as const, role, instructions: "go", readOnly: false, maxLoops: 3, on: { PASS: "done" } });

describe("buildPrompt", () => {
  it("never shows the builder verification output", () => {
    const p = buildPrompt({ ticket, stage: { ...stage("builder"), artifact: "changes.md" }, artifacts });
    expect(p).not.toContain("holdout source");
    expect(p).toContain("review.md");
    expect(p).toContain("AC-1: Archived projects leave the board");
    expect(p).toMatch(/VERDICT: PASS/);
  });

  it("shows the reviewer everything", () => {
    expect(buildPrompt({ ticket, stage: stage("reviewer"), artifacts })).toContain("holdout source");
  });
});

describe("parsePlan", () => {
  it("parses tickets and rejects unknown dependencies", () => {
    const ok = '```json\n{"tickets":[{"key":"T1","type":"feature","title":"a"},{"key":"T2","type":"chore","title":"b","dependsOn":["T1"]}]}\n```\nVERDICT: PASS';
    expect(parsePlan(ok).map((t) => t.key)).toEqual(["T1", "T2"]);
    expect(() => parsePlan(ok.replace('["T1"]', '["T9"]'))).toThrow(/unknown T9/);
  });
});

describe("decisionAsked", () => {
  it("finds the question an agent asked", () => {
    expect(Factory.decisionAsked("…\nVERDICT: BLOCKED\n\nDecision needed: allow local binding?")).toBe("allow local binding?");
    expect(Factory.decisionAsked("VERDICT: BLOCKED — need a human to run pnpm install")).toBe("need a human to run pnpm install");
    expect(Factory.decisionAsked("all good\nVERDICT: PASS")).toBeUndefined();
  });
});
