import { describe, expect, it } from "vitest";
import type { Dispatch } from "@/lib/types";
import { runOrder } from "./runs-page";

const d = (id: string, status: string, createdAt: string) => ({ id, status, createdAt }) as Dispatch;

describe("runOrder", () => {
  it("puts running dispatches first, then the most recent", () => {
    const ordered = runOrder([
      d("old-done", "succeeded", "2026-10-22T10:00:00Z"),
      d("old-running", "running", "2026-10-22T09:00:00Z"),
      d("new-done", "failed", "2026-10-22T12:00:00Z"),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(["old-running", "new-done", "old-done"]);
  });
});
