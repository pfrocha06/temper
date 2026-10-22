import { spawn } from "node:child_process";
import { sandboxed, type Sandbox } from "./sandbox.ts";

export type ExecResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Runs a command without a shell. Output is capped to keep memory bounded. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = { cwd: process.cwd() },
): Promise<ExecResult> {
  return runProcess(spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, signal: opts.signal }), opts.timeoutMs);
}

/**
 * Runs a project-configured command line through the shell (test / app / holdouts commands).
 * `onOutput` receives stdout and stderr chunks as they arrive, interleaved.
 */
export function runShell(
  command: string,
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal; onOutput?: (chunk: string) => void },
): Promise<ExecResult> {
  return runProcess(spawn(command, { cwd: opts.cwd, env: opts.env ?? process.env, shell: true, signal: opts.signal }), opts.timeoutMs, opts.onOutput);
}

/**
 * Runs a project command line that executes Builder-controlled code (the test command) inside
 * the sandbox, with a stripped environment. See `sandbox.ts`.
 */
export async function runSandboxed(
  command: string,
  sandbox: Sandbox,
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal; onOutput?: (chunk: string) => void },
): Promise<ExecResult> {
  const cmd = sandboxed(sandbox, command, { cwd: opts.cwd, env: opts.env });
  try {
    return await runProcess(spawn(cmd.file, cmd.args, { cwd: opts.cwd, env: cmd.env, shell: cmd.shell, signal: opts.signal }), opts.timeoutMs, opts.onOutput);
  } finally {
    cmd.dispose();
  }
}

const CAP = 2_000_000;

function runProcess(child: ReturnType<typeof spawn>, timeoutMs = 10 * 60_000, onOutput?: (chunk: string) => void): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const tee = (chunk: string) => {
      try {
        onOutput?.(chunk);
      } catch {
        // A progress listener must never break the command it watches.
      }
    };
    child.stdout?.on("data", (b: Buffer) => {
      const chunk = b.toString();
      stdout = (stdout + chunk).slice(-CAP);
      tee(chunk);
    });
    child.stderr?.on("data", (b: Buffer) => {
      const chunk = b.toString();
      stderr = (stderr + chunk).slice(-CAP);
      tee(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
