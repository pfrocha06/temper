import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

let env: NodeJS.ProcessEnv | undefined;

/**
 * Pins every gh/git-host call to one account. Without this, a service started by launchd
 * would act as whichever keyring account happens to be active.
 */
export async function useGithubUser(user: string | undefined): Promise<void> {
  if (!user) {
    env = undefined;
    return;
  }
  const { stdout } = await exec("gh", ["auth", "token", "--user", user]);
  env = { ...process.env, GH_TOKEN: stdout.trim(), GITHUB_TOKEN: "" };
}

export function githubEnv(): NodeJS.ProcessEnv {
  return env ?? process.env;
}

/** git args that route credentials through gh (and therefore the pinned account). */
export const GIT_CREDENTIAL_ARGS = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];
