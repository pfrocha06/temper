import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, RunEvent, Ticket } from "@temper/core";
import { cleanOutput, tailLines, throttleOutput } from "../src/gates/progress.ts";
import { CHECKS, runChecks } from "../src/gates/run.ts";

describe("throttleOutput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits at most one chunk per interval, without overlap", () => {
    const out: string[] = [];
    const t = throttleOutput({ emit: (s) => out.push(s), intervalMs: 2000 });
    t.push("a\n");
    t.push("b\n");
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1999);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["a\nb"]);
    t.push("c\n");
    vi.advanceTimersByTime(2000);
    expect(out).toEqual(["a\nb", "c"]);
    vi.advanceTimersByTime(10_000);
    expect(out).toHaveLength(2);
  });

  it("holds a partial line until it completes or the command ends", () => {
    const out: string[] = [];
    const t = throttleOutput({ emit: (s) => out.push(s), intervalMs: 100 });
    t.push("one\ntw");
    vi.advanceTimersByTime(100);
    expect(out).toEqual(["one"]);
    t.push("o\nthr");
    vi.advanceTimersByTime(100);
    expect(out).toEqual(["one", "two"]);
    t.close();
    expect(out).toEqual(["one", "two", "thr"]);
    t.push("late\n");
    vi.advanceTimersByTime(100);
    expect(out).toHaveLength(3);
  });

  it("keeps only the tail of a burst and says how much it skipped", () => {
    const out: string[] = [];
    const t = throttleOutput({ emit: (s) => out.push(s), intervalMs: 100, maxLines: 2 });
    t.push("1\n2\n3\n4\n");
    t.close();
    expect(out).toEqual(["… 2 lines skipped\n3\n4"]);
  });

  it("stops after maxChunks", () => {
    const out: string[] = [];
    const t = throttleOutput({ emit: (s) => out.push(s), intervalMs: 10, maxChunks: 2 });
    for (let i = 0; i < 5; i++) {
      t.push(`${i}\n`);
      vi.advanceTimersByTime(10);
    }
    t.close();
    expect(out).toEqual(["0", "1\n… further output not streamed"]);
  });
});

describe("cleanOutput / tailLines", () => {
  it("strips colours and carriage-return redraws", () => {
    expect(cleanOutput("\u001b[32m✓\u001b[39m ok\r\nprogress 10%\rprogress 100%\n")).toBe("✓ ok\nprogress 100%\n");
  });

  it("caps characters as well as lines", () => {
    expect(tailLines("aaaa\nbbbb\ncccc", 10, 9)).toBe("… 1 line skipped\nbbbb\ncccc");
  });
});

describe("runChecks progress events", () => {
  const ctx = {
    project: { testCommand: "pnpm test" } as Project,
    ticket: {} as Ticket,
    worktree: "/nowhere",
    sandbox: { mode: "off" as const, denyRead: [] },
    outputIntervalMs: 5,
  };

  it("reports each check as a step with streamed output, an outcome and a final result", async () => {
    const original = CHECKS.builder_tests;
    CHECKS.builder_tests = async (c) => {
      c.onOutput?.("running 3 tests\n");
      await new Promise((r) => setTimeout(r, 20));
      c.onOutput?.("3 passed\n");
      return { check: "builder_tests", ok: false, report: "`pnpm test` exited 1\n```\nboom\n```" };
    };
    try {
      const events: RunEvent[] = [];
      const outcome = await runChecks(["builder_tests", "diff_guard"], { ...ctx, onEvent: (e) => events.push(e) });
      expect(outcome.verdict).toBe("FAIL");
      expect(events[0]).toEqual({ kind: "tool_use", tool: "gate:builder_tests", input: { command: "pnpm test" } });
      const texts = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
      expect(texts.join("\n")).toBe("running 3 tests\n3 passed");
      const result = events.find((e) => e.kind === "tool_result");
      expect(result).toMatchObject({ isError: true, content: expect.stringMatching(/^FAIL in \d+s — `pnpm test` exited 1$/) });
      // Stops at the first failure: diff_guard never starts.
      expect(events.some((e) => e.kind === "tool_use" && e.tool === "gate:diff_guard")).toBe(false);
      expect(events.at(-1)).toMatchObject({ kind: "result", isError: true });
    } finally {
      CHECKS.builder_tests = original;
    }
  });
});
