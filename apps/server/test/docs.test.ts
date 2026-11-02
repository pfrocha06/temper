import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const helpText = execFileSync(process.execPath, [join(root, "apps/server/src/cli.ts"), "help"], { encoding: "utf8" });

interface HelpEntry { names: string[]; text: string }

/** Help entries: a line indented two spaces starts one; deeper lines continue it. */
function parseHelp(help: string): HelpEntry[] {
  const entries: { head: string; text: string }[] = [];
  for (const line of help.split(/\r?\n/)) {
    if (/^ {2}\S/.test(line)) entries.push({ head: line.trim(), text: line });
    else if (/^ {3,}\S/.test(line) && entries.length) entries[entries.length - 1]!.text += `\n${line}`;
  }
  return entries.map(({ head, text }) => {
    // "codex login | logout | status" is three commands; "start | stop" is two.
    const words = head.split(/ {2,}|\[|\(|--/)[0]!.split("|").map((a) => a.trim()).filter(Boolean);
    const lead = words[0]!.split(/\s+/);
    const names = words.map((w, i) => (i > 0 && !w.includes(" ") && lead.length > 1 ? `${lead[0]} ${w}` : w));
    return { names, text };
  });
}

/** Every `temper <command>` line in the README's fenced code blocks, continuations joined. */
function readmeCommands(md: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let pending = "";
  for (const raw of md.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { inBlock = !inBlock; pending = ""; continue; }
    if (!inBlock) continue;
    const line = pending + raw.trim();
    pending = "";
    if (line.endsWith("\\")) { pending = `${line.slice(0, -1).trim()} `; continue; }
    if (/^temper\s/.test(line)) out.push(line);
  }
  return out;
}

/** The command words after `temper`, up to the first option, placeholder or quote. */
function commandOf(line: string): string[] {
  const words: string[] = [];
  for (const w of line.split(/\s+/).slice(1)) {
    if (!/^[a-z][a-z-]*$/.test(w)) break;
    words.push(w);
  }
  return words;
}

/** README commands the help does not list, as the words a reader would type. */
function unknownCommands(md: string, help: string): string[] {
  const names = new Set(parseHelp(help).flatMap((e) => e.names));
  const unknown: string[] = [];
  for (const line of readmeCommands(md)) {
    const words = commandOf(line);
    const known = words.length > 0 && (names.has(words.slice(0, 2).join(" ")) || names.has(words[0]!));
    if (!known) unknown.push(words.join(" ") || line);
  }
  return unknown;
}

/** Options a command line passes, ignoring quoted arguments and trailing comments. */
function optionsOf(line: string): string[] {
  const bare = line.replace(/"[^"]*"|'[^']*'/g, "").replace(/\s#.*$/, "");
  return [...bare.matchAll(/(?:^|\s)(--[a-z][a-z-]*)/g)].map((m) => m[1]!);
}

describe("README matches the CLI", () => {
  it("lists only commands that the help prints", () => {
    expect(readmeCommands(readme).length).toBeGreaterThan(5);
    expect(unknownCommands(readme, helpText)).toEqual([]);
  });

  it("uses only options that the command's help entry lists", () => {
    const entries = parseHelp(helpText);
    const checked = new Set<string>();
    for (const line of readmeCommands(readme)) {
      const words = commandOf(line);
      const name = words.slice(0, 2).join(" ");
      if (!["project add", "import-spec", "import-github", "import-jira"].includes(name) && !["import-spec", "import-github", "import-jira"].includes(words[0]!)) continue;
      const key = name === "project add" ? name : words[0]!;
      const entry = entries.find((e) => e.names.includes(key));
      expect(entry, key).toBeDefined();
      for (const opt of optionsOf(line)) {
        expect(entry!.text, `${key} ${opt}`).toContain(opt);
        checked.add(`${key} ${opt}`);
      }
    }
    expect(checked.has("project add --name")).toBe(true);
    expect(checked.has("import-spec --project")).toBe(true);
    expect(checked.has("import-github --search")).toBe(true);
    expect(checked.has("import-jira --jql")).toBe(true);
  });

  it("reports a command the help does not list", () => {
    const sample = "Intro\n\n```sh\ntemper frobnicate --now\ntemper status\n```\n";
    expect(unknownCommands(sample, helpText)).toEqual(["frobnicate"]);
  });

  it("agrees with the help on where the service and deploy work", () => {
    expect(helpText).toMatch(/start \| stop\s+install\/uninstall the service \(launchd or systemd\)/);
    expect(readme).toMatch(/Background service \(`temper start`\) \| ✅ launchd \| ✅ systemd/);
    expect(readme).toMatch(/temper deploy .*macOS \(launchd\) and Linux with systemd; on Windows run `temper serve`/);
  });
});
