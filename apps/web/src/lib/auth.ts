import { useSyncExternalStore } from "react";

/**
 * Whether the server has asked for the board cookie. Every `/api/*` route but health answers
 * 401 without it; the first 401 anywhere flips this and the app shows the sign-in screen.
 */
let required = false;
const listeners = new Set<() => void>();

export function isAuthRequired(): boolean {
  return required;
}

export function setAuthRequired(value: boolean): void {
  if (required === value) return;
  required = value;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuthRequired(): boolean {
  return useSyncExternalStore(subscribe, isAuthRequired, isAuthRequired);
}

/**
 * Asks the server whether this browser is signed in. Used where a 401 cannot be seen directly
 * (an EventSource only reports that it closed). Returns false only for a definite 401.
 */
export async function probeAuth(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/status", { headers: { accept: "application/json" } });
    if (res.status === 401) {
      setAuthRequired(true);
      return false;
    }
    if (res.ok) setAuthRequired(false);
    return true;
  } catch {
    // Unreachable is not unauthorised: the offline banner covers that.
    return true;
  }
}
