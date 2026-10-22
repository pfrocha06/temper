import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { timeline } from "@/lib/usage";
import { TimelineChart } from "./timeline-chart";

afterEach(cleanup);

const buckets = timeline({
  from: "2026-10-20T00:00:00.000Z",
  to: "2026-10-22T23:00:00.000Z",
  series: [
    { bucket: "2026-10-21", byRole: { builder: 1200, chief: 300 } },
    { bucket: "2026-10-22", byRole: { builder: 500 } },
  ],
});

describe("TimelineChart", () => {
  it("is one keyboard stop whose arrows read each day with every role", () => {
    render(<TimelineChart buckets={buckets} roles={["chief", "builder"]} hourly={false} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain("peak 1.5k");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const tip = screen.getByRole("status");
    expect(tip.textContent).toContain("1.5k tokens");
    expect(tip.textContent).toContain("1.2kBuilder");
    expect(tip.textContent).toContain("300Chief of Staff");
  });

  it("offers the same numbers as a table", () => {
    render(<TimelineChart buckets={buckets} roles={["chief", "builder"]} hourly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("1.5k");
  });
});
