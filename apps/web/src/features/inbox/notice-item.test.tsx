import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Approval } from "@/lib/types";
import { NoticeItem } from "./notice-item";

afterEach(cleanup);

const notice: Approval = {
  id: "apv_1",
  ticketId: null,
  kind: "notice",
  title: "claude-cli reached its runsPerSession cap (3/3)",
  body: "New work for this provider waits until the window resets.",
  options: ["dismiss"],
  status: "pending",
  resolution: null,
  note: null,
  payload: null,
  chatId: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  resolvedAt: null,
};

describe("NoticeItem", () => {
  it("is information with a Dismiss button, not a decision", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NoticeItem approval={notice} selected={false} onSelect={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: notice.title })).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Dismiss"]);
    expect(screen.getByRole("link", { name: /Providers/ }).getAttribute("href")).toBe("/settings/providers");
  });
});
