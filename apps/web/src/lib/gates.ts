import type { Artifact, Ticket } from "./types";

export type CheckStatus = "PASS" | "FAIL" | "unknown";
export type GateCheck = { id: string; status: CheckStatus; body: string };
export type HoldoutResult = { id: string; status: "PASS" | "FAIL"; message: string };
export type GatesReport = { checks: GateCheck[]; holdouts: HoldoutResult[]; filesChanged: number | undefined };

const CHECK_HEADING = /^##\s+([a-z_]+)\s*:\s*(.*)$/;
// Same shape the server parses from holdout output (apps/server/src/gates/holdout-results.ts),
// rendered into gates.md as `- AC-1: PASS — message`.
const HOLDOUT_LINE = /^\s*[-*]\s+((?:AC|REG)-[A-Za-z0-9_.-]+)\s*:\s*(PASS|FAIL)\b\s*(?:[—–-]\s*)?(.*)$/;
const FILES_CHANGED = /(\d+)\s+files?\s+changed/;

/** Reads a `gates.md` artifact: one `## check: PASS|FAIL` section per gate check. */
export function parseGates(md: string): GatesReport {
  const checks: GateCheck[] = [];
  const holdouts = new Map<string, HoldoutResult>();
  let current: GateCheck | undefined;
  let inFence = false;
  for (const line of md.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    const heading = inFence ? null : CHECK_HEADING.exec(line);
    if (heading) {
      const word = heading[2]!.trim().split(/\s+/)[0]!.toUpperCase();
      current = { id: heading[1]!, status: word === "PASS" || word === "FAIL" ? word : "unknown", body: "" };
      checks.push(current);
      continue;
    }
    if (!current) continue;
    current.body += `${line}\n`;
    if (current.id !== "holdouts" || inFence) continue;
    const m = HOLDOUT_LINE.exec(line);
    if (!m) continue;
    const prev = holdouts.get(m[1]!);
    // A FAIL for a criterion wins over a PASS, as on the server.
    if (!prev || m[2] === "FAIL") holdouts.set(m[1]!, { id: m[1]!, status: m[2] as "PASS" | "FAIL", message: m[3]!.trim() });
  }
  for (const c of checks) c.body = c.body.trim();
  const diff = checks.find((c) => c.id === "diff_guard");
  const files = diff ? FILES_CHANGED.exec(diff.body) : null;
  return { checks, holdouts: [...holdouts.values()], filesChanged: files ? Number(files[1]) : undefined };
}

/** `pending`: no holdout run has reported on this criterion yet. */
export type AcStatus = "PASS" | "FAIL" | "pending";
export type AcItem = { id: string; text: string; status: AcStatus; message: string };
export type AcSummary = {
  items: AcItem[];
  passed: number;
  failed: number;
  regression: { passed: number; failed: number; failing: HoldoutResult[] };
  /** When the holdout results were recorded; undefined without a gates artifact. */
  at: string | undefined;
};

/** The latest artifact with this name (artifacts are versioned by id). */
export function latestArtifact(artifacts: Artifact[], name: string): Artifact | undefined {
  let best: Artifact | undefined;
  for (const a of artifacts) if (a.name === name && (!best || a.id > best.id)) best = a;
  return best;
}

/** Each acceptance criterion with its status from the latest holdout run, plus regression counts. */
export function acceptanceStatus(ticket: Pick<Ticket, "acceptanceCriteria">, artifacts: Artifact[]): AcSummary {
  const gates = latestArtifact(artifacts, "gates.md");
  const report = gates ? parseGates(gates.content) : undefined;
  const byId = new Map((report?.holdouts ?? []).map((h) => [h.id, h]));
  const items = ticket.acceptanceCriteria.map((ac): AcItem => {
    const r = byId.get(ac.id);
    return { id: ac.id, text: ac.text, status: r?.status ?? "pending", message: r?.message ?? "" };
  });
  const reg = (report?.holdouts ?? []).filter((h) => h.id.startsWith("REG-"));
  const failing = reg.filter((h) => h.status === "FAIL");
  return {
    items,
    passed: items.filter((i) => i.status === "PASS").length,
    failed: items.filter((i) => i.status === "FAIL").length,
    regression: { passed: reg.length - failing.length, failed: failing.length, failing },
    at: report?.checks.some((c) => c.id === "holdouts") ? gates?.createdAt : undefined,
  };
}

/**
 * A one-line summary of a markdown artifact: its first prose sentence, else its first list
 * item, else its first heading (without a leading `name.md:`).
 */
export function firstLine(md: string, max = 140): string {
  const found: Record<"prose" | "item" | "heading", string | undefined> = { prose: undefined, item: undefined, heading: undefined };
  let inFence = false;
  for (const raw of md.split("\n")) {
    const t = raw.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !t || /^VERDICT:/i.test(t) || /^[-*_]{3,}$/.test(t) || t.startsWith("|")) continue;
    const kind = t.startsWith("#") ? "heading" : /^([-*+]|\d+[.)])\s/.test(t) ? "item" : "prose";
    const text = t
      .replace(/^(#+|[-*+]|\d+[.)]|>)\s*/, "")
      .replace(/^[\w.-]+\.md\s*:\s*/, "")
      .replace(/\*\*|__|`|(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, "")
      .trim();
    if (text && !found[kind]) found[kind] = text;
    if (found.prose) break;
  }
  const line = found.prose ?? found.item ?? found.heading ?? "";
  // First sentence only.
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}
