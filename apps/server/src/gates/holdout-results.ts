export type CriterionResult = { id: string; status: "PASS" | "FAIL"; message: string };

const LINE = /^\s*((?:AC|REG)-[A-Za-z0-9_.-]+)\s*:\s*(PASS|FAIL)\b\s*(.*)$/;

/**
 * Holdout commands print one `AC-<id>: PASS|FAIL <message>` line per criterion of the current
 * ticket, and `REG-<scope>-<id>: …` for regression checks from earlier tickets and the baseline.
 */
export function parseHoldoutResults(output: string): CriterionResult[] {
  const byId = new Map<string, CriterionResult>();
  for (const line of output.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const prev = byId.get(m[1]!);
    // Any FAIL for a criterion wins over a PASS.
    if (!prev || m[2] === "FAIL") byId.set(m[1]!, { id: m[1]!, status: m[2] as "PASS" | "FAIL", message: m[3]!.trim() });
  }
  return [...byId.values()];
}

/**
 * What the Builder is allowed to learn from holdouts: which criteria failed and a one-line
 * message, capped in length. Never test source, never file paths into the holdouts repo.
 */
export function builderFeedback(results: CriterionResult[], holdoutsPath?: string): string {
  const failing = results.filter((r) => r.status === "FAIL");
  if (failing.length === 0) return "All acceptance criteria passed the holdout checks.";
  const scrub = (s: string) => (holdoutsPath ? s.split(holdoutsPath).join("<holdouts>") : s).slice(0, 160);
  return failing.map((r) => `${r.id} failed: ${scrub(r.message) || "no detail"}`).join("\n");
}
