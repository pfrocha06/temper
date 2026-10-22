import { Suspense } from "react";
import { Outlet, useNavigate } from "react-router";
import { RowsSkeleton } from "@/components/query-state";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { FactoryBar } from "./factory-bar";
import { NAV, NavRail } from "./nav-rail";

export function AppShell() {
  const live = useLiveUpdates();
  const navigate = useNavigate();
  useHotkeys(Object.fromEntries(NAV.map((n) => [`g ${n.key}`, () => navigate(n.to)])));

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
    </div>
  );
}
