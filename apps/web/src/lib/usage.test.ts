import { describe, expect, it } from "vitest";
import type { UsageBucket, UsageReport } from "./types";
import { cacheReadShare, failedAttempts, labelEvery, niceTicks, parseRange, pct, seriesRoles, ticketRows, timeline, vendorOfModel, whereItWent } from "./usage";

const b = (key: string, tokens: number, extra: Partial<UsageBucket> = {}): UsageBucket => ({ key, label: key, tokens, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, runs: 1, ...extra });

const report = (over: Partial<UsageReport> = {}): UsageReport => ({
  from: "2026-10-15T12:00:00.000Z",
  to: "2026-10-22T12:00:00.000Z",
  totals: b("total", 1000, { cacheReadTokens: 3000, runs: 10 }),
  wasted: b("wasted", 210, { runs: 2 }),
  series: [
    { bucket: "2026-10-16", byRole: { builder: 400, chief: 100 } },
    { bucket: "2026-10-20", byRole: { reviewer: 300, builder: 180, server: 20 } },
  ],
  byRole: [b("builder", 580), b("reviewer", 300), b("chief", 100), b("server", 20)],
  byKind: [b("Ticket work", 900), b("Conversations", 100)],
  byStage: [b("build", 580), b("review", 300)],
  byModel: [b("claude-sonnet-4-5", 900), b("gpt-5", 100)],
  byProject: [b("prj_1", 900)],
  byTicket: [
    { ...b("tkt_a", 600), label: "Fix login", ticketId: "tkt_a", status: "done", type: "bugfix", attempts: 4 },
    { ...b("tkt_b", 300), label: "Add docs", ticketId: "tkt_b", status: "in_progress", type: "chore", attempts: 1 },
  ],
  ...over,
});

describe("parseRange", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  it("defaults to the last 7 days and reads presets", () => {
    const r = parseRange(new URLSearchParams(""), now);
    expect(r).toMatchObject({ preset: "7d", projectId: undefined });
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86_400_000);
    expect(parseRange(new URLSearchParams("range=24h&project=prj_1"), now)).toMatchObject({ preset: "24h", projectId: "prj_1" });
    expect(parseRange(new URLSearchParams("range=bogus"), now).preset).toBe("7d");
  });

  it("reads a custom range as whole local days, never past now", () => {
    const r = parseRange(new URLSearchParams("range=custom&from=2026-10-01&to=2026-10-03"), now);
    expect(r.preset).toBe("custom");
    expect(r.from).toEqual(new Date(2026, 9, 1));
    expect(r.to).toEqual(new Date(2026, 9, 4));
    expect(parseRange(new URLSearchParams("range=custom&from=2026-10-20&to=2026-10-30"), now).to.getTime()).toBe(now);
    expect(parseRange(new URLSearchParams("range=custom&from=2026-10-05&to=2026-10-01"), now).preset).toBe("7d");
  });
});

