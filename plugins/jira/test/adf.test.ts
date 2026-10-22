import { describe, expect, it } from "vitest";
import { adfToMarkdown } from "../src/index.ts";

const t = (text: string, marks?: any[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("adfToMarkdown", () => {
  it("converts headings, lists, code and links", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        { type: "heading", attrs: { level: 2 }, content: [t("Goal")] },
        { type: "paragraph", content: [t("See "), t("the docs", [{ type: "link", attrs: { href: "https://example.test/d" } }]), t(" and run "), t("make", [{ type: "code" }]), t(" "), t("now", [{ type: "strong" }])] },
        { type: "bulletList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [t("one")] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [t("two")] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("nested")] }] }] }] },
        ] },
        { type: "orderedList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [t("first")] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [t("second")] }] },
        ] },
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;")] },
      ],
    };
    expect(adfToMarkdown(doc)).toBe(
      [
        "## Goal",
        "",
        "See [the docs](https://example.test/d) and run `make` **now**",
        "",
        "- one",
        "- two",
        "  - nested",
        "",
        "1. first",
        "2. second",
        "",
        "```ts",
        "const a = 1;",
        "```",
      ].join("\n"),
    );
  });

  it("handles null and plain strings", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown("plain")).toBe("plain");
  });
});
