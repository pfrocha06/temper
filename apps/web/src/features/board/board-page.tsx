import { useQuery } from "@tanstack/react-query";
import { FileInputIcon, FolderGit2Icon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useProject } from "@/hooks/use-project";
import { groupByStatus } from "@/lib/board";
import { ticketsQuery } from "@/lib/queries";
import { BoardColumn } from "./board-column";
import { ImportSpecDialog } from "./import-spec-dialog";
import { NewTicketDialog } from "./new-ticket-dialog";

export function BoardPage() {
  const { project, isLoading: projectsLoading } = useProject();
  const tickets = useQuery({ ...ticketsQuery(project?.id), enabled: Boolean(project) });
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  useHotkeys({ n: () => project && setNewOpen(true), i: () => project && setImportOpen(true) });

  if (!projectsLoading && !project) return <NoProject />;

  const columns = groupByStatus(tickets.data ?? []);
  const total = tickets.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Board"
        description={project ? `${total} ticket${total === 1 ? "" : "s"} in ${project.name}` : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={!project}>
              <FileInputIcon data-icon="inline-start" />
              Import spec
              <Kbd className="ml-1 max-md:hidden">i</Kbd>
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} disabled={!project}>
              <PlusIcon data-icon="inline-start" />
              New ticket
              <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground max-md:hidden">n</Kbd>
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 p-4 md:px-6">
        {tickets.isError ? (
          <QueryError error={tickets.error} what="tickets" onRetry={() => void tickets.refetch()} />
        ) : tickets.isPending ? (
          <RowsSkeleton rows={5} />
        ) : (
          <div className="flex h-full gap-3 overflow-x-auto pb-2">
            {columns.map((c) => (
              <BoardColumn key={c.status} column={c} collapsible={c.status === "cancelled"} />
            ))}
          </div>
        )}
      </div>
      {project ? (
        <>
          <NewTicketDialog projectId={project.id} open={newOpen} onOpenChange={setNewOpen} />
          <ImportSpecDialog projectId={project.id} open={importOpen} onOpenChange={setImportOpen} />
        </>
      ) : null}
    </div>
  );
}

function NoProject() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2Icon />
        </EmptyMedia>
        <EmptyTitle>No project yet</EmptyTitle>
        <EmptyDescription>
          Register the repository Temper should work on, then come back to add tickets:
          <code className="mt-2 block rounded-md bg-muted px-2 py-1 font-mono text-xs">temper project add --name NAME --repo PATH</code>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
