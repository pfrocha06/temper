import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

export const BOARD_COOKIE = "temper_board";

/** What one agent run may do through the agent API (and therefore the MCP server). */
export type Capability = {
  role: string;
  environmentId: string;
  projectId?: string;
  dispatchId?: string;
  expiresAt: number;
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Loads (or creates, mode 0600) the board token. TEMPER_BOARD_TOKEN overrides it for test instances. */
export function loadBoardToken(file: string, override?: string): string {
  if (override) return override;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(file, token + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

export class Auth {
  private capabilities = new Map<string, Capability>();
  readonly boardToken: string;
  private allowedHosts: Set<string>;

  constructor(boardToken: string, port: number) {
    this.boardToken = boardToken;
    this.allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, "127.0.0.1", "localhost"]);
  }

  issue(cap: Omit<Capability, "expiresAt">, ttlMs = 2 * 3_600_000): string {
    const token = `cap_${randomBytes(24).toString("base64url")}`;
    this.capabilities.set(token, { ...cap, expiresAt: Date.now() + ttlMs });
    return token;
  }

  revoke(token: string): void {
    this.capabilities.delete(token);
  }

  capability(token: string | undefined): Capability | undefined {
    if (!token) return undefined;
    const cap = this.capabilities.get(token);
    if (!cap) return undefined;
    if (cap.expiresAt < Date.now()) {
      this.capabilities.delete(token);
      return undefined;
    }
    return cap;
  }

  isBoard(token: string | undefined): boolean {
    return !!token && same(token, this.boardToken);
  }

  /** Rejects requests whose Host is not this machine (DNS rebinding) — the dev proxy keeps Host local too. */
  hostGuard(): MiddlewareHandler {
    return async (c, next) => {
      const host = c.req.header("host") ?? "";
      const local = this.allowedHosts.has(host) || /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
      if (!local) return c.json({ error: "forbidden host" }, 403);
      await next();
    };
  }

  /** Board routes: the HttpOnly cookie (UI) or the bearer board token (CLI). */
  board(): MiddlewareHandler {
    return async (c, next) => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (this.isBoard(getCookie(c, BOARD_COOKIE)) || this.isBoard(bearer)) return next();
      return c.json({ error: "board authentication required; open Temper with `temper open`" }, 401);
    };
  }

  /** Agent routes: a live capability token for one run. */
  agent(): MiddlewareHandler<{ Variables: { cap: Capability } }> {
    return async (c, next) => {
      const cap = this.capability(c.req.header("authorization")?.replace(/^Bearer\s+/i, ""));
      if (!cap) return c.json({ error: "invalid or expired capability" }, 401);
      c.set("cap", cap);
      await next();
    };
  }
}
