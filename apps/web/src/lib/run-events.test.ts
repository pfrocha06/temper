import { describe, expect, it } from "vitest";
import { mergeEvents, summarizeToolInput, toRunLine } from "./run-events";
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

describe("mergeEvents", () => {
  it("orders by id and drops duplicates from history and the live stream", () => {
    const history = [ev(1, { kind: "text", text: "a" }), ev(2, { kind: "text", text: "b" })];
    const live = [ev(3, { kind: "text", text: "c" }), ev(2, { kind: "text", text: "b" })];
    expect(mergeEvents(history, live).map((e) => e.id)).toEqual([1, 2, 3]);
  });
});
