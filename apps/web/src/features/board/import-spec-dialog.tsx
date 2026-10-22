import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useImportSpec } from "@/lib/queries";

/**
 * The Chief of Staff turns a spec into tickets. That is a full agent run, so the
 * request can take minutes; the dialog can be closed and the result arrives as a toast.
 */
export function ImportSpecDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const importSpec = useImportSpec();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(importSpec.isPending);

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMarkdown(await file.text());
    if (!title) setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ""));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !markdown.trim()) return setError("A spec needs a title and some markdown.");
    setError(null);
    importSpec
      .mutateAsync({ projectId, title: title.trim(), markdown, autoStart })
      .then((tickets) => {
        toast.success(`Chief of Staff wrote ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} from “${title.trim()}”`);
        setTitle("");
        setMarkdown("");
        onOpenChange(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        toast.error(`Spec import failed: ${err.message}`);
      });
  };

  const pending = importSpec.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Import spec</DialogTitle>
            <DialogDescription>The Chief of Staff reads the spec and splits it into tickets on the board.</DialogDescription>
          </DialogHeader>
          {pending ? (
            <Alert>
              <Spinner />
              <AlertTitle>Chief of Staff at work for {elapsed}</AlertTitle>
              <AlertDescription>This usually takes a few minutes. You can close this dialog; a notification appears when the tickets are ready.</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="is-title">Title</FieldLabel>
              <Input id="is-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="is-md">Spec (markdown)</FieldLabel>
              <Textarea
                id="is-md"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                rows={12}
                disabled={pending}
                className="max-h-[50vh] font-mono text-xs"
              />
              <FieldDescription>
                Paste it, or{" "}
                <label className="cursor-pointer text-primary underline underline-offset-2 has-focus-visible:outline-2">
                  load a file
                  <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only" onChange={loadFile} disabled={pending} />
                </label>
                .
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id="is-start" checked={autoStart} onCheckedChange={setAutoStart} disabled={pending} />
              <FieldLabel htmlFor="is-start">Start the tickets as soon as they are written</FieldLabel>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {pending ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Planning…" : "Import spec"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useElapsed(running: boolean): string {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return setStart(null);
    const t0 = Date.now();
    setStart(t0);
    setNow(t0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const s = start === null ? 0 : Math.floor((now - start) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
