import { mkdirSync, mkdtempSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activate, currentLink, readState, releasesDir } from "../src/releases.ts";
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
