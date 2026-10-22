import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { TicketTypeBadge } from "@/components/badges";
import { Markdown } from "@/components/markdown";
import { QueryError, RowsSkeleton } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/constants";
import { ticketQuery } from "@/lib/queries";
import type { Ticket, TicketStatus } from "@/lib/types";
import { ArtifactTabs } from "./artifact-tabs";
import { StageTimeline } from "./stage-timeline";
import { CancelTicketButton, ReportEscapeButton } from "./ticket-actions";

export function TicketPage() {
  const { id = "" } = useParams();
  const detail = useQuery(ticketQuery(id));

  if (detail.isError) {
    return (
      <div className="p-6">
        <BackToBoard />
        {detail.error instanceof ApiError && detail.error.status === 404 ? (
          <p className="mt-4 text-sm">
            There is no ticket <code className="font-mono">{id}</code>. It may belong to another Temper instance.
          </p>
        ) : (
          <div className="mt-4">
            <QueryError error={detail.error} what="this ticket" onRetry={() => void detail.refetch()} />
          </div>
        )}
      </div>
    );
  }
  if (detail.isPending) {
    return (
      <div className="p-6">
        <RowsSkeleton rows={6} />
      </div>
    );
  }

  const { ticket, dispatches, artifacts } = detail.data;
  return (
    <article className="flex flex-col">
      <TicketHeader ticket={ticket} />
      <div className="grid gap-x-8 gap-y-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {ticket.spec ? (
            <section aria-labelledby="spec-h">
              <h2 id="spec-h" className="mb-2 text-sm font-semibold">
                Spec
              </h2>
              <Markdown>{ticket.spec}</Markdown>
            </section>
          ) : null}
          <section aria-labelledby="artifacts-h">
            <h2 id="artifacts-h" className="mb-2 text-sm font-semibold">
              Artifacts
            </h2>
            <ArtifactTabs artifacts={artifacts} />
          </section>
        </div>
        <aside className="flex flex-col gap-6">
          <section aria-labelledby="stages-h">
            <h2 id="stages-h" className="mb-3 text-sm font-semibold">
              Stages
            </h2>
            <StageTimeline dispatches={dispatches} />
          </section>
          <section aria-labelledby="ac-h">
            <h2 id="ac-h" className="mb-2 text-sm font-semibold">
              Acceptance criteria
            </h2>
            {ticket.acceptanceCriteria.length === 0 ? (
              <p className="text-sm text-muted-foreground">None. The Verifier has nothing to hold this ticket to.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {ticket.acceptanceCriteria.map((ac) => (
                  <li key={ac.id} className="grid grid-cols-[3.25rem_1fr] gap-2">
                    <span className="font-mono text-xs leading-5 text-muted-foreground">{ac.id}</span>
                    <span>{ac.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="scope-h">
            <h2 id="scope-h" className="mb-2 text-sm font-semibold">
              File scope
            </h2>
            {ticket.fileScope.length === 0 ? (
              <p className="text-sm text-muted-foreground">Unscoped: this ticket may touch any file.</p>
            ) : (
              <ul className="flex flex-col gap-1 font-mono text-xs">
                {ticket.fileScope.map((p) => (
                  <li key={p} className="break-all">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {ticket.dependsOn.length > 0 ? (
            <section aria-labelledby="deps-h">
              <h2 id="deps-h" className="mb-2 text-sm font-semibold">
                Depends on
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {ticket.dependsOn.map((d) => (
                  <li key={d}>
                    <Link to={`/tickets/${d}`} className="font-mono text-xs text-primary hover:underline">
                      {d}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function BackToBoard() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2 self-start">
      <Link to="/board">
        <ArrowLeftIcon data-icon="inline-start" />
        Board
      </Link>
    </Button>
  );
}

function TicketHeader({ ticket }: { ticket: Ticket }) {
  return (
    <header className="flex flex-col gap-2 border-b px-6 pt-3 pb-4">
      <BackToBoard />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-lg leading-snug font-semibold tracking-tight">{ticket.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <TicketTypeBadge type={ticket.type} />
            <Badge variant="outline">{STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}</Badge>
            {ticket.stage ? <span className="text-muted-foreground">at stage {ticket.stage}</span> : null}
            {ticket.prUrl ? (
              <a href={ticket.prUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                Pull request
                <ExternalLinkIcon aria-hidden className="size-3.5" />
              </a>
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <ReportEscapeButton ticket={ticket} />
          <CancelTicketButton ticket={ticket} />
        </div>
      </div>
    </header>
  );
}
