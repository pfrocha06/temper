import { cn } from "cn";
import { REGIME_FLOOR, REGIMES } from "@/lib/constants";
import type { Regime, Snapshot } from "@/lib/types";

const BAND: Record<Regime, string> = { cool: "fill-heat-cool", warm: "fill-heat-warm", hot: "fill-heat-hot", fever: "fill-heat-fever" };

/** Temperature over time, oldest left, over faint regime bands. Snapshots are written on change, so it is a step line. */
export function Sparkline({ history, height = 96, now = Date.now() }: { history: Snapshot[]; height?: number; now?: number }) {
  const width = 480;
  const points = history.toSorted((a, b) => a.at.localeCompare(b.at));
  if (points.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {points.length === 1 ? "One reading so far; the line starts at the next change." : "No readings yet."}
      </div>
    );
  }
  const t0 = Date.parse(points[0]!.at);
  // Run the line on to now, so the current level reads as a level and not a final tick.
  const end = Math.max(Date.parse(points.at(-1)!.at), now);
  const span = Math.max(1, end - t0);
  const x = (iso: string) => ((Date.parse(iso) - t0) / span) * width;
  const y = (v: number) => height - 2 - v * (height - 4);
  let d = "";
  points.forEach((p, i) => {
    const px = x(p.at).toFixed(1);
    const py = y(p.value).toFixed(1);
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  });
  d += `H${width}`;
  const area = `${d}V${height}H0Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-24 w-full text-foreground"
      role="img"
      aria-label={`Temperature history, ${points.length} readings`}
    >
      {REGIMES.map((r, i) => {
        const next = REGIMES[i + 1];
        const top = y(next ? REGIME_FLOOR[next] : 1);
        return <rect key={r} x={0} width={width} y={top} height={y(REGIME_FLOOR[r]) - top} className={cn(BAND[r], "opacity-[0.07]")} />;
      })}
      <path d={area} className="fill-current opacity-10" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
