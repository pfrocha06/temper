import type { ProviderCaps, UsageWindow } from "./types";

export type Vendor = "anthropic" | "openai" | "google" | "opencode";

/** GET /api/providers (server: providers.ts ProviderInfo), after JSON. */
export type ProviderInfo = {
  id: string;
  name: string;
  vendor: Vendor;
  /** Temper has an adapter for it. */
  adapter: boolean;
  installed: boolean;
  version?: string;
  account?: { loggedIn: boolean; method?: string; email?: string; org?: string; subscription?: string };
  roles: string[];
  usage?: { day: UsageWindow; session: UsageWindow; week: UsageWindow; sessionStart: string };
  limits: ProviderLimit[];
  caps: ProviderCaps;
  pausedUntil?: string;
};

export type ProviderLimit = { limitType: string; status: string; resetsAt: string | null; at: string };

export const VENDOR_LABEL: Record<Vendor, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", opencode: "OpenCode" };

/** Adapter id → vendor (server: providers.ts KNOWN). Static so a logo never waits on a provider probe. */
const ADAPTER_VENDOR: Record<string, Vendor> = {
  "claude-cli": "anthropic",
  "codex-cli": "openai",
  "gemini-cli": "google",
  opencode: "opencode",
};

export function vendorOfAdapter(adapter: string | null | undefined): Vendor | undefined {
  if (!adapter) return undefined;
  if (ADAPTER_VENDOR[adapter]) return ADAPTER_VENDOR[adapter];
  if (/^claude/.test(adapter)) return "anthropic";
  if (/^(codex|openai)/.test(adapter)) return "openai";
  if (/^(gemini|google)/.test(adapter)) return "google";
  if (/^opencode/.test(adapter)) return "opencode";
  return undefined;
}

/** What a provider Temper has no adapter for yet would be used for. */
export const PLANNED_USE: Record<string, string> = {
  "codex-cli": "A second vendor for the Verifier and Reviewer, so the Builder's work is checked by a different model family.",
  "gemini-cli": "A second vendor for the Verifier and Reviewer, and long-context reads of large codebases.",
  opencode: "Running open-weight or self-hosted models for any role.",
};

export type ProviderState = "active" | "no_adapter" | "not_installed";

export function providerState(p: Pick<ProviderInfo, "adapter" | "installed">): ProviderState {
  if (!p.installed) return "not_installed";
  return p.adapter ? "active" : "no_adapter";
}

export const STATE_LABEL: Record<ProviderState, string> = {
  active: "Active",
  no_adapter: "Installed, no adapter yet",
  not_installed: "Not installed",
};

/** `950`, `12.3k`, `4.56M`, `1.2B`: tokens at a glance. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/\.?0+$/, "")}${unit}`;
  if (abs < 1000) return String(Math.round(n));
  if (abs < 999_500) return fmt(n / 1000, "k");
  if (abs < 999_500_000) return fmt(n / 1_000_000, "M");
  return fmt(n / 1_000_000_000, "B");
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;
}

export type MeterLevel = "none" | "ok" | "near" | "reached";

export type Meter = {
  used: number;
  /** Undefined when no cap is set (or the cap is 0, which the server treats as off). */
  cap?: number;
  /** 0..1, only with a cap. */
  fraction?: number;
  level: MeterLevel;
};

/** Usage against a cap. At or above 80% is "near"; at the cap new work waits. */
export function meter(used: number, cap: number | undefined): Meter {
  if (cap === undefined || cap <= 0) return { used, level: "none" };
  const fraction = Math.min(1, used / cap);
  return { used, cap, fraction, level: used >= cap ? "reached" : fraction >= 0.8 ? "near" : "ok" };
}

export type WindowKey = "session" | "day" | "week";

export type WindowView = { key: WindowKey; label: string; hint: string; runs: Meter; tokens: Meter; usage: UsageWindow };

/** The three usage windows with their caps, in display order. */
export function usageWindowViews(p: Pick<ProviderInfo, "usage" | "caps">): WindowView[] {
  if (!p.usage) return [];
  const { caps, usage } = p;
  const hours = caps.sessionHours ?? 5;
  return [
    { key: "session", label: "Session", hint: `The last ${hours} hour${hours === 1 ? "" : "s"}, a rolling window`, runs: meter(usage.session.runs, caps.runsPerSession), tokens: meter(usage.session.tokens, caps.tokensPerSession), usage: usage.session },
    { key: "day", label: "Today", hint: "Since midnight, server time", runs: meter(usage.day.runs, caps.runsPerDay), tokens: meter(usage.day.tokens, caps.tokensPerDay), usage: usage.day },
    { key: "week", label: "This week", hint: "The last 7 days", runs: meter(usage.week.runs, caps.runsPerWeek), tokens: meter(usage.week.tokens, caps.tokensPerWeek), usage: usage.week },
  ];
}

