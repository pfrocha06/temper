import { cn } from "cn";
import { REGIME_FLOOR, REGIME_LABEL, REGIMES } from "@/lib/constants";
import { percent } from "@/lib/format";
import type { Regime } from "@/lib/types";

const STROKE: Record<Regime, string> = { cool: "stroke-heat-cool", warm: "stroke-heat-warm", hot: "stroke-heat-hot", fever: "stroke-heat-fever" };
const TEXT: Record<Regime, string> = { cool: "text-heat-cool", warm: "text-heat-warm", hot: "text-heat-hot", fever: "text-heat-fever" };

const CX = 120;
const CY = 120;
const R = 96;

/** Point on the dial for a value in [0, 1]: 0 at the left, 1 at the right, over the top. */
function point(v: number, r = R): [number, number] {
  const a = Math.PI * (1 - v);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(from: number, to: number): string {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

/**
 * The temperature as a half dial of the four regime bands with a needle at the value.
 * The regime can lag the value (it cools only on evidence), so both are shown.
 */
export function HeatDial({ value, regime }: { value: number; regime: Regime }) {
  const v = Math.min(1, Math.max(0, value));
  const [nx, ny] = point(v, R - 20);
  const gap = 0.006;
  return (
    <div
      role="meter"
      aria-label="Factory temperature"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(v.toFixed(2))}
      aria-valuetext={`${percent(v)}, regime ${REGIME_LABEL[regime]}`}
      className="relative w-full max-w-72"
    >
      <svg viewBox="0 0 240 132" className="w-full" aria-hidden>
        {REGIMES.map((r, i) => {
          const next = REGIMES[i + 1];
          const from = REGIME_FLOOR[r] + (i === 0 ? 0 : gap);
          const to = (next ? REGIME_FLOOR[next] : 1) - (next ? gap : 0);
          return (
            <path
              key={r}
              d={arc(from, to)}
              fill="none"
              strokeWidth={r === regime ? 16 : 10}
              strokeLinecap="butt"
              className={cn(STROKE[r], r === regime ? "opacity-100" : "opacity-25")}
            />
          );
        })}
        {[0.25, 0.5, 0.75].map((t) => {
          const [x1, y1] = point(t, R + 12);
          const [x2, y2] = point(t, R + 16);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground/60" strokeWidth={1} />;
        })}
        <line x1={CX} y1={CY} x2={nx} y2={ny} className="stroke-foreground" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={5} className="fill-foreground" />
        <circle cx={CX} cy={CY} r={2} className="fill-background" />
      </svg>
      <div className="-mt-1 flex items-baseline justify-center gap-2">
        <span className={cn("text-3xl font-semibold tracking-tight", TEXT[regime])}>{REGIME_LABEL[regime]}</span>
        <span className="text-lg text-muted-foreground tabular-nums">{percent(v)}</span>
      </div>
    </div>
  );
}
