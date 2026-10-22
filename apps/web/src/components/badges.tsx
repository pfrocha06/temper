import { Badge } from "@/components/ui/badge";
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

const BOARD_ONLY_KINDS = new Set(["escalation", "decision", "agent_change", "holdout_change"]);

export function ApprovalKindBadge({ kind }: { kind: string }) {
  return <Badge variant={BOARD_ONLY_KINDS.has(kind) ? "default" : "secondary"}>{humanize(kind)}</Badge>;
}
