import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "cn";
import { roleMeta } from "@/components/role";
import { compactNumber } from "@/lib/providers";
import { labelEvery, niceTicks, type TimelineBucket } from "@/lib/usage";

export const chartColor = (role: string) => `var(--chart-${["chief", "builder", "verifier", "reviewer"].includes(role) ? role : "server"})`;

type Props = { buckets: TimelineBucket[]; roles: string[]; hourly: boolean };

/**
 * Tokens over time, stacked by role: one column per hour or day. Hover or arrow keys pick a
 * column; its tooltip lists every role. A table view carries the same numbers.
 */
export function TimelineChart({ buckets, roles, hourly }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0, ...buckets.map((b) => b.total));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks.at(-1) || 1;
  const every = labelEvery(buckets.length, hourly ? 8 : 7);
  const descId = useId();
  const peak = buckets.reduce<TimelineBucket | undefined>((p, b) => (!p || b.total > p.total ? b : p), undefined);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = buckets.length - 1;
    setActive((i) => (e.key === "Home" ? 0 : e.key === "End" ? last : Math.min(last, Math.max(0, (i ?? (e.key === "ArrowLeft" ? last + 1 : -1)) + (e.key === "ArrowLeft" ? -1 : 1)))));
  };
  const a = active !== null ? buckets[active] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ul aria-label="Roles" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {roles.map((r) => (
            <li key={r} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: chartColor(r) }} />
              {roleMeta(r).label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((t) => !t)} aria-pressed={table} className="ml-auto rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Tokens per {hourly ? "hour" : "day"} by role</caption>
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-normal">
                  {hourly ? "Hour" : "Day"}
                </th>
                {roles.map((r) => (
                  <th key={r} scope="col" className="px-2 py-1.5 text-right font-normal">
                    {roleMeta(r).label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-right font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets
                .filter((b) => b.total > 0)
                .map((b) => (
                  <tr key={b.key} className="border-t">
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      {hourly ? `${b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${b.label}` : b.label}
                    </th>
                    {roles.map((r) => (
                      <td key={r} className="px-2 py-1 text-right">
                        {b.byRole[r] ? compactNumber(b.byRole[r]) : "–"}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-medium">{compactNumber(b.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          {/* y axis */}
          <div aria-hidden className="relative h-48 w-9 text-right text-[0.6875rem] text-muted-foreground tabular-nums">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
                {compactNumber(t)}
              </span>
            ))}
          </div>
          <div
            role="img"
            tabIndex={0}
            aria-roledescription="stacked column chart"
            aria-label={`Tokens per ${hourly ? "hour" : "day"} by role, ${buckets.length} ${hourly ? "hours" : "days"}${peak && peak.total > 0 ? `; peak ${compactNumber(peak.total)} at ${peak.label}` : ""}. Use arrow keys to read each ${hourly ? "hour" : "day"}.`}
            aria-describedby={descId}
            onKeyDown={onKey}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            className="relative h-48 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* gridlines */}
            {ticks.map((t) => (
              <span key={t} aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {buckets.map((b, i) => (
                <div
                  key={b.key}
                  onPointerEnter={() => setActive(i)}
                  className={cn("flex h-full min-w-0 flex-1 flex-col items-center justify-end px-[1px]", active === i && "bg-foreground/[0.04]")}
                >
                  <div className="flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: `${(b.total / top) * 100}%` }}>
                    {roles.map((r) => {
                      const v = b.byRole[r] ?? 0;
                      if (v <= 0) return null;
                      return <span key={r} className="block w-full min-h-px first:rounded-b-none last:rounded-t-[4px]" style={{ flexGrow: v, flexBasis: 0, background: chartColor(r) }} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
            {a ? (
              <div
                role="status"
                className="pointer-events-none absolute top-0 z-10 w-max min-w-40 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
                style={active! > buckets.length / 2 ? { right: `${((buckets.length - active!) / buckets.length) * 100}%` } : { left: `${((active! + 1) / buckets.length) * 100}%` }}
              >
                <p className="mb-1 text-muted-foreground">
                  {hourly ? `${a.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${a.label}` : a.label}
                </p>
                <p className="mb-1 font-semibold tabular-nums">{compactNumber(a.total)} tokens</p>
                <ul className="flex flex-col gap-0.5">
                  {roles.map((r) => (
                    <li key={r} className="flex items-center gap-2">
                      <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: chartColor(r) }} />
                      <span className="font-medium tabular-nums">{compactNumber(a.byRole[r] ?? 0)}</span>
                      <span className="text-muted-foreground">{roleMeta(r).label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {/* x axis */}
          <span />
          <div aria-hidden className="flex text-[0.6875rem] text-muted-foreground tabular-nums">
            {buckets.map((b, i) => (
              <span key={b.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
                {i % every === 0 ? b.label : ""}
              </span>
            ))}
          </div>
          <p id={descId} className="sr-only">
            {buckets
              .filter((b) => b.total > 0)
              .map((b) => `${b.label}: ${compactNumber(b.total)}`)
              .join("; ")}
          </p>
        </div>
      )}
    </div>
  );
}
