// The secret scan every change passes before Temper pushes it (SEC-05). It is gitleaks or
// nothing: a missing, outdated, failing or stuck scanner fails the gate, never passes it.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../exec.ts";

/** The oldest gitleaks whose `git` command and JSON report this scan relies on. */
export const GITLEAKS_MIN = "8.18.0";

export const GITLEAKS_INSTALL =
  "gitleaks is required to scan changes before Temper pushes them. Install it (macOS: `brew install gitleaks`; " +
  "Windows: `winget install gitleaks`; Linux: a release from https://github.com/gitleaks/gitleaks/releases), " +
  "or point TEMPER_GITLEAKS at the binary, then retry the ticket.";

export type ScanResult = { ok: boolean; report: string };

type Finding = { RuleID?: string; File?: string; StartLine?: number; Commit?: string };

const parseVersion = (s: string) => /(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1, 4).map(Number);
const older = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

/**
 * Scans the commits in `base..HEAD` of `worktree` with gitleaks (`bin` is the command, e.g.
 * `["gitleaks"]`). Findings are reported by rule, file and line; the secret itself never is.
 */
export async function scanCommits(worktree: string, base: string, bin: string[], opts: { timeoutMs?: number } = {}): Promise<ScanResult> {
  const [file, ...pre] = bin;
  const v = await run(file!, [...pre, "version"], { cwd: worktree, timeoutMs: 30_000 });
  const version = v.code === 0 ? parseVersion(v.stdout) : undefined;
  if (!version) return { ok: false, report: GITLEAKS_INSTALL };
  const shown = version.join(".");
  if (older(version, parseVersion(GITLEAKS_MIN)!) < 0) {
    return { ok: false, report: `gitleaks ${shown} is older than ${GITLEAKS_MIN}. ${GITLEAKS_INSTALL}` };
  }

  const dir = mkdtempSync(join(tmpdir(), "temper-gitleaks-"));
  const reportPath = join(dir, "report.json");
  try {
    const r = await run(
      file!,
      [...pre, "git", "--no-banner", "--redact", "--exit-code", "1", "--report-format", "json", "--report-path", reportPath, "--log-opts", `${base}..HEAD`, "."],
      { cwd: worktree, timeoutMs: opts.timeoutMs ?? 5 * 60_000 },
    );
    if (r.timedOut) return { ok: false, report: `gitleaks timed out scanning ${base}..HEAD; the scan did not pass.` };
    if (r.code === 0) return { ok: true, report: `gitleaks ${shown}: no leaks in ${base}..HEAD` };
    if (r.code === 1) {
      let findings: Finding[] = [];
      try {
        findings = JSON.parse(readFileSync(reportPath, "utf8")) as Finding[];
      } catch {
        // An unreadable report still means gitleaks found something: fail without details.
      }
      const lines = findings.map((f) => `- ${f.RuleID ?? "secret"} in ${f.File ?? "?"}:${f.StartLine ?? "?"} (commit ${(f.Commit ?? "").slice(0, 9)})`);
      return { ok: false, report: `gitleaks found ${findings.length || "possible"} leak${findings.length === 1 ? "" : "s"} in ${base}..HEAD:\n${lines.join("\n")}` };
    }
    // Anything else is the scanner failing: its output can carry repository content, so only the
    // first line is kept.
    const first = (r.stderr || r.stdout).trim().split("\n")[0]?.slice(0, 200) ?? "";
    return { ok: false, report: `gitleaks failed (exit ${r.code}); the scan did not pass. ${first}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Pushes `branch` only if `base..HEAD` scans clean; the one way Temper publishes a ticket's
 * commits. Returns the scan, so a caller can report why nothing was pushed.
 */
export async function scanThenPush(
  worktree: string,
  base: string,
  branch: string,
  bin: string[],
  push: (cwd: string, branch: string) => Promise<void>,
): Promise<ScanResult> {
  const scan = await scanCommits(worktree, base, bin);
  if (scan.ok) await push(worktree, branch);
  return scan;
}
