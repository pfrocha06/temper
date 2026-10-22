import { useEffect, useRef, useState } from "react";

/**
 * Keys that appeared since the list was first seen, kept for `holdMs` so they can be
 * highlighted once. Items present on first load never count as new.
 */
export function useArrivals(keys: readonly string[] | undefined, holdMs = 2500): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const signature = keys?.join("\n");

  useEffect(() => {
    if (!keys) return;
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const added = keys.filter((k) => !seen.current!.has(k));
    for (const k of keys) seen.current.add(k);
    if (added.length === 0) return;
    setFresh((prev) => new Set([...prev, ...added]));
    const t = setTimeout(() => setFresh((prev) => new Set([...prev].filter((k) => !added.includes(k)))), holdMs);
    return () => clearTimeout(t);
    // `signature` stands for `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, holdMs]);

  return fresh;
}
