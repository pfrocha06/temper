import { ArrowUpIcon } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { isSendKey } from "@/lib/chat";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export type ComposerHandle = { fill: (text: string) => void; focus: () => void };

/**
 * The message box: grows with its text, sends on ⌘↵ / Ctrl↵ (Enter alone is a new line, since
 * briefs run long), and stays disabled while the Chief is answering.
 */
export function Composer({
  onSend,
  busy = false,
  sending = false,
  placeholder,
  autoFocus = false,
  label = "Message the Chief of Staff",
  ref,
  className,
}: {
  /** Return false to keep the text (e.g. the send failed). */
  onSend: (text: string) => Promise<boolean> | boolean;
  /** The Chief is answering: nothing can be sent. */
  busy?: boolean;
  sending?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  label?: string;
  ref?: Ref<ComposerHandle>;
  className?: string;
}) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    fill: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(t.length, t.length);
      });
    },
    focus: () => area.current?.focus(),
  }));

  const disabled = busy || sending;

  // When the Chief finishes, the cursor goes back to the box so the conversation keeps flowing.
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    if (wasDisabled.current && !disabled && autoFocus) area.current?.focus();
    wasDisabled.current = disabled;
  }, [disabled, autoFocus]);
  const canSend = !disabled && text.trim().length > 0;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    const sent = await onSend(text.trim());
    if (sent) setText("");
  };

  return (
    <form
      onSubmit={(e) => void send(e)}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-1.5 shadow-xs transition-colors focus-within:border-ring/60 has-disabled:bg-muted/40",
        className,
      )}
    >
      <textarea
        ref={area}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isSendKey(e)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={busy ? "The Chief of Staff is answering…" : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={2}
        className="field-sizing-content max-h-[40dvh] min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-2 pl-2">
        <span className="text-xs text-muted-foreground max-sm:hidden">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd> <Kbd>↵</Kbd> to send
        </span>
        <Button type="submit" size="sm" className="ml-auto" disabled={!canSend} aria-label="Send">
          {sending ? <Spinner data-icon="inline-start" /> : <ArrowUpIcon data-icon="inline-start" />}
          Send
        </Button>
      </div>
    </form>
  );
}
