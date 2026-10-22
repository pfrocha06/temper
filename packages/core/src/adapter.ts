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
  /** Skill directories (each containing SKILL.md) to expose to this run only. */
  skillDirs?: string[];
  appendSystemPrompt?: string;
  /** Extra environment for the agent process (and the commands it runs). */
  env?: Record<string, string>;
  signal?: AbortSignal;
};

export type RunEvent =
  | { kind: "init"; sessionId: string; model?: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool: string; input: unknown }
  | { kind: "tool_result"; isError: boolean; content: string }
  | { kind: "stderr"; text: string }
  | { kind: "result"; text: string; isError: boolean; turns?: number; durationMs?: number }
  | { kind: "rate_limited"; text: string };

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
  run(req: RunRequest, onEvent: (e: RunEvent) => void): Promise<RunResult>;
}
