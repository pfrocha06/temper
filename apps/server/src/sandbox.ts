import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * How commands that run Builder-controlled code (the test command, the candidate app) are
 * confined. `srt` is Anthropic's sandbox runtime, the same one agent runs use; `off` runs them
 * directly and is only for development where srt cannot run.
 */
export type SandboxMode = "srt" | "off";

export type Sandbox = {
  mode: SandboxMode;
  /** Directories the command may never read: holdouts and Temper's own secrets and data. */
  denyRead: string[];
  /**
   * Extra directories the command may read. Only matters on Windows, where the command runs as
   * a separate account that cannot read your profile (per-user tool installs such as corepack's cache).
   */
  allowRead?: string[];
};

/** A command ready to spawn without a shell, and what to release once it exits. */
export type SandboxedCommand = {
  file: string;
  args: string[];
  shell: boolean;
  env: NodeJS.ProcessEnv;
  /** Where the host reaches the exposed port (see `expose`), if one was asked for. */
  url?: string;
  dispose: () => void;
};

/**
 * Environment a sandboxed command keeps. Everything else (git host and API tokens, the board
 * token, TEMPER_*) is dropped: the command is the Builder's code. The Windows profile variables
 * are for srt itself (it keeps per-user state under LOCALAPPDATA); on Windows srt hands the
 * command a fresh environment of its own, so they do not reach it.
 */
const KEEP_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "CI", "PNPM_HOME",
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "USERNAME", "USERDOMAIN",
  "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
];

export function sandboxEnv(extra: Record<string, string> = {}, tmp?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (tmp) Object.assign(env, { TMPDIR: tmp, TMP: tmp, TEMP: tmp });
  return { ...env, ...extra };
}

/**
 * Where on Windows the sandbox can reach. srt runs the command as a separate account that may not
 * look inside your profile, not even at the folders above a path it was granted, and Node checks
 * every folder of a path it loads. So gate scratch dirs and worktrees live under ProgramData,
 * which every local account can traverse; holdouts and secrets stay in your profile.
 */
export const windowsGateRoot = () => join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "temper");

/** The directory gate commands' private temp dirs are made in. */
export function gateScratchRoot(): string {
  if (process.platform !== "win32") return tmpdir();
  const root = join(windowsGateRoot(), "tmp");
  mkdirSync(root, { recursive: true });
  return root;
}

const srtCli = () => createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime/dist/cli.js");

/**
 * Network policy per platform. No outbound network anywhere; local servers differ:
 * - macOS shares the host's loopback (`allowLocalBinding`), so the host reaches the app directly.
 * - Windows blocks every direct connect, loopback included, so loopback goes through srt's proxy.
 * - Linux has its own network namespace: the only way out is srt's proxy, to the host's relay.
 * `reach` is one port on the host's loopback the command may connect to through the proxy (the
 * candidate app, for the holdouts).
 */
export function srtNetwork(platform: NodeJS.Platform, relayPort?: number, reach?: number): Record<string, unknown> {
  const allowedDomains = platform === "win32" ? ["localhost", "127.0.0.1"] : relayPort ? [`127.0.0.1:${relayPort}`] : [];
  if (reach && platform !== "win32") allowedDomains.push(`127.0.0.1:${reach}`, `localhost:${reach}`);
  return { allowedDomains, deniedDomains: [], allowLocalBinding: true };
}

/**
 * The `node_modules` folders of a checkout, up to three levels down (a pnpm or npm workspace's
 * packages). Test tools keep their caches there (vite, vitest), so a command that must not change
 * the checkout's source may still write them.
 */
export function nodeModulesDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git") continue;
      if (e.name === "node_modules") found.push(join(dir, e.name));
      else if (depth < 3 && !e.name.startsWith(".")) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * Credential folders in the user's home no command Temper sandboxes needs: SSH and GPG keys,
 * cloud and git host logins, other agent CLIs' state. Only those that exist (srt can only mask a
 * real path). Windows needs none: srt runs commands there as an account that cannot read the profile.
 */
