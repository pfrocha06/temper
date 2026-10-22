import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/lib/constants";
import { canDrop, isDraggable } from "./board-model";

describe("board drag and drop", () => {
  it("starts only backlog tickets by dropping them on Ready", () => {
    expect(TICKET_STATUSES.filter((s) => canDrop(s, "ready"))).toEqual(["backlog"]);
  });

  it("cancels any open ticket dropped on Cancelled", () => {
    expect(TICKET_STATUSES.filter((s) => canDrop(s, "cancelled"))).toEqual(["backlog", "ready", "in_progress", "awaiting_board"]);
  });

  it("accepts no other drops, and finished tickets do not move", () => {
    for (const to of ["backlog", "in_progress", "awaiting_board", "done"] as const) {
      expect(TICKET_STATUSES.some((s) => canDrop(s, to))).toBe(false);
    }
    expect(isDraggable("done")).toBe(false);
    expect(isDraggable("cancelled")).toBe(false);
    expect(isDraggable("awaiting_board")).toBe(true);
  });
});
