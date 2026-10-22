import { useEffect, useRef } from "react";

/** True when a key press belongs to a text field or an open overlay, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]") !== null;
}

type Bindings = Record<string, () => void>;

/**
 * One keydown listener for the whole app, so a two-key sequence (`g i`) is
 * never also read as its second key (`i`) by another page's bindings.
 */
const registry = new Set<{ current: Bindings }>();
let prefix: string | null = null;
let prefixTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const combo = prefix ? `${prefix} ${key}` : key;
  const hadPrefix = prefix !== null;
  prefix = null;
  clearTimeout(prefixTimer);

  const all = [...registry].reverse();
  for (const ref of all) {
    const action = ref.current[combo];
    if (action) {
      e.preventDefault();
      action();
      return;
    }
  }
  if (!hadPrefix && all.some((ref) => Object.keys(ref.current).some((k) => k.startsWith(`${key} `)))) {
    prefix = key;
    prefixTimer = setTimeout(() => (prefix = null), 1000);
  }
}

/** Page-level shortcuts: single keys (`n`, `/`) or sequences written `g b`. */
export function useHotkeys(bindings: Bindings) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    registry.add(ref);
    if (!listening) {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    return () => {
      registry.delete(ref);
      if (registry.size === 0) {
        window.removeEventListener("keydown", onKeyDown);
        listening = false;
      }
    };
  }, []);
}
