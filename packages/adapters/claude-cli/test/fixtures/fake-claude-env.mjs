// Stands in for `claude -p`: reports which variables holding a canary it and a child process see.
import { execFileSync } from "node:child_process";

const leaked = (env) => Object.entries(env).filter(([, v]) => String(v).includes("canary-")).map(([k]) => k);
const child = execFileSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(Object.entries(process.env).filter(([, v]) => String(v).includes("canary-")).map(([k]) => k)))`], { encoding: "utf8" });
const report = { leaked: leaked(process.env), childLeaked: JSON.parse(child), hasPath: Boolean(process.env.PATH ?? process.env.Path), run: process.env.TEMPER_APP_URL ?? null };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "system", subtype: "init", session_id: "s-env", model: "fake" });
out({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(report), session_id: "s-env" });
