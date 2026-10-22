import { useQuery } from "@tanstack/react-query";
import { EyeIcon } from "lucide-react";
import { cn } from "cn";
import { heatBg } from "@/components/badges";
import { HeatGauge } from "@/components/heat-gauge";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Sparkline } from "@/components/sparkline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REGIME_LABEL, REGIMES } from "@/lib/constants";
import { humanize, percent, relativeTime } from "@/lib/format";
import { statusQuery, temperatureQuery } from "@/lib/queries";
import type { RegimePolicy, Snapshot } from "@/lib/types";

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
      <PageHeader title="Thermostat" description="One health signal from the audit log. It heats fast and cools only on evidence." />
      <div className="flex max-w-5xl flex-col gap-8 px-6 py-5">
        {report.data && !report.data.enforced ? (
          <Alert>
            <EyeIcon />
            <AlertTitle>Shadow mode: not enforced</AlertTitle>
            <AlertDescription>The temperature is computed and logged, but the scheduler and gates do not apply these policies yet.</AlertDescription>
          </Alert>
        ) : null}
        {report.isError ? <QueryError error={report.error} what="the temperature" onRetry={() => void report.refetch()} /> : null}
        {report.isPending ? <RowsSkeleton /> : current ? <CurrentReading snapshot={current} /> : <NoReading />}
        {report.data ? (
          <section aria-labelledby="hist-h">
            <h2 id="hist-h" className="mb-2 text-sm font-semibold">
              History
            </h2>
            <Sparkline history={report.data.history} />
          </section>
        ) : null}
        {report.data ? (
          <section aria-labelledby="pol-h">
            <h2 id="pol-h" className="mb-2 text-sm font-semibold">
              Policy per regime
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  {REGIMES.map((r) => (
                    <TableHead key={r} className={cn(current?.regime === r && "text-foreground")} aria-current={current?.regime === r ? "true" : undefined}>
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn("size-2 rounded-full", heatBg(r))} />
                        {REGIME_LABEL[r]}
                        {current?.regime === r ? <span className="text-xs font-normal text-muted-foreground">(now)</span> : null}
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
                      <TableCell key={r} className={cn("tabular-nums", current?.regime === r && "bg-muted/60 font-medium")}>
                        {row.format(report.data.policies[r][row.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function CurrentReading({ snapshot }: { snapshot: Snapshot }) {
  const { contributions = [], cleanStreak = 0 } = snapshot.contributions ?? {};
  const totalHeat = contributions.reduce((sum, c) => sum + c.heat, 0);
  return (
    <section aria-labelledby="now-h" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <h2 id="now-h" className="sr-only">
          Current temperature
        </h2>
        <p className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold tracking-tight">{REGIME_LABEL[snapshot.regime]}</span>
          <span className="text-2xl text-muted-foreground tabular-nums">{percent(snapshot.value)}</span>
        </p>
        <HeatGauge value={snapshot.value} regime={snapshot.regime} size="lg" />
        <p className="text-sm text-muted-foreground">
          {cleanStreak === 0 ? "No clean merges since the last heat signal." : `${cleanStreak} clean merge${cleanStreak === 1 ? "" : "s"} in a row.`} A streak of clean merges is what
          cools the regime one step; time alone never does. Updated {relativeTime(snapshot.at)}.
        </p>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">What is adding heat</h3>
        {contributions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing. No reverts, escaped bugs, holdout failures, flaky verifications or review disagreements in the last 30 days.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Heat</TableHead>
                <TableHead className="w-1/3">
                  <span className="sr-only">Share of heat</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contributions.map((c) => (
                <TableRow key={c.signal}>
                  <TableCell>{humanize(c.signal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.heat.toFixed(2)}</TableCell>
                  <TableCell>
                    <span aria-hidden className="block h-1.5 rounded-full bg-heat-hot" style={{ width: `${totalHeat ? (c.heat / totalHeat) * 100 : 0}%` }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

function NoReading() {
  return <p className="text-sm text-muted-foreground">No temperature snapshot yet. The first one is taken on the next heartbeat.</p>;
}
