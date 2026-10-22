import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookOpenIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { memo, useDeferredValue, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar } from "@/components/role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppActions } from "@/hooks/use-app-actions";
import { useEnvironment } from "@/hooks/use-environment";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useNow } from "@/hooks/use-now";
import { useProject } from "@/hooks/use-project";
import { KNOWLEDGE_KIND_LABEL, KNOWLEDGE_KINDS } from "@/lib/constants";
import { absoluteTime, relativeTime } from "@/lib/format";
import { countByKind, filterKnowledge, groupKnowledge, sourceLabel, type ProjectScope } from "@/lib/knowledge";
import { knowledgeEntryQuery, knowledgeQuery, useUpdateKnowledge } from "@/lib/queries";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/types";
import { EntryDialog } from "./entry-dialog";

export function KnowledgePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const deferredQ = useDeferredValue(q.trim());
  const { environment } = useEnvironment();
  const { projects } = useProject();
  const { show } = useAppActions();
  const list = useQuery(knowledgeQuery(environment?.id, deferredQ));
  const [kinds, setKinds] = useState<KnowledgeKind[]>([]);
  const [project, setProject] = useState<ProjectScope>("all");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useHotkeys({ "/": () => input.current?.focus() });

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const counts = useMemo(() => countByKind(list.data ?? []), [list.data]);
  const shown = useMemo(() => filterKnowledge(list.data ?? [], { kinds, project, archived }), [list.data, kinds, project, archived]);
  const groups = useMemo(() => groupKnowledge(shown), [shown]);
  const active = (list.data ?? []).filter((e) => e.status !== "archived").length;
  const filtered = kinds.length > 0 || project !== "all" || deferredQ !== "";
  const searchParam = params.toString();

  const setQuery = (value: string) =>
    setParams(
      (p) => {
        if (value) p.set("q", value);
        else p.delete("q");
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Knowledge"
        info="What the factory knows about this environment. Every run reads the titles and abstracts; bodies on request. The Chief of Staff curates it as work finishes."
        meta={
          list.data ? (
            <span className="tabular-nums">
              {shown.length === list.data.length ? `${active} entries` : `${shown.length} shown of ${list.data.length}`}
              {environment ? ` in ${environment.name}` : ""}
            </span>
          ) : null
        }
        actions={
          <>
            <div className="relative">
              <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={input}
                type="search"
                value={q}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search knowledge"
                aria-label="Search titles, abstracts and bodies"
                className="w-48 pr-8 pl-8 md:w-64"
              />
              <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            </div>
            <Button size="sm" onClick={() => show("add-knowledge")} disabled={!environment}>
              <PlusIcon data-icon="inline-start" />
              Add entry
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <RoleAvatar role="chief" size="xs" tooltip={false} />
          Only the Chief of Staff writes knowledge as the factory works. You can correct, pin, archive or add entries.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={kinds}
            onValueChange={(v) => setKinds(v as KnowledgeKind[])}
            aria-label="Filter by kind"
            className="flex-wrap"
          >
            {KNOWLEDGE_KINDS.map((k) => (
              <ToggleGroupItem key={k} value={k} className="gap-1.5">
                {KNOWLEDGE_KIND_LABEL[k]}
                <span className="text-muted-foreground tabular-nums">{counts.get(k) ?? 0}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger size="sm" aria-label="Filter by project" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All projects</SelectItem>
                <SelectItem value="env">Environment-wide only</SelectItem>
              </SelectGroup>
              {projects.length > 0 ? <SelectSeparator /> : null}
              <SelectGroup>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={archived} onCheckedChange={setArchived} />
            Show archived
          </label>
        </div>

        {list.isError ? (
          <QueryError error={list.error} what="knowledge" onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <RowsSkeleton rows={6} />
        ) : groups.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>{filtered || list.data.length > 0 ? "Nothing matches" : "Nothing recorded yet"}</EmptyTitle>
              <EmptyDescription>
                {filtered || list.data.length > 0 ? (
                  "Try another search or clear a filter."
                ) : (
                  <>
                    The Chief of Staff records what it learns after each ticket and in{" "}
                    <Link to="/chief" className="text-primary underline underline-offset-2">
                      conversations
                    </Link>
                    . You can add an entry yourself too.
                  </>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.kind} aria-labelledby={`kind-${g.kind}`} className="flex flex-col gap-1.5">
                <h2 id={`kind-${g.kind}`} className="flex items-baseline gap-2 text-sm font-semibold">
                  {KNOWLEDGE_KIND_LABEL[g.kind] ?? g.kind}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">{g.entries.length}</span>
                </h2>
                <ul className="flex flex-col divide-y rounded-lg border bg-card">
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} projectName={e.projectId ? projectName.get(e.projectId) : undefined} search={searchParam} onEdit={setEditing} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <EntrySheet id={id ?? null} onClose={() => void navigate({ pathname: "/knowledge", search: searchParam })} onEdit={setEditing} projectName={projectName} />
      <EntryDialog entry={editing ?? undefined} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}

const EntryRow = memo(function EntryRow({
  entry: e,
  projectName,
  search,
  onEdit,
}: {
  entry: KnowledgeEntry;
  projectName: string | undefined;
  search: string;
  onEdit: (e: KnowledgeEntry) => void;
}) {
  const isArchived = e.status === "archived";
  return (
    <li className={cn("group/row relative flex items-start gap-3 px-3 py-2.5 hover:bg-accent/40", isArchived && "opacity-60")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to={{ pathname: `/knowledge/${e.id}`, search }}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {e.pinned ? <PinIcon aria-label="Pinned" className="size-3.5 shrink-0 fill-current text-role-chief" /> : null}
          <span className="truncate">{e.title}</span>
          {isArchived ? (
            <Badge variant="outline" className="shrink-0">
              archived
            </Badge>
          ) : null}
        </Link>
        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{e.abstract}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{projectName ?? "Environment-wide"}</span>
          {e.area ? <span className="font-mono">{e.area}</span> : null}
          <span className="tabular-nums">v{e.version}</span>
          <span title={absoluteTime(e.updatedAt)}>updated {relativeTime(e.updatedAt)}</span>
          <span>by {sourceLabel(e.source).text}</span>
        </p>
      </div>
      <EntryActions entry={e} onEdit={onEdit} className="relative z-10" />
    </li>
  );
});

function EntryActions({ entry: e, onEdit, className }: { entry: KnowledgeEntry; onEdit: (e: KnowledgeEntry) => void; className?: string }) {
  const update = useUpdateKnowledge();
  const isArchived = e.status === "archived";
  const set = (patch: { pinned?: 0 | 1; status?: "active" | "archived" }, done: string) =>
    update.mutate({ id: e.id, patch }, { onSuccess: () => toast.success(done), onError: (err) => toast.error(err.message) });
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={Boolean(e.pinned)}
        aria-label={e.pinned ? `Unpin ${e.title}` : `Pin ${e.title}`}
        title={e.pinned ? "Unpin" : "Pin: pinned entries rank first in every run"}
        disabled={update.isPending}
        onClick={() => set({ pinned: e.pinned ? 0 : 1 }, e.pinned ? "Unpinned" : "Pinned")}
        className={cn(!e.pinned && "text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100")}
      >
        {e.pinned ? <PinOffIcon /> : <PinIcon />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${e.title}`} className="text-muted-foreground">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(e)}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => set({ status: isArchived ? "active" : "archived" }, isArchived ? "Restored" : "Archived; agents no longer see it")}
          >
            {isArchived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {isArchived ? "Restore" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function EntrySheet({
  id,
  onClose,
  onEdit,
  projectName,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (e: KnowledgeEntry) => void;
  projectName: Map<string, string>;
}) {
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">{id ? <EntryDetail id={id} onEdit={onEdit} projectName={projectName} /> : null}</SheetContent>
    </Sheet>
  );
}

const VIA_LABEL: Record<string, string> = { prompt: "in its prompt", search: "by searching", get: "opened in full" };

function EntryDetail({ id, onEdit, projectName }: { id: string; onEdit: (e: KnowledgeEntry) => void; projectName: Map<string, string> }) {
  const detail = useQuery(knowledgeEntryQuery(id));
  const now = useNow(false);
  if (detail.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Entry not available</SheetTitle>
          <SheetDescription className="sr-only">Could not load the entry</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <QueryError error={detail.error} what="this entry" onRetry={() => void detail.refetch()} />
        </div>
      </>
    );
  }
  const e = detail.data;
  if (!e) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Loading entry</SheetTitle>
          <SheetDescription className="sr-only">Loading</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <RowsSkeleton />
        </div>
      </>
    );
  }
  const source = sourceLabel(e.source);
  const runs = new Set(e.reads.flatMap((r) => (r.dispatchId ? [r.dispatchId] : []))).size;
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{e.kind}</Badge>
          {e.pinned ? (
            <Badge variant="outline" className="text-role-chief">
              <PinIcon data-icon="inline-start" className="fill-current" />
              pinned
            </Badge>
          ) : null}
          {e.status === "archived" ? <Badge variant="outline">archived</Badge> : null}
          <span className="text-xs text-muted-foreground tabular-nums">v{e.version}</span>
        </div>
        <SheetTitle className="text-base leading-snug">{e.title}</SheetTitle>
        <SheetDescription className="text-sm leading-6 text-foreground/80">{e.abstract}</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Applies to</dt>
          <dd>{e.projectId ? (projectName.get(e.projectId) ?? e.projectId) : "The whole environment"}</dd>
          {e.area ? (
            <>
              <dt className="text-muted-foreground">Area</dt>
              <dd className="font-mono break-all">{e.area}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Learned from</dt>
          <dd>
            {source.href ? (
              <Link to={source.href} className="text-primary hover:underline">
                {source.text}
              </Link>
            ) : (
              source.text
            )}
          </dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd title={absoluteTime(e.updatedAt)}>{relativeTime(e.updatedAt, now)}</dd>
          {e.tags.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {e.tags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
        {e.body ? <Markdown>{e.body}</Markdown> : <p className="text-sm text-muted-foreground">No body: the abstract is the whole entry.</p>}
        <section aria-labelledby="reads-h" className="flex flex-col gap-2 border-t pt-4">
          <h3 id="reads-h" className="text-xs font-medium text-muted-foreground">
            {e.reads.length === 0
              ? "No run has read this yet"
              : `Read ${e.reads.length === 1 ? "once" : `${e.reads.length} times`}${runs > 0 ? ` by ${runs} run${runs === 1 ? "" : "s"}` : ""}`}
          </h3>
          {e.reads.length > 0 ? (
            <ol className="flex flex-col">
              {e.reads.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2 border-l py-1 pl-3 text-xs">
                  {r.dispatchId ? (
                    <Link to={`/runs/${r.dispatchId}`} className="font-mono text-primary hover:underline">
                      {r.dispatchId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">a conversation</span>
                  )}
                  <span className="text-muted-foreground">{VIA_LABEL[r.via] ?? r.via}</span>
                  <time dateTime={r.at} title={absoluteTime(r.at)} className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {relativeTime(r.at, now)}
                  </time>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </div>
      <SheetFooter className="flex-row border-t">
        <EntryActions entry={e} onEdit={onEdit} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => onEdit(e)}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </SheetFooter>
    </>
  );
}
