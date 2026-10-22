import type { Snapshot } from "@/lib/types";
import { REGIME_FLOOR } from "@/lib/constants";

/** Temperature over time, oldest left. Dashed lines mark the regime band floors. */
export function Sparkline({ history, height = 72 }: { history: Snapshot[]; height?: number }) {
  const width = 480;
  const points = history.toSorted((a, b) => a.at.localeCompare(b.at));
  if (points.length < 2) {
    return <p className="text-sm text-muted-foreground">History appears once the temperature has changed at least twice.</p>;
  }
  const t0 = Date.parse(points[0]!.at);
  const span = Math.max(1, Date.parse(points.at(-1)!.at) - t0);
  const x = (iso: string) => ((Date.parse(iso) - t0) / span) * width;
  const y = (v: number) => height - 2 - v * (height - 4);
  // Snapshots are written on change, so the series is a step function.
  let d = "";
  points.forEach((p, i) => {
    const px = x(p.at).toFixed(1);
    const py = y(p.value).toFixed(1);
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-18 w-full text-primary"
      role="img"
      aria-label={`Temperature history, ${points.length} snapshots`}
    >
      {(["warm", "hot", "fever"] as const).map((r) => (
        <line
          key={r}
          x1={0}
          x2={width}
          y1={y(REGIME_FLOOR[r])}
          y2={y(REGIME_FLOOR[r])}
          className="stroke-border"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
