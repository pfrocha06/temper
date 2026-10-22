import { describe, expect, it } from "vitest";
import {
  capsSummary,
  capsToForm,
  compactNumber,
  countdown,
  formToCaps,
  formatUsd,
  limitLabel,
  limitTone,
  meter,
  resetClock,
  modelBreakdown,
  providerState,
  usageWindowViews,
  vendorOfAdapter,
  type ProviderInfo,
} from "./providers";

const win = (runs: number, tokens: number, byModel: Record<string, number> = {}) => ({ runs, tokens, outputTokens: 0, costUsd: 0, byModel });

describe("compactNumber", () => {
  it("keeps small numbers whole and shortens large ones to three significant digits", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1000)).toBe("1k");
    expect(compactNumber(1234)).toBe("1.23k");
    expect(compactNumber(12_345)).toBe("12.3k");
    expect(compactNumber(123_456)).toBe("123k");
    expect(compactNumber(999_999)).toBe("1M");
    expect(compactNumber(4_560_000)).toBe("4.56M");
    expect(compactNumber(2_000_000_000)).toBe("2B");
  });
});

describe("formatUsd", () => {
  it("shows cents, and a floor for tiny amounts", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(4.2)).toBe("$4.20");
    expect(formatUsd(1234.5)).toBe("$1,235");
  });
});

describe("meter", () => {
  it("has no level without a cap, and treats 0 as no cap", () => {
    expect(meter(5, undefined)).toEqual({ used: 5, level: "none" });
    expect(meter(5, 0)).toEqual({ used: 5, level: "none" });
  });

  it("is near from 80% and reached at the cap, clamped to full", () => {
    expect(meter(3, 10)).toMatchObject({ fraction: 0.3, level: "ok" });
    expect(meter(8, 10)).toMatchObject({ fraction: 0.8, level: "near" });
    expect(meter(10, 10)).toMatchObject({ fraction: 1, level: "reached" });
    expect(meter(14, 10)).toMatchObject({ fraction: 1, level: "reached", used: 14 });
  });
});

describe("usageWindowViews", () => {
  const p: Pick<ProviderInfo, "usage" | "caps"> = {
    caps: { runsPerSession: 4, tokensPerDay: 1_000_000, sessionHours: 3 },
    usage: { session: win(4, 10), day: win(5, 900_000), week: win(9, 2_000_000), sessionStart: "2026-10-22T07:00:00Z" },
  };

  it("pairs each window with its own caps, session first", () => {
    const views = usageWindowViews(p);
    expect(views.map((v) => v.key)).toEqual(["session", "day", "week"]);
    expect(views[0]).toMatchObject({ hint: "The last 3 hours, a rolling window", runs: { level: "reached" }, tokens: { level: "none" } });
    expect(views[1]).toMatchObject({ runs: { level: "none" }, tokens: { level: "near", cap: 1_000_000 } });
    expect(views[2]!.runs.level).toBe("none");
  });

  it("defaults the session window to 5 hours and is empty without usage", () => {
    expect(usageWindowViews({ ...p, caps: {} })[0]!.hint).toContain("5 hours");
    expect(usageWindowViews({ caps: {} })).toEqual([]);
  });
});

describe("modelBreakdown", () => {
  it("orders models by tokens with their share", () => {
    expect(modelBreakdown({ haiku: 100, opus: 300 })).toEqual([
      { model: "opus", tokens: 300, share: 0.75 },
      { model: "haiku", tokens: 100, share: 0.25 },
    ]);
    expect(modelBreakdown({})).toEqual([]);
  });
});

describe("countdown", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  it("counts down to a reset", () => {
    expect(countdown("2026-10-22T10:00:40Z", now)).toBe("in 40s");
    expect(countdown("2026-10-22T10:14:00Z", now)).toBe("in 14m");
    expect(countdown("2026-10-22T12:05:00Z", now)).toBe("in 2h 05m");
    expect(countdown("2026-10-25T13:00:00Z", now)).toBe("in 3d 3h");
    expect(countdown("2026-10-22T09:00:00Z", now)).toBe("now");
  });
});

describe("resetClock", () => {
  it("shows the time for a same-day reset and adds the weekday otherwise", () => {
    const from = new Date(2026, 9, 22, 10, 0).getTime();
    expect(resetClock(new Date(2026, 9, 22, 14, 5).toISOString(), from)).toMatch(/^at 14:05$/);
    expect(resetClock(new Date(2026, 9, 24, 9, 30).toISOString(), from)).toMatch(/^\S+ 09:30$/);
  });
});

describe("limit reports", () => {
  it("shows the reported type readably and tones known statuses", () => {
    expect(limitLabel("five_hour")).toBe("five hour");
    expect(limitLabel("seven_day_opus")).toBe("seven day opus");
    expect(limitTone("allowed")).toBe("pass");
    expect(limitTone("allowed_warning")).toBe("blocked");
    expect(limitTone("rejected")).toBe("fail");
    expect(limitTone("something_new")).toBe("muted");
  });
});

describe("providers", () => {
  it("maps adapters to vendors", () => {
    expect(vendorOfAdapter("claude-cli")).toBe("anthropic");
    expect(vendorOfAdapter("codex-cli")).toBe("openai");
    expect(vendorOfAdapter("gemini-cli")).toBe("google");
    expect(vendorOfAdapter("opencode")).toBe("opencode");
    expect(vendorOfAdapter("server")).toBeUndefined();
    expect(vendorOfAdapter(undefined)).toBeUndefined();
  });

  it("derives the card status", () => {
    expect(providerState({ adapter: true, installed: true })).toBe("active");
    expect(providerState({ adapter: false, installed: true })).toBe("no_adapter");
    expect(providerState({ adapter: true, installed: false })).toBe("not_installed");
  });
});

describe("caps form", () => {
  it("round-trips caps, with empty fields meaning no cap", () => {
    const form = capsToForm({ runsPerDay: 20, sessionHours: 5 });
    expect(form.runsPerDay).toBe("20");
    expect(form.tokensPerDay).toBe("");
    expect(formToCaps(form)).toEqual({ caps: { runsPerDay: 20, sessionHours: 5 }, errors: {} });
    expect(formToCaps(capsToForm({}))).toEqual({ caps: {}, errors: {} });
  });

  it("accepts token shorthands and separators", () => {
    const form = { ...capsToForm({}), tokensPerDay: "1.5M", tokensPerWeek: "200k", tokensPerSession: "1,000,000" };
    expect(formToCaps(form).caps).toEqual({ tokensPerDay: 1_500_000, tokensPerWeek: 200_000, tokensPerSession: 1_000_000 });
  });

  it("rejects negatives, fractions, words and a session window outside 1-24 hours", () => {
    const { caps, errors } = formToCaps({ ...capsToForm({}), runsPerDay: "-1", runsPerWeek: "2.5", tokensPerDay: "lots", sessionHours: "30" });
    expect(caps).toBeUndefined();
    expect(Object.keys(errors).toSorted()).toEqual(["runsPerDay", "runsPerWeek", "sessionHours", "tokensPerDay"]);
    expect(formToCaps({ ...capsToForm({}), sessionHours: "0" }).errors.sessionHours).toBeDefined();
    expect(formToCaps({ ...capsToForm({}), runsPerDay: "0" }).caps).toEqual({ runsPerDay: 0 });
  });

  it("summarises the caps that are set", () => {
    expect(capsSummary({ runsPerSession: 10, tokensPerDay: 2_000_000 })).toEqual(["10 runs per session", "2M tokens per day"]);
    expect(capsSummary({})).toEqual([]);
  });
});
