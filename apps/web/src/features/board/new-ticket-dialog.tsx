import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseLines } from "@/lib/board";
import { TICKET_TYPES } from "@/lib/constants";
import { useCreateTicket } from "@/lib/queries";
import type { TicketType } from "@/lib/types";

export function NewTicketDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateTicket();
  const navigate = useNavigate();
  const [type, setType] = useState<TicketType>("feature");
  const [startNow, setStartNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return setError("Give the ticket a title.");
    setError(null);
    create.mutate(
      {
        projectId,
        type,
        title,
        spec: String(form.get("spec") ?? ""),
        acceptanceCriteria: parseLines(String(form.get("criteria") ?? "")),
        fileScope: parseLines(String(form.get("scope") ?? "")),
        ready: startNow,
      },
      {
        onSuccess: (ticket) => {
          onOpenChange(false);
          setStartNow(false);
          toast.success(startNow ? "Ticket created and started" : "Ticket created in the backlog", {
            action: { label: "Open", onClick: () => navigate(`/tickets/${ticket.id}`) },
          });
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>The ticket type picks the workflow its stages run through.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid grid-cols-[10rem_1fr] gap-3">
              <Field>
                <FieldLabel htmlFor="nt-type">Type</FieldLabel>
                <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
                  <SelectTrigger id="nt-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TICKET_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={error && error.includes("title") ? true : undefined}>
                <FieldLabel htmlFor="nt-title">Title</FieldLabel>
                <Input id="nt-title" name="title" autoComplete="off" autoFocus required aria-invalid={error?.includes("title") || undefined} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="nt-spec">Spec</FieldLabel>
              <Textarea id="nt-spec" name="spec" rows={5} placeholder="What should change, and why. Markdown is fine." />
            </Field>
            <Field>
              <FieldLabel htmlFor="nt-criteria">Acceptance criteria</FieldLabel>
              <Textarea id="nt-criteria" name="criteria" rows={3} placeholder={"One per line, e.g.\nThe board shows a count of pending approvals"} />
              <FieldDescription>Numbered AC-1, AC-2… in order. The Verifier writes holdouts against these.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nt-scope">File scope</FieldLabel>
              <Textarea id="nt-scope" name="scope" rows={2} className="font-mono text-xs" placeholder={"apps/web/src/features/inbox/*"} />
              <FieldDescription>Paths or globs, one per line. Tickets with overlapping scopes do not run at the same time.</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id="nt-start" checked={startNow} onCheckedChange={setStartNow} />
              <FieldLabel htmlFor="nt-start">Start immediately</FieldLabel>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Create ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
