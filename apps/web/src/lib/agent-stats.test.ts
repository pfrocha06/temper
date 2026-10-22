import { describe, expect, it } from "vitest";
import { agentStats } from "./agent-stats";
import type { Dispatch } from "./types";

const NOW = Date.parse("2026-10-22T14:00:00.000Z");
const d = (agentId: string, start: string, secs: number | null, verdict: string | null, status = "succeeded"): Dispatch =>
  ({
    id: `${agentId}-${start}`,
    agentId,
    status,
    verdict,
    createdAt: start,
    startedAt: start,
    finishedAt: secs === null ? null : new Date(Date.parse(start) + secs * 1000).toISOString(),
  }) as Dispatch;

describe("agentStats", () => {
  it("counts runs, pass rate, mean duration and the last hour's runs per agent", () => {
    const s = agentStats(
      [
        d("builder", "2026-10-22T12:00:00.000Z", 30, "BLOCKED", "failed"),
        d("builder", "2026-10-22T13:30:00.000Z", 90, "PASS"),
        d("builder", "2026-10-22T13:50:00.000Z", null, null, "running"),
        d("reviewer", "2026-10-22T13:40:00.000Z", 20, "PASS"),
      ],
      NOW,
    );
    expect(s.get("builder")).toEqual({ runs: 3, running: 1, runsLastHour: 2, passRate: 0.5, avgMs: 60_000, recent: ["BLOCKED", "PASS"] });
    expect(s.get("reviewer")?.passRate).toBe(1);
    expect(s.get("chief")).toBeUndefined();
  });
});
