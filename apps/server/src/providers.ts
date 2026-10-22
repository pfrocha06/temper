import { getCaps, latestLimits, usageWindows, type Agent, type Db, type ProviderCaps } from "@temper/core";
import { run } from "./exec.ts";

export type ProviderInfo = {
  id: string;
  name: string;
  vendor: "anthropic" | "openai" | "google" | "opencode";
  /** Whether Temper has an adapter for it yet. */
  adapter: boolean;
  installed: boolean;
  version?: string;
  account?: { loggedIn: boolean; method?: string; email?: string; org?: string; subscription?: string };
  roles: string[];
  usage?: Awaited<ReturnType<typeof usageWindows>>;
  limits: Array<{ limitType: string; status: string; resetsAt: string | null; at: string }>;
  caps: ProviderCaps;
  pausedUntil?: string;
};

const KNOWN = [
  { id: "claude-cli", name: "Claude Code", vendor: "anthropic", bin: "claude", adapter: true },
  { id: "codex-cli", name: "Codex", vendor: "openai", bin: "codex", adapter: false },
  { id: "gemini-cli", name: "Gemini CLI", vendor: "google", bin: "gemini", adapter: false },
  { id: "opencode", name: "OpenCode", vendor: "opencode", bin: "opencode", adapter: false },
] as const;

async function versionOf(bin: string): Promise<string | undefined> {
  const r = await run(bin, ["--version"], { cwd: process.cwd(), timeoutMs: 10_000 });
  return r.code === 0 ? (r.stdout || r.stderr).trim().split("\n")[0]?.slice(0, 60) : undefined;
}

/** `claude auth status` without identifiers Temper does not need (org id, directories). */
async function claudeAccount(bin: string): Promise<ProviderInfo["account"]> {
  const r = await run(bin, ["auth", "status"], { cwd: process.cwd(), timeoutMs: 15_000 });
  try {
    const s = JSON.parse(r.stdout) as { loggedIn?: boolean; authMethod?: string; email?: string; orgName?: string; subscriptionType?: string };
    return { loggedIn: !!s.loggedIn, method: s.authMethod, email: s.email, org: s.orgName, subscription: s.subscriptionType };
  } catch {
    return { loggedIn: false };
  }
}

export async function listProviders(db: Db, agents: Agent[], opts: { claudeBin: string; pausedAdapters: Record<string, number> }): Promise<ProviderInfo[]> {
  return Promise.all(
    KNOWN.map(async (k) => {
      const bin = k.id === "claude-cli" ? opts.claudeBin : k.bin;
      const version = await versionOf(bin);
      const caps = await getCaps(db, k.id);
      const paused = opts.pausedAdapters[k.id];
      return {
        id: k.id,
        name: k.name,
        vendor: k.vendor,
        adapter: k.adapter,
        installed: !!version,
        version,
        account: k.id === "claude-cli" && version ? await claudeAccount(bin) : undefined,
        roles: agents.filter((a) => a.adapter === k.id).map((a) => a.role),
        usage: k.adapter ? await usageWindows(db, k.id, caps) : undefined,
        limits: (await latestLimits(db, k.id)).map((l) => ({
          limitType: l.limitType,
          status: l.status,
          resetsAt: l.resetsAt?.toISOString() ?? null,
          at: l.at.toISOString(),
        })),
        caps,
        pausedUntil: paused && paused > Date.now() ? new Date(paused).toISOString() : undefined,
      };
    }),
  );
}
