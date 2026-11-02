import { describe, expect, it } from "vitest";
import { jobOf, mergeReadiness, mergeRisk, prBody, repoFromRemote, repoOf, type CheckRun, type PrStatus } from "../src/index.ts";

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
    expect(repoFromRemote("https://github.com/acme/shop/")).toBe("acme/shop");
    expect(repoFromRemote("https://github.com/acme/shop/extra")).toBeUndefined();
    expect(repoFromRemote("https://notgithub.company/acme/shop")).toBeUndefined();
    expect(repoFromRemote("https://evilgithub.com/acme/shop")).toBeUndefined();
    // Linear on hostile input: no backtracking.
    const start = Date.now();
    expect(repoFromRemote("github.com/" + "a".repeat(50_000) + "/".repeat(50_000) + "!")).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("mergeReadiness", () => {
  const head = "a".repeat(40);
  const check = (name: string, bucket: CheckRun["bucket"]): CheckRun => ({ name, bucket, state: bucket.toUpperCase(), link: `https://github.com/acme/shop/actions/runs/1/job/${name.length}` });
  const status = (over: Partial<PrStatus> = {}): PrStatus => ({ state: "OPEN", head, mergeState: "CLEAN", checks: [check("test", "pass")], ...over });

  it("is ready only when the PR at the pushed commit is mergeable", () => {
    expect(mergeReadiness(status(), head)).toEqual({ kind: "ready" });
    // A failing check GitHub does not require leaves the PR mergeable.
    expect(mergeReadiness(status({ mergeState: "UNSTABLE" }), head).kind).toBe("ready");
    expect(mergeReadiness(status({ checks: [check("lint", "skipping"), check("test", "pass")] }), head).kind).toBe("ready");
  });

  it("waits while a required check runs, or while GitHub blocks the merge for a reason it has not reported yet", () => {
    const r = mergeReadiness(status({ mergeState: "BLOCKED", checks: [check("test", "pass"), check("build", "pending")] }), head);
    expect(r).toMatchObject({ kind: "pending" });
    expect(r.kind === "pending" && r.detail).toMatch(/1 of 2 required checks.*build/);
    // Right after a push GitHub may not list the required checks yet: blocked, nothing reported.
    expect(mergeReadiness(status({ mergeState: "BLOCKED", checks: [] }), head).kind).toBe("pending");
    expect(mergeReadiness(status({ mergeState: "UNKNOWN" }), head).kind).toBe("pending");
  });

  it("fails on a failed or cancelled required check, even while others run", () => {
    const r = mergeReadiness(status({ mergeState: "BLOCKED", checks: [check("test", "fail"), check("e2e", "cancel"), check("build", "pending")] }), head);
    expect(r).toMatchObject({ kind: "failed" });
    expect(r.kind === "failed" && r.failed.map((c) => c.name)).toEqual(["test", "e2e"]);
  });

  it("is blocked by what waiting cannot fix: another head, conflicts, a stale branch, a closed or draft PR", () => {
    expect(mergeReadiness(status({ head: "b".repeat(40) }), head)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/bbbbbbb.*aaaaaaa/) });
    expect(mergeReadiness(status({ mergeState: "DIRTY" }), head)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/conflicts/) });
    expect(mergeReadiness(status({ mergeState: "BEHIND" }), head)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/behind/) });
    expect(mergeReadiness(status({ mergeState: "DRAFT" }), head)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/draft/) });
    expect(mergeReadiness(status({ state: "CLOSED" }), head)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/closed/) });
  });

  it("never reads checks of another commit as this one's: a moved head wins over passing checks", () => {
    expect(mergeReadiness(status({ head: "c".repeat(40), checks: [check("test", "pass")] }), head).kind).toBe("blocked");
  });
});

describe("jobOf", () => {
  it("reads repo and job id from an Actions job link, and nothing else", () => {
    expect(jobOf("https://github.com/acme/shop/actions/runs/41/job/125")).toEqual({ repo: "acme/shop", job: "125" });
    expect(jobOf("https://ci.example.com/build/7")).toBeUndefined();
    expect(jobOf(undefined)).toBeUndefined();
  });
});
