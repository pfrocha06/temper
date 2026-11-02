import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "@/lib/types";
import { updatePhase } from "./update-phase";

const s = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "aaa",
  version: "v0.1.0",
  channel: "releases",
  branch: "main",
  latest: "bbb",
  behind: 2,
  commits: [],
  diverged: false,
  service: "systemd",
  ...over,
});

describe("updatePhase", () => {
  it("hides the button when current, diverged or unknown", () => {
    expect(updatePhase(null, null)).toBe("current");
    expect(updatePhase(s({ behind: 0 }), null)).toBe("current");
    expect(updatePhase(s({ diverged: true, behind: 0 }), null)).toBe("current");
  });

  it("offers an update when origin is ahead", () => {
    expect(updatePhase(s(), null)).toBe("available");
  });

  it("follows an update while it runs and when it fails", () => {
    expect(updatePhase(s({ applying: { startedAt: "t", target: "bbb", log: "l" } }), "bbb")).toBe("applying");
    expect(updatePhase(s({ applying: { startedAt: "t", target: "bbb", log: "l", finished: "failed" } }), "bbb")).toBe("failed");
  });

  it("is done once the restarted server runs the commit this browser asked for", () => {
    expect(updatePhase(s({ current: "bbb", behind: 0 }), "bbb")).toBe("done");
    // Rolled back: the old version is back and the update is offered again.
    expect(updatePhase(s(), "bbb")).toBe("available");
  });
});
