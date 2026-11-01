import { useQuery } from "@tanstack/react-query";
import { CircleDashedIcon, CircleDotIcon, HourglassIcon, InfoIcon, UserRoundXIcon } from "lucide-react";
import { cn } from "cn";
import { ProviderLogo, VENDOR_MARK } from "@/components/provider-logo";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar } from "@/components/role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { ROLE_ORDER } from "@/lib/constants";
import { clockTime, relativeTime } from "@/lib/format";
import {
  PLANNED_USE,
  STATE_LABEL,
  capsSummary,
  compactNumber,
  countdown,
  formatUsd,
  limitLabel,
  limitTone,
  modelBreakdown,
  providerState,
  usageWindowViews,
  type Meter,
  type ProviderInfo,
  type WindowView,
} from "@/lib/providers";
import { providersQuery } from "@/lib/queries";
import { CapsDialog } from "./caps-dialog";

const CAP_NOTE = "When a cap is reached, new work for the provider waits until its window resets, and the Inbox gets a notice.";

export function ProvidersPage() {
  const providers = useQuery(providersQuery);
  const list = providers.data ?? [];
  const active = list.filter((p) => p.adapter);
  const coming = list.filter((p) => !p.adapter);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Providers"
        info="The agent CLIs Temper runs work on: who is signed in, what Temper has used in each window, the limits the provider reports, and the caps you set."
        meta={providers.data ? <span>{active.filter((p) => p.installed).length} active</span> : null}
      />
      {providers.isError ? (
        <div className="p-6">
          <QueryError error={providers.error} what="providers" onRetry={() => void providers.refetch()} />
        </div>
      ) : providers.isPending ? (
        <div className="p-6">
          <RowsSkeleton rows={6} />
        </div>
      ) : (
        <div className="flex max-w-5xl flex-col gap-8 px-4 py-5 md:px-6">
          <ul className="flex flex-col gap-4">
            {active.map((p) => (
              <li key={p.id}>
                <ProviderCard provider={p} />
              </li>
            ))}
          </ul>
          {coming.length > 0 ? (
            <section aria-labelledby="prov-coming" className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-0.5">
                <h2 id="prov-coming" className="text-sm font-semibold">
                  Coming
                </h2>
                <p className="text-xs text-muted-foreground">Temper has no adapter for these yet. Installed ones are detected so they are ready when it does.</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {coming.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <ComingCard provider={p} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StateBadge({ provider }: { provider: ProviderInfo }) {
  const state = providerState(provider);
  const Icon = state === "active" ? CircleDotIcon : CircleDashedIcon;
  return (
    <Badge
      variant="outline"
      className={cn(state === "active" ? "border-pass/40 text-pass" : state === "no_adapter" || state === "not_enabled" ? "text-muted-foreground" : "border-dashed text-muted-foreground")}
    >
      <Icon data-icon="inline-start" />
      {STATE_LABEL[state]}
    </Badge>
  );
}

function ProviderCard({ provider: p }: { provider: ProviderInfo }) {
  const windows = usageWindowViews(p);
  const roles = p.roles.toSorted((a, b) => ROLE_ORDER.indexOf(a as never) - ROLE_ORDER.indexOf(b as never));
  const anyCost = windows.some((w) => w.usage.costUsd > 0);
  const caps = capsSummary(p.caps);

  return (
    <article aria-labelledby={`prov-${p.id}`} className="flex flex-col rounded-xl border bg-card">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 md:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground">
          <ProviderLogo vendor={p.vendor} size="lg" label={VENDOR_MARK[p.vendor].label} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`prov-${p.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold tracking-tight">{p.name}</span>
            <StateBadge provider={p} />
            {p.version ? <span className="font-mono text-xs text-muted-foreground">{shortVersion(p.version)}</span> : null}
          </h2>
          <AccountLine provider={p} />
          {roles.length > 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              Runs
              <span className="flex -space-x-1">
                {roles.map((r) => (
                  <RoleAvatar key={r} role={r} size="xs" className="ring-2 ring-card" />
                ))}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No agent role uses it.</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          <CapsDialog provider={p} />
          <p className="max-w-56 text-right text-xs text-muted-foreground max-sm:order-first max-sm:text-left">{caps.length ? caps.join("; ") : "No caps set"}</p>
        </div>
      </header>

      {p.pausedUntil ? <PausedBanner until={p.pausedUntil} /> : null}

      {windows.length > 0 ? (
        <section aria-label="Usage" className="border-t">
          <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
            {windows.map((w) => (
              <UsageWindowView key={w.key} view={w} />
            ))}
          </div>
          <p className="flex flex-wrap items-start gap-x-1.5 border-t px-4 py-2 text-xs text-muted-foreground md:px-5">
            <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {CAP_NOTE}
              {anyCost ? " Dollar figures are what the same tokens would cost at API list prices; subscriptions are not billed per token." : ""}
            </span>
          </p>
        </section>
      ) : null}

      <Limits provider={p} />
    </article>
  );
}

function AccountLine({ provider: p }: { provider: ProviderInfo }) {
  if (!p.installed) return <p className="text-sm text-muted-foreground">Not found on this machine's PATH.</p>;
  const a = p.account;
  if (!a) return null;
  if (!a.loggedIn)
    return (
      <p className="flex items-center gap-1.5 text-sm text-blocked">
        <UserRoundXIcon aria-hidden className="size-4" />
        Not signed in. Runs on this provider fail until it is.
      </p>
    );
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {a.subscription ? (
        <Badge variant="secondary" title="Subscription type, as the provider reports it">
          {a.subscription}
        </Badge>
      ) : null}
      {a.org ? <span className="truncate font-medium">{a.org}</span> : null}
      {a.email ? <span className="truncate text-muted-foreground">{a.email}</span> : null}
      {a.method ? <span className="text-xs text-muted-foreground">via {a.method}</span> : null}
    </p>
  );
}

function PausedBanner({ until }: { until: string }) {
  const now = useNow(true, 15_000);
  return (
    <Alert className="mx-4 mb-4 w-auto border-blocked/50 bg-blocked/8 md:mx-5">
      <HourglassIcon className="text-blocked" />
      <AlertTitle>
        Paused until <time dateTime={until}>{clockTime(until).slice(0, 5)}</time> ({countdown(until, now)})
      </AlertTitle>
      <AlertDescription>The provider reported a limit. New work for it waits and resumes on its own at that time.</AlertDescription>
    </Alert>
  );
}

function UsageWindowView({ view: w }: { view: WindowView }) {
  const titleId = `win-${w.key}`;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 px-4 py-4 md:px-5">
      <h3 id={titleId} className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{w.label}</span>
        <span className="text-xs text-muted-foreground">{w.hint}</span>
      </h3>
      <MeterRow label="Runs" meter={w.runs} format={String} />
      <MeterRow label="Tokens" meter={w.tokens} format={compactNumber} breakdown={w.usage.byModel} outputTokens={w.usage.outputTokens} />
      {w.usage.costUsd > 0 ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground/80">{formatUsd(w.usage.costUsd)}</span> list-price equivalent
        </p>
      ) : null}
    </section>
  );
}

const LEVEL_BAR: Record<Meter["level"], string> = { none: "bg-muted-foreground/40", ok: "bg-foreground/70", near: "bg-blocked", reached: "bg-fail" };

function MeterRow({
  label,
  meter: m,
  format,
  breakdown,
  outputTokens,
}: {
  label: string;
  meter: Meter;
  format: (n: number) => string;
  breakdown?: Record<string, number>;
  outputTokens?: number;
}) {
  const figure = (
    <span className="text-sm font-medium tabular-nums">
      {format(m.used)}
      <span className="font-normal text-muted-foreground">{m.cap !== undefined ? ` / ${format(m.cap)}` : ""}</span>
    </span>
  );
  const models = breakdown ? modelBreakdown(breakdown) : [];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        {models.length > 0 ? (
          <HoverCard openDelay={120} closeDelay={60}>
            <HoverCardTrigger asChild>
              <button type="button" className="rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {figure}
              </button>
            </HoverCardTrigger>
            <HoverCardContent align="end" className="w-72">
              <ModelBreakdown models={models} outputTokens={outputTokens} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          figure
        )}
      </div>
      {m.cap !== undefined ? (
        <div
          role="meter"
          aria-label={`${label}${m.level === "reached" ? ", cap reached" : ""}`}
          aria-valuemin={0}
          aria-valuemax={m.cap}
          aria-valuenow={Math.min(m.used, m.cap)}
          aria-valuetext={`${format(m.used)} of ${format(m.cap)}`}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn("h-full rounded-full transition-[width] duration-500", LEVEL_BAR[m.level])} style={{ width: `${(m.fraction ?? 0) * 100}%` }} />
        </div>
      ) : (
        <div aria-hidden className="flex h-1.5 items-center">
          <span className="h-px w-full border-t border-dashed border-muted-foreground/30" />
        </div>
      )}
      {m.level === "reached" ? <span className="text-xs text-fail">Cap reached: new work waits</span> : m.cap === undefined ? <span className="sr-only">No cap</span> : null}
    </div>
  );
}

function ModelBreakdown({ models, outputTokens }: { models: ReturnType<typeof modelBreakdown>; outputTokens?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium">Tokens by model</p>
      <ul className="flex flex-col gap-1.5">
        {models.map((m) => (
          <li key={m.model} className="flex flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-mono">{m.model}</span>
              <span className="tabular-nums">{compactNumber(m.tokens)}</span>
            </span>
            <span aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${m.share * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[0.6875rem] leading-4 text-muted-foreground">
        Input, output and cache writes{outputTokens !== undefined ? `; ${compactNumber(outputTokens)} of them output` : ""}. Cache reads are not counted.
      </p>
    </div>
  );
}

const TONE: Record<ReturnType<typeof limitTone>, string> = {
  pass: "text-pass border-pass/40",
  blocked: "text-blocked border-blocked/50",
  fail: "text-fail border-fail/50",
  muted: "text-muted-foreground",
};

/** The provider's own limit reports, latest per type, exactly as reported. */
function Limits({ provider: p }: { provider: ProviderInfo }) {
  const now = useNow(p.limits.length > 0, 30_000);
  if (p.limits.length === 0) {
    return p.adapter && p.installed ? (
      <p className="border-t px-4 py-3 text-xs text-muted-foreground md:px-5">No limit reports from {p.name} yet. They appear after its next run.</p>
    ) : null;
  }
  return (
    <section aria-labelledby={`lim-${p.id}`} className="border-t px-4 py-3 md:px-5">
      <h3 id={`lim-${p.id}`} className="mb-2 text-xs font-medium text-muted-foreground">
        Limits reported by {p.name}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {p.limits.map((l) => (
          <li key={l.limitType} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="min-w-28 font-medium" title={l.limitType}>
              {limitLabel(l.limitType)}
            </span>
            <Badge variant="outline" className={cn("font-mono", TONE[limitTone(l.status)])}>
              {l.status}
            </Badge>
            {l.resetsAt ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="rounded-sm text-xs text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    resets {countdown(l.resetsAt, now)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{new Date(l.resetsAt).toLocaleString()}</TooltipContent>
              </Tooltip>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">reported {relativeTime(l.at, now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ComingCard({ provider: p }: { provider: ProviderInfo }) {
  const use = PLANNED_USE[p.id];
  return (
    <article aria-labelledby={`prov-${p.id}`} className="flex h-full flex-col gap-2.5 rounded-xl border border-dashed p-4 text-muted-foreground">
      <header className="flex items-center gap-2.5">
        <ProviderLogo vendor={p.vendor} size="md" label={VENDOR_MARK[p.vendor].label} className="text-foreground/70" />
        <h3 id={`prov-${p.id}`} className="font-medium text-foreground">
          {p.name}
        </h3>
        <span className="ml-auto text-xs">coming</span>
      </header>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <StateBadge provider={p} />
        {p.version ? <span className="font-mono">{shortVersion(p.version)}</span> : null}
      </p>
      {use ? <p className="text-sm text-foreground/80">{use}</p> : null}
    </article>
  );
}

/** `2.1.0 (Claude Code)` → `2.1.0`: the name is already on the card. */
const shortVersion = (v: string) => v.replace(/\s*\(.*\)\s*$/, "");
