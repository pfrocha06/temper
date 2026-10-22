import { ROLE_ORDER } from "./constants";
import { compactNumber } from "./providers";
import type { Vendor } from "./providers";
import type { Dispatch, TicketUsage, UsageBucket, UsageReport } from "./types";

// ── range ─────────────────────────────────────────────────────────────────

export const RANGE_PRESETS = ["24h", "7d", "30d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_LABEL: Record<RangePreset, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", custom: "Custom" };
const PRESET_MS: Record<Exclude<RangePreset, "custom">, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export type UsageRange = { preset: RangePreset; from: Date; to: Date; projectId?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** `2026-10-22` as local midnight. */
const localDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
export const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The range in the URL: `?range=24h|7d|30d` (default 7d), or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (whole local days, `to` inclusive, never past now), plus `?project=`.
 */
export function parseRange(params: URLSearchParams, now = Date.now()): UsageRange {
  const projectId = params.get("project") || undefined;
  const raw = params.get("range");
  if (raw === "custom") {
    const f = params.get("from") ?? "";
    const t = params.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t)) {
      const from = localDay(f);
      const end = localDay(t);
      end.setDate(end.getDate() + 1);
      const to = new Date(Math.min(end.getTime(), now));
      if (from < to) return { preset: "custom", from, to, projectId };
    }
  }
  const preset = raw === "24h" || raw === "30d" ? raw : "7d";
  return { preset, from: new Date(now - PRESET_MS[preset]), to: new Date(now), projectId };
}

// ── timeline ──────────────────────────────────────────────────────────────

/** Series roles in the app's role order; anything else after. */
export function seriesRoles(report: Pick<UsageReport, "series">): string[] {
  const seen = new Set<string>();
  for (const s of report.series) for (const [r, v] of Object.entries(s.byRole)) if (v > 0) seen.add(r);
  const known = ROLE_ORDER.filter((r) => seen.has(r));
  return [...known, ...[...seen].filter((r) => !(known as string[]).includes(r)).toSorted()];
}

export type TimelineBucket = { key: string; start: Date; label: string; byRole: Record<string, number>; total: number };

/**
 * Every bucket in the range, empty ones included, keyed the way the server keys them (UTC hour
 * `YYYY-MM-DDTHH:00` when the range is two days or less, else UTC day `YYYY-MM-DD`).
 */
