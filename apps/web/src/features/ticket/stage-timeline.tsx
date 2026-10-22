import { Link } from "react-router";
import { DispatchStatus, VerdictBadge } from "@/components/badges";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import type { Dispatch } from "@/lib/types";

/** A one-glance summary: markdown markers and the verdict line (already shown as a badge) removed. */
export function plainSummary(md: string): string {
  return md
    .replace(/^\s*VERDICT:.*$/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every dispatch of this ticket, oldest first: the path it took through its workflow. */
export function StageTimeline({ dispatches }: { dispatches: Dispatch[] }) {
  const now = useNow(dispatches.some((d) => d.status === "running"));
  if (dispatches.length === 0) {
    return <p className="text-sm text-muted-foreground">No dispatches yet. The first stage runs once the ticket is ready and an agent is free.</p>;
  }
  return (
    <ol className="relative flex flex-col">
      {dispatches.map((d, i) => (
        <li key={d.id} className="relative grid grid-cols-[1rem_1fr] gap-x-3 pb-3 last:pb-0">
          <span aria-hidden className="relative flex justify-center">
            <span className="mt-1.5 size-2 rounded-full border-2 border-primary bg-background" />
            {i < dispatches.length - 1 ? <span className="absolute top-4 bottom-0 w-px bg-border" /> : null}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link to={`/runs/${d.id}`} className="text-sm font-medium hover:underline">
                {d.stage}
              </Link>
              {d.attempt > 1 ? <span className="text-xs text-muted-foreground">attempt {d.attempt}</span> : null}
              <VerdictBadge verdict={d.verdict} />
              {d.verdict ? null : <DispatchStatus status={d.status} />}
            </div>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">
                {d.agentId}@{d.agentVersion}
              </span>
              {d.startedAt ? <span>{duration(d.startedAt, d.finishedAt, now)}</span> : null}
              <time dateTime={d.createdAt} title={d.createdAt}>
                {relativeTime(d.createdAt)}
              </time>
            </p>
            {d.summary && d.status !== "succeeded" ? <p className="line-clamp-2 text-xs text-muted-foreground">{plainSummary(d.summary)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
