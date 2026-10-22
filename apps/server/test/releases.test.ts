import { mkdirSync, mkdtempSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { activate, currentLink, readState, releasesDir } from "../src/releases.ts";
import { waitHealthy } from "../src/releases.ts";
import { plist } from "../src/service.ts";

describe("activate", () => {
  it("tracks current and previous across deploys and rollbacks", () => {
    const home = mkdtempSync(join(tmpdir(), "temper-rel-"));
    for (const t of ["a", "b", "c"]) mkdirSync(join(releasesDir(home), t), { recursive: true });
    activate(home, "a", "deploy");
    activate(home, "b", "deploy");
    expect(readState(home)).toMatchObject({ current: "b", previous: "a" });
    activate(home, "a", "rollback");
    expect(readState(home)).toMatchObject({ current: "a", previous: "b" });
    activate(home, "c", "deploy");
    expect(readState(home)).toMatchObject({ current: "c", previous: "a" });
    expect(readlinkSync(currentLink(home))).toBe(join(releasesDir(home), "c"));
  });

  it("refuses unbuilt releases", () => {
    expect(() => activate(mkdtempSync(join(tmpdir(), "temper-rel-")), "nope", "deploy")).toThrow(/not built/);
  });
});

describe("plist", () => {
  it("runs the current release with KeepAlive and escapes values", () => {
    const xml = plist({ home: "/h/.temper", node: "/usr/bin/node", path: "/a&b" });
    expect(xml).toContain("/h/.temper/current/apps/server/src/main.ts");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toContain("/a&amp;b");
  });
});

describe("waitHealthy", () => {
  let server: Server | undefined;
  afterEach(async () => {
    const s = server;
    server = undefined;
    if (s) await new Promise((r) => s.close(r));
  });

  async function stub(status: number, body: unknown): Promise<{ port: number; paths: string[] }> {
    const paths: string[] = [];
    server = createServer((req, res) => {
      paths.push(req.url ?? "");
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return { port: (server.address() as AddressInfo).port, paths };
  }

  it("is healthy on 200 with ok:true, and only ever requests /api/health", async () => {
    const { port, paths } = await stub(200, { ok: true });
    expect(await waitHealthy(port, 1_000)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths)).toEqual(new Set(["/api/health"]));
  });

  it("is unhealthy when the body says ok:false", async () => {
    const { port } = await stub(200, { ok: false });
    expect(await waitHealthy(port, 700)).toBe(false);
  });

  it("is unhealthy on a non-2xx status", async () => {
    const { port } = await stub(503, { ok: true });
    expect(await waitHealthy(port, 700)).toBe(false);
  });

  it("is unhealthy when nothing is listening", async () => {
    const { port } = await stub(200, { ok: true });
    await new Promise((r) => server!.close(r));
    server = undefined;
    expect(await waitHealthy(port, 700)).toBe(false);
  });
});