export function timeline(report: Pick<UsageReport, "from" | "to" | "series">): TimelineBucket[] {
  const from = new Date(report.from);
  const to = new Date(report.to);
  const hourly = to.getTime() - from.getTime() <= 2 * 86_400_000;
  const step = hourly ? 3_600_000 : 86_400_000;
  const data = new Map(report.series.map((s) => [s.bucket, s.byRole]));
  const start = new Date(from);
  if (hourly) start.setUTCMinutes(0, 0, 0);
  else start.setUTCHours(0, 0, 0, 0);
  const out: TimelineBucket[] = [];
  for (let t = start.getTime(); t <= to.getTime() && out.length < 2000; t += step) {
    const d = new Date(t);
    const key = hourly ? `${d.toISOString().slice(0, 13)}:00` : d.toISOString().slice(0, 10);
    const byRole = data.get(key) ?? {};
    out.push({
      key,
      start: d,
      label: hourly
        ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
      byRole,
      total: Object.values(byRole).reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

/** A clean axis: 0 and up to four steps of 1/2/2.5/5 × 10ⁿ that cover `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
    if (v >= max) break;
  }
  return ticks;
}

/** Which bucket labels to print so they never crowd: about `max` evenly spaced, always the first. */
export function labelEvery(n: number, max = 7): number {
  return Math.max(1, Math.ceil(n / max));
}

// ── figures ───────────────────────────────────────────────────────────────

export const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
export const pct = (v: number) => (v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

/** Cache reads as a share of everything the model read or wrote; high means prompts were reused cheaply. */
export function cacheReadShare(b: Pick<UsageBucket, "tokens" | "cacheReadTokens">): number {
  return share(b.cacheReadTokens, b.tokens + b.cacheReadTokens);
}

/** Vendor from a model id, for its logo. */
export function vendorOfModel(model: string): Vendor | undefined {
  const m = model.toLowerCase();
  if (/claude|opus|sonnet|haiku/.test(m)) return "anthropic";
  if (/^(gpt|o\d|codex|chatgpt)/.test(m)) return "openai";
  if (/gemini/.test(m)) return "google";
  return undefined;
}

// ── tickets ───────────────────────────────────────────────────────────────

export type TicketSort = "tokens" | "attempts" | "label" | "failed";
export type TicketRow = TicketUsage & { share: number; failed: number };

/** Failed or blocked agent attempts per ticket, from the recent dispatch list. */
export function failedAttempts(dispatches: Pick<Dispatch, "ticketId" | "verdict" | "agentId">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of dispatches) if (d.agentId !== "server" && (d.verdict === "FAIL" || d.verdict === "BLOCKED")) out.set(d.ticketId, (out.get(d.ticketId) ?? 0) + 1);
  return out;
}

export function ticketRows(report: Pick<UsageReport, "byTicket" | "totals">, failed: Map<string, number>, sort: TicketSort, dir: "asc" | "desc"): TicketRow[] {
  const rows = report.byTicket.map((t) => ({ ...t, share: share(t.tokens, report.totals.tokens), failed: failed.get(t.ticketId) ?? 0 }));
  const sign = dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const d = sort === "label" ? a.label.localeCompare(b.label) : sort === "attempts" ? a.attempts - b.attempts : sort === "failed" ? a.failed - b.failed : a.tokens - b.tokens;
    return sign * d || b.tokens - a.tokens;
  });
}

// ── where it went ─────────────────────────────────────────────────────────

const ROLE_NAME: Record<string, string> = { chief: "The Chief of Staff", builder: "The Builder", verifier: "The Verifier", reviewer: "The Reviewer", server: "Server runs" };
const roleName = (r: string) => ROLE_NAME[r] ?? r;

/**
 * Two or three plain sentences about where the tokens went: who used most, how much went to
 * attempts that failed (and at which stage they mostly failed), and the costliest ticket.
 */
export function whereItWent(report: UsageReport, dispatches: Pick<Dispatch, "stage" | "verdict" | "agentId" | "createdAt">[] = []): string[] {
  const total = report.totals.tokens;
  if (total <= 0) return [];
  const out: string[] = [];
  const [top, second] = report.byRole;
  if (top) {
    const lead = `${roleName(top.key)} used ${pct(share(top.tokens, total))} of ${compactNumber(total)} tokens`;
    out.push(second && share(second.tokens, total) >= 0.1 ? `${lead}, ${roleName(second.key).replace(/^The /, "the ")} ${pct(share(second.tokens, total))}.` : `${lead}.`);
  }
  const conv = report.byKind.find((k) => k.key === "Conversations");
  const chiefNamed = top?.key === "chief" || (second?.key === "chief" && share(second.tokens, total) >= 0.1);
  if (conv && !chiefNamed && share(conv.tokens, total) >= 0.2) out.push(`Conversations with the Chief took ${pct(share(conv.tokens, total))}.`);
  if (report.wasted.tokens > 0) {
    const from = Date.parse(report.from);
    const to = Date.parse(report.to);
    const stages = new Map<string, number>();
    for (const d of dispatches) {
      const at = Date.parse(d.createdAt);
      if (d.agentId === "server" || at < from || at > to || (d.verdict !== "FAIL" && d.verdict !== "BLOCKED")) continue;
      stages.set(d.stage, (stages.get(d.stage) ?? 0) + 1);
    }
    const worst = [...stages.entries()].toSorted((a, b) => b[1] - a[1])[0];
    out.push(`${pct(share(report.wasted.tokens, total))} went to attempts that failed or were blocked${worst ? `, mostly at the ${worst[0]} stage` : ""}.`);
  } else {
    out.push("Nothing went to failed attempts.");
  }
  const t = report.byTicket[0];
  if (t && share(t.tokens, total) >= 0.15) out.push(`The costliest ticket, “${t.label}”, took ${pct(share(t.tokens, total))}${t.attempts > 1 ? ` over ${t.attempts} runs` : ""}.`);
  return out;
}
