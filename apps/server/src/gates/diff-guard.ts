import type { ChangedFile } from "../git.ts";

export const isTestFile = (p: string) => /(^|\/)(test|tests|__tests__|holdouts)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

// An assertion is a call, not a mention: `expect(…)`, `assert(…)`, `assert.x(…)`, `.toBe(…)`, `.should`.
// Import lines that merely name `expect` are not assertions.
const ASSERTION = /\b(expect|assert)\s*[.(]|\.(toBe|toEqual|toStrictEqual|toThrow|toMatch|toContain|toHaveLength|toHaveBeenCalled\w*|should)\b/;
const IMPORT = /^\s*(import\b|export\s+\{|const\s+\{[^}]*\}\s*=\s*require\()/;
const FOCUS_OR_SKIP = /\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe)\(|\bf(it|describe)\(/;

export type GuardInput = {
  ticketType: string;
  fileScope: string[];
  changes: ChangedFile[];
  /** Unified diff restricted to pre-existing test files that were modified or deleted. */
  existingTestDiff: string;
};

export type GuardResult = { ok: boolean; problems: string[] };

function inScope(path: string, scope: string[]): boolean {
  if (scope.length === 0) return true;
  return scope.some((s) => {
    const prefix = s.replace(/\*.*$/, "");
    return s.includes("*") ? path.startsWith(prefix) : path === s || path.startsWith(s.endsWith("/") ? s : `${s}/`);
  });
}

const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
const isManifest = (p: string) => p === "package.json" || p.endsWith("/package.json");

/**
 * Builders may add tests but may not weaken existing ones. Refactors may not touch tests at all.
 * Changes outside the ticket's file scope are rejected, except the root lockfile when an in-scope
 * package manifest changed (adding a workspace package always rewrites it). Verification tickets
 * are exempt from the test rules (they are Verifier-owned and board-approved).
 */
export function diffGuard(input: GuardInput): GuardResult {
  const problems: string[] = [];
  const tests = input.changes.filter((c) => isTestFile(c.path));
  const manifestChanged = input.changes.some((c) => isManifest(c.path) && inScope(c.path, input.fileScope));

  for (const c of input.changes) {
    if (LOCKFILES.has(c.path) && manifestChanged) continue;
    if (!inScope(c.path, input.fileScope) && !(isTestFile(c.path) && c.status === "A")) {
      problems.push(`${c.path} is outside the ticket's file scope`);
    }
  }

  if (input.ticketType !== "verification") {
    if (input.ticketType === "refactor" && tests.length > 0) {
      problems.push(`refactors may not change tests: ${tests.map((t) => t.path).join(", ")}`);
    }
    for (const t of tests.filter((t) => t.status === "D")) problems.push(`deleted test file ${t.path}`);

    for (const line of input.existingTestDiff.split("\n")) {
      if (line.startsWith("---") || line.startsWith("+++")) continue;
      if (line.startsWith("-") && !IMPORT.test(line.slice(1)) && ASSERTION.test(line)) problems.push(`removed assertion: ${line.slice(1).trim()}`);
      if (line.startsWith("+") && FOCUS_OR_SKIP.test(line)) problems.push(`added skip/only: ${line.slice(1).trim()}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
