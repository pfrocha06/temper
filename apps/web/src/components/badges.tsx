import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import type { Regime, Ticket } from "@/lib/types";

type ExternalRef = NonNullable<Ticket["externalRef"]>;

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

/** The ticket's counterpart in an external tracker (e.g. Jira); opens it in a new tab. */
export function ExternalRefChip({ externalRef, className }: { externalRef: ExternalRef | null | undefined; className?: string }) {
  if (!externalRef) return null;
  return (
    <Badge variant="outline" asChild className={className}>
      <a
        href={externalRef.url}
        target="_blank"
        rel="noreferrer noopener"
        title={`Open in ${humanize(externalRef.tracker)}`}
        // Cards are draggable and clickable; the chip is a plain link.
        onPointerDown={(e) => e.stopPropagation()}
        className="relative z-10"
      >
        <ExternalLinkIcon data-icon="inline-start" />
        {externalRef.key}
      </a>
    </Badge>
  );
}
