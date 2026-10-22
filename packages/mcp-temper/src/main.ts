#!/usr/bin/env node
// stdio MCP server exposing Temper's knowledge base (and, for the Chief, tickets) to one agent run.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { httpCaller, toolsForRole } from "./tools.ts";

const apiUrl = process.env.TEMPER_API_URL ?? "http://127.0.0.1:4600";
const capability = process.env.TEMPER_CAPABILITY;
if (!capability) {
  console.error("TEMPER_CAPABILITY is required");
  process.exit(1);
}
const call = httpCaller(apiUrl, capability);
const me = (await call("GET", "/api/agent/whoami")) as { role: string };

const server = new McpServer({ name: "temper", version: "0.0.0" });
for (const tool of toolsForRole(me.role)) {
  server.tool(tool.name, tool.description, tool.input, async (args) => {
    try {
      const out = await tool.run(call, args as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String((err as Error).message) }], isError: true };
    }
  });
}
await server.connect(new StdioServerTransport());
