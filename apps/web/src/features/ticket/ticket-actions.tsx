import { BugIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useCancelTicket, useReportEscape } from "@/lib/queries";
import type { Ticket } from "@/lib/types";

export function CancelTicketButton({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  const finished = ticket.status === "done" || ticket.status === "cancelled";
  return (
    <>
      <Button variant="outline" size="sm" disabled={finished} onClick={() => setOpen(true)}>
        <XIcon data-icon="inline-start" />
        Cancel ticket
      </Button>
      <CancelTicketDialog ticket={open ? ticket : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** Confirms a cancel; there is no undo. Open it by passing a ticket. */
export function CancelTicketDialog({ ticket, onClose }: { ticket: Ticket | null; onClose: () => void }) {
  const cancel = useCancelTicket();
  return (
    <AlertDialog open={ticket !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel “{ticket?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>Running dispatches are stopped and the worktree is removed. A cancelled ticket cannot be restarted.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep ticket</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              ticket &&
              cancel.mutate(ticket.id, {
                onSuccess: () => toast.success("Ticket cancelled"),
                onError: (e) => toast.error(`Could not cancel: ${e.message}`),
              })
            }
          >
            Cancel ticket
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** An escaped bug heats the factory and opens a ready bugfix ticket with the same file scope. */
export function ReportEscapeButton({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = useReportEscape();
  const navigate = useNavigate();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const description = String(new FormData(e.currentTarget).get("description") ?? "").trim();
    if (!description) return setError("Describe what went wrong.");
    setError(null);
    report.mutate(
      { id: ticket.id, description },
      {
        onSuccess: (bugfix) => {
          setOpen(false);
          toast.success("Escaped bug reported; a bugfix ticket is ready", {
            action: { label: "Open", onClick: () => navigate(`/tickets/${bugfix.id}`) },
          });
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BugIcon data-icon="inline-start" />
          Report escaped bug
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Report escaped bug</DialogTitle>
            <DialogDescription>A bug that got past verification raises the temperature and opens a bugfix ticket scoped to the same files.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="esc-desc">What happens</FieldLabel>
            <Textarea id="esc-desc" name="description" rows={5} autoFocus aria-invalid={error ? true : undefined} />
            <FieldDescription>Steps to reproduce and what you expected. This becomes the bugfix ticket's spec.</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={report.isPending}>
              {report.isPending ? <Spinner data-icon="inline-start" /> : null}
              Report bug
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
