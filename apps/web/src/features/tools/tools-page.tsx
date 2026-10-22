import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CircleAlertIcon, CircleDashedIcon, GitPullRequestIcon, KeyRoundIcon, PlugZapIcon, ShieldCheckIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Badge } from "@/components/ui/badge";
import { toolsQuery } from "@/lib/queries";
import type { ToolStatus, ToolsInventory } from "@/lib/types";

const STATUS: Record<ToolStatus, { label: string; icon: typeof CheckIcon; className: string }> = {
  ok: { label: "ok", icon: CheckIcon, className: "border-pass/40 text-pass" },
  missing: { label: "missing", icon: CircleDashedIcon, className: "border-blocked/50 text-blocked" },
  error: { label: "error", icon: CircleAlertIcon, className: "border-fail/50 text-fail" },
};

function StatusBadge({ status }: { status: ToolStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant="outline" className={cn("font-mono", s.className)}>
      <s.icon data-icon="inline-start" />
      {s.label}
    </Badge>
  );
}

/** What agents can use and what is installed on this machine. Secret values never reach the browser. */
export function ToolsPage() {
  const tools = useQuery(toolsQuery);
  const t = tools.data;
  const problems = t ? [...t.adapters, ...t.clis, ...t.connectors].filter((x) => x.status !== "ok").length : 0;
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Tools"
        info="Adapters, command-line tools, MCP servers and connectors Temper uses. Only key names are shown for MCP server environments; values stay in your profile."
        meta={t ? <span>{problems === 0 ? "Everything found" : `${problems} need attention`}</span> : null}
      />
      {tools.isError ? (
        <div className="p-6">
          <QueryError error={tools.error} what="tools" onRetry={() => void tools.refetch()} />
        </div>
      ) : !t ? (
        <div className="p-6">
          <RowsSkeleton rows={6} />
        </div>
      ) : (
        <div className="grid gap-8 px-4 py-5 md:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <Adapters adapters={t.adapters} />
            <Clis clis={t.clis} />
            <Connectors connectors={t.connectors} />
          </div>
          <McpServers servers={t.mcpServers} />
        </div>
      )}
    </div>
  );
}

function Section({ id, title, children, aside }: { id: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Adapters({ adapters }: { adapters: ToolsInventory["adapters"] }) {
  return (
    <Section id="adapters-h" title="Agent adapters">
      <ul className="flex flex-col gap-2">
        {adapters.map((a) => (
          <li key={a.id} className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{a.id}</span>
              <StatusBadge status={a.status} />
              {a.version ? <span className="font-mono text-xs text-muted-foreground">{a.version}</span> : null}
              {a.isolated ? (
                <span className="ml-auto flex items-center gap-1 text-xs text-pass">
                  <ShieldCheckIcon aria-hidden className="size-3.5" />
                  Isolated runs
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{a.note}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Clis({ clis }: { clis: ToolsInventory["clis"] }) {
  return (
    <Section id="clis-h" title="Command-line tools">
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {clis.map((c) => (
          <li key={c.name} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
            <span className="font-mono text-sm font-medium">{c.name}</span>
            <span className="truncate text-xs text-muted-foreground max-sm:order-3 max-sm:col-span-2">
              {c.purpose}
              {c.version ? <span className="ml-2 font-mono">{c.version}</span> : null}
            </span>
            <StatusBadge status={c.status} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

const CONNECTOR_LABEL: Record<string, string> = { github: "GitHub" };

function Connectors({ connectors }: { connectors: ToolsInventory["connectors"] }) {
  return (
    <Section id="connectors-h" title="Connectors">
      <ul className="flex flex-col gap-2">
        {connectors.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            {c.id === "github" ? <GitPullRequestIcon aria-hidden className="mt-0.5 size-4 shrink-0" /> : <PlugZapIcon aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{CONNECTOR_LABEL[c.id] ?? c.id}</span>
              <span className="text-xs leading-5 text-muted-foreground">{c.detail}</span>
            </div>
            <StatusBadge status={c.status} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

const PROFILE_EXAMPLE = `{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@example/linear-mcp"],
      "env": { "LINEAR_API_KEY": "…" },
      "description": "Read and update Linear issues"
    }
  }
}`;

function McpServers({ servers }: { servers: ToolsInventory["mcpServers"] }) {
  return (
    <Section id="mcp-h" title="MCP servers" aside={<span className="text-xs text-muted-foreground tabular-nums">{servers.length}</span>}>
      <ul className="flex flex-col gap-2">
        {servers.map((s) => (
          <li key={s.name} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PlugZapIcon aria-hidden className="size-4 text-muted-foreground" />
              <span className="font-mono text-sm font-medium">{s.name}</span>
              {s.builtIn ? <Badge variant="secondary">built in</Badge> : null}
              <span className="ml-auto flex items-center gap-1">
                {s.roles.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No agent uses it</span>
                ) : (
                  <>
                    <span className="sr-only">Used by {s.roles.map((r) => roleMeta(r).label).join(", ")}</span>
                    {s.roles.map((r) => (
                      <RoleAvatar key={r} role={r} size="xs" tooltip={`Used by ${roleMeta(r).label}`} />
                    ))}
                  </>
                )}
              </span>
            </div>
            {s.description ? <p className="text-xs leading-5 text-muted-foreground">{s.description}</p> : null}
            <p className="truncate font-mono text-xs text-muted-foreground" title={s.command}>
              <span aria-hidden className="select-none">
                ${" "}
              </span>
              {s.command}
            </p>
            {s.envKeys.length > 0 ? (
              <ul aria-label="Environment keys" className="flex flex-wrap gap-1">
                {s.envKeys.map((k) => (
                  <li key={k}>
                    <Badge variant="outline" className="font-mono">
                      <KeyRoundIcon data-icon="inline-start" />
                      {k}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
        <h3 className="font-medium">Adding an MCP server</h3>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Add it under <code className="font-mono text-foreground">mcpServers</code> in <code className="font-mono text-foreground">~/.temper/profile.json</code>.
            Secrets go in <code className="font-mono text-foreground">env</code>; only their names show here.
          </li>
          <li>
            Give it to the roles that need it on the{" "}
            <Link to="/agents" className="text-primary underline underline-offset-2">
              Agents
            </Link>{" "}
            screen. Runs get only the servers their agent lists.
          </li>
        </ol>
        <pre className="overflow-x-auto rounded-md border bg-muted p-2.5 font-mono text-xs leading-5">{PROFILE_EXAMPLE}</pre>
      </div>
    </Section>
  );
}
