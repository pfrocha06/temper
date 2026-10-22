import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Db } from "@temper/core";
import { createApi } from "../src/api.ts";
import type { Config } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";
import type { Health } from "../src/health.ts";

const throwing = (what: string) =>
  new Proxy({}, { get: () => { throw new Error(`${what} must not be used by /api/health`); } });

const appFor = (config: Config, uptime?: () => number) =>
  createApi(throwing("db") as Db, throwing("factory") as Factory, config, uptime ? { uptime } : undefined);

const json = async (res: Response) => (await res.json()) as Health;

const gitHead = () => execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: loadConfig().appRoot, encoding: "utf8" }).trim();

describe("GET /api/health", () => {
  it("returns ok, version, instance and integer uptime without credentials or db", async () => {
    const config = { ...loadConfig({ TEMPER_INSTANCE: "rc" }) };
    const res = await appFor(config).request("/api/health");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body).sort()).toEqual(["instance", "ok", "uptimeSeconds", "version"]);
    expect(body.ok).toBe(true);
    expect(body.instance).toBe("rc");
    expect(body.version).toBe(gitHead());
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("defaults the instance to main", async () => {
    const body = await json(await appFor(loadConfig({})).request("/api/health"));
    expect(body.instance).toBe("main");
  });

  it('reports "unknown" outside a git checkout and still returns 200', async () => {
    const dir = mkdtempSync(join(tmpdir(), "temper-nogit-"));
    const res = await appFor({ ...loadConfig(), appRoot: dir }).request("/api/health");
    expect(res.status).toBe(200);
    expect((await json(res)).version).toBe("unknown");
  });

  it('reports "unknown" when the directory does not exist', async () => {
    const res = await appFor({ ...loadConfig(), appRoot: join(tmpdir(), "temper-missing-dir-xyz") }).request("/api/health");
    expect((await json(res)).version).toBe("unknown");
  });

  it("floors uptime and increases as time passes", async () => {
    let seconds = 1.9;
    const app = appFor(loadConfig(), () => seconds);
    const first = (await json(await app.request("/api/health"))).uptimeSeconds;
    seconds += 2;
    const second = (await json(await app.request("/api/health"))).uptimeSeconds;
    expect(first).toBe(1);
    expect(second).toBe(3);
    expect(second).toBeGreaterThan(first);
  });

  it("computes the version once at startup", async () => {
    const app = appFor(loadConfig());
    const a = (await json(await app.request("/api/health"))).version;
    const b = (await json(await app.request("/api/health"))).version;
    expect(a).toBe(b);
  });
});
