import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactNumber, formatUsd } from "@/lib/providers";
import { pct, share } from "@/lib/usage";
import type { UsageBucket } from "@/lib/types";

export type BarItem = { bucket: UsageBucket; label?: ReactNode; icon?: ReactNode; color?: string };

/**
 * A ranked breakdown: name, a thin bar for its share of the total, tokens and share as text.
 * Details (output, cache reads, runs, cost) on hover or focus.
 */
export function BarList({ items, total, empty }: { items: BarItem[]; total: number; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((i) => i.bucket.tokens), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map(({ bucket: b, label, icon, color }) => (
        <li key={b.key}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div tabIndex={0} className="flex flex-col gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex min-w-0 items-baseline gap-2 text-sm">
                  {icon ? <span className="flex shrink-0 self-center">{icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{label ?? b.label}</span>
                  <span className="font-medium tabular-nums">{compactNumber(b.tokens)}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{pct(share(b.tokens, total))}</span>
                </div>
                <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground/55" style={{ width: `${(b.tokens / max) * 100}%`, background: color }} />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="flex flex-col gap-0.5 tabular-nums">
              <span className="font-semibold">{compactNumber(b.tokens)} tokens</span>
              <span>
                {compactNumber(b.outputTokens)} output, {compactNumber(b.cacheReadTokens)} cache reads
              </span>
              <span>
                {b.runs} run{b.runs === 1 ? "" : "s"}
                {b.costUsd > 0 ? `, ${formatUsd(b.costUsd)} list price` : ""}
              </span>
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
