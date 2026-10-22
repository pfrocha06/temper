import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { REGIME_LABEL } from "@/lib/constants";
import { humanize } from "@/lib/format";
import type { Regime } from "@/lib/types";

const HEAT_BG: Record<Regime, string> = {
  cool: "bg-heat-cool",
  warm: "bg-heat-warm",
  hot: "bg-heat-hot",
  fever: "bg-heat-fever",
};

export function heatBg(regime: Regime): string {
  return HEAT_BG[regime];
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} />;
}

export function RegimeBadge({ regime }: { regime: Regime }) {
  return (
    <Badge variant="outline">
      <Dot className={HEAT_BG[regime]} />
      {REGIME_LABEL[regime]}
    </Badge>
  );
}

export function TicketTypeBadge({ type }: { type: string }) {
  return <Badge variant="secondary">{type}</Badge>;
}

const VERDICT_DOT: Record<string, string> = { PASS: "bg-pass", FAIL: "bg-fail", BLOCKED: "bg-blocked" };

export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  return (
    <Badge variant="outline" className="font-mono">
      <Dot className={VERDICT_DOT[verdict] ?? "bg-muted-foreground"} />
      {verdict}
    </Badge>
  );
}

const DISPATCH_DOT: Record<string, string> = {
  running: "bg-primary animate-pulse",
  queued: "bg-muted-foreground",
  succeeded: "bg-pass",
  failed: "bg-fail",
  cancelled: "bg-muted-foreground",
};

export function DispatchStatus({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Dot className={DISPATCH_DOT[status] ?? "bg-muted-foreground"} />
      {humanize(status)}
    </span>
  );
}

const BOARD_ONLY_KINDS = new Set(["escalation", "decision", "agent_change", "holdout_change"]);

export function ApprovalKindBadge({ kind }: { kind: string }) {
  return <Badge variant={BOARD_ONLY_KINDS.has(kind) ? "default" : "secondary"}>{humanize(kind)}</Badge>;
}
