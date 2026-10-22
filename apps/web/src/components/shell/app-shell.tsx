import { Suspense } from "react";
import { Outlet, useNavigate } from "react-router";
import { CommandPalette } from "@/components/command-palette";
import { RowsSkeleton } from "@/components/query-state";
import { ImportSpecDialog } from "@/features/board/import-spec-dialog";
import { NewTicketDialog } from "@/features/board/new-ticket-dialog";
import { AppActionsProvider, useAppActions } from "@/hooks/use-app-actions";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useProject } from "@/hooks/use-project";
import { FactoryBar } from "./factory-bar";
import { NAV, NavRail } from "./nav-rail";

export function AppShell() {
  return (
    <AppActionsProvider>
      <Shell />
    </AppActionsProvider>
  );
}

function Shell() {
  const live = useLiveUpdates();
  const navigate = useNavigate();
  const { project } = useProject();
  const actions = useAppActions();
  useHotkeys({
    ...Object.fromEntries(NAV.map((n) => [`g ${n.key}`, () => navigate(n.to)])),
    n: () => project && actions.show("new-ticket"),
    i: () => project && actions.show("import-spec"),
  });

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <FactoryBar live={live} />
        <main id="main" className="min-h-0 flex-1 overflow-auto">
          <Suspense
            fallback={
              <div className="p-6">
                <RowsSkeleton />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette />
      {project ? (
        <>
          <NewTicketDialog projectId={project.id} open={actions.open === "new-ticket"} onOpenChange={(o) => actions.setOpen("new-ticket", o)} />
          <ImportSpecDialog projectId={project.id} open={actions.open === "import-spec"} onOpenChange={(o) => actions.setOpen("import-spec", o)} />
        </>
      ) : null}
    </div>
  );
}
