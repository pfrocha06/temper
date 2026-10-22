import { useQuery } from "@tanstack/react-query";
import { BookOpenIcon, BookPlusIcon, FileInputIcon, FolderPlusIcon, MessageSquareIcon, MessageSquarePlusIcon, PauseIcon, PlayIcon, PlusIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { useAppActions } from "@/hooks/use-app-actions";
import { useEnvironment } from "@/hooks/use-environment";
import { useProject } from "@/hooks/use-project";
import { STATUS_LABEL } from "@/lib/constants";
import { chatsQuery, knowledgeQuery, statusQuery, ticketsQuery, useSetPaused } from "@/lib/queries";
import type { TicketStatus } from "@/lib/types";
import { NAV } from "./shell/nav-rail";

/** ⌘K / Ctrl+K: jump to a screen, conversation, knowledge entry or ticket, or run an action. */
export function CommandPalette() {
  const { open, setOpen, show } = useAppActions();
  const isOpen = open === "palette";
  const navigate = useNavigate();
  const { project } = useProject();
  const { environment } = useEnvironment();
  const tickets = useQuery({ ...ticketsQuery(undefined), enabled: isOpen });
  const chats = useQuery({ ...chatsQuery(environment?.id), enabled: isOpen && Boolean(environment) });
  const knowledge = useQuery({ ...knowledgeQuery(environment?.id), enabled: isOpen && Boolean(environment) });
  const status = useQuery(statusQuery);
  const setPaused = useSetPaused();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen("palette", !isOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, setOpen]);

  const run = (fn: () => void) => () => {
    setOpen("palette", false);
    fn();
  };
  const paused = status.data?.paused ?? false;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(o) => setOpen("palette", o)}
      title="Command palette"
      description="Jump to a screen, conversation, knowledge entry or ticket, or run an action"
    >
      <Command>
        <CommandInput placeholder="Jump anywhere, or run an action" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem value="new conversation chief of staff ask brainstorm" onSelect={run(() => navigate("/chief"))}>
              <MessageSquarePlusIcon />
              New conversation with the Chief of Staff
            </CommandItem>
            <CommandItem disabled={!project} onSelect={run(() => show("new-ticket"))}>
              <PlusIcon />
              New ticket
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!project} onSelect={run(() => show("import-spec"))}>
              <FileInputIcon />
              Import spec
              <CommandShortcut>I</CommandShortcut>
            </CommandItem>
            <CommandItem disabled={!environment} value="add knowledge entry" onSelect={run(() => show("add-knowledge"))}>
              <BookPlusIcon />
              Add knowledge entry
            </CommandItem>
            <CommandItem value="new environment" onSelect={run(() => show("new-environment"))}>
              <FolderPlusIcon />
              New environment
            </CommandItem>
            <CommandItem
              disabled={!status.data}
              onSelect={run(() =>
                setPaused.mutate(!paused, {
                  onSuccess: () => toast.success(paused ? "Factory resumed" : "Factory paused. Running dispatches finish; no new ones start."),
                  onError: (e) => toast.error(`Could not ${paused ? "resume" : "pause"}: ${e.message}`),
                }),
              )}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
              {paused ? "Resume the factory" : "Pause the factory"}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            {NAV.map((n) => (
              <CommandItem key={n.to} value={`go ${n.label}`} onSelect={run(() => navigate(n.to))}>
                <n.icon />
                {n.label}
                <CommandShortcut>G {n.key.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {chats.data && chats.data.length > 0 ? (
            <CommandGroup heading="Conversations">
              {chats.data.slice(0, 20).map((c) => (
                <CommandItem key={c.id} value={`conversation ${c.title} ${c.id}`} onSelect={run(() => navigate(`/chief/${c.id}`))}>
                  <MessageSquareIcon />
                  <span className="truncate">{c.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {knowledge.data && knowledge.data.length > 0 ? (
            <CommandGroup heading="Knowledge">
              {knowledge.data
                .filter((k) => k.status !== "archived")
                .map((k) => (
                  <CommandItem key={k.id} value={`knowledge ${k.title} ${k.kind} ${k.id}`} onSelect={run(() => navigate(`/knowledge/${k.id}`))}>
                    <BookOpenIcon />
                    <span className="truncate">{k.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{k.kind}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          ) : null}
          {tickets.data && tickets.data.length > 0 ? (
            <CommandGroup heading="Tickets">
              {tickets.data.map((t) => (
                <CommandItem key={t.id} value={`${t.title} ${t.id} ${t.type}`} onSelect={run(() => navigate(`/tickets/${t.id}`))}>
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[t.status as TicketStatus] ?? t.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
