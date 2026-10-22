import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.ts";

export type ChangedFile = { status: "A" | "M" | "D" | "R"; path: string };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, { cwd, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export const branchFor = (ticketId: string) => `temper/${ticketId}`;

/** Creates (or reuses) the ticket's worktree on its own branch off the default branch. */
export async function ensureWorktree(repoPath: string, worktreesDir: string, ticketId: string, base: string): Promise<{ path: string; branch: string }> {
  const branch = branchFor(ticketId);
  const path = join(worktreesDir, ticketId);
  if (existsSync(path)) return { path, branch };
  mkdirSync(worktreesDir, { recursive: true });
  const exists = (await run("git", ["rev-parse", "--verify", "--quiet", branch], { cwd: repoPath })).code === 0;
  if (exists) await git(repoPath, "worktree", "add", path, branch);
  else await git(repoPath, "worktree", "add", "-b", branch, path, base);
  return { path, branch };
}

export async function removeWorktree(repoPath: string, path: string): Promise<void> {
  if (existsSync(path)) await git(repoPath, "worktree", "remove", "--force", path);
  await git(repoPath, "worktree", "prune");
}

export async function mergeBase(cwd: string, base: string): Promise<string> {
  return git(cwd, "merge-base", "HEAD", base);
}

/** Files changed between the merge base and HEAD, committed work only. */
export async function changedFiles(cwd: string, base: string): Promise<ChangedFile[]> {
  const mb = await mergeBase(cwd, base);
  const out = await git(cwd, "diff", "--name-status", "--no-renames", mb, "HEAD");
  return out
    ? out.split("\n").map((l) => {
        const [status, path] = l.split("\t");
        return { status: status!.charAt(0) as ChangedFile["status"], path: path! };
      })
    : [];
}

export async function diff(cwd: string, base: string, paths: string[] = []): Promise<string> {
  const mb = await mergeBase(cwd, base);
  return git(cwd, "diff", mb, "HEAD", "--", ...paths);
}

export async function commitsAhead(cwd: string, base: string): Promise<number> {
  return Number(await git(cwd, "rev-list", "--count", `${base}..HEAD`));
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  return (await git(cwd, "status", "--porcelain")) !== "";
}

export async function headSha(cwd: string): Promise<string> {
  return git(cwd, "rev-parse", "HEAD");
}

/** Server-only: push the ticket branch. Agents never call this (ADR 2). */
export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await git(cwd, "push", "--set-upstream", "origin", `${branch}:${branch}`);
}

/** Files changed between two refs. */
export async function changedBetween(cwd: string, from: string, to: string): Promise<ChangedFile[]> {
  const out = await git(cwd, "diff", "--name-status", "--no-renames", from, to);
  return out
    ? out.split("\n").map((l) => {
        const [status, path] = l.split("\t");
        return { status: status!.charAt(0) as ChangedFile["status"], path: path! };
      })
    : [];
}

export async function diffBetween(cwd: string, from: string, to: string, paths: string[] = []): Promise<string> {
  return git(cwd, "diff", from, to, "--", ...paths);
}

/** Commits everything in `cwd` if dirty. Returns true when a commit was made. */
export async function commitAll(cwd: string, message: string): Promise<boolean> {
  if (!(await hasUncommittedChanges(cwd))) return false;
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "-m", message);
  return true;
}

export async function fetchBranch(cwd: string, branch: string): Promise<void> {
  await git(cwd, "fetch", "-q", "origin", branch);
}
