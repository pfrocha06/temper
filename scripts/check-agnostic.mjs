#!/usr/bin/env node
// Fails if company-specific terms leak into the repo. Temper's core must stay
// company-agnostic; anything company-specific belongs in a local profile plugin.
//
// Patterns come only from the private denylist below, so the repository never names one.
// Extra private patterns (one regex per line) can live in ~/.temper/agnostic-denylist.txt,
// which is never committed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const builtIn = [];

const extraFile = join(homedir(), ".temper", "agnostic-denylist.txt");
const extra = existsSync(extraFile)
  ? readFileSync(extraFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  : [];

const patterns = [...builtIn, ...extra].map((p) => new RegExp(p, "i"));

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("skills/vendor/") && existsSync(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const re of patterns) {
      if (re.test(line)) hits.push(`${file}:${i + 1} matches /${re.source}/`);
    }
  });
}

if (hits.length > 0) {
  console.error("Company-specific terms found (move them to a profile plugin):");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check-agnostic: ${files.length} files clean`);
