import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";
import { cn } from "cn";
import { RowsSkeleton } from "@/components/query-state";
import { SETTINGS_PAGES } from "@/components/shell/nav-rail";

/** Settings: a second, quieter rail of sub-pages beside the page itself. */
export function SettingsLayout() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav aria-label="Settings" className="shrink-0 border-b md:w-44 md:border-r md:border-b-0">
        <p className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground max-md:hidden">Settings</p>
        <ul className="flex gap-0.5 p-2 md:flex-col max-md:overflow-x-auto">
          {SETTINGS_PAGES.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent font-medium text-accent-foreground",
                  )
                }
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Suspense
          fallback={
            <div className="p-6">
              <RowsSkeleton />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
