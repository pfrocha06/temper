import { FileTextIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "cn";
import { GateChips } from "@/components/evidence";
import { Markdown } from "@/components/markdown";
import { relativeTime } from "@/lib/format";
import { firstLine, parseGates } from "@/lib/gates";
import type { Artifact } from "@/lib/types";

/** Stage outputs in workflow order where known, the rest alphabetically. */
const ORDER = ["spec.md", "changes.md", "reproduction.md", "verification.md", "gates.md", "review.md"];
const rank = (name: string) => {
  const i = ORDER.indexOf(name);
  return i === -1 ? ORDER.length : i;
};

function summaryOf(a: Artifact): string {
  if (a.name === "gates.md") {
    const g = parseGates(a.content);
    const failed = g.checks.filter((c) => c.status === "FAIL").length;
    return `${g.checks.length} checks, ${failed === 0 ? "none failed" : `${failed} failed`}${g.filesChanged !== undefined ? `, ${g.filesChanged} files changed` : ""}`;
  }
  return firstLine(a.content) || "(empty)";
}

/** Artifacts as a list of tabs, each with a one-line summary, and the chosen one rendered beside it. */
export function ArtifactTabs({ artifacts }: { artifacts: Artifact[] }) {
  // The API returns the latest version of each name.
  const sorted = useMemo(() => artifacts.toSorted((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)), [artifacts]);
  const [selected, setSelected] = useState<string | null>(null);
  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No artifacts yet. Each stage writes its artifact here when it finishes.</p>;
  }
  const current = sorted.find((a) => a.name === selected) ?? sorted.find((a) => a.name !== "spec.md") ?? sorted[0]!;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const a = sorted[(next + sorted.length) % sorted.length]!;
    setSelected(a.name);
    document.getElementById(`art-tab-${a.name}`)?.focus();
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div role="tablist" aria-label="Artifacts" aria-orientation="vertical" className="flex flex-col gap-1 max-lg:flex-row max-lg:overflow-x-auto">
        {sorted.map((a, i) => {
          const active = a.name === current.name;
          return (
            <button
              key={a.name}
              id={`art-tab-${a.name}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls="art-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(a.name)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "flex min-w-48 flex-col gap-0.5 rounded-md border border-transparent px-2.5 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                active && "border-border bg-card shadow-xs",
              )}
            >
              <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
                <FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
                {a.name}
                <span className="ml-auto font-sans font-normal text-muted-foreground">{relativeTime(a.createdAt)}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{summaryOf(a)}</span>
            </button>
          );
        })}
      </div>
      <div
        id="art-panel"
        role="tabpanel"
        aria-labelledby={`art-tab-${current.name}`}
        tabIndex={0}
        className="min-w-0 rounded-lg border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {current.name === "gates.md" ? (
          <div className="mb-4">
            <GateChips checks={parseGates(current.content).checks} />
          </div>
        ) : null}
        <Markdown>{current.content}</Markdown>
      </div>
    </div>
  );
}
