import {
  BotIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  FileTextIcon,
  FlagIcon,
  FolderSearchIcon,
  GlobeIcon,
  HourglassIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  PencilLineIcon,
  PlugZapIcon,
  SearchIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { clockTime } from "@/lib/format";
import type { RunLine } from "@/lib/run-events";

const TOOL_ICON: Record<string, LucideIcon> = {
  Read: FileTextIcon,
  Edit: PencilLineIcon,
  MultiEdit: PencilLineIcon,
  Write: PencilLineIcon,
  NotebookEdit: PencilLineIcon,
  Bash: SquareTerminalIcon,
  Grep: SearchIcon,
  Glob: FolderSearchIcon,
  LS: FolderSearchIcon,
  WebFetch: GlobeIcon,
  WebSearch: GlobeIcon,
  Task: BotIcon,
  Agent: BotIcon,
  TodoWrite: ListChecksIcon,
  Skill: ListChecksIcon,
};

function toolIcon(tool: string): LucideIcon {
  return TOOL_ICON[tool] ?? (tool.startsWith("mcp__") ? PlugZapIcon : WrenchIcon);
}

function iconFor(line: RunLine): { icon: LucideIcon; tone: string } {
  switch (line.kind) {
    case "tool_use":
      return { icon: toolIcon(line.tool), tone: "text-foreground" };
    case "tool_result":
      return { icon: CornerDownRightIcon, tone: line.isError ? "text-fail" : "text-muted-foreground" };
    case "text":
      return { icon: MessageSquareTextIcon, tone: "" };
    case "stderr":
      return { icon: TriangleAlertIcon, tone: "text-fail" };
    case "result":
      return { icon: FlagIcon, tone: line.isError ? "text-fail" : "text-pass" };
    case "init":
      return { icon: PlugZapIcon, tone: "text-muted-foreground" };
    case "rate_limited":
      return { icon: HourglassIcon, tone: "text-blocked" };
  }
}

/** One event of a run on the timeline: time, an icon on the rail, and the event read as prose. */
export const RunLineView = memo(function RunLineView({ line, live, accent }: { line: RunLine; live: boolean; accent: string }) {
  const { icon: Icon, tone } = iconFor(line);
  const minor = line.kind === "tool_result";
  return (
    <li className="group/line relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 px-3 sm:grid-cols-[3.75rem_1.75rem_minmax(0,1fr)] [content-visibility:auto] [contain-intrinsic-size:auto_2rem] md:px-4">
      <time
        dateTime={line.at}
        className={cn("pt-1.5 text-right max-sm:hidden font-mono text-[0.6875rem] text-muted-foreground tabular-nums select-none", minor && "invisible")}
      >
        {clockTime(line.at)}
      </time>
      <span
        aria-hidden
        className="relative flex justify-center before:absolute before:inset-y-0 before:w-px before:bg-border group-first/line:before:top-3 group-last/line:before:bottom-auto group-last/line:before:h-3"
      >
        <span
          className={cn(
            "relative mt-1 flex items-center justify-center rounded-full bg-background",
            minor ? "size-5 [&>svg]:size-3" : "size-6 border [&>svg]:size-3.5",
            line.kind === "text" && accent,
            tone,
            live && cn("border-current motion-safe:animate-beacon", accent),
          )}
        >
          <Icon />
        </span>
      </span>
      <div className={cn("min-w-0 pb-1.5", minor ? "pt-1" : "pt-1.5")}>
        <LineBody line={line} />
      </div>
    </li>
  );
});

function LineBody({ line }: { line: RunLine }) {
  switch (line.kind) {
    case "text":
      return <Markdown className="[&_h1]:text-sm [&_h2]:text-sm">{line.text}</Markdown>;
    case "tool_use":
      return (
        <p className="flex min-w-0 items-baseline gap-2 text-xs leading-5">
          <span className="shrink-0 font-medium">{line.tool}</span>
          <span className="truncate font-mono text-muted-foreground" title={line.summary}>
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
              line.isError && "text-fail hover:text-fail",
            )}
          >
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tr:rotate-90" />
            <span className="truncate">
              {line.isError ? "error: " : ""}
              {line.preview}
            </span>
            {line.lines > 1 ? <span className="ml-auto shrink-0 pl-2 font-sans tabular-nums">{line.lines} lines</span> : null}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-96 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs leading-5 whitespace-pre-wrap">{line.content}</pre>
          </CollapsibleContent>
        </Collapsible>
      );
    case "stderr":
      return <pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-fail">{line.text}</pre>;
    case "result":
      return (
        <div className={cn("my-1 rounded-lg border p-3", line.isError ? "border-fail/50" : "border-pass/40")}>
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
