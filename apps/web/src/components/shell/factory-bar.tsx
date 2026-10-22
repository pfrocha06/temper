import { useQuery } from "@tanstack/react-query";
import { PauseIcon, PlayIcon, SearchIcon, UnplugIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import { HeatGauge } from "@/components/heat-gauge";
import { RoleAvatar } from "@/components/role";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useAppActions } from "@/hooks/use-app-actions";
import { REGIME_LABEL } from "@/lib/constants";
import { clockTime, percent } from "@/lib/format";
import { statusQuery, useSetPaused } from "@/lib/queries";
import type { LiveState } from "@/hooks/use-live-updates";
import { EnvironmentPicker } from "./environment-picker";
import { ProjectPicker } from "./project-picker";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The top bar: project, whether the factory runs and who is working, heat, search and the pause switch. */
export function FactoryBar({ live }: { live: LiveState }) {
  const status = useQuery(statusQuery);
  const setPaused = useSetPaused();
  const { show } = useAppActions();
  const s = status.data;
  const down = live === "down" || status.isError;

  const toggle = () => {
    if (!s) return;
    const pausing = !s.paused;
    setPaused.mutate(pausing, {
      onSuccess: () => toast.success(pausing ? "Factory paused. Running dispatches finish; no new ones start." : "Factory resumed"),
      onError: (e) => toast.error(`Could not ${pausing ? "pause" : "resume"}: ${e.message}`),
    });
  };

  const rateLimited = Object.entries(s?.pausedAdapters ?? {});

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 md:px-6">
      <div className="flex items-center gap-2">
        <EnvironmentPicker />
        <ProjectPicker />
      </div>
      {down ? (
        <p role="status" className="flex items-center gap-2 text-sm text-destructive">
          <UnplugIcon aria-hidden className="size-4" />
          <span className="max-sm:hidden">Server unreachable; showing the last data received.</span>
          <span className="sm:hidden">Offline</span>
        </p>
      ) : s ? (
        <Link
          to="/runs"
          role="status"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent"
          aria-label={`${s.paused ? "Paused" : "Running"}, ${s.active.length} active. Open live runs`}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              s.paused ? "bg-blocked" : "bg-pass",
              !s.paused && s.active.length > 0 && "text-pass motion-safe:animate-beacon",
            )}
          />
          <span className="font-medium">{s.paused ? "Paused" : s.active.length > 0 ? "Working" : "Idle"}</span>
          {s.active.length > 0 ? (
            <span className="flex -space-x-1">
              {s.active.slice(0, 5).map((a) => (
                <RoleAvatar key={a.dispatchId} role={a.role} size="xs" tooltip={false} className="ring-2 ring-background" />
              ))}
            </span>
          ) : null}
          {s.instance !== "main" ? <span className="text-muted-foreground">{s.instance}</span> : null}
        </Link>
      ) : (
        <Spinner />
      )}
      {rateLimited.length > 0 ? (
        <p className="text-sm text-blocked">
          {rateLimited.map(([adapter, until]) => `${adapter} rate-limited until ${clockTime(new Date(until).toISOString())}`).join("; ")}
        </p>
      ) : null}
      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <Button variant="outline" size="sm" onClick={() => show("palette")} className="text-muted-foreground" aria-label="Open command palette">
          <SearchIcon data-icon="inline-start" />
          <span className="max-md:hidden">Jump to</span>
          <Kbd className="max-md:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
        </Button>
        {s?.temperature ? (
          <Link
            to="/thermostat"
            className="flex w-28 flex-col gap-1 rounded-md px-1 py-0.5 hover:bg-accent md:w-36"
            aria-label={`Temperature ${percent(s.temperature.value)}, ${REGIME_LABEL[s.temperature.regime]}. Open thermostat`}
          >
            <span className="flex justify-between text-xs">
              <span className="font-medium">{REGIME_LABEL[s.temperature.regime]}</span>
              <span className="text-muted-foreground tabular-nums">{percent(s.temperature.value)}</span>
            </span>
            <HeatGauge value={s.temperature.value} regime={s.temperature.regime} />
          </Link>
        ) : null}
        <Button
          size="sm"
          variant={s?.paused ? "default" : "outline"}
          onClick={toggle}
          disabled={!s || down || setPaused.isPending}
          aria-label={s?.paused ? "Resume the factory" : "Pause the factory"}
        >
          {setPaused.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : s?.paused ? (
            <PlayIcon data-icon="inline-start" />
          ) : (
            <PauseIcon data-icon="inline-start" />
          )}
          <span className="max-sm:hidden">{s?.paused ? "Resume" : "Pause"}</span>
        </Button>
      </div>
    </div>
  );
}
