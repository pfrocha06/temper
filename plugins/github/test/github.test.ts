import { describe, expect, it } from "vitest";
import { mergeRisk, prBody, repoFromRemote, repoOf } from "../src/index.ts";

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

  it("ends with the issue line, so merging closes the issue", () => {
    const body = prBody({ ticketId: "tkt_1", title: "x", filesChanged: 1, areas: [], issue: "Closes acme/shop#7" });
    expect(body.trimEnd().split(/\n/).at(-1)).toBe("Closes acme/shop#7");
    expect(prBody({ ticketId: "tkt_1", title: "x", filesChanged: 1, areas: [] })).not.toContain("Closes");
  });
});

describe("repoOf", () => {
  it("extracts owner/repo from a PR URL", () => {
    expect(repoOf("https://github.com/acme/widgets/pull/12")).toBe("acme/widgets");
    expect(() => repoOf("https://example.com/x")).toThrow(/not a GitHub/);
  });
});

describe("repoFromRemote", () => {
  it("reads owner/repo from https and ssh GitHub remotes only", () => {
    expect(repoFromRemote("https://github.com/acme/shop.git")).toBe("acme/shop");
    expect(repoFromRemote("https://github.com/acme/shop")).toBe("acme/shop");
    expect(repoFromRemote("git@github.com:acme/shop.git")).toBe("acme/shop");
    expect(repoFromRemote("https://gitlab.com/acme/shop.git")).toBeUndefined();
    expect(repoFromRemote(null)).toBeUndefined();
  });
});
