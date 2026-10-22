export type OutputThrottleOptions = {
  /** Called with a chunk of new output; never more often than once per `intervalMs`. */
  emit: (text: string) => void;
  intervalMs?: number;
  /** Each emitted chunk keeps only the last lines of what arrived since the previous one. */
  maxLines?: number;
  maxChars?: number;
  /** After this many chunks the rest is dropped (a long run must not flood the event log). */
  maxChunks?: number;
};

export type OutputThrottle = {
  push(chunk: string): void;
  /** Emits whatever is pending now and stops the timer. Call when the command ends. */
  close(): void;
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)/g;

/** Strips terminal escapes and carriage-return redraws so a chunk reads as plain lines. */
export function cleanOutput(s: string): string {
  return s
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.slice(l.lastIndexOf("\r") + 1))
    .join("\n");
}

/** The last `maxLines` non-empty lines of `s`, at most `maxChars` long, with a note of what was skipped. */
export function tailLines(s: string, maxLines: number, maxChars: number): string {
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  let kept = lines.slice(-maxLines);
  let text = kept.join("\n");
  if (text.length > maxChars) {
    const start = text.length - maxChars;
    const partial = text[start - 1] !== "\n";
    text = text.slice(start);
    // Drop a line the cut landed inside, unless it is the only one left.
    const nl = text.indexOf("\n");
    if (partial && nl >= 0 && nl < text.length - 1) text = text.slice(nl + 1);
    kept = text.split("\n");
  }
  const skipped = lines.length - kept.length;
  return skipped > 0 ? `… ${skipped} line${skipped === 1 ? "" : "s"} skipped\n${text}` : text;
}

/**
 * Batches streamed command output into at most one chunk per interval: the first
 * output goes out after `intervalMs`, then every `intervalMs` while more arrives.
 * Chunks never overlap, so concatenated they are the output with long bursts elided.
 */
export function throttleOutput(opts: OutputThrottleOptions): OutputThrottle {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxLines = opts.maxLines ?? 20;
  const maxChars = opts.maxChars ?? 2000;
  const maxChunks = opts.maxChunks ?? 300;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = 0;
  let closed = false;

  const flush = () => {
    timer = undefined;
    if (sent >= maxChunks) {
      pending = "";
      return;
    }
    // Hold back a trailing partial line until it completes (or the command ends).
    const cut = closed ? pending.length : pending.lastIndexOf("\n") + 1;
    const ready = cleanOutput(pending.slice(0, cut));
    pending = pending.slice(cut);
    const text = tailLines(ready, maxLines, maxChars);
    if (!text) return;
    sent += 1;
    opts.emit(sent === maxChunks ? `${text}\n… further output not streamed` : text);
  };

  return {
    push(chunk) {
      if (closed || sent >= maxChunks) return;
      // Keep the buffer bounded between flushes; only the tail is ever emitted.
      pending = (pending + chunk).slice(-maxChars * 8);
      timer ??= setTimeout(flush, intervalMs);
    },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}
