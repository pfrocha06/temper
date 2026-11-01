import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import { codexAccount, createCodexCliAdapter } from "@temper/adapter-codex-cli";
import type { AgentAdapter } from "@temper/core";
import { protectedDirs, type Config } from "./config.ts";
import type { Profile } from "./profile.ts";
import { claudeAccount } from "./providers.ts";

/** The adapters the profile enables, each denied Temper's own secrets and data. */
export function createAdapters(config: Config, profile: Profile): Map<string, AgentAdapter> {
  const alwaysDenyDirs = protectedDirs(config);
  const adapters = new Map<string, AgentAdapter>();
  if (profile.adapters.includes("claude-cli")) adapters.set("claude-cli", createClaudeCliAdapter({ bin: config.claudeBin, alwaysDenyDirs }));
  if (profile.adapters.includes("codex-cli")) adapters.set("codex-cli", createCodexCliAdapter({ bin: config.codexBin, codexHome: config.codexHome, alwaysDenyDirs }));
  return adapters;
}

/** The email an adapter's CLI is signed in as. */
export async function accountOf(config: Config, adapter: string): Promise<string | undefined> {
  if (adapter === "claude-cli") return (await claudeAccount(config.claudeBin))?.email;
  if (adapter === "codex-cli") return codexAccount(config.codexHome).email;
  return undefined;
}
