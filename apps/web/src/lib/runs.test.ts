import { describe, expect, it } from "vitest";
import { groupRuns, splitRuns } from "./runs";
import type { Dispatch } from "./types";

const d = (id: string, ticketId: string, status: string, createdAt: string, finishedAt: string | null = null) =>
  ({ id, ticketId, status, createdAt, startedAt: createdAt, finishedAt, attempt: 1 }) as Dispatch;

describe("groupRuns", () => {
  const dispatches = [
    d("a2", "A", "succeeded", "2026-10-22T10:05:00Z", "2026-10-22T10:06:00Z"),
    d("a1", "A", "succeeded", "2026-10-22T10:00:00Z", "2026-10-22T10:04:00Z"),
    d("b1", "B", "failed", "2026-10-22T11:00:00Z", "2026-10-22T11:30:00Z"),
    d("c1", "C", "succeeded", "2026-10-22T09:00:00Z", "2026-10-22T09:10:00Z"),
    d("c2", "C", "running", "2026-10-22T09:20:00Z"),
  ];

  it("groups per ticket, oldest attempt first, running tickets first then by last activity", () => {
    const groups = groupRuns(dispatches);
    expect(groups.map((g) => g.ticketId)).toEqual(["C", "B", "A"]);
    expect(groups[0]!.running?.id).toBe("c2");
    expect(groups[2]!.dispatches.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(groups[2]!.latest.id).toBe("a2");
    expect(groups[1]!.lastActivity).toBe("2026-10-22T11:30:00Z");
  });

  it("splits running, latest and older tickets", () => {
    const { running, latest, older } = splitRuns(groupRuns(dispatches), 1);
    expect(running.map((g) => g.ticketId)).toEqual(["C"]);
    expect(latest.map((g) => g.ticketId)).toEqual(["B"]);
    expect(older.map((g) => g.ticketId)).toEqual(["A"]);
  });
});
