import { ArrowDownIcon, ArrowUpIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { STATUS_LABEL } from "@/lib/constants";
import { compactNumber } from "@/lib/providers";
import { pct, ticketRows, type TicketSort } from "@/lib/usage";
import type { TicketStatus, UsageReport } from "@/lib/types";

const COLUMNS: Array<{ key: TicketSort | null; label: string; align?: "right" }> = [
  { key: "label", label: "Ticket" },
  { key: null, label: "Type" },
  { key: null, label: "Status" },
  { key: "attempts", label: "Runs", align: "right" },
  { key: "failed", label: "Failed", align: "right" },
  { key: "tokens", label: "Tokens", align: "right" },
];

/** The tickets that cost the most, sortable; failed attempts flagged. */
export function TicketTable({ report, failed }: { report: UsageReport; failed: Map<string, number> }) {
  const [sort, setSort] = useState<TicketSort>("tokens");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const rows = ticketRows(report, failed, sort, dir);
  const top = rows.reduce((m, r) => Math.max(m, r.tokens), 1);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No ticket work in this range.</p>;

  const toggle = (key: TicketSort) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "label" ? "asc" : "desc");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">Most expensive tickets</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                scope="col"
                aria-sort={c.key && c.key === sort ? (dir === "asc" ? "ascending" : "descending") : undefined}
                className={cn("px-2 py-2 font-normal first:pl-0", c.align === "right" ? "text-right" : "text-left")}
              >
                {c.key ? (
                  <button type="button" onClick={() => toggle(c.key!)} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground", c.key === sort && "font-medium text-foreground")}>
                    {c.label}
                    {c.key === sort ? dir === "asc" ? <ArrowUpIcon aria-hidden className="size-3" /> : <ArrowDownIcon aria-hidden className="size-3" /> : null}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticketId} className="border-b last:border-b-0">
              <td className="max-w-80 py-2 pr-2">
                <Link to={`/tickets/${r.ticketId}`} className="line-clamp-1 font-medium hover:underline" title={r.label}>
                  {r.label}
                </Link>
              </td>
              <td className="px-2 py-2 text-muted-foreground">{r.type}</td>
              <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{STATUS_LABEL[r.status as TicketStatus] ?? r.status}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.attempts}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {r.failed > 0 ? (
                  <span className="inline-flex items-center gap-1 text-blocked" title={`${r.failed} attempt${r.failed === 1 ? "" : "s"} ended FAIL or BLOCKED`}>
                    <TriangleAlertIcon aria-hidden className="size-3.5" />
                    {r.failed}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
              <td className="py-2 pl-2">
                <div className="flex items-center justify-end gap-2">
                  <span aria-hidden className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                    <span className="block h-full rounded-full bg-foreground/55" style={{ width: `${(r.tokens / top) * 100}%` }} />
                  </span>
                  <span className="w-12 text-right font-medium tabular-nums">{compactNumber(r.tokens)}</span>
                  <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{pct(r.share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
