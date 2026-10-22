import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A profile binds one identity: which git host account the server acts as, which adapters
 * and plugins are enabled. It lives in TEMPER_HOME/profile.json and is never committed.
 */
export type McpServerConfig = { command: string; args?: string[]; env?: Record<string, string>; description?: string };

/** Jira Cloud connection. The API token is never in the profile: it is read from `<secretsDir>/<tokenSecret>`. */
export type JiraTrackerConfig = {
  baseUrl: string;
  email: string;
  tokenSecret: string;
  projects?: string[];
  transitions?: { inProgress?: string; inReview?: string; done?: string };
};

export type TrackersConfig = { jira?: JiraTrackerConfig };

export type Profile = {
  name: string;
  github?: { user: string };
  adapters: string[];
  plugins: string[];
  /** MCP servers agents may be given (assigned per role on the Agents screen). Values never leave the server. */
  mcpServers: Record<string, McpServerConfig>;
  /** Issue trackers the server can talk to (work intake and progress write-back). */
  trackers?: TrackersConfig;
};

const DEFAULT: Profile = { name: "default", adapters: ["claude-cli"], plugins: ["github"], mcpServers: {} };

export function loadProfile(home: string): Profile {
  const file = join(home, "profile.json");
  if (!existsSync(file)) return DEFAULT;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Profile>;
  const jira = raw.trackers?.jira;
  if (jira) {
    for (const k of ["baseUrl", "email", "tokenSecret"] as const) {
      if (typeof jira[k] !== "string" || !jira[k]) throw new Error(`profile.json: trackers.jira.${k} is required`);
    }
  }
  return { ...DEFAULT, ...raw };
}

/**
 * The Jira connection with its token resolved from the secrets directory, or undefined when the
 * profile has no `trackers.jira`. A missing secret throws an error that names the secret only.
 */
export function loadJiraTracker(profile: Profile, secretsDir: string): (JiraTrackerConfig & { token: string }) | undefined {
  const jira = profile.trackers?.jira;
  if (!jira) return undefined;
  const name = jira.tokenSecret;
  if (/[\\/]|^\.\.?$/.test(name)) throw new Error(`Jira token secret "${name}" is not a plain file name`);
  const file = join(secretsDir, name);
  if (!existsSync(file)) throw new Error(`Jira token secret "${name}" not found in ${secretsDir}`);
  const token = readFileSync(file, "utf8").trim();
  if (!token) throw new Error(`Jira token secret "${name}" is empty`);
  return { ...jira, token };
}
