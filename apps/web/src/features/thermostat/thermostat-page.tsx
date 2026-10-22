import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, EyeIcon, SnowflakeIcon } from "lucide-react";
import { cn } from "cn";
import { heatBg } from "@/components/badges";
import { HeatDial } from "@/components/heat-dial";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGIME_LABEL, REGIMES } from "@/lib/constants";
import { humanize, percent, relativeTime } from "@/lib/format";
import { statusQuery, temperatureQuery } from "@/lib/queries";
import type { Contribution, RegimePolicy, Snapshot } from "@/lib/types";

/** Mirrors core's SIGNALS weights (temperature.ts): every signal is listed, even at zero. */
const SIGNALS: Array<{ signal: Contribution["signal"]; weight: number; label: string }> = [
  { signal: "escaped_bug", weight: 1.2, label: "Escaped bugs" },
  { signal: "revert", weight: 1.0, label: "Reverts" },
  { signal: "holdout_failure", weight: 0.5, label: "Holdout failures" },
  { signal: "flaky_verification", weight: 0.4, label: "Flaky verifications" },
  { signal: "review_disagreement", weight: 0.3, label: "Review disagreements" },
];
/** Clean merges in a row that cool the regime one step (core: cleanMergesToCool). */
const CLEAN_TO_COOL = 3;

const POLICY_ROWS: Array<{ key: keyof RegimePolicy; label: string; format: (v: RegimePolicy[keyof RegimePolicy]) => string }> = [
  { key: "requireRedFirst", label: "Failing test before code", format: yesNo },
  { key: "requireReview", label: "Reviewer stage required", format: yesNo },
  { key: "maxFileScope", label: "Largest file scope", format: (v) => `${v} files` },
  { key: "concurrencyMultiplier", label: "Concurrency", format: (v) => `×${v}` },
  { key: "autonomousWorkflows", label: "Workflows run without the board", format: yesNo },
  { key: "spotCheckRate", label: "Spot-checked PRs", format: (v) => percent(Number(v)) },
];

function yesNo(v: unknown): string {
  return v ? "Yes" : "No";
}

export function ThermostatPage() {
  const status = useQuery(statusQuery);
  const report = useQuery(temperatureQuery);
  const current = status.data?.temperature ?? report.data?.history[0] ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Thermostat"
        info="One health signal from the audit log. It heats fast on bad signals and cools only on a streak of clean merges, never on time alone."
        meta={
          <>
            {current ? <span>updated {relativeTime(current.at)}</span> : null}
            {report.data && !report.data.enforced ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" tabIndex={0}>
                    <EyeIcon data-icon="inline-start" />
                    Shadow mode
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">Computed and logged, but the scheduler and gates do not apply these policies yet.</TooltipContent>
              </Tooltip>
            ) : null}
          </>
        }
      />
      <div className="flex max-w-5xl flex-col gap-6 px-4 py-5 md:px-6">
        {report.isError ? <QueryError error={report.error} what="the temperature" onRetry={() => void report.refetch()} /> : null}
        {report.isPending ? (
          <RowsSkeleton />
        ) : current ? (
          <CurrentReading snapshot={current} history={report.data?.history ?? []} />
        ) : (
          <p className="text-sm text-muted-foreground">No temperature reading yet. The first one is taken on the next heartbeat.</p>
        )}
        {report.data ? <PolicyTable policies={report.data.policies} regime={current?.regime} /> : null}
      </div>
    </div>
  );
}

function CurrentReading({ snapshot, history }: { snapshot: Snapshot; history: Snapshot[] }) {
  const { contributions = [], cleanStreak = 0 } = snapshot.contributions ?? {};
  const byId = new Map(contributions.map((c) => [c.signal, c]));
  const maxHeat = Math.max(1, ...contributions.map((c) => c.heat));
  const regimeIdx = REGIMES.indexOf(snapshot.regime);

  return (
    <>
      <section aria-labelledby="now-h" className="grid gap-6 rounded-xl border bg-card p-5 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-10">
        <h2 id="now-h" className="sr-only">
          Current temperature
        </h2>
        <div className="flex flex-col items-center gap-5">
          <HeatDial value={snapshot.value} regime={snapshot.regime} />
          <div className="flex w-full flex-col items-center gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SnowflakeIcon aria-hidden className="size-3.5" />
              Clean merges toward cooling
            </p>
            <div
              role="meter"
              aria-label="Clean merge streak"
              aria-valuemin={0}
              aria-valuemax={CLEAN_TO_COOL}
              aria-valuenow={Math.min(cleanStreak, CLEAN_TO_COOL)}
              className="flex gap-1.5"
            >
              {Array.from({ length: CLEAN_TO_COOL }, (_, i) => (
                <span key={i} aria-hidden className={cn("h-2 w-8 rounded-full", i < cleanStreak ? "bg-heat-cool" : "bg-muted ring-1 ring-border ring-inset")} />
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground tabular-nums">
              {regimeIdx === 0
                ? `${cleanStreak} in a row; already at the coolest regime`
                : `${Math.min(cleanStreak, CLEAN_TO_COOL)}/${CLEAN_TO_COOL}; ${Math.max(0, CLEAN_TO_COOL - cleanStreak)} more to cool to ${REGIME_LABEL[REGIMES[regimeIdx - 1]!]}`}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold">Heat by signal, last 30 days</h3>
          <ul className="flex flex-col gap-2.5">
            {SIGNALS.map(({ signal, weight, label }) => {
              const c = byId.get(signal);
              const heat = c?.heat ?? 0;
              return (
                <li key={signal} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className={cn("truncate outline-none", heat === 0 && "text-muted-foreground")}>
                        {label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {humanize(signal)}: weight {weight} per event, halving with age
                    </TooltipContent>
                  </Tooltip>
                  <span className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-heat-hot transition-[width] duration-500"
                      style={{ width: `${(heat / maxHeat) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {c ? (
                      <>
                        <span className="text-foreground">{heat.toFixed(2)}</span> ({c.count})
                      </>
                    ) : (
                      "0"
                    )}
                    <span className="sr-only"> heat{c ? ` from ${c.count} events` : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">History</h3>
            <Sparkline history={history} />
          </div>
        </div>
      </section>
    </>
  );
}

function PolicyTable({ policies, regime }: { policies: Record<string, RegimePolicy>; regime: string | undefined }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/pol flex items-center gap-1.5 rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon aria-hidden className="size-4 transition-transform group-data-[state=open]/pol:rotate-90" />
        Policy per regime
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Policy</TableHead>
              {REGIMES.map((r) => (
                <TableHead key={r} className={cn(regime === r && "text-foreground")} aria-current={regime === r ? "true" : undefined}>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn("size-2 rounded-full", heatBg(r))} />
                    {REGIME_LABEL[r]}
                    {regime === r ? <span className="text-xs font-normal text-muted-foreground">(now)</span> : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {POLICY_ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="text-muted-foreground">{row.label}</TableCell>
                {REGIMES.map((r) => (
                  <TableCell key={r} className={cn("tabular-nums", regime === r && "bg-muted/60 font-medium")}>
                    {row.format(policies[r]![row.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
