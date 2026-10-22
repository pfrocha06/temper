import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import { agentsQuery, approvalsQuery } from "@/lib/queries";
import type { Agent } from "@/lib/types";
import { AgentEditDialog } from "./agent-edit-dialog";

const ROLE_ORDER = ["planner", "builder", "verifier", "reviewer"];

export function AgentsPage() {
  const agents = useQuery(agentsQuery);
  const approvals = useQuery(approvalsQuery);
  // The API returns the latest saved version; a pending agent_change means it is not in use yet.
  const verifierPending = approvals.data?.some((a) => a.kind === "agent_change") ?? false;
  const sorted = agents.data?.toSorted((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return (
    <div className="flex flex-col">
      <PageHeader title="Agents" description="Versioned role definitions. Every run starts fresh with only what is listed here." />
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
        <ul className="flex flex-col">
          {sorted.map((a) => (
            <li key={`${a.id}@${a.version}`}>
              <AgentRow agent={a} awaitingApproval={a.role === "verifier" && verifierPending} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentRow({ agent, awaitingApproval }: { agent: Agent; awaitingApproval: boolean }) {
  return (
    <article aria-labelledby={`agent-${agent.id}`} className="grid gap-4 border-b px-6 py-4 lg:grid-cols-[16rem_minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-1">
        <h2 id={`agent-${agent.id}`} className="flex items-baseline gap-2">
          <span className="font-semibold">{agent.name}</span>
          <span className="font-mono text-xs text-muted-foreground">v{agent.version}</span>
        </h2>
        {agent.name.toLowerCase() !== agent.role ? <p className="text-sm text-muted-foreground">{humanize(agent.role)}</p> : null}
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Adapter</dt>
          <dd className="font-mono">{agent.adapter}</dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="font-mono">{agent.model ?? "adapter default"}</dd>
          <dt className="text-muted-foreground">Concurrency</dt>
          <dd className="tabular-nums">{agent.maxConcurrency === 0 ? "0 (off)" : agent.maxConcurrency}</dd>
          <dt className="text-muted-foreground">Runs/hour</dt>
          <dd className="tabular-nums">{agent.runsPerHour}</dd>
        </dl>
        {awaitingApproval ? (
          <p className="mt-1 text-xs">
            v{agent.version} awaits approval in the{" "}
            <Link to="/inbox" className="text-primary hover:underline">
              Inbox
            </Link>
            ; {agent.approvedVersion ? `v${agent.approvedVersion}` : "the last approved version"} keeps running.
          </p>
        ) : agent.role === "verifier" ? (
          <p className="mt-1 text-xs text-muted-foreground">Edits need board approval.</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <ChipList label="Skills" items={agent.skills} empty="No skills" />
        <ChipList label="Allowed tools" items={agent.permissions.allowedTools} empty="None" mono />
        <ChipList label="Disallowed tools" items={agent.permissions.disallowedTools} empty="None" mono />
        {agent.instructions ? (
          <div>
            <h3 className="mb-1 text-xs text-muted-foreground">Instructions</h3>
            <p className="line-clamp-3 text-sm whitespace-pre-wrap">{agent.instructions}</p>
          </div>
        ) : null}
      </div>
      <div>
        <AgentEditDialog agent={agent} />
      </div>
    </article>
  );
}

function ChipList({ label, items, empty, mono = false }: { label: string; items: string[]; empty: string; mono?: boolean }) {
  return (
    <div>
      <h3 className="mb-1 text-xs text-muted-foreground">{label}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((i) => (
            <li key={i}>
              <Badge variant="outline" className={mono ? "font-mono" : undefined}>
                {i}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
