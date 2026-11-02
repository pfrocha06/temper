import { XIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { externalRefLabel } from "@/components/badges";
import { issuesOf, NO_SOURCE, sourceCounts, type TicketSource } from "@/lib/board";
import type { Ticket } from "@/lib/types";

const ALL = "__all__";
const SOURCE_LABEL: Record<string, string> = { github: "GitHub", jira: "Jira", [NO_SOURCE]: "No tracker" };
const labelOf = (s: TicketSource) => SOURCE_LABEL[s] ?? s;
/** The default toggle "on" (muted) barely shows on dark; a picked filter has to read as picked. */
const ON = "data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground";

/**
 * Narrows the board to where tickets came from: a tracker (and one of its issues, since an
 * issue usually becomes several tickets) or the board itself. Hidden while every ticket has
 * the same source and no filter is set.
 */
export function SourceFilter({
  tickets,
  source,
  issue,
  onChange,
}: {
  tickets: Ticket[];
  source: string | undefined;
  issue: string | undefined;
  onChange: (f: { source?: string; issue?: string }) => void;
}) {
  const counts = useMemo(() => sourceCounts(tickets), [tickets]);
  const issues = useMemo(() => (source && source !== NO_SOURCE ? issuesOf(tickets, source) : []), [tickets, source]);
  if (counts.length < 2 && !source) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:px-6" role="group" aria-label="Filter tickets by source">
      <span className="text-xs text-muted-foreground">Source</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={source ?? ALL}
        onValueChange={(v) => v && onChange({ source: v === ALL ? undefined : v })}
        spacing={1}
        className="flex-wrap"
      >
        <ToggleGroupItem value={ALL} className={ON}>
          All <span className="text-muted-foreground tabular-nums">{tickets.length}</span>
        </ToggleGroupItem>
        {counts.map((c) => (
          <ToggleGroupItem key={c.source} value={c.source} className={`gap-1.5 ${ON}`}>
            {labelOf(c.source)} <span className="text-muted-foreground tabular-nums">{c.count}</span>
          </ToggleGroupItem>
        ))}
        {/* A source set by a link but with no tickets now stays visible, so it can be cleared. */}
        {source && !counts.some((c) => c.source === source) ? (
          <ToggleGroupItem value={source} className={ON}>
            {labelOf(source)} <span className="text-muted-foreground tabular-nums">0</span>
          </ToggleGroupItem>
        ) : null}
      </ToggleGroup>
      {issues.length > 0 ? (
        <Select value={issue ?? ALL} onValueChange={(v) => onChange({ source, issue: v === ALL ? undefined : v })}>
          <SelectTrigger size="sm" className="w-56" aria-label="Issue">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every {labelOf(source!)} issue</SelectItem>
            {issues.map((g) => (
              <SelectItem key={g.key} value={g.key}>
                <span className="font-mono">{externalRefLabel({ tracker: source!, key: g.key, url: g.url })}</span>
                <span className="text-muted-foreground tabular-nums">
                  {g.open} open{g.count > g.open ? ` · ${g.count - g.open} closed` : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {issue ? (
        <a href={issues.find((g) => g.key === issue)?.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
          Open in {labelOf(source!)}
        </a>
      ) : null}
      {source ? (
        <Button variant="ghost" size="xs" onClick={() => onChange({})} className="text-muted-foreground">
          <XIcon data-icon="inline-start" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
