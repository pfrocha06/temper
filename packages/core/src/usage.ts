import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { ModelUsage } from "./adapter.ts";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { dispatches, projects, providerLimits, providerSettings, providerUsage, tickets, type ProviderCaps } from "./db/schema.ts";

export type { ProviderCaps };

export async function recordUsage(
  db: Db,
  adapter: string,
  models: Record<string, ModelUsage>,
  ctx: { dispatchId?: string; chatId?: string; apiMs?: number },
): Promise<void> {
  const rows = Object.entries(models).map(([model, u]) => ({
    adapter,
    model,
    dispatchId: ctx.dispatchId,
    chatId: ctx.chatId,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
    apiMs: ctx.apiMs,
  }));
  if (rows.length) await db.insert(providerUsage).values(rows);
}

export async function recordLimit(
  db: Db,
  adapter: string,
  report: { limitType: string; status: string; resetsAt?: number; raw: Record<string, unknown> },
): Promise<void> {
  await db.insert(providerLimits).values({
    adapter,
    limitType: report.limitType,
    status: report.status,
    resetsAt: report.resetsAt ? new Date(report.resetsAt * 1000) : null,
    raw: report.raw,
  });
}

export type UsageWindow = { runs: number; tokens: number; outputTokens: number; costUsd: number; byModel: Record<string, number> };

/** Totals since `since`. "Tokens" counts input + output + cache writes; cache reads are reported separately by the provider and excluded. */
export async function usageSince(db: Db, adapter: string, since: Date): Promise<UsageWindow> {
  const rows = await db
    .select()
    .from(providerUsage)
    .where(and(eq(providerUsage.adapter, adapter), gte(providerUsage.at, since)));
  const runs = new Set(rows.map((r) => r.dispatchId ?? `chat:${r.chatId}:${r.at.getTime()}`));
  const byModel: Record<string, number> = {};
  let tokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const r of rows) {
    const t = r.inputTokens + r.outputTokens + r.cacheWriteTokens;
    tokens += t;
    outputTokens += r.outputTokens;
    costUsd += r.costUsd ?? 0;
    byModel[r.model] = (byModel[r.model] ?? 0) + t;
  }
  return { runs: runs.size, tokens, outputTokens, costUsd, byModel };
}

/** The latest report per limit type. */
export async function latestLimits(db: Db, adapter: string) {
  const rows = await db.select().from(providerLimits).where(eq(providerLimits.adapter, adapter)).orderBy(desc(providerLimits.id)).limit(200);
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!seen.has(r.limitType)) seen.set(r.limitType, r);
  return [...seen.values()];
}

export async function getCaps(db: Db, adapter: string): Promise<ProviderCaps> {
  const [row] = await db.select().from(providerSettings).where(eq(providerSettings.adapter, adapter));
  return row?.caps ?? {};
}

export async function setCaps(db: Db, adapter: string, caps: ProviderCaps): Promise<ProviderCaps> {
  await db
    .insert(providerSettings)
    .values({ adapter, caps })
    .onConflictDoUpdate({ target: providerSettings.adapter, set: { caps, updatedAt: sql`now()` } });
  await audit(db, { actor: "board", kind: "provider.caps_set", subject: adapter, data: caps as Record<string, unknown> });
  return caps;
}

export type Windows = { day: UsageWindow; session: UsageWindow; week: UsageWindow; sessionStart: Date };

export async function usageWindows(db: Db, adapter: string, caps: ProviderCaps, now = new Date()): Promise<Windows> {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const sessionStart = new Date(now.getTime() - (caps.sessionHours ?? 5) * 3_600_000);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  return {
    day: await usageSince(db, adapter, day),
    session: await usageSince(db, adapter, sessionStart),
    week: await usageSince(db, adapter, weekStart),
    sessionStart,
  };
}

/** The first cap the provider has reached, if any. */
export function capReached(caps: ProviderCaps, w: Windows): { cap: keyof ProviderCaps; used: number; limit: number } | undefined {
  const checks: Array<[keyof ProviderCaps, number]> = [
    ["runsPerSession", w.session.runs],
    ["tokensPerSession", w.session.tokens],
    ["runsPerDay", w.day.runs],
    ["tokensPerDay", w.day.tokens],
    ["runsPerWeek", w.week.runs],
    ["tokensPerWeek", w.week.tokens],
  ];
  for (const [cap, used] of checks) {
    const limit = caps[cap];
    if (typeof limit === "number" && limit > 0 && used >= limit) return { cap, used, limit };
  }
  return undefined;
}

export type UsageBucket = { key: string; label: string; tokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; runs: number };

export type UsageReport = {
  from: string;
  to: string;
  totals: UsageBucket;
  /** Tokens spent on attempts that ended FAIL or BLOCKED (work that had to be redone or escalated). */
  wasted: UsageBucket;
  series: Array<{ bucket: string; byRole: Record<string, number> }>;
  byRole: UsageBucket[];
  byKind: UsageBucket[];
  byStage: UsageBucket[];
  byModel: UsageBucket[];
  byProject: UsageBucket[];
  byTicket: Array<UsageBucket & { ticketId: string; status: string; type: string; attempts: number }>;
};

