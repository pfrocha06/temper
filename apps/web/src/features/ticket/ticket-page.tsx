import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, GitBranchIcon, GitPullRequestIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { cn } from "cn";
import { AcChecklist, RegressionCount } from "@/components/evidence";
import { Markdown } from "@/components/markdown";
import { Pipeline } from "@/components/pipeline";
import { QueryError, RowsSkeleton } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { acceptanceStatus } from "@/lib/gates";
import { derivePipeline, focusNode } from "@/lib/pipeline";
import { ticketQuery } from "@/lib/queries";
import type { Ticket, TicketStatus } from "@/lib/types";
import { ArtifactTabs } from "./artifact-tabs";
import { NextAction } from "./next-action";
import { StagePanel } from "./stage-panel";
import { CancelTicketButton, ReportEscapeButton } from "./ticket-actions";

export function TicketPage() {
  const { id = "" } = useParams();
  const detail = useQuery(ticketQuery(id));
  const [selected, setSelected] = useState<string | null>(null);
  const data = detail.data;
  const nodes = useMemo(() => (data ? derivePipeline(data.ticket, data.dispatches) : []), [data]);
  const ac = useMemo(() => (data ? acceptanceStatus(data.ticket, data.artifacts) : undefined), [data]);

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
  if (!data || !ac) {
    return (
      <div className="p-6">
        <RowsSkeleton rows={6} />
      </div>
    );
  }

  const { ticket, artifacts } = data;
  const focus = focusNode(nodes);
  const shown = nodes.find((n) => n.stage === selected) ?? focus;

  return (
    <article className="flex flex-col">
      <TicketHeader ticket={ticket} />
      <div className="flex flex-col gap-5 px-4 py-5 md:px-6">
        <NextAction ticket={ticket} focus={focus} />
        <div className="overflow-x-auto pb-1">
          <Pipeline nodes={nodes} size="lg" selected={shown?.stage} onSelect={setSelected} className="max-w-4xl min-w-[20rem]" />
        </div>
        {shown ? <StagePanel key={shown.stage} node={shown} /> : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <section aria-labelledby="ac-h" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="ac-h" className="text-sm font-semibold">
                  Acceptance criteria
                </h2>
                {ac.items.length > 0 ? (
                  <span className={cn("text-sm tabular-nums", ac.failed ? "text-fail" : ac.passed === ac.items.length ? "text-pass" : "text-muted-foreground")}>
                    {ac.passed}/{ac.items.length} pass
                  </span>
                ) : null}
                <RegressionCount summary={ac} />
                {ac.at ? <span className="text-xs text-muted-foreground">holdouts ran {relativeTime(ac.at)}</span> : null}
              </div>
              <AcChecklist summary={ac} />
            </section>
            {ticket.spec ? <SpecBlock spec={ticket.spec} /> : null}
            <section aria-labelledby="artifacts-h" className="flex flex-col gap-2">
              <h2 id="artifacts-h" className="text-sm font-semibold">
                Artifacts
              </h2>
              <ArtifactTabs artifacts={artifacts} />
            </section>
          </div>
          <aside className="flex flex-col gap-6">
            <section aria-labelledby="scope-h">
              <h2 id="scope-h" className="mb-2 text-sm font-semibold">
                File scope
              </h2>
              {ticket.fileScope.length === 0 ? (
                <p className="text-sm text-muted-foreground">Unscoped: this ticket may touch any file.</p>
              ) : (
                <ul className="flex flex-col gap-1 font-mono text-xs">
                  {ticket.fileScope.map((p) => (
                    <li key={p} className="rounded-sm bg-muted/60 px-1.5 py-0.5 break-all">
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
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Id</dt>
              <dd className="font-mono">{ticket.id}</dd>
              {ticket.branch ? (
                <>
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd className="flex items-center gap-1 font-mono break-all">
                    <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                    {ticket.branch}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Created</dt>
              <dd>{relativeTime(ticket.createdAt)}</dd>
            </dl>
          </aside>
        </div>
      </div>
    </article>
  );
}

function SpecBlock({ spec }: { spec: string }) {
  const [open, setOpen] = useState(false);
  const long = spec.length > 360;
  return (
    <section aria-labelledby="spec-h" className="flex flex-col items-start gap-1">
      <h2 id="spec-h" className="text-sm font-semibold">
        Spec
      </h2>
      <div
        id="spec-body"
        className={cn(
          "relative w-full overflow-hidden",
          long &&
            !open &&
            "max-h-28 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-10 after:bg-gradient-to-t after:from-background",
        )}
      >
        <Markdown>{spec}</Markdown>
      </div>
      {long ? (
        <Button variant="link" size="xs" className="px-0" aria-expanded={open} aria-controls="spec-body" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </section>
  );
}

function BackToBoard() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2 self-start text-muted-foreground">
      <Link to="/board">
        <ArrowLeftIcon data-icon="inline-start" />
        Board
      </Link>
    </Button>
  );
}

function TicketHeader({ ticket }: { ticket: Ticket }) {
  return (
    <header className="flex flex-col gap-1 border-b px-4 pt-2 pb-3 md:px-6">
      <BackToBoard />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-lg leading-snug font-semibold tracking-tight text-balance">{ticket.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{ticket.type}</Badge>
            <Badge variant="outline">{STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}</Badge>
            {ticket.prUrl ? (
              <Badge variant="outline" asChild>
                <a href={ticket.prUrl} target="_blank" rel="noreferrer noopener">
                  <GitPullRequestIcon data-icon="inline-start" />
                  {ticket.prUrl.replace(/^https?:\/\/[^/]+\//, "").replace("/pull/", "#")}
                </a>
              </Badge>
            ) : null}
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
