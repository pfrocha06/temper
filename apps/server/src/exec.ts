import { spawn } from "node:child_process";

export type ExecResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Runs a command without a shell. Output is capped to keep memory bounded. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = { cwd: process.cwd() },
): Promise<ExecResult> {
  return runProcess(spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, signal: opts.signal }), opts.timeoutMs);
}

/** Runs a project-configured command line through the shell (test / app / holdouts commands). */
export function runShell(
  command: string,
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal },
): Promise<ExecResult> {
  return runProcess(spawn(command, { cwd: opts.cwd, env: opts.env ?? process.env, shell: true, signal: opts.signal }), opts.timeoutMs);
}

const CAP = 2_000_000;

function runProcess(child: ReturnType<typeof spawn>, timeoutMs = 10 * 60_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (b: Buffer) => (stdout = (stdout + b.toString()).slice(-CAP)));
    child.stderr?.on("data", (b: Buffer) => (stderr = (stderr + b.toString()).slice(-CAP)));
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
