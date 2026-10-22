import { RadioIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { STATE_LABEL } from "@/components/pipeline";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { duration, relativeTime } from "@/lib/format";
import type { PipelineNode } from "@/lib/pipeline";

const VERDICT_TONE: Record<string, string> = { PASS: "text-pass", FAIL: "text-fail", BLOCKED: "text-blocked" };

/** The selected stage: its attempts, and the chosen attempt's summary with a link to its run. */
export function StagePanel({ node }: { node: PipelineNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const attempt = node.attempts.find((a) => a.id === picked) ?? node.latest;
  const now = useNow(attempt?.status === "running");
  const m = roleMeta(node.actor);

  if (!attempt) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <RoleAvatar role={node.actor} size="md" />
        <p>
          <span className="font-medium text-foreground">{node.stage}</span> has not run yet. {m.label}: {m.does.toLowerCase()}.
        </p>
      </div>
    );
  }
  const summary = attempt.summary?.trim() ?? "";
  const long = summary.length > 600;

  return (
    <section aria-label={`Stage ${node.stage}`} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RoleAvatar role={node.actor} size="md" live={attempt.status === "running"} />
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-semibold">
            {node.stage}
            <span className={cn("ml-2 text-xs", attempt.verdict ? "font-mono" : "font-normal", VERDICT_TONE[attempt.verdict ?? ""] ?? "text-muted-foreground")}>
              {attempt.verdict ?? (attempt === node.latest ? STATE_LABEL[node.state] : attempt.status)}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {m.label}
            {node.actor === "server" ? null : <span className="font-mono"> v{attempt.agentVersion}</span>}
            {attempt.startedAt ? `, ${duration(attempt.startedAt, attempt.finishedAt, now)}` : ""}, {relativeTime(attempt.createdAt, now)}
          </p>
        </div>
        {node.attempts.length > 1 ? (
          <div role="group" aria-label="Attempts" className="flex gap-1">
            {node.attempts.map((a) => (
              <Button
                key={a.id}
                size="xs"
                variant={a.id === attempt.id ? "secondary" : "ghost"}
                aria-pressed={a.id === attempt.id}
                onClick={() => setPicked(a.id)}
                className="font-mono"
              >
                #{a.attempt}
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    a.verdict === "PASS" ? "bg-pass" : a.verdict === "FAIL" ? "bg-fail" : a.verdict === "BLOCKED" ? "bg-blocked" : "bg-muted-foreground",
                  )}
                />
              </Button>
            ))}
          </div>
        ) : null}
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link to={`/runs/${attempt.id}`}>
            <RadioIcon data-icon="inline-start" />
            Open run
          </Link>
        </Button>
      </header>
      {summary ? (
        <div className="flex flex-col items-start gap-1">
          <div
            className={cn(
              "relative w-full overflow-hidden",
              long &&
                !expanded &&
                "max-h-48 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-12 after:bg-gradient-to-t after:from-card",
            )}
          >
            <Markdown className="text-[0.8125rem] [&_h1]:text-sm [&_h2]:text-sm">{summary}</Markdown>
          </div>
          {long ? (
            <Button variant="link" size="xs" className="px-0" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? "Show less" : "Show all"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {attempt.status === "running" ? "Running. The summary appears when the stage ends." : "No summary recorded."}
        </p>
      )}
    </section>
  );
}
