#!/usr/bin/env node
// temper — operate the local factory: service, releases, projects, specs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import { join } from "node:path";
import { loadBoardToken } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { probeIsolation } from "./probe.ts";
import { activate, backupDatabase, buildRelease, readState, restoreDatabase, waitHealthy, waitStopped } from "./releases.ts";
import { run } from "./exec.ts";
import { installService, serviceInstalled, uninstallService } from "./service.ts";

const config = loadConfig();
const [command = "help", ...rest] = process.argv.slice(2);
const api = `http://127.0.0.1:${config.port}/api`;

const boardToken = () => loadBoardToken(join(config.secretsDir, "board-token"), process.env.TEMPER_BOARD_TOKEN);

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(api + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${boardToken()}` } });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body;
}

const log = (s: string) => console.log(s);

async function deploy(ref: string, source: string) {
  const tag = await buildRelease(config.home, source, ref, log);
  const before = readState(config.home);
  let switched = false;
  let backup: string | undefined;
  try {
    log(`→ stopping service`);
    await uninstallService(config.home);
    if (!(await waitStopped(config.port))) throw new Error("the old server did not stop within 30s");
    backup = backupDatabase(config.home);
    activate(config.home, tag, "deploy");
    switched = true;
    await installService(config.home);
    log(`→ waiting for ${tag} to become healthy`);
    if (await waitHealthy(config.port, 45_000)) {
      log(`✓ deployed ${tag}`);
      return;
    }
    log(`✗ ${tag} failed its health check — rolling back`);
  } catch (err) {
    log(`✗ deploy failed: ${(err as Error).message} — restoring the previous release`);
  }
  // Any failure after the service stopped: bring the previous release (and its data) back up.
  await uninstallService(config.home);
  await waitStopped(config.port);
  if (switched && backup) restoreDatabase(config.home, backup);
  if (before.current) {
    if (switched) activate(config.home, before.current, "rollback");
    await installService(config.home);
    log((await waitHealthy(config.port)) ? `✓ running ${before.current} again` : `✗ previous release did not come up; check ${config.home}/logs/main.log`);
  }
  process.exitCode = 1;
}

async function rollback() {
  const state = readState(config.home);
  if (!state.previous) throw new Error("no previous release to roll back to");
  await uninstallService(config.home);
  await waitStopped(config.port);
  activate(config.home, state.previous, "rollback");
  await installService(config.home);
  log((await waitHealthy(config.port)) ? `✓ rolled back to ${state.previous}` : "✗ service did not come up");
}

const help = `temper <command>

  open                           open the console in your browser, signed in as the board
  serve                          run the server in the foreground (development)
  deploy [--ref main] [--source .]   build, verify and switch the service to a release
  rollback                       switch back to the previous release
  start | stop                   install/uninstall the launchd service for the current release
  status                         service, release and factory status
  pause | resume                 stop/start dispatching new work
  project add --name N --repo PATH [--remote URL] [--holdouts PATH] [--setup CMD] [--test CMD] [--app CMD] [--health PATH] [--holdouts-cmd CMD] [--holdouts-setup CMD]
  import-spec --project ID --file SPEC.md [--title T] [--start]
  probe-isolation --holdouts PATH   check a Builder run cannot read holdouts or secrets, or use the board API
`;

switch (command) {
  case "open": {
    const url = `http://127.0.0.1:${config.port}/auth?token=${encodeURIComponent(boardToken())}`;
    await run("open", [url], { cwd: config.home });
    log(`opened the console; to sign in another browser use:\n${url}`);
    break;
  }
  case "serve":
    await import("./main.ts");
    break;
  case "deploy": {
    const { values } = parseArgs({ args: rest, options: { ref: { type: "string", default: "main" }, source: { type: "string", default: process.cwd() } } });
    await deploy(values.ref!, resolve(values.source!));
    break;
  }
  case "rollback":
    await rollback();
    break;
  case "start":
    if (!readState(config.home).current) throw new Error("no release yet; run `temper deploy` first");
    await installService(config.home);
    log((await waitHealthy(config.port)) ? `✓ running on http://127.0.0.1:${config.port}` : "✗ service did not come up");
    break;
  case "stop":
    await uninstallService(config.home);
    log("stopped");
    break;
  case "status": {
    const state = readState(config.home);
    log(`service: ${(await serviceInstalled(config.home)) ? "installed" : "not installed"}`);
    log(`release: ${state.current ?? "none"} (previous: ${state.previous ?? "none"})`);
    try {
      log(JSON.stringify(await call("/status"), null, 2));
    } catch {
      log("server: not reachable");
    }
    break;
  }
  case "pause":
  case "resume":
    await call(`/${command}`, { method: "POST" });
    log(`${command}d`);
    break;
  case "project": {
    const { values } = parseArgs({
      args: rest.slice(1),
      options: {
        name: { type: "string" },
        repo: { type: "string" },
        remote: { type: "string" },
        holdouts: { type: "string" },
        setup: { type: "string" },
        test: { type: "string" },
        app: { type: "string" },
        health: { type: "string" },
        "holdouts-cmd": { type: "string" },
        "holdouts-setup": { type: "string" },
      },
    });
    if (rest[0] !== "add" || !values.name || !values.repo) throw new Error("usage: temper project add --name N --repo PATH ...");
    log(
      JSON.stringify(
        await call("/projects", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            repoPath: resolve(values.repo),
            remoteUrl: values.remote,
            holdoutsPath: values.holdouts && resolve(values.holdouts),
            setupCommand: values.setup,
            testCommand: values.test,
            appCommand: values.app,
            appHealthPath: values.health,
            holdoutsCommand: values["holdouts-cmd"],
            holdoutsSetupCommand: values["holdouts-setup"],
          }),
        }),
        null,
        2,
      ),
    );
    break;
  }
  case "import-spec": {
    const { values } = parseArgs({
      args: rest,
      options: { project: { type: "string" }, file: { type: "string" }, title: { type: "string" }, start: { type: "boolean", default: false } },
    });
    if (!values.project || !values.file) throw new Error("usage: temper import-spec --project ID --file SPEC.md");
    const markdown = readFileSync(values.file, "utf8");
    const title = values.title ?? /^#\s+(.+)$/m.exec(markdown)?.[1] ?? values.file;
    const tickets = (await call("/specs/import", { method: "POST", body: JSON.stringify({ projectId: values.project, title, markdown, autoStart: values.start }) })) as Array<{ id: string; title: string }>;
    for (const t of tickets) log(`${t.id}  ${t.title}`);
    break;
  }
  case "probe-isolation": {
    const { values } = parseArgs({ args: rest, options: { holdouts: { type: "string" } } });
    if (!values.holdouts) throw new Error("usage: temper probe-isolation --holdouts PATH");
    const r = await probeIsolation(createClaudeCliAdapter({ bin: config.claudeBin }), [resolve(values.holdouts), config.secretsDir], `http://127.0.0.1:${config.port}`);
    const attempts = r.transcript.split("\n").filter((l) => l.includes('"kind":"tool_use"')).map((l) => {
      const e = JSON.parse(l) as { tool: string; input: { command?: string; file_path?: string; pattern?: string } };
      return `${e.tool} ${e.input.command ?? e.input.file_path ?? e.input.pattern ?? ""}`.slice(0, 120);
    });
    log(`attempts (${attempts.length}):\n${attempts.map((a) => `  - ${a}`).join("\n")}`);
    const inconclusive = !r.leaked && !r.apiOpen && r.attempts < 8;
    if (r.leaked || r.apiOpen) log(`✗ LEAK:${r.leaked ? " a protected canary was read" : ""}${r.apiOpen ? " the board API answered 200" : ""}`);
    else if (inconclusive) log(`? INCONCLUSIVE: only ${r.attempts} attempts; isolation is not proven`);
    else log("✓ isolated: no protected canary was readable and the board API refused the agent");
    if (r.leaked || r.apiOpen || inconclusive) {
      log(r.transcript.slice(-3000));
      process.exitCode = 1;
    }
    break;
  }
  default:
    log(help);
}
