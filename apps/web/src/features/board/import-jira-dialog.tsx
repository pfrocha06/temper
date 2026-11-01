import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useProject } from "@/hooks/use-project";
import { jiraImportBody, summarizeJiraImport, type JiraImportResult } from "@/lib/jira-import";
import { useImportJira } from "@/lib/queries";

/** Pulls Jira issues in as tickets. The server holds the token and answers 400 when `trackers.jira` is missing. */
export function ImportJiraDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { projects, project } = useProject();
  const importJira = useImportJira();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<JiraImportResult[] | null>(null);

  const chosen = projectId ?? project?.id;
  const pending = importJira.isPending;
  const notConfigured = error !== null && /not configured/i.test(error);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = chosen ? jiraImportBody(chosen, query, start) : null;
    if (!body) return setError(chosen ? "Enter an issue key (ABC-123) or a JQL query." : "Choose a project first.");
    setError(null);
    setResults(null);
    importJira
      .mutateAsync(body)
      .then((r) => setResults(r.results))
      .catch((err: Error) => setError(err.message));
  };

  const summary = results ? summarizeJiraImport(results) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Import from Jira</DialogTitle>
            <DialogDescription>Turn Jira issues into tickets on the board. Each ticket links back to its issue.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ij-project">Project</FieldLabel>
              <Select value={chosen ?? ""} onValueChange={setProjectId} disabled={pending}>
                <SelectTrigger id="ij-project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ij-query">Issue key or JQL</FieldLabel>
              <Input id="ij-query" value={query} onChange={(e) => setQuery(e.target.value)} disabled={pending} autoComplete="off" placeholder="ABC-123, or project = ABC AND status = Open" />
              <FieldDescription>Issues that already have an open ticket are skipped.</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id="ij-start" checked={start} onCheckedChange={setStart} disabled={pending} />
              <FieldLabel htmlFor="ij-start">Start the tickets as soon as they are created</FieldLabel>
            </Field>
            {error && !notConfigured ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          {notConfigured ? (
            <Alert variant="destructive">
              <AlertTitle>Jira is not configured</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {summary ? (
            <Alert role="status">
              <AlertTitle>{summary.headline}</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {summary.created.map((r) => (
                    <li key={r.key}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                        {r.key}
                      </a>
                      : created{" "}
                      {r.ticketIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 ? ", " : ""}
                          <Link to={`/tickets/${id}`} onClick={() => onOpenChange(false)} className="underline underline-offset-2">
                            {id}
                          </Link>
                        </span>
                      ))}
                    </li>
                  ))}
                  {summary.skipped.map((r) => (
                    <li key={r.key}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                        {r.key}
                      </a>
                      : already linked
                      {r.existingTicketId ? (
                        <>
                          {" "}
                          to{" "}
                          <Link to={`/tickets/${r.existingTicketId}`} onClick={() => onOpenChange(false)} className="underline underline-offset-2">
                            {r.existingTicketId}
                          </Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {summary ? "Done" : "Cancel"}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
