import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.ts";

export const LABEL = "dev.temper.main";
export const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = () => `gui/${process.getuid?.() ?? 501}`;

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

export async function installService(home: string): Promise<void> {
  mkdirSync(join(home, "logs"), { recursive: true });
  mkdirSync(dirname(plistPath()), { recursive: true });
  writeFileSync(plistPath(), plist({ home, node: process.execPath, path: process.env.PATH ?? "/usr/bin:/bin" }));
  await run("launchctl", ["bootout", `${domain()}/${LABEL}`], { cwd: home });
  const r = await run("launchctl", ["bootstrap", domain(), plistPath()], { cwd: home });
  if (r.code !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr}`);
}

export async function uninstallService(home: string): Promise<void> {
  await run("launchctl", ["bootout", `${domain()}/${LABEL}`], { cwd: home });
}

export async function restartService(home: string): Promise<boolean> {
  const r = await run("launchctl", ["kickstart", "-k", `${domain()}/${LABEL}`], { cwd: home });
  return r.code === 0;
}

export async function stopService(home: string): Promise<void> {
  await run("launchctl", ["kill", "SIGTERM", `${domain()}/${LABEL}`], { cwd: home });
}

export async function serviceInstalled(home: string): Promise<boolean> {
  return (await run("launchctl", ["print", `${domain()}/${LABEL}`], { cwd: home })).code === 0;
}
