import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { post } from "@/lib/api";
import { humanize } from "@/lib/format";
import { forgetResolved, keys, rememberResolved } from "@/lib/queries";
import type { Approval, FactoryStatus } from "@/lib/types";

const POSITIVE = new Set(["approve", "accept", "merge", "deploy", "promote", "confirm"]);
const NEGATIVE = new Set(["reject", "cancel", "revert", "decline"]);

function optionVariant(option: string): "default" | "outline" | "destructive" {
  if (POSITIVE.has(option)) return "default";
  if (NEGATIVE.has(option)) return "destructive";
  return "outline";
}

/** The option a hotkey resolves to: `a` the first positive one, `r` the first negative one. */
export function hotkeyOption(options: string[], key: "a" | "r"): string | undefined {
  return options.find((o) => (key === "a" ? POSITIVE : NEGATIVE).has(o));
}

const CONSEQUENCE: Record<string, string> = {
  reject: "The PR is not merged and the ticket goes back to its workflow's failure path.",
  cancel: "The ticket is cancelled and its worktree removed. It cannot be restarted.",
  revert: "The change is reverted.",
};

/**
 * Resolves an approval optimistically: it leaves the inbox at once and comes back if the
 * server refuses. There is no undo, so negative options ask first.
 */
export function useResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approval, resolution, note }: { approval: Approval; resolution: string; note?: string }) =>
      post<Approval>(`/approvals/${encodeURIComponent(approval.id)}/resolve`, { resolution, note }),
    onMutate: async ({ approval, resolution }) => {
      await qc.cancelQueries({ queryKey: keys.approvals });
      if (approval.kind === "proposal") rememberResolved(qc, { ...approval, status: "resolved", resolution, resolvedAt: new Date().toISOString() });
      const before = qc.getQueryData<Approval[]>(keys.approvals);
      qc.setQueryData<Approval[]>(keys.approvals, (list) => list?.filter((a) => a.id !== approval.id));
      qc.setQueryData<FactoryStatus>(keys.status, (s) => (s ? { ...s, pendingApprovals: Math.max(0, s.pendingApprovals - 1) } : s));
      return { before };
    },
    onError: (e, { approval, resolution }, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.approvals, ctx.before);
      if (approval.kind === "proposal") forgetResolved(qc, approval.id);
      toast.error(`Could not ${resolution}: ${e.message}`);
    },
    onSuccess: (resolved, { approval, resolution }) => {
      // Pending approvals are all the list endpoint returns; keep resolved proposals for their conversation.
      if (resolved?.kind === "proposal") rememberResolved(qc, resolved);
      toast.success(`${humanize(resolution)}: ${approval.title}`);
    },
    onSettled: () => Promise.all([keys.approvals, keys.status, keys.tickets, ["ticket"]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

type Props = {
  approval: Approval;
  note?: string;
  /** Pending negative choice raised by a hotkey; the dialog confirms it. */
  confirming: string | null;
  setConfirming: (option: string | null) => void;
  showKeys?: boolean;
  size?: "sm" | "default";
};

export function ApprovalButtons({ approval, note, confirming, setConfirming, showKeys = false, size = "sm" }: Props) {
  const resolve = useResolve();
  const [choice, setChoice] = useState<string | null>(null);
  const act = (resolution: string) => {
    setChoice(resolution);
    resolve.mutate({ approval, resolution, note: note?.trim() || undefined });
  };
  const positiveKey = hotkeyOption(approval.options, "a");
  const negativeKey = hotkeyOption(approval.options, "r");
  // Primary first, destructive last.
  const ordered = approval.options.toSorted((a, b) => rank(a) - rank(b));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ordered.map((option) => (
          <Button
            key={option}
            size={size}
            variant={optionVariant(option)}
            disabled={resolve.isPending}
            onClick={() => (NEGATIVE.has(option) ? setConfirming(option) : act(option))}
          >
            {resolve.isPending && choice === option ? <Spinner data-icon="inline-start" /> : null}
            {humanize(option)}
            {showKeys && (option === positiveKey || option === negativeKey) ? (
              <Kbd className="ml-1 bg-transparent text-current opacity-70 max-md:hidden">{option === positiveKey ? "A" : "R"}</Kbd>
            ) : null}
          </Button>
        ))}
      </div>
      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {humanize(confirming ?? "")} “{approval.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {CONSEQUENCE[confirming ?? ""] ?? "This decision is recorded in the audit log."} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it pending</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => confirming && act(confirming)}>
              {humanize(confirming ?? "")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function rank(option: string): number {
  return POSITIVE.has(option) ? 0 : NEGATIVE.has(option) ? 2 : 1;
}
