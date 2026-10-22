// The factory's temperature: one health signal derived from audit events.
// Heats fast, cools only on evidence (a streak of clean merges), never on elapsed time alone.

export const SIGNALS = {
  revert: 1.0,
  escaped_bug: 1.2,
  holdout_failure: 0.5,
  flaky_verification: 0.4,
  review_disagreement: 0.3,
} as const;

export type Signal = keyof typeof SIGNALS;
export const REGIMES = ["cool", "warm", "hot", "fever"] as const;
export type Regime = (typeof REGIMES)[number];

export type HealthEvent = { kind: Signal | "clean_merge"; at: Date };

export type Contribution = { signal: Signal; count: number; heat: number };

export type Temperature = {
  value: number;
  regime: Regime;
  contributions: Contribution[];
  cleanStreak: number;
};

export type TemperatureOptions = {
  halfLifeHours?: number;
  cleanMergesToCool?: number;
};

const BANDS: Array<[number, Regime]> = [
  [0.75, "fever"],
  [0.5, "hot"],
  [0.25, "warm"],
];

function regimeFor(value: number): Regime {
  for (const [min, regime] of BANDS) if (value >= min) return regime;
  return "cool";
}

export function computeTemperature(
  events: HealthEvent[],
  now: Date,
  previous: Regime = "cool",
  options: TemperatureOptions = {},
): Temperature {
  const halfLifeMs = (options.halfLifeHours ?? 72) * 3_600_000;
  const cleanMergesToCool = options.cleanMergesToCool ?? 3;

  const bySignal = new Map<Signal, Contribution>();
  let raw = 0;
  for (const e of events) {
    if (e.kind === "clean_merge") continue;
    const age = Math.max(0, now.getTime() - e.at.getTime());
    const heat = SIGNALS[e.kind] * 0.5 ** (age / halfLifeMs);
    raw += heat;
    const c = bySignal.get(e.kind) ?? { signal: e.kind, count: 0, heat: 0 };
    c.count += 1;
    c.heat += heat;
    bySignal.set(e.kind, c);
  }
  const value = 1 - Math.exp(-raw);

  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let cleanStreak = 0;
  for (const e of sorted) cleanStreak = e.kind === "clean_merge" ? cleanStreak + 1 : 0;

  const target = regimeFor(value);
  const prevIdx = REGIMES.indexOf(previous);
  const targetIdx = REGIMES.indexOf(target);
  let regime: Regime = previous;
  if (targetIdx > prevIdx) regime = target;
  else if (targetIdx < prevIdx && cleanStreak >= cleanMergesToCool) regime = REGIMES[prevIdx - 1]!;

  const contributions = [...bySignal.values()].sort((a, b) => b.heat - a.heat);
  return { value, regime, contributions, cleanStreak };
}

export type RegimePolicy = {
  requireRedFirst: boolean;
  requireReview: boolean;
  maxFileScope: number;
  concurrencyMultiplier: number;
  autonomousWorkflows: boolean;
  spotCheckRate: number;
};

export const REGIME_POLICIES: Record<Regime, RegimePolicy> = {
  cool: { requireRedFirst: true, requireReview: true, maxFileScope: 40, concurrencyMultiplier: 1, autonomousWorkflows: true, spotCheckRate: 0.05 },
  warm: { requireRedFirst: true, requireReview: true, maxFileScope: 25, concurrencyMultiplier: 1, autonomousWorkflows: true, spotCheckRate: 0.15 },
  hot: { requireRedFirst: true, requireReview: true, maxFileScope: 12, concurrencyMultiplier: 0.5, autonomousWorkflows: false, spotCheckRate: 0.35 },
  fever: { requireRedFirst: true, requireReview: true, maxFileScope: 6, concurrencyMultiplier: 0.25, autonomousWorkflows: false, spotCheckRate: 0.75 },
};
