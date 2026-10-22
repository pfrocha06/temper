import { describe, expect, it } from "vitest";
import { placeProposals, proposalAction, proposalHeadline, proposalOutcome, proposalTargetTitle, repoName } from "./proposals";

describe("proposalAction", () => {
  it("reads the two actions a proposal can carry", () => {
    expect(proposalAction({ payload: { action: "resolve_approval", approvalId: "apv_1", resolution: "accept" } })).toEqual({ action: "resolve_approval", approvalId: "apv_1", resolution: "accept" });
    expect(proposalAction({ payload: { action: "deploy", source: "/src/temper" } })).toEqual({ action: "deploy", ref: "main", source: "/src/temper" });
    expect(proposalAction({ payload: { action: "deploy", ref: "v2", source: "/src/temper" } })).toMatchObject({ ref: "v2" });
    expect(proposalAction({ payload: null })).toEqual({ action: "unknown", raw: {} });
  });

  it("shortens titles and paths for prose", () => {
    expect(proposalHeadline("Chief proposes: deploy main from /x")).toBe("deploy main from /x");
    expect(repoName("/Users/me/dev/temper/")).toBe("temper");
    expect(proposalTargetTitle("Chief proposes: accept — Stuck: Add a badge (gates)")).toBe("Stuck: Add a badge (gates)");
    expect(proposalTargetTitle("Chief proposes: deploy main from /x")).toBeUndefined();
  });

  it("reads the outcome", () => {
    expect(proposalOutcome({ status: "pending", resolution: null })).toBe("pending");
    expect(proposalOutcome({ status: "resolved", resolution: "confirm" })).toBe("confirmed");
    expect(proposalOutcome({ status: "resolved", resolution: "decline" })).toBe("declined");
  });
});

describe("placeProposals", () => {
  const messages = [
    { id: 1, author: "board", at: "2026-10-22T10:00:00Z" },
    { id: 2, author: "chief", at: "2026-10-22T10:01:00Z" },
    { id: 3, author: "board", at: "2026-10-22T10:05:00Z" },
    { id: 4, author: "chief", at: "2026-10-22T10:07:00Z" },
  ];
  it("puts each proposal after the Chief reply of the turn that made it", () => {
    const placed = placeProposals(messages, [
      { id: "p2", createdAt: "2026-10-22T10:06:30Z" },
      { id: "p1", createdAt: "2026-10-22T10:00:40Z" },
      { id: "p3", createdAt: "2026-10-22T10:06:50Z" },
    ]);
    expect(placed.after).toEqual(new Map([[2, ["p1"]], [4, ["p2", "p3"]]]));
    expect(placed.trailing).toEqual([]);
  });

  it("keeps proposals from a turn still in progress at the end", () => {
    expect(placeProposals(messages, [{ id: "p9", createdAt: "2026-10-22T10:08:00Z" }]).trailing).toEqual(["p9"]);
  });
});