export function personalSecretDirs(home = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [];
  return [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gh", ".config/gcloud", ".claude", ".codex", ".netrc", ".git-credentials"]
    .map((p) => join(home, p))
    .filter((p) => existsSync(p));
}

/** The srt settings for one command: no outbound network, writes only to `allowWrite`. */
export function srtSettings(sandbox: Pick<Sandbox, "denyRead" | "allowRead">, allowWrite: string[], network: Record<string, unknown>): Record<string, unknown> {
  return {
    network,
    filesystem: { denyRead: sandbox.denyRead, allowRead: sandbox.allowRead ?? [], allowWrite, denyWrite: [] },
  };
}

/**
 * Runs inside the sandbox. srt gives the command a fresh environment on Windows, so the variables
 * travel in a file next to this script. On Linux it also carries the app's port out through
 * srt's proxy to the host relay (`hostRelay`), keeping a few idle tunnels open.
 */
export const LAUNCHER = `
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
Object.assign(process.env, cfg.env);
if (cfg.bridge) bridge(cfg.bridge);
const child = spawn(cfg.command, { shell: true, stdio: "inherit", env: process.env });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => child.kill(s));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

function bridge({ relayPort, token, appPort }) {
  const proxy = new URL(process.env.HTTP_PROXY || process.env.http_proxy);
  const auth = proxy.username
    ? "Proxy-Authorization: Basic " + Buffer.from(decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password)).toString("base64") + "\\r\\n"
    : "";
  const open = () => {
    let stage = "connect", buf = Buffer.alloc(0), again = false;
    const retry = () => { if (!again) { again = true; setTimeout(open, 250); } };
    const tunnel = connect(Number(proxy.port) || 80, proxy.hostname, () =>
      tunnel.write("CONNECT 127.0.0.1:" + relayPort + " HTTP/1.1\\r\\nHost: 127.0.0.1:" + relayPort + "\\r\\n" + auth + "\\r\\n"));
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === "connect") {
        const end = buf.indexOf("\\r\\n\\r\\n");
        if (end < 0) return;
        if (!/^HTTP\\/1\\.[01] 200/.test(buf.toString("latin1", 0, end))) { tunnel.destroy(); return retry(); }
        buf = buf.subarray(end + 4);
        stage = "idle";
        tunnel.write(token + "\\n");
      }
      if (stage === "idle" && buf.length) {
        // The relay sends one byte when a client arrives; the client's bytes may follow at once.
        stage = "piping";
        tunnel.off("data", onData);
        tunnel.pause();
        open();
        const rest = buf.subarray(1);
        const app = connect(appPort, "127.0.0.1", () => {
          if (rest.length) app.write(rest);
          tunnel.pipe(app);
          app.pipe(tunnel);
          tunnel.resume();
        });
        app.on("error", () => tunnel.destroy());
        app.on("close", () => tunnel.destroy());
        tunnel.on("close", () => app.destroy());
      }
    };
    tunnel.on("data", onData);
    tunnel.on("error", () => {});
    tunnel.on("close", () => { if (stage !== "piping") retry(); });
  };
  for (let i = 0; i < 4; i++) open();
}
`;

/**
 * The host end of the Linux bridge. Tunnels opened from inside the sandbox register on
 * `relayPort` with the token; each client connecting to `url` is paired with an idle tunnel.
 */
export async function hostRelay(token: string): Promise<{ relayPort: number; url: string; close: () => void }> {
  const idle: Socket[] = [];
  const waiting: Array<(t: Socket) => void> = [];
  const sockets = new Set<Socket>();
  const track = (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => s.destroy());
  };
  const expected = Buffer.from(token + "\n");
  const tunnels = createServer((t) => {
    track(t);
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < expected.length) return;
      t.off("data", onData);
      if (!timingSafeEqual(buf.subarray(0, expected.length), expected)) return void t.destroy();
      t.pause();
      t.on("close", () => idle.splice(idle.indexOf(t) >>> 0, 1));
      const next = waiting.shift();
      if (next) next(t);
      else idle.push(t);
    };
    t.on("data", onData);
  });
  const clients = createServer((client) => {
    track(client);
    client.pause();
    const pair = (t: Socket) => {
      clearTimeout(timer);
      if (client.destroyed) return void idle.push(t);
      t.write("G");
      client.pipe(t);
      t.pipe(client);
      t.resume();
      client.resume();
      t.on("close", () => client.destroy());
      client.on("close", () => t.destroy());
    };
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(pair) >>> 0, 1);
      client.destroy();
    }, 30_000);
    const t = idle.shift();
    if (t) pair(t);
    else waiting.push(pair);
  });
  const listen = (s: Server) => new Promise<number>((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve((s.address() as { port: number }).port));
  });
  const [relayPort, port] = await Promise.all([listen(tunnels), listen(clients)]);
  return {
    relayPort,
    url: `http://127.0.0.1:${port}`,
    close: () => {
      tunnels.close();
      clients.close();
      for (const s of sockets) s.destroy();
    },
  };
}

