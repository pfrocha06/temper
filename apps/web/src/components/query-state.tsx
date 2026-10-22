import { AlertCircleIcon, InfoIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isOffline } from "@/lib/api";

export function QueryError({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const offline = isOffline(error);
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{offline ? `Could not reach the server to load ${what}` : `Could not load ${what}`}</AlertTitle>
      <AlertDescription>
        {offline ? "Check that the Temper service is running. This page retries when it comes back." : error instanceof Error ? error.message : String(error)}
      </AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * A slim page bar: the title, a few facts beside it, and actions. What the page is for lives
 * in the info tooltip, not in a sentence under every title.
 */
export function PageHeader({ title, info, meta, actions }: { title: string; info?: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 md:px-6">
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      {info ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`About ${title}`} className="-ml-1.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground">
              <InfoIcon aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{info}</TooltipContent>
        </Tooltip>
      ) : null}
      {meta ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{meta}</div> : null}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
