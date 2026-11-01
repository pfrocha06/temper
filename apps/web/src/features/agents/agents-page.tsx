import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, PlugZapIcon, ShieldIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { ProviderLogo } from "@/components/provider-logo";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentStats, type AgentStats } from "@/lib/agent-stats";
import { percent } from "@/lib/format";
import { sharedVendor, VENDOR_LABEL, vendorOfAdapter } from "@/lib/providers";
import { agentsQuery, approvalsQuery, dispatchesQuery, statusQuery } from "@/lib/queries";
import type { Agent } from "@/lib/types";
import { AgentEditDialog } from "./agent-edit-dialog";

const ROLE_ORDER = ["chief", "builder", "verifier", "reviewer"];
const VERDICT_BG: Record<string, string> = { PASS: "bg-pass", FAIL: "bg-fail", BLOCKED: "bg-blocked", none: "bg-muted-foreground/40" };

export function AgentsPage() {
  const agents = useQuery(agentsQuery);
  const approvals = useQuery(approvalsQuery);
  const dispatches = useQuery(dispatchesQuery);
  const status = useQuery(statusQuery);
  // The API returns the latest saved version; a pending agent_change means it is not in use yet.
  const verifierPending = approvals.data?.some((a) => a.kind === "agent_change") ?? false;
  const sorted = agents.data?.toSorted((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const stats = useMemo(() => agentStats(dispatches.data ?? []), [dispatches.data]);
  const oneVendor = sorted ? sharedVendor(sorted) : undefined;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Agents"
        info="Versioned role definitions. Every run starts fresh with only the skills and tools listed here. Stats cover the last 100 dispatches."
        meta={status.data ? <span>{status.data.active.length} working now</span> : null}
      />
      {agents.isError ? (
        <div className="p-6">
          <QueryError error={agents.error} what="agents" onRetry={() => void agents.refetch()} />
        </div>
      ) : !sorted ? (
        <div className="p-6">
          <RowsSkeleton />
        </div>
      ) : sorted.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No agents. The server seeds the four default roles on start; restart it to restore them.</p>
      ) : (
        <>
          {oneVendor ? (
            <div className="px-3 pt-3 md:px-6 md:pt-6">
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>Builder and Verifier both run on {VENDOR_LABEL[oneVendor]}</AlertTitle>
                <AlertDescription>
                  The work and its proof come from one model family, so their blind spots line up. Give the Verifier a different adapter, such as
                  Codex, so another vendor checks the Builder (ADR 6).
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <ul className="grid gap-3 p-3 md:p-6 lg:grid-cols-2 2xl:grid-cols-4">
            {sorted.map((a) => (
              <li key={`${a.id}@${a.version}`} className="min-w-0">
                <AgentCard
                  agent={a}
                  stats={stats.get(a.id)}
                  active={status.data?.active.filter((x) => x.agentId === a.id).length ?? 0}
                  awaitingApproval={a.role === "verifier" && verifierPending}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Meter({ label, value, max, hint }: { label: string; value: number; max: number; hint: string }) {
  const pct = max === 0 ? 0 : Math.min(1, value / max);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="flex flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-foreground tabular-nums">
              {value}
              <span className="text-muted-foreground">/{max === 0 ? "off" : max}</span>
            </span>
          </div>
          <div
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full bg-current transition-[width] duration-500", pct >= 1 && "bg-blocked")}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

function AgentCard({ agent, stats, active, awaitingApproval }: { agent: Agent; stats: AgentStats | undefined; active: number; awaitingApproval: boolean }) {
  const m = roleMeta(agent.role);
  const { allowedTools, disallowedTools } = agent.permissions;
  return (
    <article aria-labelledby={`agent-${agent.id}`} className="flex h-full flex-col gap-4 rounded-xl border bg-card p-4">
      <header className="flex items-start gap-3">
        <RoleAvatar role={agent.role} size="lg" live={active > 0} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={`agent-${agent.id}`} className="flex items-baseline gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="font-mono text-xs text-muted-foreground">v{agent.version}</span>
          </h2>
          <p className="text-xs text-muted-foreground">{m.does}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary" className="font-mono">
              {agent.model ?? "default model"}
            </Badge>
            <Badge variant="outline" className="font-mono">
              <ProviderLogo vendor={vendorOfAdapter(agent.adapter)} size="xs" label={false} />
              {agent.adapter}
            </Badge>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1" aria-label="MCP servers">
            <PlugZapIcon aria-hidden className="size-3.5 text-muted-foreground" />
            {agent.mcpServers.length === 0 ? (
              <span className="text-xs text-muted-foreground">No MCP servers</span>
            ) : (
              agent.mcpServers.map((s) => (
                <Badge key={s} variant="outline" className="font-mono">
                  {s}
                </Badge>
              ))
            )}
          </p>
        </div>
        <AgentEditDialog agent={agent} />
      </header>

      {awaitingApproval ? (
        <p className="rounded-md border border-board/40 bg-board/8 px-2.5 py-1.5 text-xs">
          v{agent.version} awaits approval in the{" "}
          <Link to="/inbox" className="font-medium text-board hover:underline">
            Inbox
          </Link>
          ; {agent.approvedVersion ? `v${agent.approvedVersion}` : "the last approved version"} keeps running.
        </p>
      ) : null}

      <div className={cn("grid grid-cols-2 gap-4", m.text)}>
        <Meter label="Concurrency" value={active} max={agent.maxConcurrency} hint={`${active} running of ${agent.maxConcurrency} allowed at once`} />
        <Meter
          label="Runs this hour"
          value={stats?.runsLastHour ?? 0}
          max={agent.runsPerHour}
          hint={`Started in the last hour, of ${agent.runsPerHour} allowed per hour`}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Runs" value={String(stats?.runs ?? 0)} />
        <Stat label="Pass rate" value={stats?.passRate === undefined ? "–" : percent(stats.passRate)} />
        <Stat label="Avg time" value={stats?.avgMs === undefined ? "–" : formatShort(stats.avgMs)} />
      </dl>
      {stats && stats.recent.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Recent</span>
          <span role="img" aria-label={`Recent verdicts: ${stats.recent.join(", ")}`} className="flex gap-0.5">
            {stats.recent.map((v, i) => (
              <span key={i} aria-hidden title={v} className={cn("h-3 w-1.5 rounded-xs", VERDICT_BG[v])} />
            ))}
          </span>
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-1 border-t pt-3">
        <Disclosure label={`${agent.skills.length} skills`}>
          {agent.skills.length === 0 ? (
            <p className="text-xs text-muted-foreground">No skills.</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {agent.skills.map((s) => (
                <li key={s}>
                  <Badge variant="outline">{s}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
        <Disclosure label={`Permissions: ${allowedTools.length} allowed, ${disallowedTools.length} denied`} icon>
          <div className="flex flex-col gap-2">
            <ToolList label="Allowed" items={allowedTools} />
            <ToolList label="Denied" items={disallowedTools} />
          </div>
        </Disclosure>
        {agent.instructions ? (
          <Disclosure label="Instructions">
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">{agent.instructions}</p>
          </Disclosure>
        ) : null}
      </div>
    </article>
  );
}

function Disclosure({ label, icon = false, children }: { label: string; icon?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/d flex w-full items-center gap-1.5 rounded-sm py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-data-[state=open]/d:rotate-90" />
        {icon ? <ShieldIcon aria-hidden className="size-3.5" /> : null}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2 pl-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ToolList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {items.length === 0 ? (
        <span className="text-xs text-muted-foreground">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((i) => (
            <li key={i}>
              <Badge variant="outline" className="font-mono">
                {i}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatShort(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
