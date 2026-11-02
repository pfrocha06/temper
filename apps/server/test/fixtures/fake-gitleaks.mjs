#!/usr/bin/env node
// Stands in for gitleaks in tests: `node fake-gitleaks.mjs <mode> version|git …`.
// Modes: clean, leak (writes a JSON report with one finding, exits 1), error (exits 2),
// hang (never exits), old (reports version 8.0.0).
import { writeFileSync } from "node:fs";

const [mode, command, ...args] = process.argv.slice(2);
if (command === "version") {
  console.log(mode === "old" ? "v8.0.0" : "8.30.1");
  process.exit(0);
}
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "error") {
  console.error("fatal: not a git repository");
  process.exit(2);
} else {
  const report = args[args.indexOf("--report-path") + 1];
  const findings = mode === "leak" ? [{ RuleID: "aws-access-token", File: "src/config.ts", StartLine: 3, Commit: "abc1234def", Secret: "REDACTED" }] : [];
  writeFileSync(report, JSON.stringify(findings));
  process.exit(findings.length ? 1 : 0);
}