/** Per-model token split, largest first. */
export function modelBreakdown(byModel: Record<string, number>): Array<{ model: string; tokens: number; share: number }> {
  const total = Object.values(byModel).reduce((a, b) => a + b, 0);
  return Object.entries(byModel)
    .map(([model, tokens]) => ({ model, tokens, share: total === 0 ? 0 : tokens / total }))
    .toSorted((a, b) => b.tokens - a.tokens);
}

/** `in 2h 05m`, `in 14m`, `in 40s`, or `now` once passed. */
export function countdown(iso: string, now = Date.now()): string {
  const s = Math.floor((Date.parse(iso) - now) / 1000);
  if (s <= 0) return "now";
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A reset time relative to when it was reported: `at 14:05` the same day, else `Sat 14:05`. */
export function resetClock(iso: string, from = Date.now()): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === new Date(from).toDateString() ? `at ${hm}` : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hm}`;
}

export type LimitTone = "pass" | "blocked" | "fail" | "muted";

/** Statuses as the provider reports them; anything unrecognised is shown neutrally. */
export function limitTone(status: string): LimitTone {
  const s = status.toLowerCase();
  if (s === "allowed") return "pass";
  if (s === "allowed_warning" || s === "throttled" || s === "warning") return "blocked";
  if (s === "rejected" || s === "blocked" || s === "denied") return "fail";
  return "muted";
}

/** `five_hour` → `five hour`: the reported type, only made readable. */
export const limitLabel = (limitType: string) => limitType.replace(/[_-]+/g, " ").trim();

// ── caps form ───────────────────────────────────────────────────────────

export const CAP_FIELDS = ["runsPerSession", "tokensPerSession", "runsPerDay", "tokensPerDay", "runsPerWeek", "tokensPerWeek"] as const;
export type CapField = (typeof CAP_FIELDS)[number] | "sessionHours";
export type CapsForm = Record<CapField, string>;

export function capsToForm(caps: ProviderCaps): CapsForm {
  const s = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    runsPerSession: s(caps.runsPerSession),
    tokensPerSession: s(caps.tokensPerSession),
    runsPerDay: s(caps.runsPerDay),
    tokensPerDay: s(caps.tokensPerDay),
    runsPerWeek: s(caps.runsPerWeek),
    tokensPerWeek: s(caps.tokensPerWeek),
    sessionHours: s(caps.sessionHours),
  };
}

/**
 * Validates the caps form the way PUT /api/providers/:id/caps does: every field optional,
 * caps are non-negative whole numbers, the session window 1–24 hours. Empty means no cap.
 * Token fields accept `200k` / `1.5M` shorthands.
 */
export function formToCaps(form: CapsForm): { caps?: ProviderCaps; errors: Partial<Record<CapField, string>> } {
  const errors: Partial<Record<CapField, string>> = {};
  const caps: ProviderCaps = {};
  for (const field of CAP_FIELDS) {
    const raw = form[field].trim().replace(/[,_\s]/g, "");
    if (!raw) continue;
    const n = parseAmount(raw);
    if (n === undefined || !Number.isInteger(n) || n < 0) errors[field] = "A whole number, 0 or more";
    else caps[field] = n;
  }
  const hours = form.sessionHours.trim();
  if (hours) {
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 1 || n > 24) errors.sessionHours = "Between 1 and 24 hours";
    else caps.sessionHours = n;
  }
  return Object.keys(errors).length ? { errors } : { caps, errors };
}

function parseAmount(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([kmb])?$/i.exec(raw);
  if (!m) return undefined;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Math.round(Number(m[1]) * mult * 1e6) / 1e6;
}

/** The caps that are set, as short phrases for a summary line. */
export function capsSummary(caps: ProviderCaps): string[] {
  const out: string[] = [];
  const pair = (runs: number | undefined, tokens: number | undefined, where: string) => {
    const parts = [runs ? `${runs} runs` : "", tokens ? `${compactNumber(tokens)} tokens` : ""].filter(Boolean);
    if (parts.length) out.push(`${parts.join(" / ")} per ${where}`);
  };
  pair(caps.runsPerSession, caps.tokensPerSession, "session");
  pair(caps.runsPerDay, caps.tokensPerDay, "day");
  pair(caps.runsPerWeek, caps.tokensPerWeek, "week");
  return out;
}
