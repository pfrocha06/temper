// CI only, Windows: runs the sandbox's WFP egress check once, without a time limit.
//
// The first check after `srt windows-install` creates the sandbox user's Windows profile, which can
// take about as long as the 30 s the sandbox runtime allows that check. Doing it here, once, keeps
// the gate sandbox tests from failing on a slow runner. Run from apps/server, which depends on the
// runtime: `pnpm --filter @temper/server exec node ../../scripts/warm-windows-sandbox.mjs`.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { VENDORED_SRT_WIN_EXE, SRT_WIN_DISPATCH_ARG1, DEFAULT_WINDOWS_PROXY_PORT_RANGE } = await import(
  pathToFileURL(require.resolve("@anthropic-ai/sandbox-runtime")).href
);

// A loopback listener outside the range WFP permits, as the runtime's own check uses.
const [lo, hi] = DEFAULT_WINDOWS_PROXY_PORT_RANGE;
let server;
let port;
for (let i = 0; i < 5 && !server; i++) {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const p = s.address().port;
  if (p < lo || p > hi) [server, port] = [s, p];
  else s.close();
}
if (!server) throw new Error(`could not bind a port outside ${lo}-${hi}`);

const started = Date.now();
const r = spawnSync(VENDORED_SRT_WIN_EXE, [SRT_WIN_DISPATCH_ARG1, "wfp", "verify", "--target", `127.0.0.1:${port}`], {
  encoding: "utf8",
  timeout: 300_000,
});
server.close();
console.log(`srt-win wfp verify: exit ${r.status} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log((r.stdout || r.stderr || String(r.error ?? "")).trim());
process.exit(r.status ?? 1);
