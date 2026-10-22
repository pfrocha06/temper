import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createClaudeCliAdapter } from "@temper/adapter-claude-cli";
import { audit, loadWorkflows, openDb, seedAgents, type AgentAdapter } from "@temper/core";
import { createApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { Factory } from "./factory.ts";

const config = loadConfig();
const { db, close } = await openDb(config.dataDir);
await seedAgents(db);

const adapters = new Map<string, AgentAdapter>([["claude-cli", createClaudeCliAdapter({ bin: config.claudeBin })]]);
const workflows = loadWorkflows(join(config.appRoot, "workflows"));
const factory = new Factory(db, config, adapters, workflows);
const app = createApi(db, factory, config);

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
