// Runs every holdout against the candidate app and prints one result line per check.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const url = process.env.TEMPER_APP_URL;
const candidatePath = process.env.TEMPER_CANDIDATE_PATH;
const current = process.env.TEMPER_TICKET_ID;
const root = import.meta.dirname;

// Checks of unmerged tickets must not judge other tickets. The server passes the merged ones;
// a manual run without the variable includes everything.
const merged = process.env.TEMPER_REGRESSION_TICKETS?.split(",").filter(Boolean);
const suites = [["baseline", join(root, "baseline")]];
if (existsSync(join(root, "tickets"))) {
  for (const t of readdirSync(join(root, "tickets"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    if (t === current || !merged || merged.includes(t)) suites.push([t, join(root, "tickets", t)]);
  }
}

let failed = 0;
for (const [scope, dir] of suites) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".holdout.mjs")).sort()) {
    let results;
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      results = await mod.default({ url, candidatePath });
    } catch (err) {
      results = [{ id: file.replace(".holdout.mjs", ""), pass: false, message: `crashed: ${String(err?.message ?? err).split("\n")[0]}` }];
    }
    for (const r of results) {
      const label = scope === current ? r.id : `REG-${scope}-${r.id}`;
      if (!r.pass) failed++;
      console.log(`${label}: ${r.pass ? "PASS" : "FAIL"}${r.message ? ` ${r.message}` : ""}`);
    }
  }
}
process.exit(failed ? 1 : 0);