/**
 * Prepares `command` (a shell command line) to run in `cwd` under the sandbox. The command may
 * write only `cwd` (unless `readOnlyCwd`), a private temp dir (its TMPDIR) and `allowWrite`. With
 * `expose`, the command listens on that port inside the sandbox and the result's `url` reaches it
 * from the host. With `reach`, it may connect to that port on the host's loopback (see srtNetwork).
 */
export async function sandboxed(
  sandbox: Sandbox,
  command: string,
  opts: { cwd: string; allowWrite?: string[]; env?: Record<string, string>; expose?: number; readOnlyCwd?: boolean; reach?: number },
  platform: NodeJS.Platform = process.platform,
): Promise<SandboxedCommand> {
  const tmp = mkdtempSync(join(gateScratchRoot(), "temper-gate-tmp-"));
  const direct = opts.expose ? `http://127.0.0.1:${opts.expose}` : undefined;
  if (sandbox.mode === "off") {
    return { file: command, args: [], shell: true, env: sandboxEnv(opts.env, tmp), url: direct, dispose: () => rmSync(tmp, { recursive: true, force: true }) };
  }
  const token = randomBytes(24).toString("base64url");
  const relay = opts.expose && platform === "linux" ? await hostRelay(token) : undefined;
  // XDG_RUNTIME_DIR too: tools keep locks there (pnpm 12 its store locks), and the real one is read-only here.
  const extra: Record<string, string> = { ...opts.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, ...(platform === "win32" ? {} : { XDG_RUNTIME_DIR: tmp }) };
  // Windows routes loopback through srt's proxy; Node's own HTTP client only uses it when told to.
  if (platform === "win32") extra.NODE_USE_ENV_PROXY = "1";
  const launch = join(tmp, "launch.json");
  writeFileSync(launch, JSON.stringify({
    env: extra,
    command,
    bridge: relay && { relayPort: relay.relayPort, token, appPort: opts.expose },
  }));
  writeFileSync(join(tmp, "launch.mjs"), LAUNCHER);
  // The settings live outside every writable path, so the command cannot rewrite its own policy.
  const settingsDir = mkdtempSync(join(tmpdir(), "temper-srt-"));
  const settings = join(settingsDir, "srt-settings.json");
  writeFileSync(settings, JSON.stringify(srtSettings(sandbox, [...(opts.readOnlyCwd ? [] : [opts.cwd]), tmp, ...(opts.allowWrite ?? [])], srtNetwork(platform, relay?.relayPort, opts.reach))), { mode: 0o600 });
  const q = (s: string) => `"${s}"`;
  return {
    file: process.execPath,
    args: [srtCli(), "--settings", settings, "-c", [process.execPath, join(tmp, "launch.mjs"), launch].map(q).join(" ")],
    shell: false,
    env: sandboxEnv({}, tmp),
    url: relay?.url ?? direct,
    dispose: () => {
      relay?.close();
      rmSync(tmp, { recursive: true, force: true });
      rmSync(settingsDir, { recursive: true, force: true });
    },
  };
}
