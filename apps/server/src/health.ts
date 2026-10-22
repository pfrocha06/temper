import { execFileSync } from "node:child_process";

export type Health = { ok: true; version: string; instance: string; uptimeSeconds: number };

/** Short commit of the checkout at `cwd`, or "unknown" when it is not a git checkout. */
export function gitVersion(cwd: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
    return out || "unknown";
  } catch {
    return "unknown";
  }
}

/** Resolves the version once, then returns a cheap snapshot function. `uptime` is seconds since process start. */
export function createHealth(
  config: { instance: string; appRoot: string },
  uptime: () => number = () => process.uptime(),
): () => Health {
  const version = gitVersion(config.appRoot);
  return () => ({ ok: true, version, instance: config.instance, uptimeSeconds: Math.max(0, Math.floor(uptime())) });
}
