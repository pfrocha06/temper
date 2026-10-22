import { describe, expect, it } from "vitest";
import { hotkeyOption } from "./approval-buttons";

describe("hotkeyOption", () => {
  it("maps a to the first positive option and r to the first negative one", () => {
    expect(hotkeyOption(["approve", "reject"], "a")).toBe("approve");
    expect(hotkeyOption(["approve", "reject"], "r")).toBe("reject");
    expect(hotkeyOption(["accept", "retry", "cancel"], "a")).toBe("accept");
    expect(hotkeyOption(["accept", "retry", "cancel"], "r")).toBe("cancel");
  });

  it("binds nothing when no option fits", () => {
    expect(hotkeyOption(["retry"], "a")).toBeUndefined();
    expect(hotkeyOption(["retry"], "r")).toBeUndefined();
  });
});
