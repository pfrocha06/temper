import { useQuery } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  ClockIcon,
  GitPullRequestIcon,
  HandIcon,
  InboxIcon,
  PlayIcon,
  RadioIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Button } from "@/components/ui/button";
import { ApprovalButtons } from "@/features/inbox/approval-buttons";
import { useNow } from "@/hooks/use-now";
import { duration, plainSummary } from "@/lib/format";
import type { PipelineNode } from "@/lib/pipeline";
import { approvalsQuery, useStartTicket } from "@/lib/queries";
import type { Ticket } from "@/lib/types";

type Tone = "board" | "blocked" | "live" | "quiet" | "done";

const TONE: Record<Tone, string> = {
  board: "border-board/50 bg-board/8",
  blocked: "border-blocked/60 bg-blocked/8",
  live: "border-border bg-card",
  quiet: "border-dashed border-border",
  done: "border-pass/40 bg-pass/6",
};

function Banner({ tone, icon: Icon, title, detail, children }: { tone: Tone; icon?: LucideIcon; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label="Next action" className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3", TONE[tone])}>
      {Icon ? (
        <Icon
          aria-hidden
          className={cn(
            "size-5 shrink-0",
            tone === "board" ? "text-board" : tone === "blocked" ? "text-blocked" : tone === "done" ? "text-pass" : "text-muted-foreground",
          )}
        />
      ) : null}
      <div className="flex min-w-56 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold">{title}</p>
        {detail ? <p className="line-clamp-2 text-sm text-muted-foreground">{detail}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </section>
  );
}

/** The question an agent asked the board, as the server puts it first in an escalation. */
export function askedQuestion(body: string | undefined): string | undefined {
  return body ? /\*\*Decision needed:\*\*\s*(.+)/.exec(body)?.[1]?.trim() : undefined;
}

/** The one thing to know or do about this ticket now, with the action at hand. */
export function NextAction({ ticket, focus }: { ticket: Ticket; focus: PipelineNode | undefined }) {
  const approvals = useQuery({ ...approvalsQuery, enabled: ticket.status === "awaiting_board" });
  const approval = approvals.data?.find((a) => a.ticketId === ticket.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const start = useStartTicket();
  const running = focus?.state === "running" ? focus.latest : undefined;
  const now = useNow(Boolean(running));

  switch (ticket.status) {
    case "awaiting_board": {
      const isMerge = approval?.kind === "merge";
      const stuck = focus?.state === "blocked" || focus?.state === "fail" || approval?.kind === "escalation";
      return (
        <Banner
          tone={stuck ? "blocked" : "board"}
          icon={stuck ? TriangleAlertIcon : HandIcon}
          title={isMerge ? "Waiting for your merge" : stuck ? `Stuck at ${ticket.stage}` : `Waiting for your decision at ${ticket.stage}`}
          detail={
            isMerge
              ? "Gates passed and the Reviewer found no blockers."
              : (askedQuestion(approval?.body) ?? (focus?.latest?.summary ? plainSummary(focus.latest.summary) : undefined))
          }
        >
          {ticket.prUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={ticket.prUrl} target="_blank" rel="noreferrer noopener">
                <GitPullRequestIcon data-icon="inline-start" />
                Review PR
              </a>
            </Button>
          ) : null}
          {approval ? (
            <ApprovalButtons approval={approval} confirming={confirming} setConfirming={setConfirming} />
          ) : (
            <Button asChild size="sm">
              <Link to="/inbox">
                <InboxIcon data-icon="inline-start" />
                Open inbox
              </Link>
            </Button>
          )}
        </Banner>
      );
    }
    case "in_progress":
      if (running && focus) {
        return (
          <Banner
            tone="live"
            title={`${roleMeta(focus.actor).label} is working on ${focus.stage}`}
            detail={running.startedAt ? `Running for ${duration(running.startedAt, null, now)}` : undefined}
          >
            <RoleAvatar role={focus.actor} size="md" live />
            <Button asChild size="sm">
              <Link to={`/runs/${running.id}`}>
                <RadioIcon data-icon="inline-start" />
                Watch live
              </Link>
            </Button>
          </Banner>
        );
      }
      return (
        <Banner
          tone="quiet"
          icon={ClockIcon}
          title={`Next: ${ticket.stage ?? "first stage"}`}
          detail={`Waits for a free ${focus ? roleMeta(focus.actor).label.toLowerCase() : "agent"}.`}
        />
      );
    case "ready":
      return <Banner tone="quiet" icon={ClockIcon} title="Ready" detail="The first stage starts when an agent is free." />;
    case "backlog":
      return (
        <Banner tone="quiet" icon={PlayIcon} title="Not started" detail="Start it to queue the first stage.">
          <Button
            size="sm"
            disabled={start.isPending}
            onClick={() =>
              start.mutate(ticket.id, {
                onSuccess: () => toast.success(`Started “${ticket.title}”`),
                onError: (e) => toast.error(`Could not start: ${e.message}`),
              })
            }
          >
            <PlayIcon data-icon="inline-start" />
            Start
          </Button>
        </Banner>
      );
    case "done":
      return (
        <Banner tone="done" icon={CircleCheckIcon} title="Done">
          {ticket.prUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={ticket.prUrl} target="_blank" rel="noreferrer noopener">
                <GitPullRequestIcon data-icon="inline-start" />
                Pull request
              </a>
            </Button>
          ) : null}
        </Banner>
      );
    case "cancelled":
      return <Banner tone="quiet" icon={XCircleIcon} title="Cancelled" />;
    default:
      return null;
  }
}
