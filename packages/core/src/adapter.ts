// The contract between the orchestrator and an agent CLI (claude, codex, gemini, …).

export type RunRequest = {
  /** Working directory the agent runs in (a ticket worktree, or the holdouts checkout). */
  cwd: string;
  prompt: string;
  model?: string | null;
  /** Resume an earlier session instead of starting fresh. */
  resumeSessionId?: string;
  allowedTools: string[];
  disallowedTools: string[];
  /** Extra directories the agent may read/write besides `cwd`. */
  addDirs?: string[];
  /** Directories the agent must never read (holdouts, for the Builder). */
  denyDirs?: string[];
  /** Directories the agent may read but never change (the candidate, for the Verifier). */
  readOnlyDirs?: string[];
  /** The run may not change any file (review stages). */
  readOnly?: boolean;
  /**
   * Let sandboxed commands reach the host's 127.0.0.1 (the candidate app). Needed where the
   * sandbox has its own network namespace (Linux): traffic must go through the sandbox's proxy.
   */
  hostLoopback?: boolean;
  /** Skill directories (each containing SKILL.md) to expose to this run only. */
  skillDirs?: string[];
  appendSystemPrompt?: string;
  /** MCP servers for this run only; nothing else is loaded (strict). */
  mcpServers?: Record<string, McpServerSpec>;
  /** Extra environment for the agent process (and the commands it runs). */
  env?: Record<string, string>;
  signal?: AbortSignal;
};

export type McpServerSpec = { command: string; args?: string[]; env?: Record<string, string> };

export type RunEvent =
  | { kind: "init"; sessionId: string; model?: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool: string; input: unknown }
  | { kind: "tool_result"; isError: boolean; content: string }
  | { kind: "stderr"; text: string }
  | { kind: "result"; text: string; isError: boolean; turns?: number; durationMs?: number }
  | { kind: "rate_limited"; text: string }
  /** The provider's usage report for the run: tokens per model, and its list-price equivalent. */
  | { kind: "usage"; models: Record<string, ModelUsage>; apiMs?: number }
  /** A subscription/rate-limit window report, exactly as the provider states it. */
  | { kind: "rate_limit"; limitType: string; status: string; resetsAt?: number; raw: Record<string, unknown> };

export type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd?: number };

export type RunResult = {
  finalText: string;
  sessionId?: string;
  exitCode: number | null;
  isError: boolean;
  rateLimited: boolean;
};

export interface AgentAdapter {
  readonly id: string;
  /** Whether runs are isolated from the user's own CLI config (skills, memory, MCP servers). */
  readonly isolated: boolean;
  /** Whether commands in a run can reach the host's 127.0.0.1 (the Verifier's candidate app). Default true. */
  readonly reachesHostLoopback?: boolean;
  run(req: RunRequest, onEvent: (e: RunEvent) => void): Promise<RunResult>;
}
