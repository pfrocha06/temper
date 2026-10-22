import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, KeyRoundIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { probeAuth, useAuthRequired } from "@/lib/auth";

/** Shows the sign-in screen instead of the app whenever the server answers 401. */
export function AuthGate({ children }: { children: ReactNode }) {
  const required = useAuthRequired();
  return required ? <SignIn /> : children;
}

const COMMANDS = [
  { label: "Installed", command: "temper open" },
  { label: "From a checkout", command: "node apps/server/src/cli.ts open" },
];

function SignIn() {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [stillOut, setStillOut] = useState(false);

  const check = async () => {
    setChecking(true);
    const ok = await probeAuth();
    setChecking(false);
    if (ok) void qc.invalidateQueries();
    else setStillOut(true);
  };

  // Coming back from the sign-in link in another tab: check again without a click.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void probeAuth().then((ok) => ok && void qc.invalidateQueries());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [qc]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="size-5" aria-hidden>
            <rect x="1" y="2" width="14" height="2.5" rx="1.25" className="fill-heat-cool" />
            <rect x="1" y="6.75" width="14" height="2.5" rx="1.25" className="fill-heat-warm" />
            <rect x="1" y="11.5" width="14" height="2.5" rx="1.25" className="fill-heat-hot" />
          </svg>
          <span className="text-[0.9375rem] font-semibold tracking-tight">Temper</span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <KeyRoundIcon aria-hidden className="size-5 text-board" />
            Sign in as the board
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This console only answers to the board. Run this in a terminal on the machine where Temper runs; it opens a link that signs this
            browser in and brings you back here.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {COMMANDS.map((c) => (
            <li key={c.command}>
              <CommandLine label={c.label} command={c.command} />
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">
          Using another browser? <code className="font-mono">temper open</code> also prints the link; paste it there. The link carries the board
          token, so keep it to yourself.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void check()} disabled={checking}>
            {checking ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Check again
          </Button>
          {stillOut && !checking ? (
            <p role="status" className="text-sm text-muted-foreground">
              Still signed out. Open the link from the terminal first.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function CommandLine({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the command is still selectable.
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <code className="truncate font-mono text-sm select-all">
          <span aria-hidden className="text-muted-foreground select-none">
            ${" "}
          </span>
          {command}
        </code>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label={`Copy ${command}`}>
        {copied ? <CheckIcon className="text-pass" /> : <CopyIcon />}
      </Button>
    </div>
  );
}
