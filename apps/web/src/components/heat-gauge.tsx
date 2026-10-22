import { cn } from "cn";
import { REGIME_FLOOR, REGIME_LABEL, REGIMES } from "@/lib/constants";
import { percent } from "@/lib/format";
import type { Regime } from "@/lib/types";
import { heatBg } from "./badges";

/**
 * The temperature as a strip of the four regime bands with a needle at the
 * current value. The active regime's band is solid; the others are faint.
 * The regime can lag the value (it cools only on evidence), so both are shown.
 */
export function HeatGauge({ value, regime, size = "sm" }: { value: number; regime: Regime; size?: "sm" | "lg" }) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="meter"
      aria-label="Factory temperature"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(clamped.toFixed(2))}
      aria-valuetext={`${percent(clamped)}, regime ${REGIME_LABEL[regime]}`}
      className={cn("relative flex w-full", size === "sm" ? "h-1.5 gap-px" : "h-3 gap-0.5")}
    >
      {REGIMES.map((r, i) => {
        const next = REGIMES[i + 1];
        const width = (next ? REGIME_FLOOR[next] : 1) - REGIME_FLOOR[r];
        return (
          <span
            key={r}
            style={{ width: `${width * 100}%` }}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", heatBg(r), r === regime ? "opacity-100" : "opacity-25")}
          />
        );
      })}
      <span
        aria-hidden
        style={{ left: `${clamped * 100}%` }}
        className={cn(
          "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background",
          size === "sm" ? "h-3 w-0.5" : "h-5 w-1",
        )}
      />
    </div>
  );
}
