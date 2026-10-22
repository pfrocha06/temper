import { describe, expect, it } from "vitest";
import { computeTemperature, type HealthEvent } from "../src/temperature.ts";

const now = new Date("2026-10-22T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const ev = (kind: HealthEvent["kind"], h = 0): HealthEvent => ({ kind, at: hoursAgo(h) });

describe("computeTemperature", () => {
  it("is cool with no signals", () => {
    const t = computeTemperature([], now);
    expect(t.value).toBe(0);
    expect(t.regime).toBe("cool");
  });

  it("heats immediately on a single revert", () => {
    const t = computeTemperature([ev("revert")], now);
    expect(t.regime).toBe("hot");
    expect(t.contributions[0]).toMatchObject({ signal: "revert", count: 1 });
  });

  it("goes to fever on a flaky storm plus an escaped bug", () => {
    const t = computeTemperature([ev("escaped_bug"), ...Array.from({ length: 3 }, () => ev("flaky_verification"))], now);
    expect(t.regime).toBe("fever");
  });

  it("decays old signals", () => {
    const fresh = computeTemperature([ev("revert", 0)], now).value;
    const old = computeTemperature([ev("revert", 72)], now).value;
    expect(old).toBeLessThan(fresh);
  });

  it("never cools on elapsed time alone", () => {
    const t = computeTemperature([ev("revert", 500)], now, "hot");
    expect(t.value).toBeLessThan(0.25);
    expect(t.regime).toBe("hot");
  });

  it("cools one step after a streak of clean merges", () => {
    const events = [ev("revert", 500), ev("clean_merge", 3), ev("clean_merge", 2), ev("clean_merge", 1)];
    const t = computeTemperature(events, now, "hot");
    expect(t.cleanStreak).toBe(3);
    expect(t.regime).toBe("warm");
  });

  it("resets the clean streak on any bad signal", () => {
    const events = [ev("clean_merge", 5), ev("clean_merge", 4), ev("holdout_failure", 3), ev("clean_merge", 1)];
    expect(computeTemperature(events, now).cleanStreak).toBe(1);
  });
});
