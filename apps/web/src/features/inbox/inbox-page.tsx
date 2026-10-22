import { useQuery } from "@tanstack/react-query";
import { InboxIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { approvalsQuery } from "@/lib/queries";
import { ApprovalItem } from "./approval-item";
import { NoticeItem } from "./notice-item";
import { ProposalCard } from "./proposal-card";
import { hotkeyOption, useResolve } from "./approval-buttons";

export function InboxPage() {
  const approvals = useQuery(approvalsQuery);
  const list = approvals.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; option: string } | null>(null);
  const resolve = useResolve();
  const notices = list.filter((a) => a.kind === "notice").length;
  const decisions = list.length - notices;
  const index = Math.max(
    0,
    list.findIndex((a) => a.id === selectedId),
  );
  const selected = list[index];

  const move = (delta: number) => {
    const next = list[Math.min(list.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    setSelectedId(next.id);
    document.getElementById(`apv-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    a: () => {
      const option = selected && hotkeyOption(selected.options, "a");
      if (selected && option) resolve.mutate({ approval: selected, resolution: option });
    },
    r: () => {
      const option = selected && hotkeyOption(selected.options, "r");
      // Declining a proposal changes nothing, so it needs no confirmation.
      if (!selected || !option) return;
      if (selected.kind === "proposal") resolve.mutate({ approval: selected, resolution: option });
      else setConfirming({ id: selected.id, option });
    },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Inbox"
        info="Decisions the factory may not make alone: merges, escalations, decisions and Verifier changes, the Chief of Staff's proposals, plus notices to read and dismiss. Oldest first."
        meta={
          list.length > 0 ? (
            <>
              {decisions > 0 ? <span className="font-medium text-board tabular-nums">{decisions} waiting</span> : null}
              {notices > 0 ? (
                <span className="tabular-nums">
                  {notices} notice{notices === 1 ? "" : "s"}
                </span>
              ) : null}
              <span className="flex items-center gap-1 text-xs max-md:hidden">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> move, <Kbd>A</Kbd> approve, <Kbd>R</Kbd> reject
              </span>
            </>
          ) : null
        }
      />
      {approvals.isError ? (
        <div className="p-6">
          <QueryError error={approvals.error} what="approvals" onRetry={() => void approvals.refetch()} />
        </div>
      ) : approvals.isPending ? (
        <div className="p-6">
          <RowsSkeleton />
        </div>
      ) : list.length === 0 ? (
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
        <ol className="flex max-w-6xl flex-col gap-3 p-3 md:p-6">
          {list.map((a) => (
            <li key={a.id}>
              {a.kind === "proposal" ? (
                <ProposalCard proposal={a} context="inbox" selected={a.id === selected?.id} onSelect={() => setSelectedId(a.id)} />
              ) : a.kind === "notice" ? (
                <NoticeItem approval={a} selected={a.id === selected?.id} onSelect={() => setSelectedId(a.id)} />
              ) : (
                <ApprovalItem
                  approval={a}
                  selected={a.id === selected?.id}
                  onSelect={() => setSelectedId(a.id)}
                  confirming={confirming?.id === a.id ? confirming.option : null}
                  setConfirming={(option) => setConfirming(option ? { id: a.id, option } : null)}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
