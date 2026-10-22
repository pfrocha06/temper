import { describe, expect, it } from "vitest";
import { actionMeta, chatStreamReducer, chatTitle, initialChatStream, isSendKey, shortTool, temperSummary, thinkingItems } from "./chat";
import type { RunEvent } from "./types";

describe("operator actions", () => {
  it("labels the Chief's operator tools and links them", () => {
    expect(actionMeta({ tool: "propose_decision", summary: "accept apv_1" })).toEqual({ label: "Proposed a decision", write: true, href: "/inbox" });
    expect(actionMeta({ tool: "propose_deploy", summary: "main" })).toMatchObject({ label: "Proposed a deploy", href: "/inbox" });
    expect(actionMeta({ tool: "ticket_retry", summary: "tkt_ab12" })).toEqual({ label: "Retried stage", write: true, href: "/tickets/tkt_ab12" });
    expect(actionMeta({ tool: "factory_pause", summary: "" })).toMatchObject({ label: "Paused the factory", write: true });
    expect(actionMeta({ tool: "approvals_list", summary: "" })).toEqual({ label: "Looked at the Inbox", write: false, href: "/inbox" });
    expect(actionMeta({ tool: "project_register", summary: "web" }).label).toBe("Registered project");
  });

  it("summarises what a proposal or ticket action was about", () => {
    expect(temperSummary("propose_decision", { approvalId: "apv_1", resolution: "accept", reason: "tests pass" })).toBe("accept apv_1");
    expect(temperSummary("propose_deploy", { source: "/dev/temper", reason: "x" })).toBe("main from temper");
    expect(temperSummary("ticket_start", { ticketId: "tkt_1" })).toBe("tkt_1");
  });
});

describe("actionMeta", () => {
  it("links knowledge ids to the entry and titles or queries to a search", () => {
    expect(actionMeta({ tool: "knowledge_update", summary: "kn_ab12cd34" })).toEqual({ label: "Updated knowledge", write: true, href: "/knowledge/kn_ab12cd34" });
    expect(actionMeta({ tool: "knowledge_add", summary: "Use pnpm, not npm" }).href).toBe("/knowledge?q=Use%20pnpm%2C%20not%20npm");
    expect(actionMeta({ tool: "knowledge_search", summary: "deploy" })).toMatchObject({ label: "Searched knowledge", write: false });
  });

  it("sends ticket actions to the board and leaves unknown tools unlinked", () => {
    expect(actionMeta({ tool: "ticket_create", summary: "Add login" })).toEqual({ label: "Created ticket", write: true, href: "/board" });
    expect(actionMeta({ tool: "mcp__linear__issue", summary: "x" })).toEqual({ label: "mcp__linear__issue", write: false, href: undefined });
  });

  it("accepts the full MCP tool name too", () => {
    expect(shortTool("mcp__temper__knowledge_add")).toBe("knowledge_add");
    expect(actionMeta({ tool: "mcp__temper__knowledge_archive", summary: "kn_x" }).label).toBe("Archived knowledge");
  });
});

describe("thinkingItems", () => {
  const events: RunEvent[] = [
    { kind: "init", sessionId: "s1" },
    { kind: "text", text: "Let me check what we know." },
    { kind: "text", text: "Two entries look relevant." },
    { kind: "tool_use", tool: "mcp__temper__knowledge_search", input: { query: "auth" } },
    { kind: "tool_result", isError: false, content: "[]" },
    { kind: "tool_use", tool: "mcp__temper__knowledge_add", input: { title: "Board auth uses a cookie", kind: "convention" } },
    { kind: "tool_use", tool: "Read", input: { file_path: "apps/server/src/auth.ts" } },
    { kind: "tool_result", isError: true, content: "ENOENT" },
    { kind: "result", text: "Done", isError: false },
  ];

  it("merges consecutive text and turns tool calls into chips", () => {
    const items = thinkingItems(events);
    expect(items.map((i) => i.kind)).toEqual(["text", "action", "action", "action"]);
    expect(items[0]).toMatchObject({ kind: "text", text: "Let me check what we know.\n\nTwo entries look relevant." });
    expect(items[1]).toMatchObject({ action: { tool: "knowledge_search", summary: "auth" }, state: "ok" });
    expect(items[2]).toMatchObject({ action: { tool: "knowledge_add", summary: "Board auth uses a cookie" }, meta: { write: true } });
  });

  it("settles the latest open call with each result", () => {
    const items = thinkingItems(events);
    // The Read got the error; the knowledge_add before it has no result yet.
    expect(items[3]).toMatchObject({ action: { tool: "Read", summary: "apps/server/src/auth.ts" }, state: "error" });
    expect(items[2]).toMatchObject({ state: "running" });
  });

  it("surfaces rate limits and stderr as notices, and ignores the final result", () => {
    const items = thinkingItems([
      { kind: "rate_limited", text: "until 12:00" },
      { kind: "stderr", text: "  " },
      { kind: "result", text: "x", isError: false },
    ]);
    expect(items).toEqual([{ key: 0, kind: "notice", text: "Rate limited: until 12:00", tone: "error" }]);
  });
});

describe("chatStreamReducer", () => {
  const reduce = chatStreamReducer("chat_1");
  const text: RunEvent = { kind: "text", text: "hi" };

  it("follows a turn from start to the stored reply", () => {
    let s = reduce(initialChatStream, { chatId: "chat_1", kind: "started" });
    expect(s).toEqual({ thinking: true, events: [] });
    s = reduce(s, { chatId: "chat_1", kind: "event", event: text });
    expect(s.events).toEqual([text]);
    s = reduce(s, { chatId: "chat_1", kind: "finished" });
    // Still shown until the reply is fetched, so nothing flashes.
    expect(s).toEqual({ thinking: false, events: [text] });
    s = reduce(s, { chatId: "chat_1", kind: "settled" });
    expect(s).toEqual({ thinking: false, events: [] });
  });

  it("ignores other conversations and a settle that races a new turn", () => {
    const started = reduce(initialChatStream, { chatId: "chat_1", kind: "started" });
    expect(reduce(started, { chatId: "chat_2", kind: "finished" })).toBe(started);
    const busy = reduce(started, { chatId: "chat_1", kind: "event", event: text });
    expect(reduce(busy, { chatId: "chat_1", kind: "settled" })).toBe(busy);
  });

  it("treats any event as proof the Chief is answering (stream joined mid-turn)", () => {
    expect(reduce(initialChatStream, { chatId: "chat_1", kind: "event", event: text }).thinking).toBe(true);
  });
});

describe("chatTitle", () => {
  it("uses the first sentence of the first non-empty line", () => {
    expect(chatTitle("\n\n# Let's plan the billing export. It needs CSV.\nMore")).toBe("Let's plan the billing export.");
    expect(chatTitle("x".repeat(80))).toHaveLength(60);
    expect(chatTitle("   \n ")).toBe("New conversation");
  });
});

describe("isSendKey", () => {
  it("sends on cmd/ctrl+enter only, never mid-composition", () => {
    expect(isSendKey({ key: "Enter", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSendKey({ key: "Enter", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSendKey({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSendKey({ key: "Enter", metaKey: true, ctrlKey: false, nativeEvent: { isComposing: true } })).toBe(false);
  });
});
