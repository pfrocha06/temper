import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorkflows, nextStep, parseVerdict, parseWorkflow, TICKET_TYPES } from "../src/workflow.ts";

const minimal = `
type: chore
description: test
start: build
stages:
  - id: build
    kind: agent
    role: builder
    instructions: do it
    maxLoops: 2
    on: { PASS: gates, FAIL: build }
  - id: gates
    kind: gate
    checks: [builder_tests]
    on: { PASS: done, FAIL: build }
`;

describe("parseVerdict", () => {
  it("takes the last verdict line", () => {
    expect(parseVerdict("VERDICT: FAIL\nretrying\nVERDICT: PASS")).toBe("PASS");
  });
  it("treats a missing verdict as FAIL", () => {
    expect(parseVerdict("all done!")).toBe("FAIL");
  });
  it("ignores verdicts that are not at line start", () => {
    expect(parseVerdict("I would say VERDICT: PASS")).toBe("FAIL");
  });
});

describe("parseWorkflow", () => {
  it("rejects transitions to unknown stages", () => {
    expect(() => parseWorkflow(minimal.replace("PASS: done", "PASS: nowhere"))).toThrow(/unknown 'nowhere'/);
  });
});

describe("nextStep", () => {
  const wf = parseWorkflow(minimal);

  it("follows the verdict", () => {
    expect(nextStep(wf, "build", "PASS", {})).toMatchObject({ kind: "stage", stage: { id: "gates" } });
    expect(nextStep(wf, "gates", "PASS", {})).toEqual({ kind: "done" });
  });

  it("escalates to the board when a loop cap is hit", () => {
    expect(nextStep(wf, "gates", "FAIL", { build: 2 })).toMatchObject({ kind: "board" });
  });

  it("escalates BLOCKED without an explicit route", () => {
    expect(nextStep(wf, "build", "BLOCKED", {})).toMatchObject({ kind: "board" });
  });
});

describe("repository workflows", () => {
  it("defines a valid workflow for every ticket type", () => {
    const all = loadWorkflows(join(import.meta.dirname, "../../../workflows"));
    expect([...all.keys()].sort()).toEqual([...TICKET_TYPES].sort());
  });
});
