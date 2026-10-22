import { describe, expect, it } from "vitest";
import { redact, redactText } from "../src/redact.ts";

describe("redactText", () => {
  it("removes well-known token formats", () => {
    const fake = "ghp_" + "a".repeat(36);
    expect(redactText(`token is ${fake} ok`)).toBe("token is [redacted] ok");
    expect(redactText("key sk-ant-" + "b".repeat(30))).toBe("key [redacted]");
    expect(redactText("AKIA" + "C".repeat(16))).toBe("[redacted]");
  });

  it("redacts secret-looking assignments but keeps the key name", () => {
    expect(redactText("API_KEY=hunter2 PORT=4600")).toBe("API_KEY=[redacted] PORT=4600");
    expect(redactText('{"db_password": "pw123"}')).toBe('{"db_password": "[redacted]"}');
  });

  it("redacts bearer credentials", () => {
    expect(redactText("Authorization: Bearer abcdefghijkl")).toContain("Bearer [redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redactText("ran 12 tests in 3s")).toBe("ran 12 tests in 3s");
    expect(redactText("## secret_scan: PASS")).toBe("## secret_scan: PASS");
    expect(redactText("token: required")).toBe("token: required");
  });
});

describe("redact", () => {
  it("walks objects and redacts values under secret-looking keys", () => {
    expect(redact({ token: "abc", nested: { list: ["API_KEY=x"] }, count: 3, inputTokens: 120 })).toEqual({
      token: "[redacted]",
      nested: { list: ["API_KEY=[redacted]"] },
      count: 3,
      inputTokens: 120,
    });
  });
});
