import { describe, expect, it } from "vitest";
import { TOOLS, toolsForRole } from "../src/tools.ts";

describe("toolsForRole", () => {
  it("gives workers read-only knowledge tools", () => {
    expect(toolsForRole("builder").map((t) => t.name)).toEqual(["knowledge_search", "knowledge_get"]);
    expect(toolsForRole("verifier").map((t) => t.name)).toEqual(["knowledge_search", "knowledge_get"]);
  });
  it("gives the Chief of Staff everything", () => {
    expect(toolsForRole("chief")).toHaveLength(TOOLS.length);
  });
});
