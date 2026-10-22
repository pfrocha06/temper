import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toRunLine } from "@/lib/run-events";
import type { DispatchEvent } from "@/lib/types";
import { RunLineView } from "./run-line";

afterEach(cleanup);

const at = "2026-10-22T10:00:00.000Z";
const ev = (e: { kind: string; [k: string]: unknown }): DispatchEvent => {
  const { kind, ...payload } = e;
  return { id: 1, dispatchId: "dsp_1", at, kind, payload } as DispatchEvent;
};
const view = (e: DispatchEvent) =>
  render(
    <TooltipProvider>
      <ol>
        <RunLineView line={toRunLine(e)} live={false} accent="" />
      </ol>
    </TooltipProvider>,
  );

describe("RunLineView", () => {
  it("renders a usage report as a compact info row", () => {
    view(ev({ kind: "usage", models: { "claude-sonnet": { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.12 } } }));
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("3k tokens");
    expect(row.textContent).toContain("claude-sonnet 3k (2k out)");
    expect(row.textContent).toContain("$0.12 list price");
  });

  it("renders a limit report with its type and status as reported", () => {
    view(ev({ kind: "rate_limit", limitType: "five_hour", status: "allowed_warning", raw: {} }));
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("Limit");
    expect(row.textContent).toContain("five hour");
    expect(screen.getByText("allowed_warning").className).toContain("text-blocked");
  });
});
