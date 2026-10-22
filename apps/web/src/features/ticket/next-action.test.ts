import { describe, expect, it } from "vitest";
import { askedQuestion } from "./next-action";

describe("askedQuestion", () => {
  it("pulls the agent's question out of an escalation body", () => {
    expect(askedQuestion("**Decision needed:** allow local binding?\n\nbuild ended BLOCKED")).toBe("allow local binding?");
    expect(askedQuestion("build ended BLOCKED")).toBeUndefined();
    expect(askedQuestion(undefined)).toBeUndefined();
  });
});
