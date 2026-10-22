import { CheckIcon, CircleDashedIcon, CircleHelpIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { humanize, relativeTime } from "@/lib/format";
import type { AcItem, AcStatus, AcSummary, CheckStatus, GateCheck } from "@/lib/gates";

const AC_ICON: Record<AcStatus, { icon: typeof CheckIcon; className: string; label: string }> = {
  PASS: { icon: CheckIcon, className: "bg-pass text-background", label: "passes" },
  FAIL: { icon: XIcon, className: "bg-fail text-background", label: "fails" },
  pending: { icon: CircleDashedIcon, className: "text-muted-foreground", label: "not checked yet" },
};

function AcMark({ status, className }: { status: AcStatus; className?: string }) {
  const { icon: Icon, className: tone } = AC_ICON[status];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full [&>svg]:size-2.5",
        status === "pending" && "[&>svg]:size-4",
        tone,
        className,
      )}
    >
      <Icon strokeWidth={status === "pending" ? 2 : 3.5} />
    </span>
  );
}

/** Acceptance criteria as a checklist marked by the latest holdout run; hover a line for the holdout's message. */
export function AcChecklist({ summary }: { summary: AcSummary }) {
  if (summary.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No acceptance criteria. The Verifier has nothing to hold this ticket to.</p>;
  }
  return (
    <ul className="flex flex-col">
      {summary.items.map((ac) => (
        <li key={ac.id}>
          <HoverCard openDelay={150} closeDelay={50}>
            <HoverCardTrigger asChild>
              <div
                tabIndex={0}
                aria-label={`${ac.id} ${AC_ICON[ac.status].label}: ${ac.text}${ac.message ? `. Holdout: ${ac.message}` : ""}`}
                className="grid grid-cols-[1rem_3rem_minmax(0,1fr)] items-start gap-2 rounded-md px-1.5 py-1.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AcMark status={ac.status} className="mt-0.5" />
                <span className="font-mono text-xs leading-5 text-muted-foreground">{ac.id}</span>
                <span className={cn("line-clamp-2 text-sm leading-5", ac.status === "FAIL" && "text-fail")}>{ac.text}</span>
              </div>
            </HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-96 max-w-[calc(100vw-2rem)]">
              <AcDetail ac={ac} at={summary.at} />
            </HoverCardContent>
          </HoverCard>
        </li>
      ))}
    </ul>
  );
}

function AcDetail({ ac, at }: { ac: AcItem; at: string | undefined }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AcMark status={ac.status} />
        {ac.id} {AC_ICON[ac.status].label}
      </p>
      <p>{ac.text}</p>
      {ac.message ? <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-words">{ac.message}</p> : null}
      <p className="text-xs text-muted-foreground">{at ? `Holdouts ran ${relativeTime(at)}` : "Holdouts have not run for this ticket yet."}</p>
    </div>
  );
}

/** One chip per criterion: compact evidence for cards and the inbox. */
export function AcChips({ summary }: { summary: AcSummary }) {
  if (summary.items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={`Acceptance criteria: ${summary.passed} of ${summary.items.length} pass`}>
      {summary.items.map((ac) => (
        <li key={ac.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-label={`${ac.id} ${AC_ICON[ac.status].label}`}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ac.status === "PASS" && "border-pass/40",
                  ac.status === "FAIL" && "border-fail/60 text-fail",
                  ac.status === "pending" && "border-dashed text-muted-foreground",
                )}
              >
                <AcMark status={ac.status} className="size-3.5 [&>svg]:size-2" />
                {ac.id}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-80">
              <span className="block">{ac.text}</span>
              {ac.message ? <span className="mt-1 block font-mono opacity-80">{ac.message}</span> : null}
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** Regression checks from earlier tickets, as one count. */
export function RegressionCount({ summary }: { summary: AcSummary }) {
  const { passed, failed, failing } = summary.regression;
  const total = passed + failed;
  if (total === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
            failed ? "text-fail" : "text-muted-foreground",
          )}
        >
          <ShieldCheckIcon aria-hidden className="size-3.5" />
          <span className="tabular-nums">
            {passed}/{total}
          </span>
          regression checks
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        {failed === 0 ? "Every regression check from earlier tickets still passes." : failing.map((f) => `${f.id}: ${f.message || "failed"}`).join("\n")}
      </TooltipContent>
    </Tooltip>
  );
}

const CHECK_TONE: Record<CheckStatus, string> = {
  PASS: "border-pass/40 [&>svg]:text-pass",
  FAIL: "border-fail/60 text-fail",
  unknown: "border-dashed text-muted-foreground",
};

/** Gate checks from `gates.md`, one chip each. */
export function GateChips({ checks }: { checks: GateCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Gate checks">
      {checks.map((c) => {
        const Icon = c.status === "PASS" ? CheckIcon : c.status === "FAIL" ? XIcon : CircleHelpIcon;
        return (
          <li key={c.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-3",
                    CHECK_TONE[c.status],
                  )}
                >
                  <Icon aria-hidden strokeWidth={3} />
                  {humanize(c.id)}
                  <span className="sr-only">: {c.status === "unknown" ? "result not recorded" : c.status}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-96 whitespace-pre-wrap">{c.body.split("\n").slice(0, 4).join("\n") || c.status}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
