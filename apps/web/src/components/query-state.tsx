import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
