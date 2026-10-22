import { describe, expect, it } from "vitest";
import { mergeRisk, prBody, repoOf } from "../src/index.ts";

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

describe("repoOf", () => {
  it("extracts owner/repo from a PR URL", () => {
    expect(repoOf("https://github.com/acme/widgets/pull/12")).toBe("acme/widgets");
    expect(() => repoOf("https://example.com/x")).toThrow(/not a GitHub/);
  });
});
