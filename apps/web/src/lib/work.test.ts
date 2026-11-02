import { describe, expect, it } from "vitest";
import type { Ticket } from "./types";
import { groupWork, specTitle, workColumn, workColumns, workSourceCounts, type WorkItem } from "./work";

let n = 0;
const ticket = (over: Partial<Ticket> & { status: string }): Ticket =>
  ({
    id: `t${++n}`,
    title: `ticket ${n}`,
    type: "feature",
    spec: "",
    prUrl: null,
    externalRef: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as unknown as Ticket;

const gh = (num: number) => ({ tracker: "github", key: `o/r#${num}`, url: `https://github.com/o/r/issues/${num}` });
const fromSpec = (title: string) => `Do the thing.\n\nFrom spec: ${title}`;
const item = (statuses: string[]): WorkItem => groupWork(statuses.map((status) => ticket({ status, spec: fromSpec("S") })))[0]!;

describe("specTitle", () => {
  it("reads the title importSpec appends to every ticket's spec", () => {
    expect(specTitle(ticket({ status: "backlog", spec: fromSpec("Harness fingerprint") }))).toBe("Harness fingerprint");
    expect(specTitle(ticket({ status: "backlog", spec: "Written on the board." }))).toBeUndefined();
  });
});

describe("groupWork", () => {
  it("makes one item per tracker issue, titled by the issue", () => {
    const items = groupWork([
      ticket({ status: "backlog", externalRef: gh(4), spec: fromSpec("Fingerprints") }),
      ticket({ status: "done", externalRef: gh(4), spec: fromSpec("Fingerprints") }),
      ticket({ status: "backlog", externalRef: gh(5), spec: fromSpec("Merge readiness") }),
    ]);
    expect(items.map((i) => [i.title, i.tickets.length, i.ref?.key])).toEqual([
      ["Fingerprints", 2, "o/r#4"],
      ["Merge readiness", 1, "o/r#5"],
    ]);
  });

  it("groups a pasted spec's tickets by its title, and keeps a hand-made ticket on its own", () => {
    const items = groupWork([
      ticket({ status: "backlog", spec: fromSpec("Jira part 2") }),
      ticket({ status: "backlog", spec: fromSpec("Jira part 2") }),
      ticket({ status: "backlog", title: "Fix the typo", spec: "Just this." }),
    ]);
    expect(items.map((i) => [i.title, i.tickets.length, i.source])).toEqual([
      ["Jira part 2", 2, "none"],
      ["Fix the typo", 1, "none"],
    ]);
  });

  it("falls back to the issue key when no ticket says which spec it came from", () => {
    expect(groupWork([ticket({ status: "backlog", externalRef: gh(9) })])[0]!.title).toBe("o/r#9");
  });

  it("counts progress without cancelled tickets, and collects open PRs", () => {
    const i = groupWork([
      ticket({ status: "done", spec: fromSpec("S") }),
      ticket({ status: "in_progress", spec: fromSpec("S"), prUrl: "https://github.com/o/r/pull/1" }),
      ticket({ status: "awaiting_board", spec: fromSpec("S") }),
      ticket({ status: "backlog", spec: fromSpec("S") }),
      ticket({ status: "cancelled", spec: fromSpec("S") }),
    ])[0]!;
    expect({ total: i.total, done: i.done, running: i.running, waiting: i.waiting, backlog: i.backlog, prs: i.prs }).toEqual({
      total: 4,
      done: 1,
      running: 1,
      waiting: 1,
      backlog: 1,
      prs: ["https://github.com/o/r/pull/1"],
    });
  });
});

describe("workColumn", () => {
  it("is Backlog until something starts", () => {
    expect(workColumn(item(["backlog", "backlog"]))).toBe("backlog");
  });

  it("is In progress once any ticket is started, even if some are done", () => {
    expect(workColumn(item(["ready", "backlog"]))).toBe("in_progress");
    expect(workColumn(item(["done", "backlog"]))).toBe("in_progress");
  });

  it("needs you when any ticket waits on the board, whatever the rest do", () => {
    expect(workColumn(item(["in_progress", "awaiting_board", "done"]))).toBe("needs_you");
  });

  it("is Done when every ticket that was not cancelled is done", () => {
    expect(workColumn(item(["done", "cancelled", "done"]))).toBe("done");
  });

  it("is Cancelled only when every ticket was cancelled", () => {
    expect(workColumn(item(["cancelled", "cancelled"]))).toBe("cancelled");
  });
});

describe("workColumns", () => {
  it("returns the columns in order, oldest first in Backlog and most recent first elsewhere", () => {
    const items = groupWork([
      ticket({ status: "backlog", spec: fromSpec("B2"), createdAt: "2026-01-02T00:00:00Z" }),
      ticket({ status: "backlog", spec: fromSpec("B1"), createdAt: "2026-01-01T00:00:00Z" }),
      ticket({ status: "done", spec: fromSpec("D1"), updatedAt: "2026-02-01T00:00:00Z" }),
      ticket({ status: "done", spec: fromSpec("D2"), updatedAt: "2026-03-01T00:00:00Z" }),
    ]);
    const cols = workColumns(items);
    expect(cols.map((c) => c.column)).toEqual(["backlog", "in_progress", "needs_you", "done", "cancelled"]);
    expect(cols[0]!.items.map((i) => i.title)).toEqual(["B1", "B2"]);
    expect(cols[3]!.items.map((i) => i.title)).toEqual(["D2", "D1"]);
  });
});

describe("workSourceCounts", () => {
  it("counts issues, not tickets", () => {
    const items = groupWork([
      ticket({ status: "backlog", externalRef: gh(1) }),
      ticket({ status: "backlog", externalRef: gh(1) }),
      ticket({ status: "backlog", externalRef: gh(2) }),
      ticket({ status: "backlog", spec: fromSpec("S") }),
    ]);
    expect(workSourceCounts(items)).toEqual([
      { source: "github", count: 2 },
      { source: "none", count: 1 },
    ]);
  });
});
