import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, getAgent, loadWorkflows, openDb, pendingApprovals, recentAudit, saveAgent, seedAgents, type AgentAdapter, type Db } from "@temper/core";
import { loadConfig } from "../src/config.ts";
import { Factory, type FactoryOptions } from "../src/factory.ts";
import type { Profile } from "../src/profile.ts";

const root = join(import.meta.dirname, "../../..");
const stub = (id: string): AgentAdapter => ({ id, isolated: true, run: async () => ({ finalText: "", exitCode: 0, isError: false, rateLimited: false }) });

let db: Db;
let close: () => Promise<void>;
let factory: Factory;

function make(profile: Partial<Profile>, extra: Partial<FactoryOptions> = {}, installed = ["claude-cli", "codex-cli"]) {
  const home = mkdtempSync(join(tmpdir(), "temper-home-"));
  const config = { ...loadConfig({ TEMPER_HOME: home, TEMPER_GATE_SANDBOX: "off" }), appRoot: root, heartbeatMs: 60_000 };
  const full: Profile = { name: "work", adapters: ["claude-cli"], plugins: [], mcpServers: {}, ...profile };
  factory = new Factory(db, config, new Map(installed.map((id) => [id, stub(id)])), loadWorkflows(join(root, "workflows")), { profile: full, ...extra });
}

beforeEach(async () => {
  ({ db, close } = await openDb());
  await seedAgents(db);
});
afterEach(async () => {
  await factory?.stop();
  await close();
});

describe("which adapters may get work (spec 0011, AC-2)", () => {
  it("refuses an adapter the profile does not enable, and audits it", async () => {
    make({ adapters: ["claude-cli"] });
    expect(await factory.adapterRefusal("claude-cli")).toBeUndefined();
    expect(await factory.adapterRefusal("codex-cli")).toBe('profile "work" does not allow the codex-cli adapter');

    const chief = (await getAgent(db, "chief"))!;
    await saveAgent(db, { ...chief, adapter: "codex-cli" });
    const project = await createProject(db, { name: "demo", repoPath: mkdtempSync(join(tmpdir(), "repo-")) });
    await expect(factory.importSpec(project.id, "Spec", "# Spec\nDo it.")).rejects.toThrow(/dispatch refused: .*codex-cli/);

    const refused = (await recentAudit(db, 50)).filter((e) => e.kind === "dispatch.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ subject: "codex-cli", data: { agent: "chief", role: "chief" } });
    expect((await pendingApprovals(db)).some((a) => a.kind === "notice" && a.title.includes("codex-cli"))).toBe(true);
  });

  it("refuses an enabled adapter that is not installed", async () => {
    make({ adapters: ["claude-cli", "codex-cli"] }, {}, ["claude-cli"]);
    expect(await factory.adapterRefusal("codex-cli")).toBe("adapter 'codex-cli' is not installed");
  });

  it("refuses an adapter signed in to an account the profile does not pin", async () => {
    let signedIn = "me@personal.example";
    make({ adapters: ["claude-cli", "codex-cli"], accounts: { "codex-cli": "Me@Work.example" } }, { accountOf: async () => signedIn });
    expect(await factory.adapterRefusal("codex-cli")).toBe('codex-cli is signed in as me@personal.example, but profile "work" allows only Me@Work.example');
    expect(await factory.adapterRefusal("claude-cli")).toBeUndefined();

    signedIn = "me@work.example";
    make({ adapters: ["claude-cli", "codex-cli"], accounts: { "codex-cli": "Me@Work.example" } }, { accountOf: async () => signedIn });
    expect(await factory.adapterRefusal("codex-cli")).toBeUndefined();
  });

  it("treats an unreadable login as nobody", async () => {
    make({ adapters: ["codex-cli"], accounts: { "codex-cli": "me@work.example" } }, { accountOf: async () => { throw new Error("cli missing"); } });
    expect(await factory.adapterRefusal("codex-cli")).toMatch(/signed in as nobody/);
  });
});
