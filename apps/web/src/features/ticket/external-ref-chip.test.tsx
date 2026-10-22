import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalRefChip } from "@/components/badges";

afterEach(cleanup);

describe("ExternalRefChip", () => {
  it("shows the key as a link that opens the url in a new tab", () => {
    render(<ExternalRefChip externalRef={{ tracker: "jira", key: "ABC-1", url: "https://x.atlassian.net/browse/ABC-1" }} />);
    const link = screen.getByRole("link", { name: /ABC-1/ });
    expect(link.getAttribute("href")).toBe("https://x.atlassian.net/browse/ABC-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing without a ref", () => {
    const { container } = render(<ExternalRefChip externalRef={null} />);
    expect(container.firstChild).toBeNull();
  });
});
