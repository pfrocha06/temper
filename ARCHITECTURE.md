# Architecture

A map of the code: what lives where, how a ticket moves through it, and the invariants a change
must keep. The product design and its reasons are in [docs/design.md](docs/design.md) and the
[ADRs](docs/adr); the words are defined in [CONTEXT.md](CONTEXT.md).

## The shape

One Node process, the **server**, owns everything: the database, the scheduler, the git host and
tracker credentials, and the HTTP API. Agents are separate CLI processes (`claude`, `codex`) the
server starts in a ticket's worktree. They never talk to GitHub or Jira themselves; they reach
Temper only through MCP servers that call the server's agent API with a short-lived capability.
The **console** is a static React app the server serves; the **`temper` CLI** is a thin HTTP
client of the same server.

```
board (browser / temper CLI)
        │  board token
        ▼
apps/server ── Factory (heartbeat) ── adapters ──▶ claude / codex CLI in a worktree
   │   │                                                  │
   │   └── gates (tests, diff guard, secret scan, holdouts, in a sandbox)
   │                                                      │ MCP (mcp-temper), capability token
   │◀─────────────────────── agent API ◀──────────────────┘
   ├── packages/core (PGlite database: tickets, dispatches, audit, …)
   └── plugins/github (gh), plugins/jira (REST): used by the server only
```

## Where things live

| Path | What it is |
|---|---|
| `apps/server/src/main.ts` | Starts the server: config, profile, database, adapters, the Factory, the HTTP API, the updater. |
| `apps/server/src/factory.ts` | The scheduler. Each heartbeat reconciles state, then dispatches stages; routes verdicts through the workflow; escalates to the board. |
| `apps/server/src/api.ts`, `auth.ts` | The board's HTTP API (`/api/*`, Hono + zod) and board-token auth. |
| `apps/server/src/agent-api.ts` | The agent API: what an agent run may do, decided by its role and capability. |
| `apps/server/src/adapters.ts`, `prompt.ts` | Picks an adapter for an agent and builds the stage prompt (and what the Builder must not see). |
| `apps/server/src/gates/` | Hard checks: builder tests, diff guard, secret scan, holdout results. |
| `apps/server/src/sandbox.ts`, `probe.ts` | The gate sandbox, and `probe-isolation`, which proves what an agent cannot read. |
| `apps/server/src/holdouts.ts` | The holdouts repository each project gets, outside the Builder's reach. |
| `apps/server/src/plan.ts` | Parses the Chief's plan when a spec is split into tickets. |
| `apps/server/src/intake.ts`, `github-import.ts`, `jira-import.ts` | Work intake: issues become specs, specs become tickets linked back to the issue. |
| `apps/server/src/releases.ts`, `service.ts`, `updates.ts`, `cli.ts` | Running Temper itself: releases, the launchd/systemd service, update checks, `temper deploy`. |
| `apps/server/src/profile.ts`, `config.ts` | The profile (identity, adapters, trackers; never committed) and environment config. |
| `packages/core` | Domain and storage: the drizzle schema and migrations (PGlite), tickets, dispatches, approvals, audit, knowledge, temperature, workflow routing, redaction. No HTTP, no processes. |
| `packages/adapters/*` | One package per agent CLI, implementing the `AgentAdapter` contract in `packages/core/src/adapter.ts`. |
| `packages/mcp-temper` | The `temper` MCP server given to agents: knowledge base, and tickets for the Chief. Every tool is a call to the agent API. |
| `plugins/github`, `plugins/jira` | Git host and tracker clients. Server-only. |
| `apps/web` | The console: React, TanStack Query, react-router, Tailwind, shadcn/ui. One folder per screen in `src/features`. |
| `workflows/*.yaml` | The stage DAG for each ticket type. |
| `skills/` | Skills vendored for agents, with their sources and registry. |

## How a ticket moves

1. **Intake.** The board imports a spec (console, `temper import-spec`, GitHub or Jira issue). The
   Chief of Staff splits it into tickets with acceptance criteria, a file scope and dependencies
   (`Factory.importSpec`, `plan.ts`).
2. **Start.** A started ticket gets a branch and a worktree. Its workflow (`workflows/<type>.yaml`)
   names the first stage.
3. **Stages.** Each heartbeat (`Factory.tick`) dispatches the next stage of ready tickets, within
   each agent's concurrency, its hourly run limit and the provider's usage caps. An agent stage runs the role's agent through its
   adapter and ends with a `VERDICT:` line; a gate stage runs checks on the server.
4. **Routing.** The verdict picks the next stage from the workflow (`on: { PASS, FAIL, BLOCKED }`).
   Loops are capped; anything the factory may not decide becomes an approval in the board's Inbox.
5. **Finish.** The `pr` gate opens the pull request; the board approves the merge (autonomy level
   0). The ticket is done, its worktree is cleaned up, and the Chief digests what was learned into
   the knowledge base.

Every step writes audit events. Temperature, the health signal, is computed from them.

## Invariants

Changes must keep these. Each has an ADR; changing one needs a new ADR.

- **Only the server touches the remote** (ADR 0002). Agents commit locally and never push, open
  PRs or call trackers. Tokens for GitHub and Jira live in `TEMPER_HOME/secrets` and only the
  server reads them.
- **The Builder never sees the holdouts** (ADR 0001). Holdouts live in a separate repository the
  Builder's sandbox cannot read, and the prompt never includes the Verifier's artifacts.
- **Agents act through capabilities** (ADR 0007). The board has the board token; an agent run gets
  a capability scoped to its dispatch or chat and role, and the server checks it on every call.
- **Audit events are append-only.** Never updated or deleted.
- **The core is company-agnostic** (ADR 0004). Anything specific to one company belongs in a local
  profile plugin, not in this repository.
- **Workflows are data** (ADR 0005). Ticket behaviour changes by editing a workflow YAML, not by
  special cases in the Factory.
- **Adapters hide the vendor** (ADR 0006). The Factory knows the `AgentAdapter` contract, not
  `claude` or `codex` flags.
