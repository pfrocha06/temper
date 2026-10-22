import { BanIcon, CheckIcon, ClockIcon, HandIcon, TriangleAlertIcon, XIcon, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { duration } from "@/lib/format";
import type { NodeState, PipelineNode } from "@/lib/pipeline";
import { roleMeta } from "./role";

export const STATE_LABEL: Record<NodeState, string> = {
  pending: "Not reached",
  queued: "Waiting for a free agent",
  running: "Running",
  pass: "Passed",
  fail: "Failed",
  blocked: "Stuck",
  waiting: "Waiting for you",
  cancelled: "Cancelled",
};

const BADGE: Partial<Record<NodeState, { icon: LucideIcon; className: string }>> = {
  pass: { icon: CheckIcon, className: "bg-pass text-background" },
  fail: { icon: XIcon, className: "bg-fail text-background" },
  blocked: { icon: TriangleAlertIcon, className: "bg-blocked text-background" },
  waiting: { icon: HandIcon, className: "bg-board text-primary-foreground" },
  queued: { icon: ClockIcon, className: "bg-muted-foreground text-background" },
  cancelled: { icon: BanIcon, className: "bg-muted-foreground text-background" },
};

/** Ring colour per state; running and queued use the role's own accent. */
const RING: Record<NodeState, string> = {
  pending: "border-dashed border-muted-foreground/40 text-muted-foreground/70",
  queued: "border-current/50",
  running: "border-current bg-[color-mix(in_oklab,currentColor_16%,transparent)] motion-safe:animate-beacon",
  pass: "border-pass/70",
  fail: "border-fail",
  blocked: "border-blocked",
  waiting: "border-board text-board! motion-safe:animate-beacon",
  cancelled: "border-muted-foreground/40 text-muted-foreground/60",
};

function nodeLabel(n: PipelineNode): string {
  const tries = n.attempts.length > 1 ? `, ${n.attempts.length} attempts` : "";
  return `${n.stage} (${roleMeta(n.actor).label}): ${STATE_LABEL[n.state]}${n.stale ? ", earlier result superseded" : ""}${tries}`;
}

function connectorDone(n: PipelineNode) {
  return n.state === "pass" && !n.stale;
}

/** Tiny dot strip for cards and lists. */
export function PipelineStrip({ nodes, className }: { nodes: PipelineNode[]; className?: string }) {
  if (nodes.length === 0) return null;
  return (
    <span role="img" aria-label={`Stages: ${nodes.map(nodeLabel).join("; ")}`} className={cn("inline-flex items-center", className)}>
      {nodes.map((n, i) => (
        <Fragment key={n.stage}>
          {i > 0 ? <span aria-hidden className={cn("h-px w-2.5", connectorDone(nodes[i - 1]!) ? "bg-pass/70" : "bg-border")} /> : null}
          <span
            aria-hidden
            title={`${n.stage}: ${STATE_LABEL[n.state]}`}
            className={cn(
              "size-2 shrink-0 rounded-full",
              roleMeta(n.actor).text,
              n.state === "pending" && "border border-muted-foreground/50",
              n.state === "queued" && "border border-current",
              n.state === "running" && "bg-current motion-safe:animate-beacon",
              n.state === "pass" && "bg-pass",
              n.state === "fail" && "bg-fail",
              n.state === "blocked" && "bg-blocked",
              n.state === "waiting" && "bg-board text-board motion-safe:animate-beacon",
              n.state === "cancelled" && "bg-muted-foreground/40",
            )}
          />
        </Fragment>
      ))}
    </span>
  );
}

type PipelineProps = {
  nodes: PipelineNode[];
  size?: "md" | "lg";
  /** With `onSelect`, nodes become buttons and the selected one is marked. */
  selected?: string;
  onSelect?: (stage: string) => void;
  className?: string;
};

/** The workflow as a row of stage nodes: role icon, state ring, corner badge, label. */
export function Pipeline({ nodes, size = "md", selected, onSelect, className }: PipelineProps) {
  const now = useNow(nodes.some((n) => n.state === "running"));
  const lg = size === "lg";
  return (
    <ol aria-label="Stages" className={cn("flex w-full items-start", className)}>
      {nodes.map((n, i) => {
        const m = roleMeta(n.actor);
        const Icon = m.icon;
        const badge = n.stale ? undefined : BADGE[n.state];
        const BadgeIcon = badge?.icon;
        const time = n.latest?.startedAt ? duration(n.latest.startedAt, n.latest.finishedAt, now) : "";
        const isSelected = selected === n.stage;
        const body = (
          <>
            <span
              className={cn(
                "relative flex items-center justify-center rounded-full border-2 bg-background transition-colors",
                lg ? "size-10 [&>svg]:size-[1.125rem]" : "size-7 [&>svg]:size-3.5",
                m.text,
                RING[n.state],
                isSelected && "outline-2 outline-offset-2 outline-ring",
              )}
            >
              <Icon aria-hidden />
              {BadgeIcon ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute -right-1 -bottom-1 flex items-center justify-center rounded-full ring-2 ring-background",
                    lg ? "size-4 [&>svg]:size-2.5" : "size-3.5 [&>svg]:size-2",
                    badge.className,
                  )}
                >
                  <BadgeIcon strokeWidth={3} />
                </span>
              ) : null}
              {n.attempts.length > 1 ? (
                <span
                  aria-hidden
                  className="absolute -top-1.5 -right-2 rounded-full bg-secondary px-1 font-mono text-[0.625rem] leading-4 text-secondary-foreground tabular-nums ring-2 ring-background"
                >
                  ×{n.attempts.length}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "mt-1.5 max-w-full truncate leading-tight",
                lg ? "text-xs font-medium" : "text-[0.6875rem]",
                n.state === "pending" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {n.stage}
            </span>
            {lg ? (
              <span className="h-4 text-[0.6875rem] text-muted-foreground tabular-nums">
                {n.state === "waiting" ? "your call" : n.stale ? "superseded" : time}
              </span>
            ) : null}
          </>
        );
        return (
          <Fragment key={n.stage}>
            {i > 0 ? (
              <li
                aria-hidden
                className={cn(
                  "mx-0.5 min-w-3 flex-1 self-start",
                  lg ? "mt-5" : "mt-3.5",
                  connectorDone(nodes[i - 1]!)
                    ? "h-0.5 bg-pass/60"
                    : n.state === "running" || n.state === "queued"
                      ? cn("h-0.5 bg-[repeating-linear-gradient(90deg,currentColor_0_6px,transparent_6px_10px)] opacity-60 motion-safe:animate-flow", m.text)
                      : "h-px border-t border-dashed border-muted-foreground/35",
                )}
              />
            ) : null}
            <li className="flex min-w-0 shrink-0 flex-col items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  {onSelect ? (
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={nodeLabel(n)}
                      onClick={() => onSelect(n.stage)}
                      className="flex min-w-12 flex-col items-center rounded-md px-1 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </button>
                  ) : (
                    <span role="img" aria-label={nodeLabel(n)} className="flex min-w-10 flex-col items-center px-0.5 pt-1">
                      {body}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {m.label} · {STATE_LABEL[n.state]}
                  {n.stale ? " (superseded)" : ""}
                  {time ? ` · ${time}` : ""}
                </TooltipContent>
              </Tooltip>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
