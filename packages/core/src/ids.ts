import { randomBytes } from "node:crypto";

/** Short, sortable-enough, URL-safe ids with a readable prefix, e.g. `tkt_k3j9x2ab`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("base64url").toLowerCase().replace(/[-_]/g, "x")}`;
}
