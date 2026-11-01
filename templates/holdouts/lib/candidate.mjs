// Feature detection on the candidate checkout: baseline checks expect a behaviour only once the
// candidate contains the code that introduces it, so checks never run ahead of main.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = () => process.env.TEMPER_CANDIDATE_PATH;

export function hasFile(rel) {
  return !!root() && existsSync(join(root(), rel));
}

export function fileMatches(rel, re) {
  return hasFile(rel) && re.test(readFileSync(join(root(), rel), "utf8"));
}
