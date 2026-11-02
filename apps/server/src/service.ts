import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { run } from "./exec.ts";

// The service that keeps the current release running: launchd on macOS, systemd on Linux.
// Elsewhere (Windows, Linux without systemd) there is none, and updates are applied by hand.

export const LABEL = "dev.temper.main";
export const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = () => `gui/${process.getuid?.() ?? 501}`;

export const SYSTEMD_UNIT = "temper.service";

export type ServiceKind = "launchd" | "systemd" | "none";

export function serviceKind(platform: NodeJS.Platform = process.platform, systemdBooted = existsSync("/run/systemd/system")): ServiceKind {
  if (platform === "darwin") return "launchd";
  if (platform === "linux" && systemdBooted) return "systemd";
  return "none";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** launchd job: runs the current release, restarts on crash, starts at login. */
export function plist(opts: { home: string; node: string; path: string }): string {
  const entry = join(opts.home, "current", "apps", "server", "src", "main.ts");
  const env: Record<string, string> = { TEMPER_HOME: opts.home, TEMPER_INSTANCE: "main", PATH: opts.path };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(opts.node)}</string><string>${esc(entry)}</string></array>
  <key>WorkingDirectory</key><string>${esc(join(opts.home, "current"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${k}</key><string>${esc(v)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(join(opts.home, "logs", "main.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(join(opts.home, "logs", "main.log"))}</string>
</dict>
</plist>
`;
}

// ── systemd ──────────────────────────────────────────────────────────────────

/** System unit when running as root (how a WSL or server install runs), else a user unit. */
const systemdUser = () => (process.getuid?.() ?? 0) !== 0;
const systemctl = (args: string[], cwd: string) => run("systemctl", [...(systemdUser() ? ["--user"] : []), ...args], { cwd });

/** Where the unit lives: the file systemd already loads it from, else the standard place. */
export async function systemdUnitPath(home: string): Promise<string> {
  const r = await systemctl(["show", "-p", "FragmentPath", "--value", SYSTEMD_UNIT], home);
  const existing = r.code === 0 ? r.stdout.trim() : "";
  if (existing) return existing;
  return systemdUser() ? join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT) : join("/etc/systemd/system", SYSTEMD_UNIT);
}

/** `Environment=` pairs of an existing unit, so a rewrite keeps what the owner set by hand. */
export function unitEnvironment(unit: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of unit.split(/\r?\n/)) {
    const m = /^\s*Environment=(.*)$/.exec(line);
    if (!m) continue;
    // One or more KEY=VALUE, each optionally double-quoted.
    for (const pair of m[1]!.match(/"[^"]*"|\S+/g) ?? []) {
      const kv = pair.startsWith('"') ? pair.slice(1, -1) : pair;
      const eq = kv.indexOf("=");
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return env;
}

const unitValue = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

/** systemd unit: runs the current release, restarts on failure, starts at boot. */
export function systemdUnit(opts: { home: string; node: string; path: string; keepEnv?: Record<string, string>; user: boolean }): string {
  // systemd is Linux-only: POSIX paths whatever the platform this is built or tested on.
  const current = posix.join(opts.home, "current");
  const env: Record<string, string> = {
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    ...opts.keepEnv,
    TEMPER_HOME: opts.home,
    TEMPER_INSTANCE: "main",
    PATH: opts.path,
  };
  const log = posix.join(opts.home, "logs", "main.log");
  return `[Unit]
Description=Temper (main instance)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${current}
${Object.entries(env)
  .map(([k, v]) => `Environment=${unitValue(`${k}=${v}`)}`)
  .join("\n")}
ExecStart=${opts.node} ${posix.join(current, "apps", "server", "src", "main.ts")}
Restart=on-failure
RestartSec=5
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=${opts.user ? "default.target" : "multi-user.target"}
`;
}

// ── both ─────────────────────────────────────────────────────────────────────

export async function installService(home: string): Promise<void> {
  mkdirSync(join(home, "logs"), { recursive: true });
  const kind = serviceKind();
  if (kind === "launchd") {
    mkdirSync(dirname(plistPath()), { recursive: true });
    writeFileSync(plistPath(), plist({ home, node: process.execPath, path: process.env.PATH ?? "/usr/bin:/bin" }));
    await run("launchctl", ["bootout", `${domain()}/${LABEL}`], { cwd: home });
    const r = await run("launchctl", ["bootstrap", domain(), plistPath()], { cwd: home });
    if (r.code !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr}`);
    return;
  }
  if (kind === "systemd") {
    const path = await systemdUnitPath(home);
    const keepEnv = existsSync(path) ? unitEnvironment(readFileSync(path, "utf8")) : {};
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, systemdUnit({ home, node: process.execPath, path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", keepEnv, user: systemdUser() }));
    for (const args of [["daemon-reload"], ["enable", SYSTEMD_UNIT], ["restart", SYSTEMD_UNIT]]) {
      const r = await systemctl(args, home);
      if (r.code !== 0) throw new Error(`systemctl ${args.join(" ")} failed: ${r.stderr}`);
    }
    return;
  }
  throw new Error("no service manager here (launchd or systemd); run `temper serve` instead");
}

/**
 * The service definition as it is now (plist or unit), and a way to put it back and start it.
 * A first deploy rewrites a hand-made definition; if that release fails, this restores the old one.
 */
export async function snapshotService(home: string): Promise<() => Promise<void>> {
  const kind = serviceKind();
  const path = kind === "launchd" ? plistPath() : kind === "systemd" ? await systemdUnitPath(home) : undefined;
  const before = path && existsSync(path) ? readFileSync(path, "utf8") : undefined;
  return async () => {
    if (!path || before === undefined) return;
    writeFileSync(path, before);
    if (kind === "launchd") {
      await run("launchctl", ["bootout", `${domain()}/${LABEL}`], { cwd: home });
      await run("launchctl", ["bootstrap", domain(), path], { cwd: home });
    } else {
      await systemctl(["daemon-reload"], home);
      await systemctl(["restart", SYSTEMD_UNIT], home);
    }
  };
}

export async function uninstallService(home: string): Promise<void> {
  const kind = serviceKind();
  if (kind === "launchd") await run("launchctl", ["bootout", `${domain()}/${LABEL}`], { cwd: home });
  else if (kind === "systemd") await systemctl(["stop", SYSTEMD_UNIT], home);
}

export async function serviceInstalled(home: string): Promise<boolean> {
  const kind = serviceKind();
  if (kind === "launchd") return (await run("launchctl", ["print", `${domain()}/${LABEL}`], { cwd: home })).code === 0;
  if (kind === "systemd") return (await systemctl(["is-active", "--quiet", SYSTEMD_UNIT], home)).code === 0;
  return false;
}

/**
 * Starts `node <args>` so it outlives the service: a deploy stops the service, and anything in
 * the service's own process group (launchd) or cgroup (systemd) would be stopped with it.
 */
export async function spawnOutsideService(home: string, args: string[], env: Record<string, string>, logFile: string): Promise<void> {
  mkdirSync(dirname(logFile), { recursive: true });
  if (serviceKind() === "systemd") {
    const r = await run(
      "systemd-run",
      [
        ...(systemdUser() ? ["--user"] : []),
        `--unit=temper-update-${Date.now()}`,
        "--collect",
        `--working-directory=${home}`,
        `--property=StandardOutput=append:${logFile}`,
        `--property=StandardError=append:${logFile}`,
        ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`),
        process.execPath,
        ...args,
      ],
      { cwd: home },
    );
    if (r.code !== 0) throw new Error(`systemd-run failed: ${r.stderr.trim()}`);
    return;
  }
  // launchd: a new session (detached) leaves the job's process group, so bootout does not reach it.
  const out = openSync(logFile, "a");
  const child = spawn(process.execPath, args, { cwd: home, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", out, out] });
  child.unref();
}
