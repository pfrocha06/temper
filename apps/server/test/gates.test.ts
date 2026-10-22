import { describe, expect, it } from "vitest";
import { builderFeedback, parseHoldoutResults } from "../src/gates/holdout-results.ts";
import { diffGuard } from "../src/gates/diff-guard.ts";
import { scanAddedLines } from "../src/gates/secret-scan.ts";

describe("diffGuard", () => {
  const base = { ticketType: "feature", fileScope: ["apps/web/src/*"], existingTestDiff: "" };

  it("allows new tests and in-scope changes", () => {
    const r = diffGuard({ ...base, changes: [{ status: "M", path: "apps/web/src/a.ts" }, { status: "A", path: "apps/web/test/a.test.ts" }] });
    expect(r).toEqual({ ok: true, problems: [] });
  });

  it("rejects out-of-scope changes", () => {
    expect(diffGuard({ ...base, changes: [{ status: "M", path: "packages/core/x.ts" }] }).ok).toBe(false);
  });

  it("rejects removed assertions and added skips in existing tests", () => {
    const existingTestDiff = ["--- a/x.test.ts", "+++ b/x.test.ts", "-  expect(total).toBe(3);", "+  it.skip('works', () => {"].join("\n");
    const r = diffGuard({ ...base, changes: [{ status: "M", path: "apps/web/src/x.test.ts" }], existingTestDiff });
    expect(r.problems).toHaveLength(2);
  });

  it("does not mistake an import that names expect for an assertion", () => {
    const existingTestDiff = ['-import { describe, expect, it } from "vitest";', '+import { afterEach, describe, expect, it } from "vitest";'].join("\n");
    expect(diffGuard({ ...base, changes: [{ status: "M", path: "apps/web/src/x.test.ts" }], existingTestDiff }).ok).toBe(true);
  });

  it("rejects deleted tests", () => {
    expect(diffGuard({ ...base, changes: [{ status: "D", path: "apps/web/src/x.test.ts" }] }).ok).toBe(false);
  });

  it("forbids any test change in a refactor", () => {
    const r = diffGuard({ ...base, ticketType: "refactor", changes: [{ status: "A", path: "apps/web/src/new.test.ts" }] });
    expect(r.ok).toBe(false);
  });

  it("exempts verification tickets from test rules", () => {
    const r = diffGuard({ ...base, ticketType: "verification", fileScope: [], changes: [{ status: "D", path: "holdouts/x.spec.ts" }] });
    expect(r.ok).toBe(true);
  });
});

describe("holdout results", () => {
  const out = "setup...\nAC-1: PASS\nAC-2: FAIL archived project still on board (/secret/holdouts/board.spec.ts:12)\nAC-2: PASS\n";

  it("parses criteria and lets FAIL win", () => {
    expect(parseHoldoutResults(out)).toEqual([
      { id: "AC-1", status: "PASS", message: "" },
      { id: "AC-2", status: "FAIL", message: "archived project still on board (/secret/holdouts/board.spec.ts:12)" },
    ]);
  });

  it("treats regression lines as results too", () => {
    expect(parseHoldoutResults("REG-baseline-status: FAIL down\nAC-1: PASS")).toEqual([
      { id: "REG-baseline-status", status: "FAIL", message: "down" },
      { id: "AC-1", status: "PASS", message: "" },
    ]);
  });

  it("gives the builder only criterion ids and scrubbed one-liners", () => {
    const fb = builderFeedback(parseHoldoutResults(out), "/secret/holdouts");
    expect(fb).toBe("AC-2 failed: archived project still on board (<holdouts>/board.spec.ts:12)");
    expect(fb).not.toContain("/secret/holdouts");
  });
});

describe("scanAddedLines", () => {
  it("flags added secrets only", () => {
    const d = ["+++ b/config.ts", "+const API_KEY = 'abc123'", "-const OLD_TOKEN = 'x'", "+const port = 4600"].join("\n");
    expect(scanAddedLines(d)).toEqual(["config.ts: possible secret"]);
  });
});
