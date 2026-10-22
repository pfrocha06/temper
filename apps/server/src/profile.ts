import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A profile binds one identity: which git host account the server acts as, which adapters
 * and plugins are enabled. It lives in TEMPER_HOME/profile.json and is never committed.
 */
export type Profile = {
  name: string;
  github?: { user: string };
  adapters: string[];
  plugins: string[];
};

const DEFAULT: Profile = { name: "default", adapters: ["claude-cli"], plugins: ["github"] };

export function loadProfile(home: string): Profile {
  const file = join(home, "profile.json");
  if (!existsSync(file)) return DEFAULT;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Profile>;
  return { ...DEFAULT, ...raw };
}
