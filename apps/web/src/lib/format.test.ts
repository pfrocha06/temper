import { describe, expect, it } from "vitest";
import { plainSummary } from "./format";

describe("plainSummary", () => {
  it("drops markdown markers and the verdict line", () => {
    expect(plainSummary("## Summary\n\nThe bump needs a **decision**: `node` 20.\n\nVERDICT: BLOCKED")).toBe("Summary The bump needs a decision: node 20.");
  });
});
