import { compactNumber, formatUsd } from "./providers";
import type { DispatchEvent, ModelUsage } from "./types";

export type RunLineTone = "default" | "muted" | "error" | "success";

/** One row in the run viewer. */
export type RunLine =
  | { id: number; at: string; kind: "text"; text: string }
  | { id: number; at: string; kind: "tool_use"; tool: string; summary: string }
  | { id: number; at: string; kind: "tool_result"; isError: boolean; preview: string; content: string; lines: number }
  | { id: number; at: string; kind: "stderr"; text: string }
  | { id: number; at: string; kind: "result"; isError: boolean; text: string; meta: string }
  | { id: number; at: string; kind: "init"; text: string }
  | { id: number; at: string; kind: "rate_limited"; text: string }
  /** The provider's usage report: tokens per model, compact. */
  | { id: number; at: string; kind: "usage"; models: Array<{ model: string; tokens: number; text: string }>; total?: string; cost?: string; apiTime?: string }
  /** A limit report, exactly as the provider states it. */
  | { id: number; at: string; kind: "rate_limit"; limitType: string; status: string; resetsAt?: string }
  /** A server gate check folded from its events: started, streamed output, outcome. */
  | { id: number; at: string; kind: "gate"; check: string; command: string; output: string; outcome?: { isError: boolean; text: string; at: string } };

const GATE_PREFIX = "gate:";

/**
 * Folds server gate progress into one step per check: a `gate:<check>` tool use opens
 * a step, the text events after it are its streamed output, and its tool result closes it.
 * Everything else passes through unchanged.
 */
export function foldGateSteps(lines: RunLine[]): RunLine[] {
  const out: RunLine[] = [];
  let open: Extract<RunLine, { kind: "gate" }> | undefined;
  for (const l of lines) {
    if (l.kind === "tool_use" && l.tool.startsWith(GATE_PREFIX)) {
      open = { id: l.id, at: l.at, kind: "gate", check: l.tool.slice(GATE_PREFIX.length), command: l.summary, output: "" };
      out.push(open);
      continue;
    }
    if (open && l.kind === "text") {
      open.output = open.output ? `${open.output}\n${l.text}` : l.text;
      continue;
    }
    if (open && l.kind === "tool_result") {
      open.outcome = { isError: l.isError, text: l.content, at: l.at };
      open = undefined;
      continue;
    }
    out.push(l);
  }
  return out;
}

const PREFERRED_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"];

/** A one-line description of a tool's input, e.g. `Bash  pnpm test` or `Read  src/a.ts`. */
export function summarizeToolInput(input: unknown, max = 160): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return clip(String(input), max);
  const obj = input as Record<string, unknown>;
  for (const key of PREFERRED_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      const rest = Object.keys(obj).filter((k) => k !== key).length;
      return clip(oneLine(v), max) + (rest > 0 && key !== "command" ? ` (+${rest})` : "");
    }
  }
  const parts = Object.entries(obj).map(([k, v]) => `${k}=${typeof v === "string" ? oneLine(v) : JSON.stringify(v)}`);
  return clip(parts.join(" "), max);
}

export function toRunLine(e: DispatchEvent): RunLine {
  const base = { id: e.id, at: e.at };
  switch (e.kind) {
    case "text":
      return { ...base, kind: "text", text: e.payload.text };
    case "tool_use":
      return { ...base, kind: "tool_use", tool: e.payload.tool, summary: summarizeToolInput(e.payload.input) };
    case "tool_result": {
      const content = e.payload.content ?? "";
      return {
        ...base,
        kind: "tool_result",
        isError: e.payload.isError,
        content,
        preview: clip(oneLine(content), 140) || "(empty)",
        lines: content ? content.split("\n").length : 0,
      };
    }
    case "stderr":
      return { ...base, kind: "stderr", text: e.payload.text };
    case "result": {
      const meta = [
        e.payload.turns !== undefined ? `${e.payload.turns} turns` : "",
        e.payload.durationMs !== undefined ? formatMs(e.payload.durationMs) : "",
      ]
        .filter(Boolean)
        .join(", ");
      return { ...base, kind: "result", isError: e.payload.isError, text: e.payload.text, meta };
    }
    case "init":
      return { ...base, kind: "init", text: `Session ${e.payload.sessionId}${e.payload.model ? ` on ${e.payload.model}` : ""}` };
    case "rate_limited":
      return { ...base, kind: "rate_limited", text: e.payload.text };
    case "usage":
      return { ...base, ...usageLine(e.payload.models ?? {}, e.payload.apiMs) };
    case "rate_limit":
      return {
        ...base,
        kind: "rate_limit",
        limitType: e.payload.limitType,
        status: e.payload.status,
        resetsAt: typeof e.payload.resetsAt === "number" ? new Date(e.payload.resetsAt * 1000).toISOString() : undefined,
      };
  }
}

/**
 * One run's tokens per model, counted the way the Providers page counts them (input + output +
 * cache writes; cache reads excluded), e.g. `sonnet 12.3k (2.1k out, 48k cached)`.
 * Counts that did not arrive as numbers (an older server redacted them) are left out, not guessed.
 */
function usageLine(models: Record<string, Partial<Record<keyof ModelUsage, unknown>>>, apiMs?: number): Omit<Extract<RunLine, { kind: "usage" }>, "id" | "at"> {
  let total = 0;
  let counted = false;
  let cost = 0;
  let costed = false;
  const rows = Object.entries(models).map(([model, u]) => {
    const [input, output, cacheRead, cacheWrite] = [u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens].map(num);
    if (num(u.costUsd) !== undefined) {
      cost += u.costUsd as number;
      costed = true;
    }
    if (input === undefined || output === undefined || cacheWrite === undefined) return { model, tokens: 0, text: "tokens not recorded" };
    const tokens = input + output + cacheWrite;
    total += tokens;
    counted = true;
    const extra = [`${compactNumber(output)} out`, cacheRead ? `${compactNumber(cacheRead)} cached` : ""].filter(Boolean).join(", ");
    return { model, tokens, text: `${compactNumber(tokens)} (${extra})` };
  });
  return {
    kind: "usage",
    models: rows.toSorted((a, b) => b.tokens - a.tokens),
    total: counted ? compactNumber(total) : undefined,
    cost: costed ? formatUsd(cost) : undefined,
    apiTime: apiMs !== undefined ? formatMs(apiMs) : undefined,
  };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Merges two event lists by id, ascending, without duplicates. */
export function mergeEvents(a: DispatchEvent[], b: DispatchEvent[]): DispatchEvent[] {
  const byId = new Map<number, DispatchEvent>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
