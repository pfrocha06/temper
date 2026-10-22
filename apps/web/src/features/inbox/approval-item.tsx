import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, FileDiffIcon, GitPullRequestIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { ApprovalKindBadge } from "@/components/badges";
import { AcChips, GateChips, RegressionCount } from "@/components/evidence";
import { Markdown } from "@/components/markdown";
import { Pipeline } from "@/components/pipeline";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/format";
import { acceptanceStatus, latestArtifact, parseGates } from "@/lib/gates";
import { derivePipeline } from "@/lib/pipeline";
import { ticketQuery } from "@/lib/queries";
import type { Approval } from "@/lib/types";
import { ApprovalButtons } from "./approval-buttons";

const URL_RE = /https?:\/\/\S+/;

/** Body text without the PR URL it opens with: the URL gets its own button. */
function bodyWithoutUrl(body: string, url: string | undefined): string {
  return url ? body.replace(url, "").trim() : body;
}

type Props = {
  approval: Approval;
  selected: boolean;
  onSelect: () => void;
  confirming: string | null;
  setConfirming: (o: string | null) => void;
};

/** One decision for the board, with the evidence needed to make it inline. */
export function ApprovalItem({ approval, selected, onSelect, confirming, setConfirming }: Props) {
  const detail = useQuery({ ...ticketQuery(approval.ticketId ?? ""), enabled: Boolean(approval.ticketId) });
  const [note, setNote] = useState("");
  const [showBody, setShowBody] = useState(false);
  const evidence = useMemo(() => {
    if (!detail.data) return undefined;
    const { ticket, dispatches, artifacts } = detail.data;
    const gates = latestArtifact(artifacts, "gates.md");
    return { ticket, nodes: derivePipeline(ticket, dispatches), ac: acceptanceStatus(ticket, artifacts), gates: gates ? parseGates(gates.content) : undefined };
  }, [detail.data]);
  const prUrl = evidence?.ticket.prUrl ?? URL_RE.exec(approval.body)?.[0];
  const body = bodyWithoutUrl(approval.body, prUrl);
  const noteId = `note-${approval.id}`;

  return (
    <article
      id={`apv-${approval.id}`}
      aria-labelledby={`apv-h-${approval.id}`}
      aria-current={selected ? "true" : undefined}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
      className={cn(
        "grid gap-x-6 gap-y-4 rounded-xl border bg-card p-4 transition-shadow md:grid-cols-[minmax(0,1fr)_17rem] md:p-5",
        selected ? "border-ring/60 shadow-md ring-1 ring-ring/40" : "opacity-90 hover:opacity-100",
      )}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ApprovalKindBadge kind={approval.kind} />
            {evidence ? <span className="rounded-sm bg-secondary px-1.5 py-px text-secondary-foreground">{evidence.ticket.type}</span> : null}
            <time dateTime={approval.createdAt} title={approval.createdAt}>
              waiting {relativeTime(approval.createdAt).replace(/ ago$/, "")}
            </time>
          </div>
          <h2 id={`apv-h-${approval.id}`} className="text-base leading-snug font-semibold text-balance">
            {evidence?.ticket.title ?? approval.title}
          </h2>
        </header>

        {approval.ticketId && !evidence ? (
          <Skeleton className="h-16 w-full" />
        ) : evidence ? (
          <>
            <Pipeline nodes={evidence.nodes} className="max-w-xl" />
            <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              {evidence.ac.items.length > 0 ? (
                <>
                  <dt className="pt-0.5 text-xs text-muted-foreground">
                    Criteria{" "}
                    <span className={cn("tabular-nums", evidence.ac.failed ? "text-fail" : evidence.ac.passed === evidence.ac.items.length && "text-pass")}>
                      {evidence.ac.passed}/{evidence.ac.items.length}
                    </span>
                  </dt>
                  <dd className="flex flex-col gap-1.5">
                    <AcChips summary={evidence.ac} />
                    <RegressionCount summary={evidence.ac} />
                  </dd>
                </>
              ) : null}
              {evidence.gates ? (
                <>
                  <dt className="pt-0.5 text-xs text-muted-foreground">Gates</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <GateChips checks={evidence.gates.checks} />
                    {evidence.gates.filesChanged !== undefined ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileDiffIcon aria-hidden className="size-3.5" />
                        {evidence.gates.filesChanged} files changed
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </>
        ) : null}

        {body ? (
          <div className="flex flex-col items-start gap-1">
            <div className={cn("relative w-full overflow-hidden rounded-md bg-muted/40 px-3 py-2", !showBody && body.length > 280 && "max-h-24")}>
              <Markdown className="text-[0.8125rem]">{body}</Markdown>
            </div>
            {body.length > 280 ? (
              <Button variant="link" size="xs" className="px-0" onClick={() => setShowBody((s) => !s)} aria-expanded={showBody}>
                {showBody ? "Show less" : "Show all"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 md:border-l md:pl-6">
        <div className="flex flex-wrap gap-2">
          {prUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={prUrl} target="_blank" rel="noreferrer noopener">
                <GitPullRequestIcon data-icon="inline-start" />
                Review PR
              </a>
            </Button>
          ) : null}
          {approval.ticketId ? (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/tickets/${approval.ticketId}`}>
                Ticket
                <ArrowUpRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
        </div>
        <Input
          id={noteId}
          aria-label="Note for the record (optional)"
          placeholder="Note for the record (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
        />
        <ApprovalButtons approval={approval} note={note} confirming={confirming} setConfirming={setConfirming} showKeys={selected} />
      </div>
    </article>
  );
}
