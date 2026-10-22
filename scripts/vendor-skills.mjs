#!/usr/bin/env node
// Vendors pinned upstream skills into skills/vendor/<owner>/<name> and rebuilds skills/registry.json.
// Sources and commits live in skills/sources.json; bumping a commit there is a chore ticket.
// Fetched repositories are treated as data: nothing from them is executed.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const { sources } = JSON.parse(readFileSync(join(root, "skills/sources.json"), "utf8"));
const vendorDir = join(root, "skills/vendor");
rmSync(vendorDir, { recursive: true, force: true });

const registry = [];
for (const src of sources) {
  const [owner] = src.repo.split("/");
  const tmp = mkdtempSync(join(tmpdir(), "temper-vendor-"));
  const git = (...a) => execFileSync("git", a, { cwd: tmp, stdio: "pipe" });
  git("init", "-q");
  git("remote", "add", "origin", `https://github.com/${src.repo}.git`);
  git("fetch", "-q", "--depth", "1", "origin", src.commit);
  git("checkout", "-q", "FETCH_HEAD");
  const dest = join(vendorDir, owner);
  mkdirSync(dest, { recursive: true });
  const license = readdirSync(tmp).find((f) => /^licen[cs]e/i.test(f));
  if (license) cpSync(join(tmp, license), join(dest, "LICENSE"));
  for (const path of src.skills) {
    const from = join(tmp, path);
    if (!existsSync(join(from, "SKILL.md"))) throw new Error(`${src.repo}: ${path}/SKILL.md not found`);
    const name = basename(path);
    if (registry.some((r) => r.name === name)) throw new Error(`duplicate skill name '${name}'`);
    cpSync(from, join(dest, name), { recursive: true });
    registry.push({ name, origin: "vendor", path: `skills/vendor/${owner}/${name}`, source: src.repo, commit: src.commit, license: src.license });
  }
  rmSync(tmp, { recursive: true, force: true });
}

const localDir = join(root, "skills/local");
if (existsSync(localDir)) {
  for (const name of readdirSync(localDir)) {
    if (existsSync(join(localDir, name, "SKILL.md"))) registry.push({ name, origin: "local", path: `skills/local/${name}` });
  }
}

registry.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(root, "skills/registry.json"), JSON.stringify({ skills: registry }, null, 2) + "\n");
console.log(`vendored ${registry.filter((r) => r.origin === "vendor").length} skills`);
