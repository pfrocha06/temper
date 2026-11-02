import { describe, expect, it } from "vitest";
import { filterTickets, groupByStatus, issuesOf, parseLines, sourceCounts } from "./board";
import type { Ticket } from "./types";

const ticket = (id: string, status: string, createdAt: string, updatedAt = createdAt): Ticket =>
  ({ id, status, createdAt, updatedAt, title: id, type: "feature", fileScope: [] }) as unknown as Ticket;

describe("groupByStatus", () => {
  it("returns one column per status in workflow order, even when empty", () => {
    expect(groupByStatus([]).map((c) => c.status)).toEqual(["backlog", "ready", "in_progress", "awaiting_board", "done", "cancelled"]);
  });

  it("keeps queues in creation order and the rest most recently updated first", () => {
    const cols = groupByStatus([
      ticket("b2", "backlog", "2026-01-02"),
      ticket("b1", "backlog", "2026-01-01"),
      ticket("d1", "done", "2026-01-01", "2026-02-01"),
      ticket("d2", "done", "2026-01-02", "2026-03-01"),
    ]);
    expect(cols.find((c) => c.status === "backlog")!.tickets.map((t) => t.id)).toEqual(["b1", "b2"]);
    expect(cols.find((c) => c.status === "done")!.tickets.map((t) => t.id)).toEqual(["d2", "d1"]);
  });

  it("drops tickets with a status the board does not know", () => {
    const cols = groupByStatus([ticket("x", "archived", "2026-01-01")]);
    expect(cols.flatMap((c) => c.tickets)).toEqual([]);
  });
});

describe("parseLines", () => {
  it("splits on lines, trims, and strips list markers", () => {
    expect(parseLines("- first\n\n  * second  \n3. third\nplain")).toEqual(["first", "second", "third", "plain"]);
  });

  it("keeps globs intact", () => {
    expect(parseLines("src/**/*.ts\nBash(git diff:*)")).toEqual(["src/**/*.ts", "Bash(git diff:*)"]);
  });
});

describe("filtering by source", () => {
  const ref = (tracker: string, key: string) => ({ externalRef: { tracker, key, url: `https://x/${key}` } });
  const t = (id: string, status: string, extra: object = {}) => ({ ...ticket(id, status, "2026-01-01"), ...extra }) as Ticket;
  const list = [
    t("g1", "backlog", ref("github", "acme/shop#7")),
    t("g2", "done", ref("github", "acme/shop#7")),
    t("g3", "backlog", ref("github", "acme/shop#12")),
    t("g4", "ready", ref("github", "acme/shop#12")),
    t("j1", "backlog", ref("jira", "SHOP-3")),
    t("m1", "backlog"),
  ];

  it("counts tickets per source, GitHub then Jira, untracked last", () => {
    expect(sourceCounts(list)).toEqual([
      { source: "github", count: 4 },
      { source: "jira", count: 1 },
      { source: "none", count: 1 },
    ]);
  });

  it("groups a tracker's tickets by issue, most open first", () => {
    expect(issuesOf(list, "github")).toEqual([
      { key: "acme/shop#12", url: "https://x/acme/shop#12", count: 2, open: 2 },
      { key: "acme/shop#7", url: "https://x/acme/shop#7", count: 2, open: 1 },
    ]);
  });

  it("filters by source, then by issue", () => {
    expect(filterTickets(list, {}).length).toBe(6);
    expect(filterTickets(list, { source: "none" }).map((x) => x.id)).toEqual(["m1"]);
    expect(filterTickets(list, { source: "github", issue: "acme/shop#7" }).map((x) => x.id)).toEqual(["g1", "g2"]);
  });
});
