import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedFlush, rootsForAudit } from "./live";

describe("rootsForAudit", () => {
  it("maps audit kinds to the queries they make stale", () => {
    expect(rootsForAudit("approval.requested")).toContain("approvals");
    expect(rootsForAudit("dispatch.finished")).toEqual(expect.arrayContaining(["dispatches", "ticket", "status"]));
    expect(rootsForAudit("signal.escaped_bug")).toEqual(["temperature", "status"]);
    expect(rootsForAudit("factory.paused")).toEqual(["status"]);
    expect(rootsForAudit("agent.saved")).toContain("agents");
    expect(rootsForAudit("knowledge.added")).toEqual(["knowledge"]);
    expect(rootsForAudit("chat.started")).toContain("chats");
    expect(rootsForAudit("provider.caps_set")).toContain("providers");
    expect(rootsForAudit("environment.created")).toEqual(["environments", "projects"]);
  });

  it("ignores kinds nothing on screen depends on", () => {
    expect(rootsForAudit("server.started")).toEqual([]);
    expect(rootsForAudit("heartbeat.error")).toEqual([]);
  });
});

describe("createDebouncedFlush", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst into one flush with the union of roots", () => {
    const flush = vi.fn();
    const d = createDebouncedFlush(flush, 300);
    d.add(["tickets"]);
    d.add(["status", "tickets"]);
    vi.advanceTimersByTime(299);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect([...flush.mock.calls[0]![0]].sort()).toEqual(["status", "tickets"]);
  });

  it("does not schedule a flush for nothing, and cancel drops pending roots", () => {
    const flush = vi.fn();
    const d = createDebouncedFlush(flush, 100);
    d.add([]);
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
    d.add(["agents"]);
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
  });
});