type Row = typeof providerUsage.$inferSelect;

function bucketOf(key: string, label: string): UsageBucket {
  return { key, label, tokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, runs: 0 };
}

/**
 * Where the tokens went between `from` and `to`. "Tokens" = input + output + cache writes; cache
 * reads are cheap re-reads of the same context and are reported separately.
 */
export async function usageReport(db: Db, opts: { from: Date; to: Date; projectId?: string }): Promise<UsageReport> {
  const rows = await db
    .select()
    .from(providerUsage)
    .where(and(gte(providerUsage.at, opts.from), lte(providerUsage.at, opts.to)));
  const dispatchRows = await db.select().from(dispatches);
  const ticketRows = await db.select().from(tickets);
  const projectRows = await db.select().from(projects);
  const d = new Map(dispatchRows.map((x) => [x.id, x]));
  const t = new Map(ticketRows.map((x) => [x.id, x]));
  const p = new Map(projectRows.map((x) => [x.id, x]));

  const totals = bucketOf("total", "Total");
  const wasted = bucketOf("wasted", "Failed or blocked attempts");
  const maps = { role: new Map<string, UsageBucket>(), kind: new Map<string, UsageBucket>(), stage: new Map<string, UsageBucket>(), model: new Map<string, UsageBucket>(), project: new Map<string, UsageBucket>(), ticket: new Map<string, UsageReport["byTicket"][number]>() };
  const series = new Map<string, Record<string, number>>();
  const runsSeen = { total: new Set<string>(), wasted: new Set<string>() };
  const spanMs = opts.to.getTime() - opts.from.getTime();
  const hourly = spanMs <= 2 * 86_400_000;

  const add = (b: UsageBucket, r: Row, runKey: string, seen?: Set<string>) => {
    b.tokens += r.inputTokens + r.outputTokens + r.cacheWriteTokens;
    b.outputTokens += r.outputTokens;
    b.cacheReadTokens += r.cacheReadTokens;
    b.costUsd += r.costUsd ?? 0;
    if (seen) {
      if (!seen.has(runKey)) {
        seen.add(runKey);
        b.runs++;
      }
    }
  };
  const get = <T extends UsageBucket>(m: Map<string, T>, key: string, make: () => T) => {
    let b = m.get(key);
    if (!b) m.set(key, (b = make()));
    return b;
  };
  const seenBy = new Map<UsageBucket, Set<string>>();
  const addTo = (b: UsageBucket, r: Row, runKey: string) => {
    let s = seenBy.get(b);
    if (!s) seenBy.set(b, (s = new Set()));
    add(b, r, runKey, s);
  };

  for (const r of rows) {
    const disp = r.dispatchId ? d.get(r.dispatchId) : undefined;
    const ticket = disp ? t.get(disp.ticketId) : undefined;
    if (opts.projectId && ticket?.projectId !== opts.projectId) continue;
    const runKey = r.dispatchId ?? `chat:${r.chatId ?? "none"}:${r.at.getTime()}`;
    const role = r.chatId ? "chief" : disp ? (disp.agentId === "server" ? "server" : disp.agentId) : "chief";
    const kind = r.chatId ? "Conversations" : disp?.stage === "digest" ? "Knowledge digests" : disp ? "Ticket work" : "Spec intake";

    addTo(totals, r, runKey);
    if (disp && (disp.verdict === "FAIL" || disp.verdict === "BLOCKED")) addTo(wasted, r, runKey);
    addTo(get(maps.role, role, () => bucketOf(role, role)), r, runKey);
    addTo(get(maps.kind, kind, () => bucketOf(kind, kind)), r, runKey);
    if (disp) addTo(get(maps.stage, disp.stage, () => bucketOf(disp.stage, disp.stage)), r, runKey);
    addTo(get(maps.model, r.model, () => bucketOf(r.model, r.model)), r, runKey);
    if (ticket) {
      const proj = p.get(ticket.projectId);
      addTo(get(maps.project, ticket.projectId, () => bucketOf(ticket.projectId, proj?.name ?? ticket.projectId)), r, runKey);
      const tb = get(maps.ticket, ticket.id, () => ({ ...bucketOf(ticket.id, ticket.title), ticketId: ticket.id, status: ticket.status, type: ticket.type, attempts: dispatchRows.filter((x) => x.ticketId === ticket.id && x.stage !== "digest").length }));
      addTo(tb, r, runKey);
    }
    const at = new Date(r.at);
    const bucket = hourly ? `${at.toISOString().slice(0, 13)}:00` : at.toISOString().slice(0, 10);
    const s = series.get(bucket) ?? {};
    s[role] = (s[role] ?? 0) + r.inputTokens + r.outputTokens + r.cacheWriteTokens;
    series.set(bucket, s);
  }
  const sorted = <T extends UsageBucket>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.tokens - a.tokens);
  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    totals,
    wasted,
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, byRole]) => ({ bucket, byRole })),
    byRole: sorted(maps.role),
    byKind: sorted(maps.kind),
    byStage: sorted(maps.stage),
    byModel: sorted(maps.model),
    byProject: sorted(maps.project),
    byTicket: sorted(maps.ticket).slice(0, 25),
  };
}
