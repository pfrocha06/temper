import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { isAuthRequired, probeAuth, setAuthRequired } from "./auth";

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthRequired(false);
});

describe("401 handling", () => {
  it("any 401 from the API asks for sign-in, and the error still reaches the caller", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "board authentication required" }));
    await expect(api("/tickets")).rejects.toMatchObject({ status: 401, message: "board authentication required" });
    expect(isAuthRequired()).toBe(true);
  });

  it("a later success clears it; other errors leave it alone", async () => {
    setAuthRequired(true);
    vi.stubGlobal("fetch", respond(500, { error: "boom" }));
    await expect(api("/tickets")).rejects.toBeInstanceOf(ApiError);
    expect(isAuthRequired()).toBe(true);
    vi.stubGlobal("fetch", respond(200, []));
    await api("/tickets");
    expect(isAuthRequired()).toBe(false);
  });

  it("probeAuth reports a definite 401 and treats an unreachable server as not an auth problem", async () => {
    expect(await probeAuth(respond(401))).toBe(false);
    expect(isAuthRequired()).toBe(true);
    expect(await probeAuth(respond(200))).toBe(true);
    expect(isAuthRequired()).toBe(false);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await probeAuth(offline)).toBe(true);
    expect(isAuthRequired()).toBe(false);
  });
});
