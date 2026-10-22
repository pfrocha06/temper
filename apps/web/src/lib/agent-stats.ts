import type { Dispatch } from "./types";

export type AgentStats = {
  runs: number;
  /** Share of finished runs with a PASS verdict; undefined before any verdict. */
  passRate: number | undefined;
  avgMs: number | undefined;
  runsLastHour: number;
  running: number;
  /** Verdicts of the most recent finished runs, oldest first. */
  recent: Array<"PASS" | "FAIL" | "BLOCKED" | "none">;
};

/** Per-agent run statistics from the recent dispatch list. */
export function agentStats(dispatches: Dispatch[], now = Date.now(), recentCount = 12): Map<string, AgentStats> {
  const map = new Map<string, AgentStats & { durations: number[]; verdicts: number; passes: number }>();
  const sorted = dispatches.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const d of sorted) {
    const s = map.get(d.agentId) ?? {
      runs: 0,
      passRate: undefined,
      avgMs: undefined,
      runsLastHour: 0,
      running: 0,
      recent: [],
      durations: [],
      verdicts: 0,
      passes: 0,
    };
    s.runs += 1;
    if (d.status === "running") s.running += 1;
    if (d.startedAt && now - Date.parse(d.startedAt) <= 3_600_000) s.runsLastHour += 1;
    if (d.startedAt && d.finishedAt) s.durations.push(Date.parse(d.finishedAt) - Date.parse(d.startedAt));
    if (d.verdict) {
      s.verdicts += 1;
      if (d.verdict === "PASS") s.passes += 1;
    }
    if (d.finishedAt) s.recent.push((d.verdict as "PASS" | "FAIL" | "BLOCKED" | null) ?? "none");
    map.set(d.agentId, s);
  }
  const out = new Map<string, AgentStats>();
  for (const [id, s] of map) {
    out.set(id, {
      runs: s.runs,
      running: s.running,
      runsLastHour: s.runsLastHour,
      passRate: s.verdicts ? s.passes / s.verdicts : undefined,
      avgMs: s.durations.length ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length : undefined,
      recent: s.recent.slice(-recentCount),
    });
  }
  return out;
}
