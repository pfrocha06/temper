import { describe, expect, it } from "vitest";
import type { IntakeCandidate } from "@/lib/types";
import { blockedReason, effectiveSelection, progressSummary, type RowProgress } from "./import-issues-model";

const c = (key: string, over: Partial<IntakeCandidate> = {}): IntakeCandidate => ({
  source: "github",
  key,
  title: key,
  url: `https://github.com/acme/shop/issues/${key.split("#")[1]}`,
  status: "open",
  labels: [],
  author: "owner",
  trusted: true,
  ...over,
});

describe("import issues selection", () => {
  it("blocks issues already on the board, and untrusted authors unless allowed", () => {
    expect(blockedReason(c("acme/shop#1"), false)).toBeUndefined();
    expect(blockedReason(c("acme/shop#2", { ticketId: "tkt_1" }), true)).toBe("Already on the board");
    expect(blockedReason(c("acme/shop#3", { trusted: false, author: "stranger" }), false)).toMatch(/stranger, who cannot push/);
    expect(blockedReason(c("acme/shop#3", { trusted: false }), true)).toBeUndefined();
  });

  it("drops ticked rows that turn unselectable when the author switch goes off", () => {
    const list = [c("acme/shop#1"), c("acme/shop#2", { trusted: false })];
    const ticked = new Set(["acme/shop#1", "acme/shop#2"]);
    expect(effectiveSelection(list, ticked, true)).toEqual(["acme/shop#1", "acme/shop#2"]);
    expect(effectiveSelection(list, ticked, false)).toEqual(["acme/shop#1"]);
  });

  it("sums progress across rows", () => {
    const done = (status: "imported" | "skipped", n: number): RowProgress => ({ state: "done", result: { key: "k", url: "u", status, ticketIds: Array(n).fill("t") } });
    const m = new Map<string, RowProgress>([
      ["a", done("imported", 3)],
      ["b", done("skipped", 0)],
      ["c", { state: "failed", error: "x" }],
      ["d", { state: "importing", since: 0 }],
      ["e", { state: "queued" }],
    ]);
    expect(progressSummary(m)).toEqual({ done: 3, total: 5, tickets: 3, skipped: 1, failed: 1 });
  });
});
