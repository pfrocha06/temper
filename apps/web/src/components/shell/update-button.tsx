import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircleIcon, CheckCircle2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { statusQuery, updateLogQuery, updateQuery, useApplyUpdate, useCheckUpdate } from "@/lib/queries";
import type { UpdateStatus } from "@/lib/types";
import { updatePhase } from "./update-phase";

const TARGET_KEY = "temper.update.target";
const readTarget = () => {
  try {
    return localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
};
const writeTarget = (sha: string | null) => {
  try {
    if (sha) localStorage.setItem(TARGET_KEY, sha);
    else localStorage.removeItem(TARGET_KEY);
  } catch {
    /* private window: the success notice is skipped, nothing else */
  }
};

/**
 * The top bar's update control. Hidden while Temper is current; otherwise it says how many
 * commits are waiting, and opens a dialog that applies them and follows the update through
 * the restart. The update itself runs outside the server, so it survives the restart.
 */
export function UpdateButton() {
  const [target, setTarget] = useState<string | null>(readTarget);
  const update = useQuery(updateQuery(target !== null));
  const [open, setOpen] = useState(false);
  const s = update.data;
  const phase = updatePhase(s ?? null, target);

  // Back on the new version: say so once, and offer a reload for the new console.
  const announced = useRef(false);
  useEffect(() => {
    if (phase !== "done" || announced.current) return;
    announced.current = true;
    toast.success(`Temper updated to ${s!.current.slice(0, 7)}`, { action: { label: "Reload", onClick: () => location.reload() }, duration: Infinity });
  }, [phase, s]);

  if (!s || phase === "current") return null;
  const label =
    phase === "available" ? (s.channel === "releases" && s.latestVersion ? `Update to ${s.latestVersion}` : `Update · ${s.behind}`) : phase === "applying" ? "Updating…" : phase === "failed" ? "Update failed" : "Updated · reload";
  return (
    <>
      <Button
        size="sm"
        variant={phase === "failed" ? "destructive" : phase === "available" ? "default" : "outline"}
        onClick={() => (phase === "done" ? (writeTarget(null), location.reload()) : setOpen(true))}
        aria-label={phase === "available" ? `${s.latestVersion ?? `${s.behind} new commits`} available. Open update` : label}
      >
        {phase === "applying" ? (
          <Spinner data-icon="inline-start" />
        ) : phase === "failed" ? (
          <TriangleAlertIcon data-icon="inline-start" />
        ) : phase === "done" ? (
          <CheckCircle2Icon data-icon="inline-start" />
        ) : (
          <ArrowUpCircleIcon data-icon="inline-start" />
        )}
        <span className="max-sm:hidden">{label}</span>
      </Button>
      <UpdateDialog
        status={s}
        phase={phase}
        open={open}
        onOpenChange={setOpen}
        onStarted={(sha) => {
          writeTarget(sha);
          setTarget(sha);
        }}
      />
    </>
  );
}

function UpdateDialog({
  status: s,
  phase,
  open,
  onOpenChange,
  onStarted,
}: {
  status: UpdateStatus;
  phase: ReturnType<typeof updatePhase>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStarted: (sha: string) => void;
}) {
  const check = useCheckUpdate();
  const apply = useApplyUpdate();
  const factory = useQuery(statusQuery);
  const showLog = open && (phase === "applying" || phase === "failed");
  const log = useQuery(updateLogQuery(showLog));
  const logEnd = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logEnd.current?.scrollTo({ top: logEnd.current.scrollHeight });
  }, [log.data]);
  const active = factory.data?.active.length ?? 0;

  const start = () =>
    apply
      .mutateAsync()
      .then((r) => {
        onStarted(r.applying!.target);
        toast.info("Update started. Temper keeps working while the new version is built and checked.");
      })
      .catch((e: Error) => toast.error(`Could not start the update: ${e.message}`));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{phase === "failed" ? "Update failed" : phase === "applying" ? "Updating Temper" : "Update Temper"}</DialogTitle>
          <DialogDescription>
            Running <span className="font-mono">{s.version || s.current.slice(0, 7)}</span>
            {s.latestVersion ? (
              <>
                {" "}
                → <span className="font-mono">{s.latestVersion}</span>
                {s.channel === "main" ? <span className="text-muted-foreground"> (head of {s.branch})</span> : null}
              </>
            ) : null}
            {s.checkedAt ? <span className="text-muted-foreground"> · checked {new Date(s.checkedAt).toLocaleTimeString()}</span> : null}
          </DialogDescription>
        </DialogHeader>

        {phase === "available" ? (
          <>
            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-y px-6 py-2">
              <p className="mb-2 flex items-baseline gap-3 text-sm font-medium">
                <span>
                  {s.behind} new commit{s.behind === 1 ? "" : "s"}
                  {s.behind > s.commits.length ? ` (newest ${s.commits.length} shown)` : ""}
                </span>
                {s.notesUrl ? (
                  <a href={s.notesUrl} target="_blank" rel="noreferrer" className="text-xs font-normal text-primary underline-offset-2 hover:underline">
                    Release notes
                  </a>
                ) : null}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {s.commits.map((c) => (
                  <li key={c.sha} className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">{c.sha}</span>
                    <span>{c.subject}</span>
                  </li>
                ))}
              </ul>
            </div>
            {s.service === "none" ? (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>Update by hand here</AlertTitle>
                <AlertDescription>
                  Temper is not running under launchd or systemd, so it cannot restart itself. Pull the checkout and restart <code>temper serve</code>.
                </AlertDescription>
              </Alert>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>The new version is built and the full check runs. Temper keeps working meanwhile.</li>
                <li>
                  Then dispatching pauses and Temper waits for running agents to finish
                  {active ? ` (${active} running now)` : ""}.
                </li>
                <li>The service switches over. The database is backed up first, and a failed health check rolls back.</li>
              </ol>
            )}
          </>
        ) : null}

        {showLog ? (
          <pre ref={logEnd} className="-mx-6 min-h-40 flex-1 overflow-auto border-y bg-muted/40 px-6 py-3 font-mono text-xs whitespace-pre-wrap">
            {log.data || (log.isPending ? "Starting…" : "No output yet.")}
          </pre>
        ) : null}
        {phase === "applying" ? (
          <p className="text-sm text-muted-foreground">
            You can close this. While the service restarts, the console shows the server as offline for a moment, then this button turns into “Updated · reload”.
          </p>
        ) : null}
        {s.error ? <p className="text-sm text-destructive">Last check failed: {s.error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending || phase === "applying"}>
            {check.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Check again
          </Button>
          {phase === "available" || phase === "failed" ? (
            <Button onClick={() => void start()} disabled={apply.isPending || s.service === "none" || s.behind === 0}>
              {apply.isPending ? <Spinner data-icon="inline-start" /> : <ArrowUpCircleIcon data-icon="inline-start" />}
              {phase === "failed" ? "Try again" : "Update now"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
