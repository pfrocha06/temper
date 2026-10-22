import { and, desc, gte, like } from "drizzle-orm";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { auditEvents, temperatureSnapshots } from "./db/schema.ts";
import { computeTemperature, SIGNALS, type HealthEvent, type Regime, type Signal, type Temperature } from "./temperature.ts";

export type HealthKind = Signal | "clean_merge";

export async function recordSignal(db: Db, kind: HealthKind, subject: string, data: Record<string, unknown> = {}) {
  return audit(db, { actor: "system", kind: `signal.${kind}`, subject, data });
}

export async function healthEvents(db: Db, since: Date): Promise<HealthEvent[]> {
  const rows = await db
    .select({ kind: auditEvents.kind, at: auditEvents.at })
    .from(auditEvents)
    .where(and(gte(auditEvents.at, since), like(auditEvents.kind, "signal.%")));
  return rows
    .map((r) => ({ kind: r.kind.slice("signal.".length) as HealthEvent["kind"], at: r.at }))
    .filter((e) => e.kind === "clean_merge" || e.kind in SIGNALS);
}

export type Snapshot = typeof temperatureSnapshots.$inferSelect;

export async function latestSnapshot(db: Db): Promise<Snapshot | undefined> {
  const [row] = await db.select().from(temperatureSnapshots).orderBy(desc(temperatureSnapshots.id)).limit(1);
  return row;
}

export async function snapshotHistory(db: Db, limit = 200): Promise<Snapshot[]> {
  return db.select().from(temperatureSnapshots).orderBy(desc(temperatureSnapshots.id)).limit(limit);
}

/** Recomputes the temperature over the last 30 days and stores a snapshot when it changed. */
export async function refreshTemperature(db: Db, now = new Date()): Promise<{ snapshot: Snapshot; temperature: Temperature }> {
  const previous = await latestSnapshot(db);
  const events = await healthEvents(db, new Date(now.getTime() - 30 * 86_400_000));
  const t = computeTemperature(events, now, (previous?.regime as Regime | undefined) ?? "cool");
  const prevStreak = (previous?.contributions as { cleanStreak?: number } | undefined)?.cleanStreak ?? 0;
  const changed =
    !previous || previous.regime !== t.regime || Math.abs(previous.value - t.value) > 0.01 || prevStreak !== t.cleanStreak;
  if (!changed) return { snapshot: previous!, temperature: t };
  const [snapshot] = await db
    .insert(temperatureSnapshots)
    .values({ value: t.value, regime: t.regime, contributions: { contributions: t.contributions, cleanStreak: t.cleanStreak } })
    .returning();
  if (!previous || previous.regime !== t.regime) {
    await audit(db, { actor: "system", kind: "temperature.regime_changed", data: { from: previous?.regime ?? null, to: t.regime, value: t.value } });
  }
  return { snapshot: snapshot!, temperature: t };
}

