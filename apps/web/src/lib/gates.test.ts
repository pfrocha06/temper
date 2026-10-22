import { describe, expect, it } from "vitest";
import { acceptanceStatus, firstLine, parseGates } from "./gates";
import type { Artifact } from "./types";

const GATES = `## builder_tests: PASS
\`pnpm check\` at 9ccf83d73a exited 0
\`\`\`
## not_a_check: FAIL
- AC-9: FAIL — inside a fence, ignored
\`\`\`

## diff_guard: PASS
3 files changed, all allowed.

## secret_scan: [redacted]
built-in scan: clean

## holdouts: FAIL
Holdouts exited 1.
- REG-baseline-status: PASS
- REG-baseline-agents: FAIL — 500 from /api/agents
- AC-1: PASS — GET /api/health -> 200 with no credentials
- AC-2: FAIL — version was "abc" not "9ccf83d"
- AC-2: PASS — a later PASS does not hide the FAIL
- AC-3: PASS
`;

const artifact = (id: number, name: string, content: string): Artifact =>
  ({ id, name, content, ticketId: "t", dispatchId: null, createdAt: `2026-10-22T13:0${id}:00.000Z` }) as Artifact;

describe("parseGates", () => {
  it("reads one check per section, ignoring headings inside code fences", () => {
    const r = parseGates(GATES);
    expect(r.checks.map((c) => [c.id, c.status])).toEqual([
      ["builder_tests", "PASS"],
      ["diff_guard", "PASS"],
      ["secret_scan", "unknown"],
      ["holdouts", "FAIL"],
    ]);
  });

  it("reads holdout lines with their message; a FAIL wins over a PASS for the same id", () => {
    const r = parseGates(GATES);
    expect(r.holdouts).toEqual([
      { id: "REG-baseline-status", status: "PASS", message: "" },
      { id: "REG-baseline-agents", status: "FAIL", message: "500 from /api/agents" },
      { id: "AC-1", status: "PASS", message: "GET /api/health -> 200 with no credentials" },
      { id: "AC-2", status: "FAIL", message: 'version was "abc" not "9ccf83d"' },
      { id: "AC-3", status: "PASS", message: "" },
    ]);
  });

  it("derives the number of files changed from the diff guard", () => {
    expect(parseGates(GATES).filesChanged).toBe(3);
    expect(parseGates("## builder_tests: PASS\nok").filesChanged).toBeUndefined();
  });
});

describe("acceptanceStatus", () => {
  const ticket = {
    acceptanceCriteria: [
      { id: "AC-1", text: "returns 200" },
      { id: "AC-2", text: "reports the version" },
      { id: "AC-4", text: "never reported" },
    ],
  };

  it("marks each criterion from the latest gates artifact and counts regression checks", () => {
    const older = artifact(1, "gates.md", "## holdouts: PASS\n- AC-1: FAIL — old run");
    const s = acceptanceStatus(ticket, [older, artifact(2, "gates.md", GATES), artifact(3, "review.md", "- AC-4: PASS")]);
    expect(s.items.map((i) => [i.id, i.status])).toEqual([
      ["AC-1", "PASS"],
      ["AC-2", "FAIL"],
      ["AC-4", "pending"],
    ]);
    expect(s.items[1]!.message).toBe('version was "abc" not "9ccf83d"');
    expect([s.passed, s.failed]).toEqual([1, 1]);
    expect(s.regression).toMatchObject({ passed: 1, failed: 1 });
    expect(s.regression.failing.map((f) => f.id)).toEqual(["REG-baseline-agents"]);
    expect(s.at).toBe("2026-10-22T13:02:00.000Z");
  });

  it("leaves every criterion pending before any holdout run", () => {
    const s = acceptanceStatus(ticket, []);
    expect(s.items.every((i) => i.status === "pending")).toBe(true);
    expect(s.at).toBeUndefined();
    // A gates run that stopped before holdouts says nothing about the criteria either.
    expect(acceptanceStatus(ticket, [artifact(4, "gates.md", "## builder_tests: FAIL\nNo commits")]).at).toBeUndefined();
  });
});

describe("firstLine", () => {
  it("prefers the first prose sentence over headings and list items", () => {
    expect(firstLine("# verification.md: tkt_1\n\nAll five criteria pass. More detail.\n\nVERDICT: PASS")).toBe("All five criteria pass.");
  });
  it("falls back to a list item, then to a heading without its file name", () => {
    expect(firstLine("# changes.md: GET /api/health\n## What changed\n- **`health.ts`** (new)")).toBe("health.ts (new)");
    expect(firstLine("# changes.md: GET /api/health")).toBe("GET /api/health");
  });
  it("keeps underscores in identifiers while dropping emphasis", () => {
    expect(firstLine("- **builder_tests**: No commits were made.")).toBe("builder_tests: No commits were made.");
  });
});
