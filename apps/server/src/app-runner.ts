import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** A candidate app under test. It runs with its own board token so checks can call its API. */
export type RunningApp = { url: string; token: string; stop: () => void; logs: () => string };

/** Boots a project's app from a worktree on a free port and waits for its health path. */
export async function bootApp(command: string, cwd: string, healthPath: string, timeoutMs = 120_000): Promise<RunningApp> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const token = randomBytes(24).toString("base64url");
  let logs = "";
  const child: ChildProcess = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(port), TEMPER_INSTANCE: `app-${port}`, TEMPER_BOARD_TOKEN: token },
  });
  child.stdout?.on("data", (b: Buffer) => (logs = (logs + b).slice(-20_000)));
  child.stderr?.on("data", (b: Buffer) => (logs = (logs + b).slice(-20_000)));
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(url + healthPath);
      if (res.status < 500) return { url, token, stop, logs: () => logs };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`app did not become healthy at ${url}${healthPath}\n${logs.slice(-2000)}`);
}
