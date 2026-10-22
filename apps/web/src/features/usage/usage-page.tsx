import { useQuery } from "@tanstack/react-query";
import { ChartColumnIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { cn } from "cn";
import { ProviderLogo } from "@/components/provider-logo";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compactNumber, formatUsd } from "@/lib/providers";
import { dispatchesQuery, projectsQuery, usageQuery } from "@/lib/queries";
import type { UsageReport } from "@/lib/types";
import {
  RANGE_LABEL,
  RANGE_PRESETS,
  cacheReadShare,
  failedAttempts,
  parseRange,
  pct,
  seriesRoles,
  share,
  timeline,
  toDateInput,
  vendorOfModel,
  whereItWent,
  type RangePreset,
} from "@/lib/usage";
import { BarList } from "./bar-list";
import { TicketTable } from "./ticket-table";
import { TimelineChart, chartColor } from "./timeline-chart";

const ALL = "all";

/** Where the tokens go: by role, kind of work, stage, model, project and ticket, over a chosen range. */
export function UsagePage() {
  const [params, setParams] = useSearchParams();
  // The range is resolved once per URL so "now" does not move on every render.
  const range = useMemo(() => parseRange(params), [params]);
  const q = { from: range.from.toISOString(), to: range.to.toISOString(), projectId: range.projectId };
  const usage = useQuery(usageQuery(q));
  const projects = useQuery(projectsQuery);
  const dispatches = useQuery(dispatchesQuery);
  const r = usage.data;

  const update = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );
  const setPreset = (p: RangePreset) =>
    p === "custom" ? update({ range: "custom", from: toDateInput(range.from), to: toDateInput(range.to) }) : update({ range: p === "7d" ? undefined : p, from: undefined, to: undefined });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Usage"
        info="Tokens every agent run used, from the providers' own reports. Tokens count input, output and cache writes; cache reads are cheap and shown separately."
        meta={r ? <span>{rangeText(r)}</span> : null}
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 md:px-6" role="group" aria-label="Filters">
        <ToggleGroup type="single" size="sm" variant="outline" value={range.preset} onValueChange={(v) => v && setPreset(v as RangePreset)} aria-label="Range">
          {RANGE_PRESETS.map((p) => (
            <ToggleGroupItem key={p} value={p} className="px-2.5">
              {RANGE_LABEL[p]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {range.preset === "custom" ? (
          <div className="flex items-center gap-1.5 text-sm">
            <Input
              type="date"
              aria-label="From"
              className="h-8 w-36"
              value={params.get("from") ?? ""}
              max={params.get("to") ?? undefined}
              onChange={(e) => e.target.value && update({ from: e.target.value })}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To"
              className="h-8 w-36"
              value={params.get("to") ?? ""}
              min={params.get("from") ?? undefined}
              max={toDateInput(new Date())}
              onChange={(e) => e.target.value && update({ to: e.target.value })}
            />
          </div>
        ) : null}
        <Select value={range.projectId ?? ALL} onValueChange={(v) => update({ project: v === ALL ? undefined : v })}>
          <SelectTrigger size="sm" aria-label="Project" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>All projects</SelectItem>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {range.projectId ? <span className="text-xs text-muted-foreground">Conversations are not tied to a project, so they are left out.</span> : null}
      </div>

      {usage.isError ? (
        <div className="p-6">
          <QueryError error={usage.error} what="usage" onRetry={() => void usage.refetch()} />
        </div>
      ) : !r ? (
        <div className="p-6">
          <RowsSkeleton rows={8} />
        </div>
      ) : r.totals.tokens === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No usage in this range</EmptyTitle>
            <EmptyDescription>
              Usage appears after agent runs: ticket stages, knowledge digests and conversations with the Chief of Staff each record the tokens their provider reports.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className={cn("flex max-w-7xl flex-col gap-6 px-4 py-5 transition-opacity md:px-6", usage.isPlaceholderData && "opacity-60")}>
          <Overview report={r} dispatches={dispatches.data ?? []} />
          <Panel title="Tokens over time" aside={timelineAside(r)}>
            <TimelineChart buckets={timeline(r)} roles={seriesRoles(r)} hourly={isHourly(r)} />
          </Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="By role">
              <BarList
                total={r.totals.tokens}
                empty="No runs."
                items={r.byRole.map((b) => ({ bucket: b, label: roleMeta(b.key).label, icon: <RoleAvatar role={b.key} size="xs" tooltip={false} />, color: chartColor(b.key) }))}
              />
            </Panel>
            <Panel title="By kind of work">
              <BarList total={r.totals.tokens} empty="No runs." items={r.byKind.map((b) => ({ bucket: b }))} />
            </Panel>
            <Panel title="By stage" aside="Ticket work only">
              <BarList total={r.totals.tokens} empty="No ticket stages ran." items={r.byStage.map((b) => ({ bucket: b, label: <span className="font-mono text-[0.8125rem]">{b.label}</span> }))} />
            </Panel>
            <Panel title="By model">
              <BarList
                total={r.totals.tokens}
                empty="No runs."
                items={r.byModel.map((b) => ({ bucket: b, label: <span className="font-mono text-[0.8125rem]">{b.label}</span>, icon: <ProviderLogo vendor={vendorOfModel(b.key)} size="sm" label={false} className="text-muted-foreground" /> }))}
              />
            </Panel>
            <Panel title="By project" aside="Ticket work only">
              <BarList total={r.totals.tokens} empty="No ticket work." items={r.byProject.map((b) => ({ bucket: b }))} />
            </Panel>
          </div>
          <Panel title="Most expensive tickets" aside={`Top ${r.byTicket.length}`}>
            <TicketTable report={r} failed={failedAttempts(dispatches.data ?? [])} />
          </Panel>
        </div>
      )}
    </div>
  );
}

const isHourly = (r: UsageReport) => Date.parse(r.to) - Date.parse(r.from) <= 2 * 86_400_000;
const timelineAside = (r: UsageReport) => (isHourly(r) ? "Per hour" : "Per day, UTC");

function rangeText(r: UsageReport): string {
  const f = new Date(r.from);
  const t = new Date(r.to);
  const opts: Intl.DateTimeFormatOptions = isHourly(r) ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" };
  return `${f.toLocaleString(undefined, opts)} to ${t.toLocaleString(undefined, opts)}`;
}

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The headline: total tokens, the story in a sentence or two, and the supporting figures. */
function Overview({ report: r, dispatches }: { report: UsageReport; dispatches: Parameters<typeof whereItWent>[1] }) {
  const story = whereItWent(r, dispatches);
  const wasted = share(r.wasted.tokens, r.totals.tokens);
  return (
    <section aria-label="Overview" className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <p className="flex items-baseline gap-2">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">{compactNumber(r.totals.tokens)}</span>
          <span className="text-sm text-muted-foreground">tokens</span>
        </p>
        <div aria-label="Where it went" className="max-w-prose text-[0.9375rem] leading-relaxed text-foreground/90">
          {story.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-xl border bg-border">
        <Tile label="Runs" value={String(r.totals.runs)} />
        <Tile label="Failed attempts" value={pct(wasted)} detail={`${compactNumber(r.wasted.tokens)} tokens on ${r.wasted.runs} run${r.wasted.runs === 1 ? "" : "s"} that ended FAIL or BLOCKED`} tone={wasted >= 0.25 ? "text-blocked" : undefined} />
        <Tile label="List-price equivalent" value={formatUsd(r.totals.costUsd)} detail="What these tokens would cost at API prices. Subscriptions are not billed per token." />
        <Tile label="Cache reads" value={pct(cacheReadShare(r.totals))} detail={`${compactNumber(r.totals.cacheReadTokens)} tokens read from cache, of everything read or written`} />
      </dl>
    </section>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl font-semibold tracking-tight tabular-nums", tone)}>{value}</dd>
      {detail ? <dd className="text-xs leading-snug text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}
