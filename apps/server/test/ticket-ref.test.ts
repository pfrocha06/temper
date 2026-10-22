import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, openDb, type Db } from "@temper/core";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import type { Factory } from "../src/factory.ts";

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApi>;
let projectId: string;

const fakeFactory = { tick: async () => {}, status: () => ({}), on: () => {}, off: () => {} } as unknown as Factory;
const post = (body: unknown) =>
  app.request("/api/tickets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  ({ db, close } = await openDb());
  projectId = (await createProject(db, { name: "p", repoPath: "/e/p" })).id;
  app = createApi(db, fakeFactory, loadConfig({ TEMPER_HOME: "/tmp/none" }));
});
afterEach(() => close());

describe("ticket external ref", () => {
  const externalRef = { tracker: "jira", key: "ABC-1", url: "https://example.atlassian.net/browse/ABC-1" };

  it("returns the ref a ticket was created with", async () => {
    const created = (await (await post({ projectId, type: "feature", title: "linked", externalRef })).json()) as { id: string; externalRef: unknown };
    expect(created.externalRef).toEqual(externalRef);
    const list = (await (await app.request(`/api/tickets?projectId=${projectId}`)).json()) as { id: string; externalRef: unknown }[];
    expect(list.find((t) => t.id === created.id)?.externalRef).toEqual(externalRef);
  });

  it("returns null for tickets without a ref and rejects a malformed one", async () => {
    const plain = (await (await post({ projectId, type: "feature", title: "plain" })).json()) as { id: string; externalRef: unknown };
    expect(plain.externalRef).toBeNull();
    expect((await post({ projectId, type: "feature", title: "bad", externalRef: { tracker: "jira" } })).status).toBeGreaterThanOrEqual(400);
  });
});
