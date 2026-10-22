import { describe, expect, it } from "vitest";
import { mergeRisk, prBody } from "../src/index.ts";

describe("mergeRisk", () => {
  it("scales with files and areas", () => {
    expect(mergeRisk(3, ["apps"])).toBe("low");
    expect(mergeRisk(10, ["apps"])).toBe("medium");
    expect(mergeRisk(5, ["apps", "packages", "plugins", "workflows"])).toBe("high");
  });
});

describe("prBody", () => {
  it("includes evidence and strips verdict lines", () => {
    const body = prBody({ ticketId: "tkt_1", title: "x", changes: "Added X\nVERDICT: PASS", verification: "AC-1: PASS", filesChanged: 2, areas: ["apps"] });
    expect(body).toContain("merge risk: low");
    expect(body).toContain("## Evidence");
    expect(body).not.toContain("VERDICT");
  });
});
