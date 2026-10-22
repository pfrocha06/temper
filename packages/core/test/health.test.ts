import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDispatch,
  createProject,
  createTicket,
  finishDispatch,
  openDb,
  recordSignal,
  refreshTemperature,
  stageAttempts,
  type Db,
} from "../src/index.ts";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await openDb()));
afterEach(() => close());

describe("temperature from the audit log", () => {
  it("starts cool and heats on a revert signal", async () => {
    expect((await refreshTemperature(db)).snapshot.regime).toBe("cool");
    await recordSignal(db, "revert", "tkt_x");
    const { snapshot } = await refreshTemperature(db);
    expect(snapshot.regime).toBe("hot");
  });
});

describe("dispatches", () => {
  it("finish exactly once and count attempts per stage", async () => {
    const p = await createProject(db, { name: "p", repoPath: "/r" });
    const t = await createTicket(db, { projectId: p.id, type: "feature", title: "t" });
    const d1 = await createDispatch(db, { ticketId: t.id, stage: "build", agentId: "builder", agentVersion: 1 });
    await finishDispatch(db, d1.id, { status: "failed", verdict: "FAIL" });
    await expect(finishDispatch(db, d1.id, { status: "succeeded" })).rejects.toThrow(/not running/);
    const d2 = await createDispatch(db, { ticketId: t.id, stage: "build", agentId: "builder", agentVersion: 1 });
    expect(d2.attempt).toBe(2);
    expect(await stageAttempts(db, t.id)).toEqual({ build: 2 });
  });
});
