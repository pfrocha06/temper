import { PlayIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { TicketTypeBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fileScopeHint } from "@/lib/board";
import { useStartTicket } from "@/lib/queries";
import type { Ticket } from "@/lib/types";

export function TicketCard({ ticket }: { ticket: Ticket }) {
  const start = useStartTicket();
  const scope = fileScopeHint(ticket.fileScope);
  return (
    <article className="group/card relative flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-card-foreground transition-colors hover:border-ring/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex items-center justify-between gap-2">
        <TicketTypeBadge type={ticket.type} />
        {ticket.stage ? <span className="truncate text-xs text-muted-foreground">{ticket.stage}</span> : null}
      </div>
      <h3 className="text-sm leading-snug font-medium">
        <Link to={`/tickets/${ticket.id}`} className="outline-none after:absolute after:inset-0">
          {ticket.title}
        </Link>
      </h3>
      {scope ? (
        <p className="truncate font-mono text-xs text-muted-foreground" title={ticket.fileScope.join("\n")}>
          {scope}
        </p>
      ) : null}
      {ticket.status === "backlog" ? (
        <Button
          size="xs"
          variant="outline"
          className="relative z-10 self-start"
          disabled={start.isPending}
          onClick={() =>
            start.mutate(ticket.id, {
              onSuccess: () => toast.success(`Started “${ticket.title}”`),
              onError: (e) => toast.error(`Could not start: ${e.message}`),
            })
          }
        >
          {start.isPending ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          Start
        </Button>
      ) : null}
    </article>
  );
}
