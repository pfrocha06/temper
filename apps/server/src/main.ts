import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { audit, ensureDefaultEnvironment, loadWorkflows, openDb, seedAgents } from "@temper/core";
import { accountOf, createAdapters } from "./adapters.ts";
import { createApi } from "./api.ts";
import { Auth, loadBoardToken } from "./auth.ts";
import { useGithubUser } from "@temper/plugin-github";
import { loadConfig } from "./config.ts";
import { loadProfile } from "./profile.ts";
import { Factory } from "./factory.ts";
import { Updater } from "./updates.ts";

const config = loadConfig();
const profile = loadProfile(config.home);
await useGithubUser(profile.github?.user);
const { db, close } = await openDb(config.dataDir);
await seedAgents(db);
await ensureDefaultEnvironment(db, dirname(config.appRoot));

const adapters = createAdapters(config, profile);
const workflows = loadWorkflows(join(config.appRoot, "workflows"));
const auth = new Auth(loadBoardToken(join(config.secretsDir, "board-token"), process.env.TEMPER_BOARD_TOKEN), config.port);
const factory = new Factory(db, config, adapters, workflows, { auth, profile, accountOf: (a) => accountOf(config, a) });
// The main instance looks for newer commits on its source's origin; dev and preview instances do not.
const updater = new Updater({ home: config.home, appRoot: config.appRoot });
const checkUpdates = (process.env.TEMPER_UPDATE_CHECK ?? (config.instance === "main" ? "1" : "0")) !== "0";
if (checkUpdates) updater.start();
const app = createApi(db, factory, config, { auth, profile, updater });

const server = serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, async ({ port }) => {
  await audit(db, { actor: "system", kind: "server.started", data: { instance: config.instance, port } });
  console.log(`temper ${config.instance} listening on http://127.0.0.1:${port}`);
});
await factory.start();

const shutdown = async () => {
  await factory.stop();
  server.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
