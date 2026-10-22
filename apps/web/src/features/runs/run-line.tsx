import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { clockTime } from "@/lib/format";
import type { RunLine } from "@/lib/run-events";

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} className="pt-px font-mono text-[0.6875rem] text-muted-foreground tabular-nums select-none">
      {clockTime(at)}
    </time>
  );
}

/** One event of a run, rendered for reading rather than as raw JSON. */
export const RunLineView = memo(function RunLineView({ line }: { line: RunLine }) {
  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 px-4 py-1 [content-visibility:auto] [contain-intrinsic-size:auto_1.75rem]">
      <Time at={line.at} />
      <LineBody line={line} />
    </li>
  );
});

function LineBody({ line }: { line: RunLine }) {
  switch (line.kind) {
    case "text":
      return <p className="text-sm leading-6 whitespace-pre-wrap">{line.text}</p>;
    case "tool_use":
      return (
        <p className="flex min-w-0 gap-2 font-mono text-xs leading-5">
          <span className="shrink-0 font-medium text-primary">{line.tool}</span>
          <span className="truncate text-muted-foreground" title={line.summary}>
            {line.summary}
          </span>
        </p>
      );
    case "tool_result":
      return (
        <Collapsible>
          <CollapsibleTrigger
            className={cn(
              "group/tr flex w-full min-w-0 items-center gap-1 rounded-sm text-left font-mono text-xs leading-5 text-muted-foreground hover:text-foreground",
              line.isError && "text-destructive hover:text-destructive",
            )}
          >
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tr:rotate-90" />
            <span className="truncate">
              {line.isError ? "error: " : ""}
              {line.preview}
            </span>
            {line.lines > 1 ? <span className="ml-auto shrink-0 pl-2">{line.lines} lines</span> : null}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-96 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs leading-5 whitespace-pre-wrap">{line.content}</pre>
          </CollapsibleContent>
        </Collapsible>
      );
    case "stderr":
      return <pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-destructive">{line.text}</pre>;
    case "result":
      return (
        <div className={cn("my-1 rounded-md border p-3", line.isError ? "border-destructive/50" : "border-primary/30")}>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {line.isError ? "Run ended with an error" : "Final message"}
            {line.meta ? ` (${line.meta})` : ""}
          </p>
          <Markdown>{line.text || "(no text)"}</Markdown>
        </div>
      );
    case "init":
      return <p className="font-mono text-xs leading-5 text-muted-foreground">{line.text}</p>;
    case "rate_limited":
      return <p className="text-sm text-blocked">Rate limited: {line.text}</p>;
  }
}
