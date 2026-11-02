# Execution boundaries

Every place Temper runs code it does not control, the policy that confines it, and the tests
that prove the policy. A change that adds a path, or loosens one, updates this page and its tests;
`apps/server/test/boundaries.test.ts` fails on a new process call site until it is accounted for.

Run the suite with `pnpm test:security`. It needs the real sandbox (see the README's platform
table); CI installs it on Linux, macOS and Windows and **fails**, rather than skips, when it is
missing (`apps/server/test/helpers/srt.ts`).

## The paths

| Path | Whose code | Confined by | Policy | Tests |
|---|---|---|---|---|
| Builder, Reviewer, Chief agent runs | the model's tool calls | the agent CLI's own sandbox (`claude`, `codex`) | denied Temper's secrets and data and the holdouts; no network but what the role needs; environment from `agentEnv` | `packages/core/test/agent-env.test.ts`, the adapters' canary tests; `temper probe-isolation` against a real CLI |
| Verifier agent runs | the model's tool calls | the same | as above, the holdouts writable, the candidate read-only, the app through the sandbox proxy | the same |
| MCP servers of a run | Temper (`mcp-temper`) or the profile | started by the agent CLI | the run's environment plus their configured variables; a capability scoped to the run's role and environment, revoked when it ends | `apps/server/test/auth.test.ts` |
| Setup commands (project, holdouts) | the repository (install scripts) | srt, `runSetup` | writes its folder and the package caches; reaches only `TEMPER_SETUP_ALLOW_DOMAINS`; denied Temper's secrets, the user's credential folders, other worktrees and (project setup) the holdouts | `apps/server/test/setup.test.ts` |
| Builder tests (gate) | the Builder | srt, the gate sandbox | writes the worktree and a temp dir; no network; denied secrets, credentials and the holdouts; stripped environment | `apps/server/test/sandbox.test.ts` (`probeGateIsolation`) |
| Candidate app (gate, Verifier) | the Builder | srt, the gate sandbox | as the tests, reachable from the host on one port | `apps/server/test/sandbox.test.ts` (`bootApp`) |
| Holdouts (gate) | the Verifier | srt, the holdouts sandbox | reads the holdouts and the candidate; writes a temp dir and the candidate's `node_modules`; reaches only the app; denied secrets, credentials and other worktrees | `apps/server/test/holdouts-sandbox.test.ts` |
| Secret scan before a push | Temper (gitleaks) on agent commits | fails closed | gitleaks 8.18+ or the push does not happen | `apps/server/test/secret-scan.test.ts` |
| Git and `gh` commands the server runs | Temper, with fixed arguments | the host, with the server's credentials | runs in repositories agents can write to; hardening in progress | |
| Temper's own deploy and update | Temper | the host, outside the service | board-approved; builds and checks a release before switching | `apps/server/test/updates.test.ts`, `releases.test.ts` |

## Rules every sandboxed path follows

- **Fail closed.** The gate sandbox is probed before first use (`probeGateIsolation`). A probe
  that fails stops every stage that would run untrusted code, sends the board a notice and records
  `gate_sandbox.failed` with the reason; nothing falls back to the host
  (`boundaries.test.ts`). `TEMPER_GATE_SANDBOX=off` is for development only and is audited at start.
- **No server environment.** Sandboxed commands get `sandboxEnv`; agent CLIs get `agentEnv`.
- **No secret in output.** Tests plant canaries and assert they appear nowhere: not in output,
  reports, artifacts or files.
- **No process left behind.** On Linux srt runs each command in a PID namespace that dies with it
  (`holdouts-sandbox.test.ts`). On macOS and Windows a process a command detaches outlives the run
  but keeps the same sandbox profile, so it stays confined.

## Platform notes

- **Linux:** commands have their own network namespace; the only way out is srt's proxy, which
  enforces the per-path host allowlist. Writes a policy re-allows inside a read-denied folder (the
  candidate's `node_modules` under the denied worktrees folder) land in a scratch layer and are
  discarded when the command ends.
- **macOS:** the sandbox shares the host's loopback, so sandboxed code can open other local
  ports; the board API refuses requests without the board token.
- **Windows:** srt runs commands as a separate account that cannot read the user's profile.
  Worktrees, holdouts, gate scratch files and setup caches therefore live under
  `%ProgramData%\temper`; a holdouts folder inside the profile fails the holdouts gate. Loopback
  goes through srt's proxy to any local port; the board API refuses requests without the token.
  That one account's ACLs are every sandbox's rules, so policies running at once combine and a
  deny wins: the holdouts cannot run against a sandboxed candidate app (the check fails closed),
  and a gate running while another ticket's sandbox denies the holdouts can fail. Use Linux, macOS
  or WSL for projects with an app command.
