import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { keys } from "@/lib/queries";
import type { Approval } from "@/lib/types";
import { ProposalCard } from "./proposal-card";

afterEach(cleanup);

const base: Approval = {
  id: "apv_p1",
  ticketId: null,
  kind: "proposal",
  title: "Chief proposes: accept — Stuck: Add a badge (gates)",
  body: "The gate failure is a missing commit, which the retry fixed.",
  options: ["confirm", "decline"],
  status: "pending",
  resolution: null,
  note: null,
  payload: { action: "resolve_approval", approvalId: "apv_t", resolution: "accept" },
  chatId: "chat_1",
  createdAt: "2026-10-22T10:00:00.000Z",
  resolvedAt: null,
};
const target: Approval = { ...base, id: "apv_t", kind: "escalation", title: "Stuck: Add a badge (gates)", ticketId: "tkt_9", payload: null, chatId: null, options: ["accept", "retry", "cancel"] };

function view(proposal: Approval, context: "inbox" | "chat" = "inbox") {
  const qc = new QueryClient();
  qc.setQueryData(keys.approvals, [target, proposal]);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>
          <ProposalCard proposal={proposal} context={context} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProposalCard", () => {
  it("shows the reason, what Confirm does with a link to the target, and Confirm / Decline", () => {
    view(base);
    expect(screen.getByText("The Chief of Staff proposes…")).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toBe("Accept “Stuck: Add a badge (gates)”");
    expect(screen.getByText(/missing commit/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Stuck: Add a badge/ }).getAttribute("href")).toBe("/tickets/tkt_9");
    expect(screen.getByRole("link", { name: /Conversation/ }).getAttribute("href")).toBe("/chief/chat_1");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Confirm", "Decline"]);
  });

  it("describes a deploy", () => {
    view({ ...base, payload: { action: "deploy", ref: "main", source: "/dev/temper" } }, "chat");
    expect(screen.getByRole("heading").textContent).toBe("Deploy main from temper");
    expect(screen.getByText("/dev/temper")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Conversation/ })).toBeNull();
  });

  it("shows the outcome instead of buttons once resolved", () => {
    view({ ...base, status: "resolved", resolution: "decline", resolvedAt: "2026-10-22T10:05:00.000Z" }, "chat");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Declined")).toBeTruthy();
  });
});
