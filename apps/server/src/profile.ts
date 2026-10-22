import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A profile binds one identity: which git host account the server acts as, which adapters
 * and plugins are enabled. It lives in TEMPER_HOME/profile.json and is never committed.
 */
export type McpServerConfig = { command: string; args?: string[]; env?: Record<string, string>; description?: string };

export type Profile = {
  name: string;
  github?: { user: string };
  adapters: string[];
  plugins: string[];
  /** MCP servers agents may be given (assigned per role on the Agents screen). Values never leave the server. */
  mcpServers: Record<string, McpServerConfig>;
};

const DEFAULT: Profile = { name: "default", adapters: ["claude-cli"], plugins: ["github"], mcpServers: {} };

export function loadProfile(home: string): Profile {
  const file = join(home, "profile.json");
  if (!existsSync(file)) return DEFAULT;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Profile>;
  return { ...DEFAULT, ...raw };
}
