import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Config = {
  /** Root of all Temper state: releases, instances, worktrees. */
  home: string;
  /** Instance name; `main` for the live service, `rc` for a release candidate. */
  instance: string;
  dataDir: string;
  worktreesDir: string;
  port: number;
  /** The Temper checkout this process runs from (workflows/, skills/, apps/web/dist). */
  appRoot: string;
  heartbeatMs: number;
  claudeBin: string;
  /** Board token file (mode 0600). Agents are always denied this directory. */
  secretsDir: string;
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.TEMPER_HOME ?? join(homedir(), ".temper");
  const instance = env.TEMPER_INSTANCE ?? "main";
  return {
    home,
    instance,
    dataDir: join(home, "instances", instance, "db"),
    worktreesDir: join(home, "worktrees"),
    port: Number(env.TEMPER_PORT ?? env.PORT ?? (instance === "rc" ? 4601 : 4600)),
    appRoot: env.TEMPER_APP_ROOT ?? appRoot,
    heartbeatMs: Number(env.TEMPER_HEARTBEAT_MS ?? 15_000),
    claudeBin: env.TEMPER_CLAUDE_BIN ?? "claude",
    secretsDir: join(home, "secrets"),
  };
}
