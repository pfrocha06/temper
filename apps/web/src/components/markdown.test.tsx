import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders headings, lists, code and GFM tables", () => {
    const { container } = render(<Markdown>{"# Title\n\n- one\n- two\n\n`code`\n\n| a | b |\n|---|---|\n| 1 | 2 |"}</Markdown>);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("table td")?.textContent).toBe("1");
  });

  it("never turns raw HTML into elements", () => {
    const { container } = render(
      <Markdown>{'<script>window.pwned = true</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://example.org"></iframe>\n\ntext'}</Markdown>,
    );
    expect(container.querySelector("script, iframe, img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.textContent).toContain("text");
  });

  it("drops javascript: and data: link targets", () => {
    const { container } = render(<Markdown>{"[a](javascript:alert(1)) [b](data:text/html,hi) [c](https://example.org)"}</Markdown>);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => /^javascript:|^data:/i.test(h))).toBe(false);
    expect(hrefs).toContain("https://example.org");
  });

  it("opens external links in a new tab without an opener", () => {
    const { container } = render(<Markdown>{"[c](https://example.org)"}</Markdown>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("does not fetch markdown images", () => {
    const { container } = render(<Markdown>{"![diagram](https://tracker.example/pixel.png)"}</Markdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: diagram]");
  });
});
