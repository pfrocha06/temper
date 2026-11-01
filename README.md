# Temper

[![ci](https://github.com/pfrocha06/temper/actions/workflows/ci.yml/badge.svg)](https://github.com/pfrocha06/temper/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A local, always-on software factory. AI agents plan, build, verify and review changes to your
repositories; you set direction, approve merges, and grant autonomy as it is earned.

**Trust is measured, not assumed.** Most agent harnesses take an agent's word that its work is
done. Temper doesn't:

- **The builder never owns the proof.** A separate Verifier writes behaviour tests ("holdouts")
  from the spec into a repository the Builder can't read. The Builder only learns which
  acceptance criteria failed.
- **The server, not the agents, touches the outside world.** Agents run sandboxed with no network
  and commit locally. Only the server pushes, opens PRs and merges, after hard gates pass.
- **Health is a number.** A temperature computed from the audit log (reverts, escaped bugs,
  holdout failures, review disagreement) heats fast and cools only on evidence.

> **Status: early (v0).** Temper builds itself. Agents run on the `claude` CLI behind an adapter
> interface. The service runs on macOS (launchd); on Linux, run the server in the foreground.
> Expect breaking changes. See the [roadmap](docs/roadmap.md).

## How it works

```
spec ──▶ Chief of Staff ──▶ tickets
                              │
            ┌─────────────────┘
            ▼
         build ──▶ verify ──▶ gates ──▶ review ──▶ PR ──▶ board merges
       (Builder)  (Verifier)  tests,    (Reviewer)  (server)    (you)
           ▲      holdouts   holdouts,      │
           │      repo       diff guard,    │
           └──── feedback ◀─ secret scan ◀──┘  on FAIL
```

Each ticket type (feature, bugfix, refactor, investigation, perf, …) maps to a workflow in
[`workflows/`](workflows): a graph of stages that each end in `VERDICT: PASS | FAIL | BLOCKED`.
Loops are capped; anything stuck goes to your inbox.

| Role | Does | Never |
|---|---|---|
| Chief of Staff | turns specs into tickets, curates shared knowledge, talks with you | resolves your decisions itself |
| Builder | test-first changes in a git worktree, local commits | reads holdouts, weakens tests, pushes |
| Verifier | writes holdouts from the spec, runs them against the running app | edits product code |
| Reviewer | adversarial review of the diff against the spec | edits code |

Every run is a fresh session with only the skills, instructions and MCP servers assigned to its
role. Your own agent settings, memory and plugins never leak in.

## Requirements

- Node.js ≥ 22 and pnpm
- git and the [GitHub CLI](https://cli.github.com/) (`gh`), signed in
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`), signed in

## Develop

```sh
pnpm install
pnpm check      # company-agnostic check + typecheck + tests
pnpm dev        # dev instance: server on :4610, web on :5173, separate data from the service
```

## Run it as a service

```sh
# 1. Profile: which git host account the server acts as (never committed)
mkdir -p ~/.temper
cat > ~/.temper/profile.json <<'JSON'
{ "name": "default", "github": { "user": "<your-gh-user>" }, "adapters": ["claude-cli"], "plugins": ["github"] }
JSON

# 2. Build, verify and start a release (UI on http://127.0.0.1:4600), then sign in as the board
node apps/server/src/cli.ts deploy --ref main
node apps/server/src/cli.ts open

# 3. Before trusting the factory, prove agents can't read your holdouts or secrets
node apps/server/src/cli.ts probe-isolation --holdouts <holdouts-checkout>

# 4. Register a project
node apps/server/src/cli.ts project add --name temper --repo . \
  --remote https://github.com/<owner>/temper.git \
  --holdouts <holdouts-checkout> \
  --test "pnpm install --frozen-lockfile --prefer-offline && pnpm check" \
  --setup "pnpm install --frozen-lockfile --prefer-offline" \
  --app 'pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @temper/web build && TEMPER_HOME=$(mktemp -d) TEMPER_HEARTBEAT_MS=3600000 node apps/server/src/main.ts' \
  --holdouts-setup "pnpm install --frozen-lockfile --prefer-offline" \
  --health /api/status \
  --holdouts-cmd "node run.mjs"

# 5. Hand it work
node apps/server/src/cli.ts import-spec --project <id> --file spec.md --start
```

`temper rollback` returns to the previous release. `temper pause` stops new work.
Run `node apps/server/src/cli.ts help` for every command.

### The holdouts repository

Holdouts live in their own git repository, outside the project, so the Builder never sees them
([ADR 0001](docs/adr/0001-holdouts-in-a-separate-repository.md)). Its shape:

- `baseline/` holds checks that must always pass.
- `tickets/<ticket-id>/` holds checks the Verifier writes for one ticket. Once that ticket merges,
  they keep running as regression checks.
- Each `*.holdout.mjs` default-exports `async ({ url, candidatePath }) => [{ id, pass, message }]`.
- `run.mjs` runs them against `TEMPER_APP_URL` and prints one `AC-<id>: PASS|FAIL` line per check.

## Repository layout

```
apps/server            API, scheduler, orchestrator, gates, git service, CLI
apps/web               console: board, tickets, runs, inbox, thermostat, agents, skills
packages/core          domain: tickets, dispatches, audit log, temperature, workflows, database
packages/adapters/*    agent CLI adapters (claude-cli first)
packages/mcp-temper    MCP server agents use to reach Temper's knowledge and tools
plugins/*              git host and tracker plugins (github, jira)
workflows/             one workflow per ticket type
skills/                pinned registry of vendored and local agent skills
```

## Documentation

- [Design](docs/design.md): the model, roles, gates and definition of done
- [Glossary](CONTEXT.md): the vocabulary humans and agents share
- [Decisions](docs/adr): architecture decision records
- [Roadmap](docs/roadmap.md) and [specs](docs/specs): what's next, written to be picked up cold

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the
[code of conduct](CODE_OF_CONDUCT.md), and report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Vendored skills under `skills/vendor/` keep their own licences; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
