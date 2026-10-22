import { describe, expect, it } from "vitest";
import { foldGateSteps, mergeEvents, summarizeToolInput, toRunLine } from "./run-events";
import type { DispatchEvent } from "./types";

const at = "2026-10-22T10:00:00.000Z";
const ev = (id: number, e: { kind: string; [k: string]: unknown }): DispatchEvent => {
  const { kind, ...payload } = e;
  return { id, dispatchId: "dsp_1", at, kind, payload } as DispatchEvent;
};

describe("summarizeToolInput", () => {
  it("prefers the field that says what the tool does", () => {
    expect(summarizeToolInput({ command: "pnpm   test\n --run", timeout: 1000 })).toBe("pnpm test --run");
    expect(summarizeToolInput({ file_path: "src/a.ts", old_string: "x", new_string: "y" })).toBe("src/a.ts (+2)");
  });

  it("falls back to key=value pairs and clips long input", () => {
    expect(summarizeToolInput({ a: 1, b: [2] })).toBe("a=1 b=[2]");
    const long = summarizeToolInput({ command: "x".repeat(500) }, 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith("…")).toBe(true);
  });

  it("handles empty and primitive input", () => {
    expect(summarizeToolInput(undefined)).toBe("");
    expect(summarizeToolInput("ls")).toBe("ls");
  });
});

describe("toRunLine", () => {
  it("maps each event kind to a display line", () => {
    expect(toRunLine(ev(1, { kind: "text", text: "hello" }))).toMatchObject({ kind: "text", text: "hello" });
    expect(toRunLine(ev(2, { kind: "tool_use", tool: "Read", input: { file_path: "a.ts" } }))).toMatchObject({
      kind: "tool_use",
      tool: "Read",
      summary: "a.ts",
    });
    expect(toRunLine(ev(3, { kind: "stderr", text: "warn" }))).toMatchObject({ kind: "stderr", text: "warn" });
    expect(toRunLine(ev(4, { kind: "init", sessionId: "s1", model: "opus" }))).toMatchObject({ kind: "init", text: "Session s1 on opus" });
    expect(toRunLine(ev(5, { kind: "rate_limited", text: "slow down" }))).toMatchObject({ kind: "rate_limited" });
  });

  it("collapses tool results to a one-line preview with a line count", () => {
    const line = toRunLine(ev(6, { kind: "tool_result", isError: true, content: "line 1\nline 2\nline 3" }));
    expect(line).toMatchObject({ kind: "tool_result", isError: true, preview: "line 1 line 2 line 3", lines: 3 });
    expect(toRunLine(ev(7, { kind: "tool_result", isError: false, content: "" }))).toMatchObject({ preview: "(empty)", lines: 0 });
  });

  it("summarises the result's turns and duration", () => {
    const line = toRunLine(ev(8, { kind: "result", text: "VERDICT: PASS", isError: false, turns: 12, durationMs: 95_000 }));
    expect(line).toMatchObject({ kind: "result", meta: "12 turns, 1m 35s" });
  });
});

describe("usage and rate-limit events", () => {
  it("summarises tokens per model, largest first, excluding cache reads from the count", () => {
    const line = toRunLine(
      ev(9, {
        kind: "usage",
        apiMs: 42_000,
        models: {
          "claude-haiku": { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.001 },
          "claude-sonnet": { inputTokens: 1_000, outputTokens: 2_100, cacheReadTokens: 48_000, cacheWriteTokens: 9_200, costUsd: 0.25 },
        },
      }),
    );
    expect(line).toEqual({
      id: 9,
      at,
      kind: "usage",
      total: "12.4k",
      cost: "$0.25",
      apiTime: "42s",
      models: [
        { model: "claude-sonnet", tokens: 12_300, text: "12.3k (2.1k out, 48k cached)" },
        { model: "claude-haiku", tokens: 150, text: "150 (50 out)" },
      ],
    });
  });

  it("omits cost when the provider reports none", () => {
    const line = toRunLine(ev(10, { kind: "usage", models: { m: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } }));
    expect(line).toMatchObject({ kind: "usage", total: "2" });
    expect(line).not.toHaveProperty("cost", expect.anything());
  });

  it("does not guess counts that did not arrive as numbers", () => {
    const line = toRunLine(ev(13, { kind: "usage", models: { m: { inputTokens: "[redacted]", outputTokens: "[redacted]", cacheReadTokens: "[redacted]", cacheWriteTokens: "[redacted]", costUsd: 0.2 } } }));
    expect(line).toMatchObject({ kind: "usage", total: undefined, cost: "$0.20", models: [{ model: "m", text: "tokens not recorded" }] });
  });

  it("keeps a limit report as reported, with the reset as a timestamp", () => {
    const line = toRunLine(ev(11, { kind: "rate_limit", limitType: "five_hour", status: "allowed", resetsAt: 1_792_000_000, raw: {} }));
    expect(line).toEqual({ id: 11, at, kind: "rate_limit", limitType: "five_hour", status: "allowed", resetsAt: new Date(1_792_000_000_000).toISOString() });
    expect(toRunLine(ev(12, { kind: "rate_limit", limitType: "seven_day", status: "rejected", raw: {} }))).toMatchObject({ resetsAt: undefined });
  });
});

describe("mergeEvents", () => {
  it("orders by id and drops duplicates from history and the live stream", () => {
    const history = [ev(1, { kind: "text", text: "a" }), ev(2, { kind: "text", text: "b" })];
    const live = [ev(3, { kind: "text", text: "c" }), ev(2, { kind: "text", text: "b" })];
    expect(mergeEvents(history, live).map((e) => e.id)).toEqual([1, 2, 3]);
  });
});

describe("foldGateSteps", () => {
  it("folds a gate check's start, streamed output and outcome into one step", () => {
    const lines = [
      ev(1, { kind: "tool_use", tool: "gate:builder_tests", input: { command: "pnpm check" } }),
      ev(2, { kind: "text", text: "running" }),
      ev(3, { kind: "text", text: "12 passed" }),
      ev(4, { kind: "tool_result", isError: false, content: "PASS in 2m 3s — ok" }),
      ev(5, { kind: "tool_use", tool: "gate:diff_guard", input: { command: "diff guard" } }),
      ev(6, { kind: "result", text: "report", isError: false }),
    ].map(toRunLine);
    const folded = foldGateSteps(lines);
    expect(folded.map((l) => l.kind)).toEqual(["gate", "gate", "result"]);
    expect(folded[0]).toMatchObject({ check: "builder_tests", command: "pnpm check", output: "running\n12 passed", outcome: { isError: false, text: "PASS in 2m 3s — ok" } });
    expect(folded[1]).toMatchObject({ check: "diff_guard", output: "" });
    expect(folded[1]).not.toHaveProperty("outcome");
  });

  it("leaves agent events alone", () => {
    const lines = [ev(1, { kind: "tool_use", tool: "Bash", input: { command: "ls" } }), ev(2, { kind: "text", text: "hi" })].map(toRunLine);
    expect(foldGateSteps(lines)).toEqual(lines);
  });
});
