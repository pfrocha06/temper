import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ExternalLinkIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { githubFiltersQuery, importIssue, intakeSourcesQuery, jiraFiltersQuery, keys, useIntakeSearch } from "@/lib/queries";
import type { IntakeCandidate, IntakeQuery, IntakeSourceId } from "@/lib/types";
import { blockedReason, effectiveSelection, progressSummary, selectable, type RowProgress } from "./import-issues-model";

const ANY = "__any__";
/** The default toggle "on" (muted) barely shows on dark; a picked filter has to read as picked. */
const ON = "data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground";

/**
 * Pick issues from GitHub or Jira and turn them into tickets. Fetching imports nothing; each
 * ticked issue then goes through the Chief one request at a time, so the dialog can be closed
 * and progress is kept until the next fetch.
 */
export function ImportIssuesDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const sources = useQuery({ ...intakeSourcesQuery(projectId), enabled: open });
  const [source, setSource] = useState<IntakeSourceId | null>(null);
  const available = (id: IntakeSourceId) => sources.data?.[id].available === true;
  const current: IntakeSourceId | null = source && available(source) ? source : available("github") ? "github" : available("jira") ? "jira" : null;

  // GitHub pickers.
  const [ghQuery, setGhQuery] = useState("");
  const [ghLabels, setGhLabels] = useState<string[]>([]);
  const [ghMilestone, setGhMilestone] = useState(ANY);
  const ghFilters = useQuery(githubFiltersQuery(projectId, open && current === "github"));

  // Jira pickers.
  const [jiraMode, setJiraMode] = useState<"pick" | "jql">("pick");
  const [jiraProject, setJiraProject] = useState("");
  const [jiraEpic, setJiraEpic] = useState(ANY);
  const [jiraText, setJiraText] = useState("");
  const [jiraDone, setJiraDone] = useState(false);
  const [jql, setJql] = useState("");
  const jiraFilters = useQuery(jiraFiltersQuery(jiraProject, open && current === "jira"));

  const search = useIntakeSearch();
  const [candidates, setCandidates] = useState<IntakeCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anyAuthor, setAnyAuthor] = useState(false);
  const [start, setStart] = useState(false);
  const [progress, setProgress] = useState<Map<string, RowProgress>>(new Map());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // A different project starts over.
  useEffect(() => {
    setCandidates(null);
    setSelected(new Set());
    setProgress(new Map());
    setJiraProject("");
    setJiraEpic(ANY);
  }, [projectId]);

  const query = (): IntakeQuery | string => {
    if (current === "github")
      return { projectId, source: "github", query: ghQuery.trim() || undefined, labels: ghLabels.length ? ghLabels : undefined, milestone: ghMilestone === ANY ? undefined : ghMilestone };
    if (current === "jira") {
      if (jiraMode === "jql") return jql.trim() ? { projectId, source: "jira", jql: jql.trim() } : "Write a JQL query.";
      if (!jiraProject) return "Pick a Jira project.";
      return { projectId, source: "jira", project: jiraProject, epic: jiraEpic === ANY ? undefined : jiraEpic, text: jiraText.trim() || undefined, includeDone: jiraDone };
    }
    return "No tracker is available for this project.";
  };

  const fetchIssues = (e: FormEvent) => {
    e.preventDefault();
    const q = query();
    if (typeof q === "string") return setError(q);
    setError(null);
    setProgress(new Map());
    search
      .mutateAsync(q)
      .then((list) => {
        setCandidates(list);
        // Nothing ticked: each import is a Chief run, so the board picks them on purpose.
        setSelected(new Set());
      })
      .catch((err: Error) => setError(err.message));
  };

  const ticked = useMemo(() => (candidates ? effectiveSelection(candidates, selected, anyAuthor) : []), [candidates, selected, anyAuthor]);
  const selectableRows = candidates?.filter((c) => selectable(c, anyAuthor)) ?? [];
  const allTicked = selectableRows.length > 0 && ticked.length === selectableRows.length;
  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const runImport = async () => {
    if (!current || !ticked.length) return;
    const keysToImport = [...ticked];
    cancelled.current = false;
    setImporting(true);
    setProgress(new Map(keysToImport.map((k) => [k, { state: "queued" } as RowProgress])));
    const set = (k: string, p: RowProgress) => setProgress((m) => new Map(m).set(k, p));
    let tickets = 0;
    let failed = 0;
    for (const key of keysToImport) {
      if (cancelled.current) break;
      set(key, { state: "importing", since: Date.now() });
      try {
        const result = await importIssue({ projectId, source: current, key, start, anyAuthor });
        tickets += result.ticketIds.length;
        set(key, { state: "done", result });
        void qc.invalidateQueries({ queryKey: keys.tickets });
      } catch (err) {
        failed++;
        set(key, { state: "failed", error: (err as Error).message });
      }
    }
    setImporting(false);
    if (cancelled.current) toast.info(`Import stopped: ${tickets} ticket${tickets === 1 ? "" : "s"} written`);
    else if (failed) toast.error(`${failed} issue${failed === 1 ? "" : "s"} failed to import; ${tickets} ticket${tickets === 1 ? "" : "s"} written`);
    else toast.success(`Chief of Staff wrote ${tickets} ticket${tickets === 1 ? "" : "s"} from ${keysToImport.length} issue${keysToImport.length === 1 ? "" : "s"}`);
  };

  const summary = progressSummary(progress);
  const busy = search.isPending || importing;
  const unavailable = sources.data && !current;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import issues</DialogTitle>
          <DialogDescription>Fetch issues from a tracker, tick the ones you want, and the Chief of Staff turns each into tickets on the board.</DialogDescription>
        </DialogHeader>

        <form onSubmit={fetchIssues} className="flex flex-col gap-4">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={current ?? ""}
            onValueChange={(v) => {
              if (!v) return;
              setSource(v as IntakeSourceId);
              setCandidates(null);
              setProgress(new Map());
            }}
            disabled={busy}
            aria-label="Tracker"
          >
            <ToggleGroupItem value="github" disabled={!available("github")} className={ON}>
              GitHub issues
            </ToggleGroupItem>
            <ToggleGroupItem value="jira" disabled={!available("jira")} className={ON}>
              Jira
            </ToggleGroupItem>
          </ToggleGroup>
          {sources.data && current && !available(current === "github" ? "jira" : "github") ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              {(() => {
                const other = sources.data[current === "github" ? "jira" : "github"];
                return other.available ? null : other.reason;
              })()}
            </p>
          ) : null}
          {unavailable ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>No tracker for this project</AlertTitle>
              <AlertDescription>
                {sources.data!.github.available ? null : <span className="block">{(sources.data!.github as { reason: string }).reason}</span>}
                {sources.data!.jira.available ? null : <span className="block">{(sources.data!.jira as { reason: string }).reason}</span>}
              </AlertDescription>
            </Alert>
          ) : null}

          {current === "github" ? (
            <FieldGroup className="gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <Field>
                  <FieldLabel htmlFor="ii-q">Search</FieldLabel>
                  <Input id="ii-q" value={ghQuery} onChange={(e) => setGhQuery(e.target.value)} placeholder="e.g. export in:title, author:pfrocha06, no:assignee" disabled={busy} autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ii-ms">Milestone</FieldLabel>
                  <Select value={ghMilestone} onValueChange={setGhMilestone} disabled={busy}>
                    <SelectTrigger id="ii-ms" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any milestone</SelectItem>
                      {ghFilters.data?.milestones.map((m) => (
                        <SelectItem key={m.number} value={m.title}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel>Labels</FieldLabel>
                {ghFilters.isPending ? (
                  <Spinner />
                ) : ghFilters.data?.labels.length ? (
                  <ToggleGroup type="multiple" variant="outline" size="sm" value={ghLabels} onValueChange={setGhLabels} disabled={busy} className="flex-wrap justify-start" spacing={1}>
                    {ghFilters.data.labels.map((l) => (
                      <ToggleGroupItem key={l.name} value={l.name} title={l.description || undefined} className={`gap-1.5 ${ON}`}>
                        <span className="size-2 rounded-full" style={{ backgroundColor: `#${l.color || "888888"}` }} aria-hidden />
                        {l.name}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <FieldDescription>{ghFilters.isError ? `Labels could not be loaded: ${ghFilters.error.message}` : "The repository has no labels."}</FieldDescription>
                )}
                <FieldDescription>Open issues only, in {sources.data?.github.available ? (sources.data.github as { repo: string }).repo : "the project's repository"}. Ticked labels must all match.</FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}

          {current === "jira" ? (
            <FieldGroup className="gap-3">
              <Tabs value={jiraMode} onValueChange={(v) => setJiraMode(v as "pick" | "jql")}>
                <TabsList>
                  <TabsTrigger value="pick">Pick</TabsTrigger>
                  <TabsTrigger value="jql">JQL</TabsTrigger>
                </TabsList>
              </Tabs>
              {jiraMode === "pick" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="ii-jp">Project</FieldLabel>
                      <Select
                        value={jiraProject}
                        onValueChange={(v) => {
                          setJiraProject(v);
                          setJiraEpic(ANY);
                        }}
                        disabled={busy}
                      >
                        <SelectTrigger id="ii-jp" className="w-full">
                          <SelectValue placeholder={jiraFilters.isPending ? "Loading projects…" : "Choose a project"} />
                        </SelectTrigger>
                        <SelectContent>
                          {jiraFilters.data?.projects.map((p) => (
                            <SelectItem key={p.key} value={p.key}>
                              <span className="font-mono">{p.key}</span>
                              {p.name !== p.key ? <span className="text-muted-foreground">{p.name}</span> : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ii-je">Epic</FieldLabel>
                      <Select value={jiraEpic} onValueChange={setJiraEpic} disabled={busy || !jiraProject}>
                        <SelectTrigger id="ii-je" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>Any epic</SelectItem>
                          {jiraFilters.data?.epics.map((e) => (
                            <SelectItem key={e.key} value={e.key}>
                              <span className="font-mono">{e.key}</span>
                              <span className="truncate text-muted-foreground">{e.summary}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                    <Field>
                      <FieldLabel htmlFor="ii-jt">Text</FieldLabel>
                      <Input id="ii-jt" value={jiraText} onChange={(e) => setJiraText(e.target.value)} placeholder="Words in the summary or description" disabled={busy} autoComplete="off" />
                    </Field>
                    <Field orientation="horizontal" className="pb-2">
                      <Switch id="ii-jd" checked={jiraDone} onCheckedChange={setJiraDone} disabled={busy} />
                      <FieldLabel htmlFor="ii-jd">Include done</FieldLabel>
                    </Field>
                  </div>
                  {jiraFilters.isError ? <FieldError>{jiraFilters.error.message}</FieldError> : null}
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="ii-jql">JQL</FieldLabel>
                  <Textarea
                    id="ii-jql"
                    value={jql}
                    onChange={(e) => setJql(e.target.value)}
                    rows={3}
                    disabled={busy}
                    className="font-mono text-xs"
                    placeholder={'project = ABC AND sprint in openSprints() AND assignee = currentUser() ORDER BY rank'}
                  />
                  <FieldDescription>Sent to Jira as typed. Jira rejects queries that are not bounded by a project, epic or similar.</FieldDescription>
                </Field>
              )}
            </FieldGroup>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" size="sm" disabled={busy || !current}>
              {search.isPending ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}
              Fetch issues
            </Button>
            {error ? <FieldError className="text-sm">{error}</FieldError> : null}
          </div>
        </form>

        {candidates ? (
          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-y px-6">
            {candidates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No issues match.</p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        aria-label="Select all"
                        checked={allTicked ? true : ticked.length ? "indeterminate" : false}
                        onCheckedChange={(on) => setSelected(new Set(on ? selectableRows.map((c) => c.key) : []))}
                        disabled={importing || selectableRows.length === 0}
                      />
                    </TableHead>
                    <TableHead className="w-28">Issue</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-40">{current === "jira" ? "Epic · status" : "Labels"}</TableHead>
                    <TableHead className="w-36 text-right">Import</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => {
                    const blocked = blockedReason(c, anyAuthor);
                    const p = progress.get(c.key);
                    return (
                      <TableRow key={c.key} data-state={ticked.includes(c.key) ? "selected" : undefined} className={blocked ? "text-muted-foreground" : undefined}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${c.key}`}
                            checked={ticked.includes(c.key)}
                            onCheckedChange={(on) => toggle(c.key, on === true)}
                            disabled={importing || blocked !== undefined}
                            title={blocked}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                            {c.source === "github" ? c.key.slice(c.key.lastIndexOf("#")) : c.key}
                            <ExternalLinkIcon className="size-3" aria-hidden />
                          </a>
                        </TableCell>
                        <TableCell className="max-w-0 whitespace-normal">
                          <span className="line-clamp-2">{c.title}</span>
                          {blocked ? <span className="block text-xs">{blocked}</span> : null}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-wrap gap-1">
                            {c.source === "jira" ? (
                              <>
                                {c.parent ? (
                                  <Badge variant="outline" className="font-mono" title={c.parent.summary}>
                                    {c.parent.key}
                                  </Badge>
                                ) : null}
                                <Badge variant="secondary">{c.status}</Badge>
                              </>
                            ) : (
                              c.labels.slice(0, 3).map((l) => (
                                <Badge key={l} variant="secondary">
                                  {l}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <RowStatus candidate={c} progress={p} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        ) : null}

        {candidates?.length ? (
          <FieldGroup className="gap-2">
            <Field orientation="horizontal">
              <Switch id="ii-start" checked={start} onCheckedChange={setStart} disabled={importing} />
              <FieldLabel htmlFor="ii-start">Start the tickets as soon as they are written</FieldLabel>
            </Field>
            {current === "github" && candidates.some((c) => !c.trusted && !c.ticketId) ? (
              <Field orientation="horizontal">
                <Switch id="ii-any" checked={anyAuthor} onCheckedChange={setAnyAuthor} disabled={importing} />
                <FieldLabel htmlFor="ii-any">Also allow issues from people who cannot push</FieldLabel>
                <FieldDescription className="ml-auto max-w-sm text-xs">An issue's text becomes instructions for the agents. Read these first.</FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
        ) : null}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {progress.size
              ? `${summary.done}/${summary.total} done · ${summary.tickets} ticket${summary.tickets === 1 ? "" : "s"}${summary.skipped ? ` · ${summary.skipped} skipped` : ""}${summary.failed ? ` · ${summary.failed} failed` : ""}`
              : candidates
                ? `${ticked.length} of ${candidates.length} selected`
                : null}
          </span>
          <div className="flex gap-2">
            {importing ? (
              <Button type="button" variant="outline" onClick={() => (cancelled.current = true)}>
                Stop after this one
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void runImport()} disabled={busy || ticked.length === 0}>
              {importing ? <Spinner data-icon="inline-start" /> : null}
              {importing ? "Importing…" : `Import ${ticked.length || ""} issue${ticked.length === 1 ? "" : "s"}`.replace("  ", " ")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowStatus({ candidate, progress }: { candidate: IntakeCandidate; progress: RowProgress | undefined }) {
  if (progress?.state === "importing")
    return (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="size-3" />
        Chief at work
      </span>
    );
  if (progress?.state === "queued") return <span className="text-muted-foreground">Queued</span>;
  if (progress?.state === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-destructive" title={progress.error}>
        <XIcon className="size-3" />
        Failed
      </span>
    );
  if (progress?.state === "done") {
    const r = progress.result;
    if (r.status === "skipped") return <span title={r.reason}>Skipped</span>;
    return (
      <span className="inline-flex items-center gap-1">
        <CheckIcon className="size-3" />
        {r.ticketIds.length === 1 ? (
          <Link to={`/tickets/${r.ticketIds[0]}`} className="hover:underline">
            1 ticket
          </Link>
        ) : (
          `${r.ticketIds.length} tickets`
        )}
      </span>
    );
  }
  if (candidate.ticketId)
    return (
      <Link to={`/tickets/${candidate.ticketId}`} className="text-muted-foreground hover:underline">
        On the board
      </Link>
    );
  return null;
}
