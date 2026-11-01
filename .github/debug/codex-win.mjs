// TEMPORARY: which Codex network settings hold on Windows. Removed once settled.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const home = process.env.TEMPER_TEST_CODEX_HOME;
const root = mkdtempSync(join(tmpdir(), "cxdbg-"));
const deny = join(root, "deny"); mkdirSync(deny); writeFileSync(join(deny, "c.txt"), "CANARY");
const work = join(root, "work"); mkdirSync(work);
const app = createServer((q, s) => s.end("HOSTAPP")).listen(47199, "127.0.0.1");
await new Promise((r) => app.once("listening", r));
const code = `
const fs=require('fs');
try{console.log('READ',fs.readFileSync(${JSON.stringify(join(deny, "c.txt"))},'utf8'))}catch(e){console.log('READ-DENIED',e.code)}
const s=require('http').createServer((q,r)=>r.end('SELF')).listen(0,'127.0.0.1',()=>fetch('http://127.0.0.1:'+s.address().port).then(r=>r.text()).then(t=>{console.log('SELF',t);s.close()},e=>{console.log('SELFERR',e.cause?.code||e.message);s.close()})).on('error',e=>console.log('LISTENERR',e.code));
fetch('http://127.0.0.1:47199').then(r=>r.text()).then(t=>console.log('HOST',t),e=>console.log('HOSTERR',e.cause?.code||e.message));
fetch('https://example.com').then(r=>console.log('NET',r.status),e=>console.log('NETERR',e.cause?.code||e.message));
require('net').connect(443,'93.184.215.14').on('connect',function(){console.log('TCPNET open');this.destroy()}).on('error',e=>console.log('TCPNETERR',e.code));
setTimeout(()=>{},4000);
`;
const toml = (v) => typeof v === "string" ? JSON.stringify(v) : typeof v === "boolean" ? String(v) : `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)} = ${toml(x)}`).join(", ")}}`;
const fsRules = { [deny]: "deny" };
const variants = {
  "net+proxy+lb, mxc": { net: { enabled: true, allow_local_binding: true, domains: { localhost: "allow", "127.0.0.1": "allow" } }, flags: ["--enable", "network_proxy", "--enable", "prefer_mxc"] },
  "net+proxy+lb, elevated": { net: { enabled: true, allow_local_binding: true, domains: { localhost: "allow", "127.0.0.1": "allow" } }, flags: ["--enable", "network_proxy", "--disable", "prefer_mxc"] },
  "net+proxy, elevated": { net: { enabled: true, domains: { localhost: "allow", "127.0.0.1": "allow" } }, flags: ["--enable", "network_proxy", "--disable", "prefer_mxc"] },
  "net off, elevated": { net: { enabled: false }, flags: ["--disable", "prefer_mxc"] },
  "net off, mxc": { net: { enabled: false }, flags: ["--enable", "prefer_mxc"] },
};
for (const [name, v] of Object.entries(variants)) {
  const args = ["sandbox", "-c", 'default_permissions="t"', "-c", `permissions={t = {extends = ":workspace", filesystem = ${toml(fsRules)}, network = ${toml(v.net)}}}`, "-c", 'windows.sandbox="elevated"', ...v.flags, "--permissions-profile", "t", "-C", work, "--", process.execPath, "-e", code];
  const t = Date.now();
  const r = spawnSync("codex.cmd", args, { cwd: work, env: { ...process.env, CODEX_HOME: home }, encoding: "utf8", shell: true, timeout: 60000 });
  console.log(`\n== ${name} (${Date.now() - t}ms, exit ${r.status})\n${(r.stdout + r.stderr).trim().slice(0, 1200)}`);
}
app.close();
