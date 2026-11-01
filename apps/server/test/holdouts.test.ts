import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@temper/core";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";
import { defaultHoldoutsPath, initHoldouts } from "../src/holdouts.ts";

const root = join(import.meta.dirname, "../../..");
const template = join(root, "templates", "holdouts");
const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** Runs the holdouts against a tiny app answering `status` on every path. */
async function runAgainst(dir: string, status: number): Promise<{ code: number; out: string }> {
  const app = createServer((_q, s) => ((s.statusCode = status), s.end("ok"))).listen(0, "127.0.0.1");
  await new Promise((r) => app.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const r = await new Promise<{ code: number; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["run.mjs"], { cwd: dir, env: { ...process.env, TEMPER_APP_URL: url } });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d));
      child.on("close", (code: number) => resolve({ code, out }));
    });
    return r;
  } finally {
    app.close();
  }
}

describe("starter holdouts", () => {
  it("creates a git folder whose example check runs against the app", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "holdouts-")), "myapp");
    expect(await initHoldouts(dir, template)).toEqual({ created: true });
    for (const f of ["run.mjs", "README.md", "lib/check.mjs", "lib/http.mjs", "baseline/app.holdout.mjs"]) expect(existsSync(join(dir, f))).toBe(true);
    expect(git(dir, "log", "--format=%s")).toBe("holdouts: start from Temper's template");
    expect(git(dir, "status", "--porcelain")).toBe("");

    expect(await runAgainst(dir, 200)).toEqual({ code: 0, out: "REG-baseline-responds: PASS\n" });
    const failing = await runAgainst(dir, 503);
    expect(failing.code).toBe(1);
    expect(failing.out).toBe("REG-baseline-responds: FAIL GET / answered 503\n");
  });

  it("keeps an existing holdouts checkout and refuses a folder that is not one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "holdouts-"));
    git(dir, "init", "-q");
    expect(await initHoldouts(dir, template)).toEqual({ created: false });
    expect(existsSync(join(dir, "run.mjs"))).toBe(false);

    const other = mkdtempSync(join(tmpdir(), "not-holdouts-"));
    writeFileSync(join(other, "notes.txt"), "mine");
    await expect(initHoldouts(other, template)).rejects.toThrow(/not a git repository/);
  });

  it("names the default folder after the project", () => {
    expect(defaultHoldoutsPath("/h", "My App!")).toBe(join("/h", "holdouts", "my-app"));
    expect(defaultHoldoutsPath("/h", "???")).toBe(join("/h", "holdouts", "project"));
  });
});

describe("POST /api/projects", () => {
  let db: Db;
  let close: () => Promise<void>;
  let home: string;
  beforeEach(async () => {
    ({ db, close } = await openDb());
    home = mkdtempSync(join(tmpdir(), "temper-home-"));
  });
  afterEach(() => close());

  it("gives a project without a holdouts folder one Temper keeps", async () => {
    const app = createApi(db, {} as Factory, { ...loadConfig({ TEMPER_HOME: home }), appRoot: root });
    const res = await app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shop", repoPath: "/code/shop" }) });
    expect(res.status).toBe(201);
    const project = (await res.json()) as { holdoutsPath: string; holdoutsCommand: string };
    expect(project.holdoutsPath).toBe(join(home, "holdouts", "shop"));
    expect(project.holdoutsCommand).toBe("node run.mjs");
    expect(existsSync(join(home, "holdouts", "shop", "baseline", "app.holdout.mjs"))).toBe(true);
  });

  it("keeps the board's own holdouts command and folder", async () => {
    const mine = mkdtempSync(join(tmpdir(), "holdouts-"));
    git(mine, "init", "-q");
    mkdirSync(join(mine, "checks"));
    const app = createApi(db, {} as Factory, { ...loadConfig({ TEMPER_HOME: home }), appRoot: root });
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shop", repoPath: "/code/shop", holdoutsPath: mine, holdoutsCommand: "npm test" }),
    });
    expect(await res.json()).toMatchObject({ holdoutsPath: mine, holdoutsCommand: "npm test" });
  });
});
