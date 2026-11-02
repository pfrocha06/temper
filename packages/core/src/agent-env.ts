// The environment an agent CLI starts with (SEC-03). Never the server's whole environment: that
// holds git host and tracker tokens, the board token and whatever else the host exported. An
// agent gets what any process needs to run (paths, locale, the Windows profile variables), its
// adapter's own login, and the variables Temper sets for the run.

/** What every process needs, on every platform. Matched case-insensitively (Windows env names). */
export const BASE_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TERM", "TZ", "TMPDIR", "TMP", "TEMP",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
  // Corporate networks: where to send traffic and which CAs to trust. No credentials.
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  // Windows: the profile and system locations programs look up.
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "USERNAME", "USERDOMAIN",
  "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS",
] as const;

/** Prefixes kept as a family: the locale settings. */
const BASE_PREFIXES = ["LC_"];

/**
 * Variables a run may never set, whatever asks: they make every process the agent starts load
 * code of the setter's choosing.
 */
const UNSAFE = new Set(["LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "NODE_OPTIONS", "BASH_ENV", "ENV", "PROMPT_COMMAND", "PERL5OPT", "PYTHONSTARTUP"]);
const UNSAFE_PREFIXES = ["DYLD_"];

export class UnsafeAgentEnvError extends Error {
  override name = "UnsafeAgentEnvError";
}

/**
 * Builds an agent's environment: the base allowlist and `adapterKeys` (its own login, say
 * `ANTHROPIC_API_KEY`) taken from `source`, then the run's own variables (`run`). A run variable
 * that would load code into every process is refused rather than dropped, so the mistake shows.
 */
export function agentEnv(
  adapterKeys: readonly string[],
  run: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const keep = new Set([...BASE_ENV, ...adapterKeys].map((k) => k.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    const K = k.toUpperCase();
    if (v !== undefined && (keep.has(K) || BASE_PREFIXES.some((p) => K.startsWith(p)))) env[k] = v;
  }
  for (const [k, v] of Object.entries(run)) {
    const K = k.toUpperCase();
    if (UNSAFE.has(K) || UNSAFE_PREFIXES.some((p) => K.startsWith(p))) throw new UnsafeAgentEnvError(`a run may not set ${k}`);
    env[k] = v;
  }
  return env;
}
