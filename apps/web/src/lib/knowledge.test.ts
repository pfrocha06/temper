import { describe, expect, it } from "vitest";
import { compareKnowledge, countByKind, filterKnowledge, groupKnowledge, parseTags, sourceLabel } from "./knowledge";
import type { KnowledgeEntry } from "./types";

let n = 0;
const entry = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: `kn_${++n}`,
  environmentId: "env_default",
  projectId: null,
  area: null,
  kind: "convention",
  title: `Entry ${n}`,
  abstract: "An abstract",
  body: "",
  tags: [],
  status: "active",
  pinned: 0,
  version: 1,
  source: "board",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const envWide = entry({ title: "env-wide" });
const web = entry({ title: "web", projectId: "prj_web", kind: "gotcha" });
const api = entry({ title: "api", projectId: "prj_api", kind: "decision" });
const old = entry({ title: "old", status: "archived" });
const all = [envWide, web, api, old];

describe("filterKnowledge", () => {
  it("hides archived entries unless asked", () => {
    expect(filterKnowledge(all, { kinds: [], project: "all", archived: false })).toEqual([envWide, web, api]);
    expect(filterKnowledge(all, { kinds: [], project: "all", archived: true })).toHaveLength(4);
  });

  it("keeps environment-wide entries in a project's view, since its runs load them too", () => {
    expect(filterKnowledge(all, { kinds: [], project: "prj_web", archived: false }).map((e) => e.title)).toEqual(["env-wide", "web"]);
    expect(filterKnowledge(all, { kinds: [], project: "env", archived: false }).map((e) => e.title)).toEqual(["env-wide"]);
  });

  it("filters by kind", () => {
    expect(filterKnowledge(all, { kinds: ["gotcha", "decision"], project: "all", archived: false })).toEqual([web, api]);
  });
});

describe("groupKnowledge", () => {
  it("groups in canonical kind order and drops empty kinds; unknown kinds go last", () => {
    const odd = entry({ kind: "rumour" });
    const groups = groupKnowledge([api, odd, web, envWide]);
    expect(groups.map((g) => g.kind)).toEqual(["convention", "gotcha", "decision", "rumour"]);
  });

  it("sorts pinned first, archived last, then most recently updated", () => {
    const recent = entry({ title: "recent", updatedAt: "2026-10-20T00:00:00.000Z" });
    const pinned = entry({ title: "pinned", pinned: 1 });
    const archived = entry({ title: "archived", status: "archived", updatedAt: "2026-10-21T00:00:00.000Z" });
    const [conventions] = groupKnowledge([envWide, archived, recent, pinned]);
    expect(conventions!.entries.map((e) => e.title)).toEqual(["pinned", "recent", "env-wide", "archived"]);
    expect(compareKnowledge(pinned, recent)).toBeLessThan(0);
  });
});

describe("helpers", () => {
  it("counts active entries per kind", () => {
    expect(countByKind(all)).toEqual(new Map([["convention", 1], ["gotcha", 1], ["decision", 1]]));
  });

  it("parses tags from commas or lines", () => {
    expect(parseTags(" ci, testing\nci,, ")).toEqual(["ci", "testing"]);
  });

  it("explains where an entry came from", () => {
    expect(sourceLabel("board")).toEqual({ text: "you" });
    expect(sourceLabel("dsp_abc")).toEqual({ text: "a run", href: "/runs/dsp_abc" });
    expect(sourceLabel("tkt_abc").href).toBe("/tickets/tkt_abc");
    expect(sourceLabel(null).text).toBe("unknown");
  });
});
