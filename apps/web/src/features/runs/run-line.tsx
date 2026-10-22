import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  FileTextIcon,
  FlagIcon,
  FolderSearchIcon,
  GlobeIcon,
  HourglassIcon,
  ListChecksIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PencilLineIcon,
  PlugZapIcon,
  SearchIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useLayoutEffect, useRef } from "react";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNow } from "@/hooks/use-now";
import { clockTime, duration, humanize } from "@/lib/format";
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
    case "gate":
      return line.outcome
        ? { icon: line.outcome.isError ? XIcon : CheckIcon, tone: line.outcome.isError ? "border-fail text-fail" : "border-pass/70 text-pass" }
        : { icon: ListChecksIcon, tone: "text-foreground" };
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
export const RunLineView = memo(function RunLineView({
  line,
  live,
  accent,
  running = false,
  gate = false,
}: {
  line: RunLine;
  live: boolean;
  accent: string;
  /** The dispatch is still running: an unfinished gate check is in progress, not abandoned. */
  running?: boolean;
  /** A server gate run: its result is the gate report, not an agent's final message. */
  gate?: boolean;
}) {
  const spinning = line.kind === "gate" && !line.outcome && running;
  const { icon: Icon, tone } = spinning ? { icon: Loader2Icon, tone: "text-foreground [&>svg]:animate-spin" } : iconFor(line);
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
            live && !spinning && cn("border-current motion-safe:animate-beacon", accent),
          )}
        >
          <Icon />
        </span>
      </span>
      <div className={cn("min-w-0 pb-1.5", minor ? "pt-1" : "pt-1.5")}>
        {line.kind === "gate" ? <GateStep step={line} running={running} /> : <LineBody line={line} gate={gate} />}
      </div>
    </li>
  );
});

type GateLine = Extract<RunLine, { kind: "gate" }>;

const TAIL_LINES = 14;
/** Gate checks that run a project command, shown with a shell prompt. */
const SHELL_CHECKS = new Set(["builder_tests", "holdouts"]);

/** A server gate check: what it runs, a live tail of its output while it runs, then its outcome. */
function GateStep({ step, running }: { step: GateLine; running: boolean }) {
  const pending = !step.outcome;
  const active = pending && running;
  const now = useNow(active);
  const lines = step.output ? step.output.split("\n") : [];
  const tail = lines.slice(-TAIL_LINES);
  const tailRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [step.output]);
  const status = step.outcome ? (step.outcome.isError ? "FAIL" : "PASS") : running ? "running" : "stopped";
  const tone = step.outcome ? (step.outcome.isError ? "text-fail" : "text-pass") : "text-muted-foreground";
  // The outcome line repeats the verdict and time shown beside the name.
  const detail = step.outcome?.text.replace(/^(PASS|FAIL) in [^—]+— /, "").replace(/^(PASS|FAIL) in \S+( \S+)?$/, "");

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pb-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{humanize(step.check)}</span>
        <span className={cn("font-mono text-xs font-medium", tone)}>{status}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {step.outcome ? duration(step.at, step.outcome.at) : active ? duration(step.at, null, now) : ""}
        </span>
      </div>
      {step.command ? (
        <p className="truncate font-mono text-xs text-muted-foreground" title={step.command}>
          {SHELL_CHECKS.has(step.check) ? (
            <span aria-hidden className="select-none">
              ${" "}
            </span>
          ) : null}
          {step.command}
        </p>
      ) : null}
      {active ? (
        <pre
          ref={tailRef}
          aria-label={`Latest output of ${humanize(step.check)}`}
          className="max-h-72 overflow-auto rounded-md border bg-muted/60 p-2 font-mono text-[0.6875rem] leading-[1.125rem] whitespace-pre-wrap text-foreground/85"
        >
          {lines.length > TAIL_LINES ? <span className="block text-muted-foreground select-none">… {lines.length - TAIL_LINES} earlier line{lines.length - TAIL_LINES === 1 ? "" : "s"}</span> : null}
          {tail.length > 0 ? tail.join("\n") : <span className="text-muted-foreground">Waiting for output…</span>}
        </pre>
      ) : lines.length > 0 ? (
        <Collapsible defaultOpen={step.outcome?.isError ?? false}>
          <CollapsibleTrigger className="group/out flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground">
            <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-data-[state=open]/out:rotate-90" />
            Output <span className="tabular-nums">· {lines.length} lines</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md border bg-muted/60 p-2 font-mono text-[0.6875rem] leading-[1.125rem] whitespace-pre-wrap">{step.output}</pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {detail ? <p className={cn("font-mono text-xs break-words", step.outcome?.isError ? "text-fail" : "text-muted-foreground")}>{detail}</p> : null}
    </div>
  );
}

function LineBody({ line, gate }: { line: Exclude<RunLine, GateLine>; gate: boolean }) {
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
      if (gate) {
        // The steps above already show each check; the full report stays one click away.
        return (
          <Collapsible className={cn("my-1 rounded-lg border px-3 py-2", line.isError ? "border-fail/50" : "border-pass/40")}>
            <CollapsibleTrigger className="group/rep flex w-full items-center gap-1.5 text-left text-xs font-medium">
              <span className={line.isError ? "text-fail" : "text-pass"}>{line.isError ? "Gates failed" : "Gates passed"}</span>
              {line.meta ? <span className="font-normal text-muted-foreground tabular-nums">in {line.meta}</span> : null}
              <span className="ml-auto flex items-center gap-1 font-normal text-muted-foreground group-hover/rep:text-foreground">
                Report
                <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-data-[state=open]/rep:rotate-90" />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Markdown className="mt-2 border-t pt-2">{line.text || "(no text)"}</Markdown>
            </CollapsibleContent>
          </Collapsible>
        );
      }
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
