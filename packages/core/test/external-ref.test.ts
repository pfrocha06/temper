import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, createTicket, findOpenTicketByRef, getTicket, openDb, type Db } from "../src/index.ts";

let db: Db;
let close: () => Promise<void>;
let projectId: string;

beforeEach(async () => {
  ({ db, close } = await openDb());
  projectId = (await createProject(db, { name: "temper", repoPath: "/tmp/temper" })).id;
});
afterEach(() => close());

describe("external tracker reference", () => {
  const ref = { tracker: "jira", key: "ABC-1", url: "https://example.atlassian.net/browse/ABC-1" };

  it("round-trips an external ref and defaults to none", async () => {
    const t = await createTicket(db, { projectId, type: "feature", title: "linked", externalRef: ref });
    expect((await getTicket(db, t.id))?.externalRef).toEqual(ref);
    const plain = await createTicket(db, { projectId, type: "feature", title: "plain" });
    expect((await getTicket(db, plain.id))?.externalRef).toBeNull();
  });

  it("finds the open ticket by tracker and key, ignoring done and cancelled", async () => {
    const old = await createTicket(db, { projectId, type: "feature", title: "old", externalRef: ref, status: "done" });
    await createTicket(db, { projectId, type: "feature", title: "gone", externalRef: ref, status: "cancelled" });
    await createTicket(db, { projectId, type: "feature", title: "other", externalRef: { ...ref, key: "ABC-2" } });
    expect(await findOpenTicketByRef(db, "jira", "ABC-1")).toBeUndefined();
    const open = await createTicket(db, { projectId, type: "feature", title: "open", externalRef: ref, status: "in_progress" });
    expect((await findOpenTicketByRef(db, "jira", "ABC-1"))?.id).toBe(open.id);
    expect(old.id).not.toBe(open.id);
    expect(await findOpenTicketByRef(db, "linear", "ABC-1")).toBeUndefined();
  });
});
