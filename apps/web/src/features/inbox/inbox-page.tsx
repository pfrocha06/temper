import { useQuery } from "@tanstack/react-query";
import { InboxIcon } from "lucide-react";
import { useMemo } from "react";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { approvalsQuery, ticketsQuery } from "@/lib/queries";
import { ApprovalItem } from "./approval-item";

export function InboxPage() {
  const approvals = useQuery(approvalsQuery);
  const tickets = useQuery(ticketsQuery(undefined));
  const ticketById = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t])), [tickets.data]);
  const count = approvals.data?.length ?? 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Inbox"
        description={count === 0 ? "What the factory may not decide alone." : `${count} decision${count === 1 ? "" : "s"} waiting for the board, oldest first.`}
      />
      {approvals.isError ? (
        <div className="p-6">
          <QueryError error={approvals.error} what="approvals" onRetry={() => void approvals.refetch()} />
        </div>
      ) : approvals.isPending ? (
        <div className="p-6">
          <RowsSkeleton />
        </div>
      ) : count === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing needs the board</EmptyTitle>
            <EmptyDescription>Merges, escalations, decisions and Verifier changes appear here when they need your call.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        approvals.data.map((a) => <ApprovalItem key={a.id} approval={a} ticket={a.ticketId ? ticketById.get(a.ticketId) : undefined} />)
      )}
    </div>
  );
}
