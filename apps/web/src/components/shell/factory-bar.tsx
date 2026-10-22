import { useQuery } from "@tanstack/react-query";
import { PauseIcon, PlayIcon, UnplugIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import { HeatGauge } from "@/components/heat-gauge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { REGIME_LABEL } from "@/lib/constants";
import { clockTime, percent } from "@/lib/format";
import { statusQuery, useSetPaused } from "@/lib/queries";
import type { LiveState } from "@/hooks/use-live-updates";
import { ProjectPicker } from "./project-picker";

/** The top bar: which project, whether the factory runs, how hot it is, and the pause switch. */
export function FactoryBar({ live }: { live: LiveState }) {
  const status = useQuery(statusQuery);
  const setPaused = useSetPaused();
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
    <div className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2 md:px-6">
      <ProjectPicker />
      {down ? (
        <p role="status" className="flex items-center gap-2 text-sm text-destructive">
          <UnplugIcon aria-hidden className="size-4" />
          Server unreachable. Showing the last data received; reconnecting.
        </p>
      ) : s ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <span aria-hidden className={cn("size-2 rounded-full", s.paused ? "bg-blocked" : "bg-pass")} />
          <span className="font-medium">{s.paused ? "Paused" : "Running"}</span>
          <Link to="/runs" className="text-muted-foreground hover:text-foreground hover:underline">
            {s.active.length === 0 ? "no active dispatches" : s.active.length === 1 ? "1 active dispatch" : `${s.active.length} active dispatches`}
          </Link>
          {s.instance !== "main" ? <span className="text-muted-foreground">on instance {s.instance}</span> : null}
        </p>
      ) : (
        <Spinner />
      )}
      {rateLimited.length > 0 ? (
        <p className="text-sm text-blocked">
          {rateLimited.map(([adapter, until]) => `${adapter} rate-limited until ${clockTime(new Date(until).toISOString())}`).join("; ")}
        </p>
      ) : null}
      <div className="ml-auto flex items-center gap-4">
        {s?.temperature ? (
          <Link
            to="/thermostat"
            className="flex w-44 flex-col gap-1 rounded-md px-1 py-0.5 hover:bg-accent"
            aria-label={`Temperature ${percent(s.temperature.value)}, ${REGIME_LABEL[s.temperature.regime]}. Open thermostat`}
          >
            <span className="flex justify-between text-xs">
              <span className="font-medium">{REGIME_LABEL[s.temperature.regime]}</span>
              <span className="text-muted-foreground tabular-nums">{percent(s.temperature.value)}</span>
            </span>
            <HeatGauge value={s.temperature.value} regime={s.temperature.regime} />
          </Link>
        ) : null}
        <Button size="sm" variant={s?.paused ? "default" : "outline"} onClick={toggle} disabled={!s || down || setPaused.isPending}>
          {setPaused.isPending ? <Spinner data-icon="inline-start" /> : s?.paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
          {s?.paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </div>
  );
}
