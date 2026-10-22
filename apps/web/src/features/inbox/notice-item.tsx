import { ArrowUpRightIcon, BellIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { relativeTime } from "@/lib/format";
import type { Approval } from "@/lib/types";
import { useResolve } from "./approval-buttons";

/** Notices about providers (caps, limits) point at the Providers page. */
const PROVIDER_RE = /\b(cap|caps|provider|limit|rate[- ]limit)\b/i;

/** A `notice`: something the board should know, not a decision. Its only option is to dismiss it. */
export function NoticeItem({ approval, selected, onSelect }: { approval: Approval; selected: boolean; onSelect: () => void }) {
  const resolve = useResolve();
  const option = approval.options[0] ?? "dismiss";
  const aboutProviders = PROVIDER_RE.test(`${approval.title} ${approval.body}`);
  return (
    <article
      id={`apv-${approval.id}`}
      aria-labelledby={`apv-h-${approval.id}`}
      aria-current={selected ? "true" : undefined}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3",
        selected && "border-solid border-ring/50",
      )}
    >
      <BellIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="font-medium">Notice</span>
          <time dateTime={approval.createdAt} title={approval.createdAt}>
            {relativeTime(approval.createdAt)}
          </time>
        </p>
        <h2 id={`apv-h-${approval.id}`} className="text-sm leading-snug font-medium">
          {approval.title}
        </h2>
        {approval.body ? <Markdown className="text-[0.8125rem] text-muted-foreground">{approval.body}</Markdown> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
        {aboutProviders ? (
          <Button asChild size="sm" variant="ghost">
            <Link to="/settings/providers">
              Providers
              <ArrowUpRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ approval, resolution: option })}>
          {resolve.isPending ? <Spinner data-icon="inline-start" /> : null}
          Dismiss
        </Button>
      </div>
    </article>
  );
}
