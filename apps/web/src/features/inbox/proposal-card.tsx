import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, CheckIcon, MessageSquareIcon, RocketIcon, XIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { RoleAvatar } from "@/components/role";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { humanize, relativeTime } from "@/lib/format";
import { proposalAction, proposalOutcome, proposalTargetTitle, repoName } from "@/lib/proposals";
import { approvalsQuery } from "@/lib/queries";
import type { Approval } from "@/lib/types";
import { useResolve } from "./approval-buttons";

type Props = {
  proposal: Approval;
  /** In the Inbox: a link back to the conversation it came from. In a chat: no link, tighter. */
  context: "inbox" | "chat";
  selected?: boolean;
  onSelect?: () => void;
};

/**
 * A Chief of Staff proposal: why, what Confirm does, and Confirm / Decline. The board decides;
 * the Chief cannot act on its own proposal.
 */
export function ProposalCard({ proposal, context, selected = false, onSelect }: Props) {
  const resolve = useResolve();
  const approvals = useQuery(approvalsQuery);
  const action = proposalAction(proposal);
  const outcome = proposalOutcome(proposal);
  const target = action.action === "resolve_approval" ? approvals.data?.find((a) => a.id === action.approvalId) : undefined;
  const targetTitle = target?.title ?? proposalTargetTitle(proposal.title);
  const choice = resolve.isPending ? resolve.variables?.resolution : undefined;
  const act = (resolution: string) => resolve.mutate({ approval: proposal, resolution });
  const headingId = `apv-h-${proposal.id}`;

  return (
    <article
      id={context === "inbox" ? `apv-${proposal.id}` : `prop-${proposal.id}`}
      aria-labelledby={headingId}
      aria-current={selected ? "true" : undefined}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-role-chief/30 bg-card p-4",
        context === "inbox" && "md:p-5",
        selected && "ring-1 ring-ring/40",
        outcome !== "pending" && "border-border bg-muted/30",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <RoleAvatar role="chief" size="xs" tooltip={false} />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-role-chief">The Chief of Staff proposes…</span>{" "}
          <time dateTime={proposal.createdAt} title={proposal.createdAt}>
            {relativeTime(proposal.createdAt)}
          </time>
        </p>
        {context === "inbox" && proposal.chatId ? (
          <Link to={`/chief/${proposal.chatId}`} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
            <MessageSquareIcon aria-hidden className="size-3.5" />
            Conversation
          </Link>
        ) : null}
      </header>

      <h2 id={headingId} className="text-base leading-snug font-semibold text-balance">
        {action.action === "resolve_approval" ? (
          <>
            {humanize(action.resolution)} {targetTitle ? <>“{targetTitle}”</> : <span className="font-mono text-sm">{action.approvalId}</span>}
          </>
        ) : action.action === "deploy" ? (
          <>
            Deploy <span className="font-mono text-sm">{action.ref}</span> from {repoName(action.source)}
          </>
        ) : (
          proposal.title
        )}
      </h2>

      {proposal.body ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Why</p>
          <Markdown className="text-[0.8125rem]">{proposal.body}</Markdown>
        </div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
        <p className="text-xs font-medium text-muted-foreground">On Confirm</p>
        {action.action === "resolve_approval" ? (
          <p>
            Temper resolves{" "}
            {target ? (
              <Link to={target.ticketId ? `/tickets/${target.ticketId}` : `/inbox#apv-${target.id}`} className="font-medium underline-offset-2 hover:underline">
                {target.title}
                <ArrowUpRightIcon aria-hidden className="ml-0.5 inline size-3.5 align-[-2px]" />
              </Link>
            ) : (
              <>
                {targetTitle ? <span className="font-medium">{targetTitle}</span> : <>approval <span className="font-mono text-xs">{action.approvalId}</span></>}
                {outcome === "pending" && approvals.data ? <span className="text-muted-foreground"> (no longer waiting)</span> : null}
              </>
            )}{" "}
            with <span className="font-mono text-xs font-medium">{action.resolution}</span>, as if you had chosen it.
          </p>
        ) : action.action === "deploy" ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <RocketIcon aria-hidden className="size-3.5 self-center text-muted-foreground" />
            Temper builds <span className="font-mono text-xs font-medium">{action.ref}</span> from
            <span className="font-mono text-xs break-all">{action.source}</span>
            and deploys it as the new release.
          </p>
        ) : (
          <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(action.raw, null, 2)}</pre>
        )}
      </div>

      {outcome === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={resolve.isPending} onClick={() => act("confirm")}>
            {choice === "confirm" ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            Confirm
          </Button>
          <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => act("decline")}>
            {choice === "decline" ? <Spinner data-icon="inline-start" /> : <XIcon data-icon="inline-start" />}
            Decline
          </Button>
        </div>
      ) : (
        <p className={cn("flex items-center gap-1.5 text-sm font-medium", outcome === "confirmed" ? "text-pass" : "text-muted-foreground")}>
          {outcome === "confirmed" ? <CheckIcon aria-hidden className="size-4" /> : <XIcon aria-hidden className="size-4" />}
          {outcome === "confirmed" ? "Confirmed" : outcome === "declined" ? "Declined" : humanize(proposal.resolution ?? proposal.status)}
          {proposal.resolvedAt ? <span className="font-normal text-muted-foreground">{relativeTime(proposal.resolvedAt)}</span> : null}
        </p>
      )}
    </article>
  );
}
