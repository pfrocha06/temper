import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capReached, latestLimits, openDb, recordLimit, recordUsage, setCaps, getCaps, usageWindows, type Db } from "../src/index.ts";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await openDb()));
afterEach(() => close());

const u = (i: number, o: number) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: 1000, cacheWriteTokens: 10, costUsd: 0.01 });

describe("provider usage", () => {
  it("totals runs and tokens per window, excluding cache reads", async () => {
    await recordUsage(db, "claude-cli", { sonnet: u(100, 50) }, { dispatchId: "d1" });
    await recordUsage(db, "claude-cli", { opus: u(10, 5), sonnet: u(1, 1) }, { dispatchId: "d2" });
    const w = await usageWindows(db, "claude-cli", {});
    expect(w.day.runs).toBe(2);
    expect(w.day.tokens).toBe(160 + 25 + 12);
    expect(w.week.byModel.opus).toBe(25);
  });

  it("reports the first cap reached", async () => {
    await recordUsage(db, "claude-cli", { sonnet: u(100, 50) }, { dispatchId: "d1" });
    const caps = await setCaps(db, "claude-cli", { runsPerSession: 1, tokensPerDay: 10_000 });
    expect(await getCaps(db, "claude-cli")).toEqual(caps);
    expect(capReached(caps, await usageWindows(db, "claude-cli", caps))).toMatchObject({ cap: "runsPerSession", used: 1, limit: 1 });
    expect(capReached({ runsPerSession: 5 }, await usageWindows(db, "claude-cli", {}))).toBeUndefined();
  });

  it("keeps the latest report per limit type", async () => {
    await recordLimit(db, "claude-cli", { limitType: "five_hour", status: "allowed", resetsAt: 1_800_000_000, raw: {} });
    await recordLimit(db, "claude-cli", { limitType: "five_hour", status: "rejected", resetsAt: 1_800_000_000, raw: {} });
    await recordLimit(db, "claude-cli", { limitType: "seven_day", status: "allowed", raw: {} });
    const l = await latestLimits(db, "claude-cli");
    expect(l.find((x) => x.limitType === "five_hour")?.status).toBe("rejected");
    expect(l).toHaveLength(2);
  });
});

describe("usageReport", () => {
  it("attributes tokens to roles, stages, tickets and waste", async () => {
    const { createProject, createTicket, createDispatch, finishDispatch, usageReport } = await import("../src/index.ts");
    const p = await createProject(db, { name: "p", repoPath: "/p" });
    const t = await createTicket(db, { projectId: p.id, type: "feature", title: "T" });
    const d1 = await createDispatch(db, { ticketId: t.id, stage: "build", agentId: "builder", agentVersion: 1 });
    await finishDispatch(db, d1.id, { status: "failed", verdict: "FAIL" });
    const d2 = await createDispatch(db, { ticketId: t.id, stage: "build", agentId: "builder", agentVersion: 1 });
    await finishDispatch(db, d2.id, { status: "succeeded", verdict: "PASS" });
    await recordUsage(db, "claude-cli", { sonnet: u(100, 0) }, { dispatchId: d1.id });
    await recordUsage(db, "claude-cli", { sonnet: u(200, 0) }, { dispatchId: d2.id });
    await recordUsage(db, "claude-cli", { opus: u(50, 0) }, { chatId: "chat_1" });

    const r = await usageReport(db, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) });
    expect(r.totals.tokens).toBe(110 + 210 + 60);
    expect(r.wasted.tokens).toBe(110);
    expect(r.byRole.map((b) => [b.key, b.tokens])).toEqual([["builder", 320], ["chief", 60]]);
    expect(r.byKind.map((b) => b.key)).toEqual(["Ticket work", "Conversations"]);
    expect(r.byTicket[0]).toMatchObject({ ticketId: t.id, tokens: 320, runs: 2, attempts: 2 });
    expect(r.byStage[0]).toMatchObject({ key: "build", runs: 2 });
  });
});
