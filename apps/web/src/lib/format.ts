/** Duration between two ISO timestamps (or until now), e.g. `42s`, `3m 05s`, `1h 12m`. */
export function duration(startIso: string | null, endIso: string | null, now = Date.now()): string {
  if (!startIso) return "";
  const ms = Math.max(0, (endIso ? Date.parse(endIso) : now) - Date.parse(startIso));
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

/** `3 min. ago`, `yesterday`… */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export const shortCommit = (sha?: string) => (sha ? sha.slice(0, 7) : "");
export const shortId = (id: string) => id.replace(/^[a-z]+_/, "").slice(0, 8);
export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const humanize = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

/** A one-glance summary: markdown markers and the verdict line (shown separately) removed. */
export function plainSummary(md: string): string {
  return md
    .replace(/^\s*VERDICT:.*$/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*|__|`|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
