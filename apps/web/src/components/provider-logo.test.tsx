import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderLogo } from "./provider-logo";

afterEach(cleanup);

describe("ProviderLogo", () => {
  it("draws each vendor's mark in currentColor with an accessible label", () => {
    for (const vendor of ["anthropic", "openai", "google", "opencode"] as const) {
      render(<ProviderLogo vendor={vendor} label={`mark ${vendor}`} />);
      const svg = screen.getByRole("img", { name: `mark ${vendor}` });
      expect(svg.getAttribute("fill")).toBe("currentColor");
      expect(svg.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(20);
    }
  });

  it("is hidden from assistive tech when decorative, and absent for unknown vendors", () => {
    const { container } = render(<ProviderLogo vendor="anthropic" label={false} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const empty = render(<ProviderLogo vendor={undefined} />);
    expect(empty.container.innerHTML).toBe("");
  });
});
