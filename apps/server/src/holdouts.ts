import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.ts";

/** Where Temper keeps a project's holdouts when the board names no folder (see Config.holdoutsRoot). */
export const defaultHoldoutsPath = (holdoutsRoot: string, projectName: string) =>
  join(holdoutsRoot, projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project");

/** The command that runs a holdouts folder made from the starter template. */
export const STARTER_HOLDOUTS_COMMAND = "node run.mjs";

/**
 * Makes `dir` a holdouts folder from Temper's starter template: run.mjs, helpers and one example
 * baseline check, in a local git repository (Temper commits every holdout change and diffs it).
 * An existing git folder is kept as it is. Anything else already there is an error.
 */
export async function initHoldouts(dir: string, templateDir: string): Promise<{ created: boolean }> {
  if (existsSync(join(dir, ".git"))) return { created: false };
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} exists and is not a git repository; pass --holdouts with an empty folder or a holdouts checkout`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  cpSync(templateDir, dir, { recursive: true });
  const git = async (...args: string[]) => {
    const r = await run("git", args, { cwd: dir });
    if (r.code !== 0) throw new Error(`git ${args[0]} failed in ${dir}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  // The board's own git identity when it has one; otherwise a neutral one, so a fresh machine works.
  const identity = (await run("git", ["config", "user.email"], { cwd: dir })).stdout.trim() ? [] : ["-c", "user.name=Temper", "-c", "user.email=temper@localhost"];
  await git(...identity, "commit", "-q", "-m", "holdouts: start from Temper's template");
  return { created: true };
}
