import { summarizeToolInput } from "./run-events";
import type { ChatAction, ChatStreamMessage, RunEvent } from "./types";

const TEMPER_PREFIX = "mcp__temper__";

/** What the Chief did with a tool, in the board's words. Unknown tools keep their name. */
const ACTION_LABEL: Record<string, string> = {
  knowledge_search: "Searched knowledge",
  knowledge_get: "Read knowledge",
  knowledge_add: "Recorded knowledge",
  knowledge_update: "Updated knowledge",
  knowledge_archive: "Archived knowledge",
  projects_list: "Looked at projects",
  tickets_list: "Looked at tickets",
  ticket_create: "Created ticket",
};

/** Actions that change something; the rest only read. */
const WRITES = new Set(["knowledge_add", "knowledge_update", "knowledge_archive", "ticket_create"]);

export type ActionMeta = { label: string; write: boolean; href?: string };

/** `mcp__temper__knowledge_add` → `knowledge_add`; other tools are returned unchanged. */
export function shortTool(tool: string): string {
  return tool.startsWith(TEMPER_PREFIX) ? tool.slice(TEMPER_PREFIX.length) : tool;
}

/**
 * How to show one Chief action: a label, whether it wrote, and where it leads. The server keeps
 * only a summary per action (a title, query or id), so a link goes to the entry when the summary
 * is an id and to a search for it otherwise.
 */
export function actionMeta(action: ChatAction): ActionMeta {
  const tool = shortTool(action.tool);
  const label = ACTION_LABEL[tool] ?? tool;
  const write = WRITES.has(tool);
  const s = action.summary.trim();
  let href: string | undefined;
  if (tool.startsWith("knowledge_")) {
    if (/^kn_[\w-]+$/.test(s)) href = `/knowledge/${s}`;
    else if (s) href = `/knowledge?q=${encodeURIComponent(s)}`;
  } else if (tool === "ticket_create" || tool === "tickets_list") {
    href = "/board";
  }
  return { label, write, href };
}

/** One row of the Chief's in-progress turn. */
export type ThinkingItem =
  | { key: number; kind: "text"; text: string }
  | { key: number; kind: "action"; tool: string; action: ChatAction; meta: ActionMeta; state: "running" | "ok" | "error" }
  | { key: number; kind: "notice"; text: string; tone: "muted" | "error" };

/**
 * Folds a turn's run events into what the board reads while the Chief works: consecutive text
 * becomes one paragraph, each tool call becomes a chip that its result settles. The final
 * `result` is not shown here; it arrives as the stored message.
 */
export function thinkingItems(events: RunEvent[]): ThinkingItem[] {
  const out: ThinkingItem[] = [];
  events.forEach((e, key) => {
    const last = out.at(-1);
    switch (e.kind) {
      case "text":
        // Each text event is a whole assistant block, not a delta.
        if (last?.kind === "text") last.text = `${last.text}\n\n${e.text}`;
        else out.push({ key, kind: "text", text: e.text });
        return;
      case "tool_use": {
        const input = (e.input ?? {}) as Record<string, unknown>;
        const temper = e.tool.startsWith(TEMPER_PREFIX);
        const summary = temper ? String(input.title ?? input.query ?? input.id ?? "").slice(0, 120) : summarizeToolInput(e.input, 120);
        const action = { tool: shortTool(e.tool), summary };
        out.push({ key, kind: "action", tool: e.tool, action, meta: actionMeta(action), state: "running" });
        return;
      }
      case "tool_result": {
        const open = out.findLast((i): i is Extract<ThinkingItem, { kind: "action" }> => i.kind === "action" && i.state === "running");
        if (open) open.state = e.isError ? "error" : "ok";
        return;
      }
      case "rate_limited":
        out.push({ key, kind: "notice", text: `Rate limited: ${e.text}`, tone: "error" });
        return;
      case "stderr":
        if (e.text.trim()) out.push({ key, kind: "notice", text: e.text.trim(), tone: "error" });
        return;
      default:
        return;
    }
  });
  return out;
}

export type ChatStreamState = {
  /** null until the stream says something; the GET's `thinking` applies meanwhile. */
  thinking: boolean | null;
  events: RunEvent[];
};

export const initialChatStream: ChatStreamState = { thinking: null, events: [] };

/** A `chat` SSE message, or `settled`: the stored reply has been fetched, so live events can go. */
export type ChatStreamAction = ChatStreamMessage | { chatId: string; kind: "settled" };

/** Applies one action for this conversation; messages for others are ignored. */
export function chatStreamReducer(chatId: string) {
  return (state: ChatStreamState, msg: ChatStreamAction): ChatStreamState => {
    if (msg.chatId !== chatId) return state;
    switch (msg.kind) {
      case "started":
        return { thinking: true, events: [] };
      case "event":
        return msg.event ? { thinking: true, events: [...state.events, msg.event] } : state;
      case "finished":
        // Events stay on screen until the stored reply replaces them.
        return { ...state, thinking: false };
      case "settled":
        return state.thinking ? state : { ...state, events: [] };
    }
  };
}

/** A conversation title from its opening message: the first line, trimmed to a sentence or 60 chars. */
export function chatTitle(message: string): string {
  const line = message
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  if (!line) return "New conversation";
  const sentence = line.match(/^(.{12,}?[.?!])(\s|$)/)?.[1] ?? line;
  return sentence.length > 60 ? `${sentence.slice(0, 59).trimEnd()}…` : sentence;
}

/** True for ⌘↵ / Ctrl↵, the composer's send key. */
export function isSendKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent?.isComposing;
}
