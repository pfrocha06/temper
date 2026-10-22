import {
  ArchiveIcon,
  BookOpenIcon,
  FolderPlusIcon,
  GavelIcon,
  InboxIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  BanIcon,
  BookPlusIcon,
  FolderKanbanIcon,
  ListTodoIcon,
  PencilLineIcon,
  PlugZapIcon,
  SearchIcon,
  TicketPlusIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { Markdown } from "@/components/markdown";
import { AgentProviderLogo } from "@/components/provider-logo";
import { RoleAvatar } from "@/components/role";
import { Spinner } from "@/components/ui/spinner";
import { absoluteTime, clockTime } from "@/lib/format";
import { actionMeta, type ThinkingItem } from "@/lib/chat";
import type { ChatAction, ChatMessage } from "@/lib/types";

const ACTION_ICON: Record<string, LucideIcon> = {
  knowledge_search: SearchIcon,
  knowledge_get: BookOpenIcon,
  knowledge_add: BookPlusIcon,
  knowledge_update: PencilLineIcon,
  knowledge_archive: ArchiveIcon,
  projects_list: FolderKanbanIcon,
  tickets_list: ListTodoIcon,
  ticket_create: TicketPlusIcon,
  ticket_start: PlayIcon,
  ticket_cancel: BanIcon,
  ticket_retry: RefreshCwIcon,
  ticket_digest: BookOpenIcon,
  factory_pause: PauseIcon,
  factory_resume: PlayIcon,
  project_register: FolderPlusIcon,
  approvals_list: InboxIcon,
  propose_decision: GavelIcon,
  propose_deploy: RocketIcon,
};

/**
 * One thing the Chief did: a compact chip. Writes (knowledge recorded, tickets created) carry the
 * Chief's accent; reads stay neutral. Links to the entry or the board where there is one.
 */
export function ActionChip({ action, state }: { action: ChatAction; state?: "running" | "ok" | "error" }) {
  const meta = actionMeta(action);
  const Icon = ACTION_ICON[action.tool] ?? PlugZapIcon;
  const body = (
    <>
      {state === "running" ? <Spinner className="size-3" /> : state === "error" ? <XIcon aria-hidden className="size-3" /> : <Icon aria-hidden className={cn("size-3", meta.write && "text-role-chief")} />}
      <span className="shrink-0 font-medium whitespace-nowrap">{meta.label}</span>
      {action.summary ? <span className="max-w-[16rem] min-w-0 truncate text-muted-foreground">{action.summary}</span> : null}
    </>
  );
  const cls = cn(
    "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs",
    meta.write ? "border-role-chief/35 bg-role-chief/8 text-foreground" : "bg-background text-muted-foreground",
    state === "error" && "border-fail/50 text-fail",
  );
  const title = `${meta.label}${action.summary ? `: ${action.summary}` : ""}${state === "error" ? " (failed)" : ""}`;
  return meta.href ? (
    <Link to={meta.href} className={cn(cls, "hover:border-ring/50 hover:bg-accent")} title={title}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

export function ActionChips({ actions }: { actions: ChatAction[] }) {
  if (actions.length === 0) return null;
  return (
    <ul aria-label="What the Chief did" className="flex flex-wrap gap-1">
      {actions.map((a, i) => (
        <li key={i} className="min-w-0">
          <ActionChip action={a} />
        </li>
      ))}
    </ul>
  );
}

/** A stored message: yours on the right, the Chief's on the left with what it did beneath. */
export const MessageView = memo(function MessageView({ message, pending = false }: { message: Pick<ChatMessage, "author" | "content" | "actions" | "at">; pending?: boolean }) {
  if (message.author === "board") {
    return (
      <li className="flex justify-end">
        <div className={cn("flex max-w-[min(36rem,88%)] flex-col items-end gap-1", pending && "opacity-70")}>
          <div className="rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm leading-6 whitespace-pre-wrap text-secondary-foreground [overflow-wrap:anywhere]">
            {message.content}
          </div>
          <time dateTime={message.at} title={absoluteTime(message.at)} className="px-1 text-[0.6875rem] text-muted-foreground tabular-nums">
            {pending ? "sending…" : clockTime(message.at).slice(0, 5)}
          </time>
        </div>
      </li>
    );
  }
  const failed = message.content.startsWith("I hit an error:");
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <RoleAvatar role="chief" size="md" tooltip={false} />
      <div className="flex min-w-0 flex-col gap-2 pt-1">
        <p className="flex items-center gap-2 text-xs">
          <span className="font-medium text-role-chief">Chief of Staff</span>
          <AgentProviderLogo agentId="chief" size="xs" tooltip className="text-muted-foreground" />
          <time dateTime={message.at} title={absoluteTime(message.at)} className="text-muted-foreground tabular-nums">
            {clockTime(message.at).slice(0, 5)}
          </time>
        </p>
        {failed ? (
          <p className="flex items-start gap-2 rounded-lg border border-fail/40 bg-fail/5 px-3 py-2 text-sm text-fail">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {message.content}
          </p>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
        <ActionChips actions={message.actions} />
      </div>
    </li>
  );
});

/**
 * The Chief's turn in progress: its notes as it writes them and each tool call as a chip, under
 * a live avatar. Consecutive tool calls share one row so the notes stay readable.
 */
export function ThinkingView({ items, thinking }: { items: ThinkingItem[]; thinking: boolean }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3" aria-live="polite" aria-busy={thinking}>
      <RoleAvatar role="chief" size="md" live={thinking} tooltip={false} />
      <div className="flex min-w-0 flex-col gap-2 pt-1">
        <p className="flex items-baseline gap-2 text-xs">
          <span className="font-medium text-role-chief">Chief of Staff</span>
          <span className="text-muted-foreground">{thinking ? "thinking" : "wrapping up"}</span>
          {thinking ? <ThinkingDots /> : null}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Reading the knowledge base and getting oriented…</p>
        ) : (
          <div className="flex flex-col gap-2 border-l-2 border-role-chief/25 pl-3">
            {groupThinking(items).map((g) =>
              g.kind === "text" ? (
                <Markdown key={g.key} className="text-muted-foreground [&_h1]:text-sm [&_h2]:text-sm">
                  {g.text}
                </Markdown>
              ) : g.kind === "notice" ? (
                <p key={g.key} className={cn("font-mono text-xs", g.tone === "error" ? "text-fail" : "text-muted-foreground")}>
                  {g.text}
                </p>
              ) : (
                <ul key={g.key} className="flex flex-wrap gap-1">
                  {g.actions.map((a) => (
                    <li key={a.key} className="min-w-0">
                      <ActionChip action={a.action} state={a.state} />
                    </li>
                  ))}
                </ul>
              ),
            )}
          </div>
        )}
      </div>
    </li>
  );
}

type ActionItem = Extract<ThinkingItem, { kind: "action" }>;
type Group = Exclude<ThinkingItem, ActionItem> | { key: number; kind: "actions"; actions: ActionItem[] };

/** Consecutive tool calls share one row of chips. */
function groupThinking(items: ThinkingItem[]): Group[] {
  const out: Group[] = [];
  for (const i of items) {
    const last = out.at(-1);
    if (i.kind === "action") {
      if (last?.kind === "actions") last.actions.push(i);
      else out.push({ key: i.key, kind: "actions", actions: [i] });
    } else out.push(i);
  }
  return out;
}

function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-0.5 text-role-chief">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 rounded-full bg-current motion-safe:animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
      ))}
    </span>
  );
}
