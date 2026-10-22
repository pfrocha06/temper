import { Link } from "react-router";
import { cn } from "cn";
import { RoleAvatar, roleMeta } from "@/components/role";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import type { Dispatch, FactoryStatus, Ticket } from "@/lib/types";

const VERDICT_TEXT: Record<string, string> = { PASS: "text-pass", FAIL: "text-fail", BLOCKED: "text-blocked" };

/** What the agents are doing right now; when idle, the last thing that finished. */
export function ActivityStrip({
  status,
  dispatches,
  ticketById,
}: {
  status: FactoryStatus | undefined;
  dispatches: Dispatch[];
  ticketById: Map<string, Ticket>;
}) {
  const active = status?.active ?? [];
  const now = useNow(active.length > 0);
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  const last = active.length === 0 ? dispatches.find((d) => d.finishedAt) : undefined;

  return (
    <div aria-label="Agent activity" role="region" className="flex items-center gap-2 overflow-x-auto border-b bg-muted/30 px-4 py-1.5 md:px-6">
      {active.length > 0 ? (
        <ul aria-live="polite" className="flex items-center gap-2">
          {active.map((a) => {
            const d = byId.get(a.dispatchId);
            const t = ticketById.get(a.ticketId);
            return (
              <li key={a.dispatchId}>
                <Link
                  to={`/runs/${a.dispatchId}`}
                  className="flex h-8 max-w-96 items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-xs hover:border-ring/60 motion-safe:animate-arrive"
                >
                  <RoleAvatar role={a.role} size="sm" live tooltip={false} />
                  <span className={cn("font-medium", roleMeta(a.role).text)}>{roleMeta(a.role).label}</span>
                  <span className="text-muted-foreground">{d?.stage ?? "working"}</span>
                  <span className="min-w-0 truncate">{t?.title ?? a.ticketId}</span>
                  {d?.startedAt ? <span className="shrink-0 text-muted-foreground tabular-nums">{duration(d.startedAt, null, now)}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status?.paused ? "bg-blocked" : "bg-muted-foreground/60")} />
          <span className="shrink-0">{status?.paused ? "Paused." : "No agent is working."}</span>
          {last ? (
            <Link to={`/runs/${last.id}`} className="flex min-w-0 items-center gap-1.5 rounded-sm hover:text-foreground">
              <span className="shrink-0">Last:</span>
              <RoleAvatar role={last.agentId} size="xs" tooltip={false} />
              <span className="shrink-0">{last.stage}</span>
              {last.verdict ? <span className={cn("shrink-0 font-mono font-medium", VERDICT_TEXT[last.verdict])}>{last.verdict}</span> : null}
              <span className="min-w-0 truncate">{ticketById.get(last.ticketId)?.title}</span>
              <span className="shrink-0">{relativeTime(last.finishedAt!)}</span>
            </Link>
          ) : null}
        </p>
      )}
    </div>
  );
}
