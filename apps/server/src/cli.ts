#!/usr/bin/env node
// temper — operate the local factory: service, releases, projects, specs.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { codexAccount, resolveBin } from "@temper/adapter-codex-cli";
import { createAdapters } from "./adapters.ts";
import { join } from "node:path";
import { loadBoardToken } from "./auth.ts";
import { loadConfig, protectedDirs } from "./config.ts";
import { probeGateIsolation, probeIsolation } from "./probe.ts";
import { loadProfile } from "./profile.ts";
import { activate, backupDatabase, buildRelease, readState, restoreDatabase, waitHealthy, waitStopped } from "./releases.ts";
import { run } from "./exec.ts";
import { installService, serviceInstalled, serviceKind, snapshotService, uninstallService } from "./service.ts";

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

type ImportResult = { key: string; status: string; ticketIds: string[]; reason?: string; existingTicketId?: string };
const logImport = (r: ImportResult) => {
  if (r.status === "skipped") log(`${r.key}  skipped: ${r.reason ?? `already linked to open ticket ${r.existingTicketId}`}`);
  else for (const id of r.ticketIds) log(`${r.key}  ${id}`);
};

/** Search the tracker, then import each match in its own request. Returns how many matched. */
async function importEach(projectId: string, query: Record<string, unknown> & { source: "github" | "jira" }, opts: { start: boolean; anyAuthor?: boolean }): Promise<number> {
  const { candidates } = (await call("/intake/search", { method: "POST", body: JSON.stringify({ ...query, limit: 100 }) })) as {
    candidates: Array<{ key: string; title: string; ticketId?: string }>;
  };
  for (const [i, c] of candidates.entries()) {
    console.error(`[${i + 1}/${candidates.length}] ${c.key}  ${c.title}`);
    logImport((await call("/intake/import", { method: "POST", body: JSON.stringify({ projectId, source: query.source, key: c.key, ...opts }) })) as ImportResult);
  }
  return candidates.length;
}

