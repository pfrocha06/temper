import { useQuery } from "@tanstack/react-query";
import { BookOpenIcon, BotIcon, ChartColumnIcon, CrownIcon, GaugeIcon, InboxIcon, KanbanIcon, LibraryIcon, PlayIcon, PlugZapIcon, SettingsIcon, ThermometerIcon, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "cn";
import { Kbd } from "@/components/ui/kbd";
import { statusQuery } from "@/lib/queries";
import { ThemeSwitch } from "./theme-switch";

type NavItem = { to: string; label: string; icon: LucideIcon; key: string };

export const NAV: NavItem[] = [
  { to: "/chief", label: "Chief of Staff", icon: CrownIcon, key: "c" },
  { to: "/board", label: "Board", icon: KanbanIcon, key: "b" },
  { to: "/runs", label: "Live runs", icon: PlayIcon, key: "r" },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, key: "i" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpenIcon, key: "k" },
  { to: "/thermostat", label: "Thermostat", icon: ThermometerIcon, key: "t" },
  { to: "/usage", label: "Usage", icon: ChartColumnIcon, key: "u" },
  { to: "/agents", label: "Agents", icon: BotIcon, key: "a" },
  { to: "/skills", label: "Skills", icon: LibraryIcon, key: "s" },
];

/** The bottom group: configuration rather than work. */
export const SETTINGS: NavItem = { to: "/settings", label: "Settings", icon: SettingsIcon, key: "," };

/** Settings sub-pages, also offered in the command palette. */
export const SETTINGS_PAGES: Array<{ to: string; label: string; icon: LucideIcon; description: string }> = [
  { to: "/settings/providers", label: "Providers", icon: GaugeIcon, description: "Agent providers: login, usage and caps" },
  { to: "/settings/tools", label: "Tools", icon: PlugZapIcon, description: "Adapters, CLIs, MCP servers and connectors" },
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
        {NAV.map((item) => (
          <li key={item.to}>
            <NavEntry item={item} badge={item.to === "/inbox" && pending > 0 ? pending : 0} />
          </li>
        ))}
        <li className="md:hidden">
          <NavEntry item={SETTINGS} />
        </li>
      </ul>
      <ul aria-label="Settings" className="mt-auto flex flex-col gap-0.5 px-2 pt-2 max-md:hidden">
        <li>
          <NavEntry item={SETTINGS} />
        </li>
      </ul>
      <div className="p-2 max-md:hidden">
        <ThemeSwitch />
      </div>
    </nav>
  );
}

function NavEntry({ item: { to, label, icon: Icon, key }, badge = 0 }: { item: NavItem; badge?: number }) {
  return (
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
      {badge > 0 ? (
        <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
          {badge}
          <span className="sr-only"> pending approvals</span>
        </span>
      ) : (
        <Kbd className="opacity-0 group-hover:opacity-100 max-md:hidden" aria-hidden>
          g {key}
        </Kbd>
      )}
    </NavLink>
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
