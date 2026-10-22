import { useQuery } from "@tanstack/react-query";
import { BookOpenIcon, BotIcon, CrownIcon, InboxIcon, KanbanIcon, LibraryIcon, PlayIcon, PlugZapIcon, ThermometerIcon, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "cn";
import { Kbd } from "@/components/ui/kbd";
import { statusQuery } from "@/lib/queries";
import { ThemeSwitch } from "./theme-switch";

export const NAV: Array<{ to: string; label: string; icon: LucideIcon; key: string }> = [
  { to: "/chief", label: "Chief of Staff", icon: CrownIcon, key: "c" },
  { to: "/board", label: "Board", icon: KanbanIcon, key: "b" },
  { to: "/runs", label: "Live runs", icon: PlayIcon, key: "r" },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, key: "i" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpenIcon, key: "k" },
  { to: "/thermostat", label: "Thermostat", icon: ThermometerIcon, key: "t" },
  { to: "/agents", label: "Agents", icon: BotIcon, key: "a" },
  { to: "/tools", label: "Tools", icon: PlugZapIcon, key: "o" },
  { to: "/skills", label: "Skills", icon: LibraryIcon, key: "s" },
];

export function NavRail() {
  const { data: status } = useQuery(statusQuery);
  const pending = status?.pendingApprovals ?? 0;
  return (
    <nav aria-label="Main" className="flex shrink-0 flex-col border-r bg-rail md:w-52 max-md:border-r-0 max-md:border-b">
      <div className="flex h-12 items-center gap-2 px-4 max-md:hidden">
        <TemperMark />
        <span className="text-[0.9375rem] font-semibold tracking-tight">Temper</span>
      </div>
      <ul className="flex gap-0.5 px-2 md:flex-col max-md:overflow-x-auto max-md:py-1.5 max-md:[scrollbar-width:none]">
        {NAV.map(({ to, label, icon: Icon, key }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent font-medium text-accent-foreground",
                )
              }
            >
              <Icon aria-hidden className="size-4" />
              <span className="flex-1">{label}</span>
              {to === "/inbox" && pending > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
                  {pending}
                  <span className="sr-only"> pending approvals</span>
                </span>
              ) : (
                <Kbd className="opacity-0 group-hover:opacity-100 max-md:hidden" aria-hidden>
                  g {key}
                </Kbd>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto p-2 max-md:hidden">
        <ThemeSwitch />
      </div>
    </nav>
  );
}

/** Three bars in the temper tints, coolest at the top. */
function TemperMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <rect x="1" y="2" width="14" height="2.5" rx="1.25" className="fill-heat-cool" />
      <rect x="1" y="6.75" width="14" height="2.5" rx="1.25" className="fill-heat-warm" />
      <rect x="1" y="11.5" width="14" height="2.5" rx="1.25" className="fill-heat-hot" />
    </svg>
  );
}
