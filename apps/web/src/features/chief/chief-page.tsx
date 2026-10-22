import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, MessageSquarePlusIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { cn } from "cn";
import { QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar } from "@/components/role";
import { Button } from "@/components/ui/button";
import { useEnvironment } from "@/hooks/use-environment";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/api";
import { chatTitle, thinkingItems } from "@/lib/chat";
import { relativeTime } from "@/lib/format";
import { chatQuery, chatsQuery, useSendChatMessage, useStartChat } from "@/lib/queries";
import type { Chat } from "@/lib/types";
import { MessageView, ThinkingView } from "./chat-parts";
import { Composer, type ComposerHandle } from "./composer";
import { useChatStream } from "./use-chat-stream";

/**
 * Conversations with the Chief of Staff: the board brainstorms, asks, and hands over work here.
 * Wide screens keep the list beside the thread; narrow ones show one at a time.
 */
export function ChiefPage() {
  const { chatId } = useParams();
  const { environment, isLoading } = useEnvironment();
  const chats = useQuery(chatsQuery(environment?.id));

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside
        aria-label="Conversations"
        className={cn("flex min-h-0 flex-col border-r bg-muted/20 max-md:border-r-0", chatId ? "max-md:hidden" : "max-md:order-2 max-md:border-t")}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 max-md:hidden">
          <h1 className="text-sm font-semibold tracking-tight">Conversations</h1>
          <Button variant="ghost" size="xs" asChild className="ml-auto">
            <Link to="/chief" aria-label="New conversation">
              <MessageSquarePlusIcon data-icon="inline-start" />
              New
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {chats.isError ? (
            <div className="p-2">
              <QueryError error={chats.error} what="conversations" onRetry={() => void chats.refetch()} />
            </div>
          ) : chats.isPending || isLoading ? (
            <div className="p-2">
              <RowsSkeleton rows={3} />
            </div>
          ) : (
            <ChatList chats={chats.data} selectedId={chatId} />
          )}
        </div>
      </aside>
      <section className="flex min-h-0 flex-col max-md:order-1">
        {chatId ? (
          <ChatThread key={chatId} chatId={chatId} />
        ) : environment ? (
          <NewConversation environmentId={environment.id} environmentName={environment.name} />
        ) : isLoading ? (
          <div className="p-6">
            <RowsSkeleton />
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">No environment yet. Create one from the environment menu in the top bar.</p>
        )}
      </section>
    </div>
  );
}

function ChatList({ chats, selectedId }: { chats: Chat[]; selectedId?: string }) {
  const now = useNow(true, 60_000);
  if (chats.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">No conversations yet in this environment.</p>;
  }
  return (
    <>
      <h2 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground md:sr-only">Earlier conversations</h2>
      <ul className="flex flex-col gap-0.5">
        {chats.map((c) => (
          <li key={c.id}>
            <Link
              to={`/chief/${c.id}`}
              aria-current={c.id === selectedId ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-accent/70 focus-visible:-outline-offset-2",
                c.id === selectedId && "bg-accent",
              )}
            >
              <span className="truncate text-sm font-medium">{c.title}</span>
              <span className="text-xs text-muted-foreground">{relativeTime(c.updatedAt, now)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

const STARTERS = [
  {
    label: "Brainstorm a project",
    text: "I want to brainstorm a new project. Ask me questions one at a time until we have a clear spec, then propose tickets.",
  },
  { label: "What do you know here?", text: "What do you know about this environment so far: projects, conventions, decisions, and open questions?" },
  { label: "Turn an idea into tickets", text: "I have an idea I'd like broken into tickets:\n\n" },
  { label: "What did we learn lately?", text: "What have you recorded in the knowledge base recently, and what are you still unsure about?" },
];

function NewConversation({ environmentId, environmentName }: { environmentId: string; environmentName: string }) {
  const start = useStartChat();
  const navigate = useNavigate();
  const composer = useRef<ComposerHandle>(null);

  const send = async (message: string) => {
    try {
      const chat = await start.mutateAsync({ environmentId, title: chatTitle(message), message });
      void navigate(`/chief/${chat.id}`);
      return true;
    } catch (err) {
      toast.error(`Could not start the conversation: ${(err as Error).message}`);
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-col gap-3">
          <RoleAvatar role="chief" size="lg" tooltip={false} />
          <h1 className="text-2xl font-semibold tracking-tight text-balance">What are we working on?</h1>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Think out loud with the Chief of Staff about <span className="font-medium text-foreground">{environmentName}</span>. It knows what the
            factory has learned, asks the questions a spec needs, and hands work to the builders when you agree. What it learns, it records.
          </p>
        </div>
        <Composer ref={composer} onSend={send} sending={start.isPending} autoFocus placeholder="Brainstorm a project, ask a question, or paste a brief…" />
        <div className="flex flex-col gap-2">
          <h2 className="text-xs text-muted-foreground">Or start from</h2>
          <ul className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <li key={s.label}>
                <Button variant="outline" size="sm" onClick={() => composer.current?.fill(s.text)}>
                  {s.label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ChatThread({ chatId }: { chatId: string }) {
  const detail = useQuery(chatQuery(chatId));
  const stream = useChatStream(chatId);
  const send = useSendChatMessage();
  const items = useMemo(() => thinkingItems(stream.events), [stream.events]);
  const thinking = stream.thinking ?? detail.data?.thinking ?? false;
  const showLive = thinking || items.length > 0;
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const messages = detail.data?.messages;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [messages, items, follow, send.isPending]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const onSend = async (message: string) => {
    setFollow(true);
    try {
      await send.mutateAsync({ chatId, message });
      return true;
    } catch (err) {
      toast.error(`Not sent: ${(err as Error).message}`);
      return false;
    }
  };

  if (detail.isError) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <BackToList />
        {detail.error instanceof ApiError && detail.error.status === 404 ? (
          <p className="text-sm">
            There is no conversation <code className="font-mono">{chatId}</code>.
          </p>
        ) : (
          <QueryError error={detail.error} what="this conversation" onRetry={() => void detail.refetch()} />
        )}
      </div>
    );
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:px-6">
        <BackToList />
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">{detail.data?.chat.title ?? "Conversation"}</h1>
        {thinking ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-role-chief text-role-chief motion-safe:animate-beacon" />
            Answering
          </span>
        ) : null}
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {!messages ? (
          <div className="mx-auto max-w-3xl p-6">
            <RowsSkeleton rows={4} />
          </div>
        ) : (
          <ol aria-label="Messages" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
            {messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
            {send.isPending && send.variables ? (
              <MessageView pending message={{ author: "board", content: send.variables.message, actions: [], at: new Date().toISOString() }} />
            ) : null}
            {showLive ? <ThinkingView items={items} thinking={thinking} /> : null}
          </ol>
        )}
      </div>
      <div className="shrink-0 border-t bg-background/80 px-4 pt-3 pb-4 backdrop-blur md:px-6">
        <Composer
          onSend={onSend}
          busy={thinking}
          sending={send.isPending}
          autoFocus
          placeholder="Reply, push back, or ask it to turn this into tickets…"
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

function BackToList() {
  return (
    <Button variant="ghost" size="icon-sm" asChild className="md:hidden">
      <Link to="/chief" aria-label="All conversations">
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}
