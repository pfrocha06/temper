import { describe, expect, it } from "vitest";
import type { Environment, Project } from "@/lib/types";
import { resolveEnvironment } from "./use-environment";
import { inEnvironment } from "./use-project";

const env = (id: string): Environment => ({ id, name: id, rootPath: "/w", createdAt: "2026-10-01T00:00:00.000Z" });
const project = (id: string, environmentId: string | null) => ({ id, environmentId }) as Project;

describe("environments", () => {
  it("prefers the stored choice, then env_default, then the first", () => {
    const list = [env("env_a"), env("env_default")];
    expect(resolveEnvironment(list, "env_a")?.id).toBe("env_a");
    expect(resolveEnvironment(list, "env_gone")?.id).toBe("env_default");
    expect(resolveEnvironment([env("env_a"), env("env_b")], null)?.id).toBe("env_a");
    expect(resolveEnvironment([], null)).toBeUndefined();
  });

  it("scopes projects to the environment; ones without one belong to the default", () => {
    const ps = [project("p1", "env_a"), project("p2", null), project("p3", "env_default")];
    expect(inEnvironment(ps, "env_a").map((p) => p.id)).toEqual(["p1"]);
    expect(inEnvironment(ps, "env_default").map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(inEnvironment(ps, undefined)).toHaveLength(3);
  });
});