/** Is the running server busy? Unreachable counts as idle: then nothing is running to interrupt. */
async function activeRuns(): Promise<number> {
  try {
    return ((await call("/status")) as { active?: unknown[] }).active?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Stops new dispatches and waits for running ones to finish. False (and resumed) on timeout. */
async function drain(timeoutMs: number): Promise<boolean> {
  await call("/pause", { method: "POST" }).catch(() => undefined);
  const end = Date.now() + timeoutMs;
  let reported = -1;
  for (;;) {
    const n = await activeRuns();
    if (n === 0) return true;
    if (n !== reported) log(`→ waiting for ${n} running agent${n === 1 ? "" : "s"} to finish (dispatching is paused)`);
    reported = n;
    if (Date.now() > end) {
      await call("/resume", { method: "POST" }).catch(() => undefined);
      return false;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

async function deploy(ref: string, source: string, whenIdle = false) {
  log(`== deploy ${ref} from ${source} at ${new Date().toISOString()}`);
  const tag = await buildRelease(config.home, source, ref, log);
  const before = readState(config.home);
  // A first deploy replaces a hand-made service definition; keep it to restore on failure.
  const restoreOriginalService = before.current ? undefined : await snapshotService(config.home);
  if (whenIdle && !(await drain(2 * 60 * 60_000))) {
    log(`✗ agents still running after 2 hours; ${tag} is built but not switched to. Dispatching resumed.`);
    process.exitCode = 1;
    return;
  }
  let switched = false;
  let backup: string | undefined;
  try {
    log(`→ stopping service`);
    await uninstallService(config.home);
    if (!(await waitStopped(config.port))) throw new Error("the old server did not stop within 30s");
    backup = backupDatabase(config.home);
    activate(config.home, tag, "deploy", source);
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
  } else if (restoreOriginalService) {
    await restoreOriginalService();
    log((await waitHealthy(config.port)) ? "✓ running the original service again" : "✗ the original service did not come up; check its log");
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
  deploy [--ref main] [--source DIR] [--when-idle]
                                 build, verify and switch the service to a release; --when-idle
                                 pauses dispatching and waits for running agents before switching
  rollback                       switch back to the previous release
  start | stop                   install/uninstall the service (launchd or systemd) for the current release
  status                         service, release and factory status
  pause | resume                 stop/start dispatching new work
  project add --name N --repo PATH [--remote URL] [--holdouts PATH (default: ~/.temper/holdouts/N)] [--setup CMD] [--test CMD] [--app CMD] [--health PATH] [--holdouts-cmd CMD] [--holdouts-setup CMD]
  import-spec --project ID --file SPEC.md [--title T] [--start]
  import-jira --project ID (--issue KEY | --jql "…") [--start]
  import-github --project ID (--issue N | --search "label:roadmap") [--repo OWNER/NAME] [--start] [--any-author]
                                 GitHub issues as work; only issues by people who can push, unless --any-author
  probe-isolation --holdouts PATH   check runs of every enabled adapter, and the gate commands that run Builder code, cannot read holdouts or secrets, or use the board API
  codex login | logout | status  sign Temper's own Codex in or out (kept apart from ~/.codex)
  codex setup                    Windows: set up Codex's elevated sandbox for Temper (one admin prompt)
`;

switch (command) {
  case "open": {
    const url = `http://127.0.0.1:${config.port}/auth?token=${encodeURIComponent(boardToken())}`;
    const [opener, ...openArgs] = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", '""'] : ["xdg-open"];
    await run(opener!, [...openArgs, url], { cwd: config.home });
    log(`opened the console; to sign in another browser use:\n${url}`);
    break;
  }
  case "serve":
    await import("./main.ts");
    break;
  case "deploy": {
    const { values } = parseArgs({
      args: rest,
      options: { ref: { type: "string", default: "main" }, source: { type: "string", default: config.appRoot }, "when-idle": { type: "boolean", default: false } },
    });
    try {
      await deploy(values.ref!, resolve(values.source!), values["when-idle"]);
    } catch (err) {
      log(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
    // The console reads this line to know the update is over (updates.ts).
    log(`== done: ${process.exitCode ? "failed" : "ok"}`);
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
    log(`service: ${serviceKind()} ${(await serviceInstalled(config.home)) ? "running" : "not running"}`);
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
  case "import-github": {
    const { values } = parseArgs({
      args: rest,
      options: {
        project: { type: "string" },
        issue: { type: "string" },
        search: { type: "string" },
        repo: { type: "string" },
        start: { type: "boolean", default: false },
        "any-author": { type: "boolean", default: false },
      },
    });
    if (!values.project || !!values.issue === !!values.search) throw new Error('usage: temper import-github --project ID (--issue N | --search "…") [--repo OWNER/NAME] [--start] [--any-author]');
    const issue = values.issue ? Number(values.issue.replace(/^#/, "")) : undefined;
    if (issue !== undefined && !Number.isInteger(issue)) throw new Error(`not an issue number: ${values.issue}`);
    if (values.search && !values.repo) {
      // Search, then one request per issue: a batch can take longer than one HTTP request may wait.
      const n = await importEach(values.project, { source: "github", projectId: values.project, query: values.search }, { start: values.start, anyAuthor: values["any-author"] });
      if (!n) log("no matching open issues");
      break;
    }
    const { results } = (await call("/github/import", {
      method: "POST",
      body: JSON.stringify({ projectId: values.project, issue, search: values.search, repo: values.repo, start: values.start, anyAuthor: values["any-author"] }),
    })) as { results: ImportResult[] };
    if (!results.length) log("no matching open issues");
    results.forEach(logImport);
    break;
  }
  case "import-jira": {
    const { values } = parseArgs({
      args: rest,
      options: { project: { type: "string" }, issue: { type: "string" }, jql: { type: "string" }, start: { type: "boolean", default: false } },
    });
    if (!values.project || !!values.issue === !!values.jql) throw new Error('usage: temper import-jira --project ID (--issue KEY | --jql "…") [--start]');
    if (values.jql) {
      const n = await importEach(values.project, { source: "jira", projectId: values.project, jql: values.jql }, { start: values.start });
      if (!n) log("no matching issues");
      break;
    }
    const { results } = (await call("/jira/import", { method: "POST", body: JSON.stringify({ projectId: values.project, issue: values.issue, start: values.start }) })) as {
      results: ImportResult[];
    };
    results.forEach(logImport);
    break;
  }
  case "probe-isolation": {
    const { values } = parseArgs({ args: rest, options: { holdouts: { type: "string" } } });
    if (!values.holdouts) throw new Error("usage: temper probe-isolation --holdouts PATH");
    // Every adapter the profile enables: each one is trusted only once its own runs are probed.
    const adapters = createAdapters(config, loadProfile(config.home));
    if (adapters.size === 0) throw new Error("the profile enables no adapters");
    for (const [id, adapter] of adapters) {
      log(`\n── ${id}`);
      const r = await probeIsolation(adapter, [resolve(values.holdouts), config.secretsDir], `http://127.0.0.1:${config.port}`).catch((err: Error) => err);
      if (r instanceof Error) {
        log(`✗ could not run: ${r.message}`);
        process.exitCode = 1;
        continue;
      }
      const attempts = r.transcript.split("\n").filter((l) => l.includes('"kind":"tool_use"')).map((l) => {
        const e = JSON.parse(l) as { tool: string; input: { command?: string; file_path?: string; pattern?: string } };
        return `${e.tool} ${e.input?.command ?? e.input?.file_path ?? e.input?.pattern ?? ""}`.slice(0, 120);
      });
      log(`attempts (${attempts.length}):\n${attempts.map((a) => `  - ${a}`).join("\n")}`);
      const leak = r.leaked || r.apiOpen || r.internetOpen;
      const inconclusive = !leak && r.attempts < 8;
      if (leak) log(`✗ LEAK:${r.leaked ? " a protected canary was read" : ""}${r.apiOpen ? " the board API answered 200" : ""}${r.internetOpen ? " the internet answered" : ""}`);
      else if (inconclusive) log(`? INCONCLUSIVE: only ${r.attempts} attempts; isolation is not proven`);
      else log(`✓ ${id} isolated: no protected canary was readable, the board API refused the agent, no internet`);
      if (leak || inconclusive) {
        log(r.transcript.slice(-3000));
        process.exitCode = 1;
      }
    }
    // The server also runs Builder code itself (tests, the candidate app): probe that path too.
    const gate = await probeGateIsolation({ mode: config.gateSandbox, denyRead: [], allowRead: config.gateAllowRead }, [resolve(values.holdouts), ...protectedDirs(config)], `http://127.0.0.1:${config.port}`);
    if (gate.isolated) log("✓ gate commands isolated: no canary readable, no writes, no server environment, no board API, no internet");
    else {
      log(`✗ GATE LEAK${config.gateSandbox === "off" ? " (TEMPER_GATE_SANDBOX=off)" : ""}:\n${gate.problems.map((p) => `  - ${p}`).join("\n")}\n${gate.output.slice(-3000)}`);
      process.exitCode = 1;
    }
    break;
  }
  case "codex": {
    const [sub = "status", ...args] = rest;
    if (sub === "status") {
      const a = codexAccount(config.codexHome);
      log(a.loggedIn ? `signed in${a.email ? ` as ${a.email}` : ""} (${a.method}${a.plan ? `, ${a.plan}` : ""})` : "not signed in: run `temper codex login`");
      log(`CODEX_HOME ${config.codexHome}`);
      if (!loadProfile(config.home).adapters.includes("codex-cli")) log("not enabled: add \"codex-cli\" to adapters in profile.json");
      break;
    }
    const codexArgs = sub === "login" || sub === "logout" ? [sub, ...args] : sub === "setup" ? ["sandbox", "setup", "--elevated", "--current-user", "--codex-home", config.codexHome, ...args] : undefined;
    if (!codexArgs) throw new Error("usage: temper codex login | logout | status | setup");
    mkdirSync(config.codexHome, { recursive: true, mode: 0o700 });
    // Interactive: the login opens a browser (or prints a device code); `setup` asks for admin once.
    const bin = resolveBin(config.codexBin);
    const code = await new Promise<number | null>((done) => spawn(bin.file, [...bin.args, ...codexArgs], { stdio: "inherit", env: { ...process.env, CODEX_HOME: config.codexHome } }).on("close", done).on("error", (e) => { log(`could not run ${config.codexBin}: ${e.message}`); done(1); }));
    process.exitCode = code ?? 1;
    break;
  }
  default:
    log(help);
}
