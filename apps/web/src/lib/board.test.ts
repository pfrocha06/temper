import { describe, expect, it } from "vitest";
import { groupByStatus, parseLines } from "./board";
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