describe("timeline", () => {
  it("fills every day in the range, in UTC day keys, empty ones included", () => {
    const t = timeline(report());
    expect(t.map((x) => x.key)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(t[1]).toMatchObject({ total: 500, byRole: { builder: 400, chief: 100 } });
    expect(t[2]!.total).toBe(0);
  });

  it("uses hourly buckets for two days or less", () => {
    const t = timeline({ from: "2026-10-22T09:30:00.000Z", to: "2026-10-22T12:10:00.000Z", series: [{ bucket: "2026-10-22T11:00", byRole: { chief: 5 } }] });
    expect(t.map((x) => x.key)).toEqual(["2026-10-22T09:00", "2026-10-22T10:00", "2026-10-22T11:00", "2026-10-22T12:00"]);
    expect(t[2]!.total).toBe(5);
  });

  it("orders series roles the way the app does", () => {
    expect(seriesRoles(report())).toEqual(["chief", "builder", "reviewer", "server"]);
  });
});

describe("axis", () => {
  it("picks clean ticks that cover the maximum", () => {
    expect(niceTicks(950)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(12_300)).toEqual([0, 5000, 10000, 15000]);
    expect(niceTicks(0)).toEqual([0]);
    expect(labelEvery(30, 7)).toBe(5);
    expect(labelEvery(5, 7)).toBe(1);
  });
});

describe("figures", () => {
  it("formats shares and the cache-read share", () => {
    expect(pct(0.584)).toBe("58%");
    expect(pct(0.001)).toBe("<1%");
    expect(pct(0)).toBe("0%");
    expect(cacheReadShare({ tokens: 1000, cacheReadTokens: 3000 })).toBe(0.75);
  });

  it("finds a model's vendor for its logo", () => {
    expect(vendorOfModel("claude-sonnet-4-5")).toBe("anthropic");
    expect(vendorOfModel("opus")).toBe("anthropic");
    expect(vendorOfModel("gpt-5-codex")).toBe("openai");
    expect(vendorOfModel("gemini-2.5-pro")).toBe("google");
    expect(vendorOfModel("llama3")).toBeUndefined();
  });
});

describe("tickets", () => {
  const dispatches = [
    { ticketId: "tkt_a", verdict: "FAIL", agentId: "builder" },
    { ticketId: "tkt_a", verdict: "BLOCKED", agentId: "reviewer" },
    { ticketId: "tkt_a", verdict: "FAIL", agentId: "server" },
    { ticketId: "tkt_b", verdict: "PASS", agentId: "builder" },
  ];
  it("counts failed agent attempts, not server gate runs", () => {
    expect(failedAttempts(dispatches)).toEqual(new Map([["tkt_a", 2]]));
  });

  it("sorts by any column, with share of the total", () => {
    const failed = failedAttempts(dispatches);
    expect(ticketRows(report(), failed, "tokens", "desc").map((r) => [r.ticketId, r.share, r.failed])).toEqual([
      ["tkt_a", 0.6, 2],
      ["tkt_b", 0.3, 0],
    ]);
    expect(ticketRows(report(), failed, "label", "asc").map((r) => r.label)).toEqual(["Add docs", "Fix login"]);
    expect(ticketRows(report(), failed, "attempts", "asc")[0]!.ticketId).toBe("tkt_b");
  });
});

describe("whereItWent", () => {
  it("says who used most, how much failed and where, and the costliest ticket", () => {
    const dispatches = [
      { stage: "build", verdict: "FAIL", agentId: "builder", createdAt: "2026-10-20T10:00:00.000Z" },
      { stage: "build", verdict: "FAIL", agentId: "builder", createdAt: "2026-10-20T11:00:00.000Z" },
      { stage: "review", verdict: "BLOCKED", agentId: "reviewer", createdAt: "2026-10-20T12:00:00.000Z" },
      { stage: "gates", verdict: "FAIL", agentId: "server", createdAt: "2026-10-20T12:00:00.000Z" },
      { stage: "review", verdict: "FAIL", agentId: "reviewer", createdAt: "2026-09-01T12:00:00.000Z" },
    ];
    expect(whereItWent(report(), dispatches)).toEqual([
      "The Builder used 58% of 1k tokens, the Reviewer 30%.",
      "21% went to attempts that failed or were blocked, mostly at the build stage.",
      "The costliest ticket, “Fix login”, took 60% over 4 runs.",
    ]);
  });

  it("notes conversations when they are a large share, and when nothing failed", () => {
    const r = report({ wasted: b("wasted", 0, { runs: 0 }), byKind: [b("Ticket work", 700), b("Conversations", 300)], byTicket: [] });
    expect(whereItWent(r)).toEqual(["The Builder used 58% of 1k tokens, the Reviewer 30%.", "Conversations with the Chief took 30%.", "Nothing went to failed attempts."]);
    expect(whereItWent(report({ totals: b("total", 0) }))).toEqual([]);
  });
});
