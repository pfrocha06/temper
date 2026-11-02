// Stands in for `codex exec --json`: echoes what it was given, then a canned run.
import { execFileSync } from "node:child_process";
const canaries = (env) => Object.entries(env).filter(([, v]) => String(v).includes("canary-")).map(([k]) => k);
const childCanaries = () => JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(Object.entries(process.env).filter(([, v]) => String(v).includes("canary-")).map(([k]) => k)))`], { encoding: "utf8" }));
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "thread.started", thread_id: "thread-123" });
  out({ type: "turn.started" });
  out({ type: "item.started", item: { id: "i1", type: "command_execution", command: "bash -lc ls", status: "in_progress" } });
  out({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "bash -lc ls", aggregated_output: "a.txt\n", exit_code: 0, status: "completed" } });
  const echo = { stdin, home: process.env.CODEX_HOME, capability: process.env.TEMPER_CAPABILITY ?? null, args: process.argv.slice(2), leaked: canaries(process.env), childLeaked: childCanaries() };
  out({ type: "item.completed", item: { id: "i2", type: "agent_message", text: JSON.stringify(echo) } });
  out({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "VERDICT: PASS" } });
  out({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50, reasoning_output_tokens: 10 } });
});
