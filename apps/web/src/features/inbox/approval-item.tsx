import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ApprovalKindBadge } from "@/components/badges";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { humanize, relativeTime } from "@/lib/format";
import { useResolveApproval } from "@/lib/queries";
import type { Approval, Ticket } from "@/lib/types";

const POSITIVE = new Set(["approve", "accept", "merge", "deploy", "promote"]);
const NEGATIVE = new Set(["reject", "cancel", "revert"]);

export function optionVariant(option: string): "default" | "outline" | "destructive" {
  if (POSITIVE.has(option)) return "default";
  if (NEGATIVE.has(option)) return "destructive";
  return "outline";
}

export function ApprovalItem({ approval, ticket }: { approval: Approval; ticket: Ticket | undefined }) {
  const resolve = useResolveApproval();
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const noteId = `note-${approval.id}`;

  const act = (resolution: string) => {
    setChoice(resolution);
    resolve.mutate(
      { id: approval.id, resolution, note: note.trim() || undefined },
      {
        onSuccess: () => toast.success(`${humanize(resolution)}: ${approval.title}`),
        onError: (e) => toast.error(`Could not ${resolution}: ${e.message}`),
      },
    );
  };

  return (
    <article aria-labelledby={`apv-${approval.id}`} className="flex flex-col gap-3 border-b px-6 py-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ApprovalKindBadge kind={approval.kind} />
        <h2 id={`apv-${approval.id}`} className="text-sm font-semibold">
          {approval.title}
        </h2>
        <time dateTime={approval.createdAt} title={approval.createdAt} className="ml-auto text-xs text-muted-foreground">
          {relativeTime(approval.createdAt)}
        </time>
      </header>
      {approval.ticketId ? (
        <p className="text-sm">
          Ticket{" "}
          <Link to={`/tickets/${approval.ticketId}`} className="text-primary hover:underline">
            {ticket?.title ?? approval.ticketId}
          </Link>
        </p>
      ) : null}
      {approval.body ? (
        <div className="max-h-80 overflow-y-auto rounded-md border bg-card p-3">
          <Markdown>{approval.body}</Markdown>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-56 flex-1">
          <FieldLabel htmlFor={noteId} className="text-xs text-muted-foreground">
            Note for the record (optional)
          </FieldLabel>
          <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {approval.options.map((option) => (
            <Button key={option} size="sm" variant={optionVariant(option)} disabled={resolve.isPending} onClick={() => act(option)}>
              {resolve.isPending && choice === option ? <Spinner data-icon="inline-start" /> : null}
              {humanize(option)}
            </Button>
          ))}
        </div>
      </div>
    </article>
  );
}
