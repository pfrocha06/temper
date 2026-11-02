# AGENTS.md

Instructions for coding agents (and humans) changing this repository. Claude Code reads it through
`CLAUDE.md`; Codex, Cursor and others read it directly. Temper's own Builder agents read it too
when Temper works on itself.

## Read first

- [CONTEXT.md](CONTEXT.md): the glossary. Use its words exactly (ticket, stage, dispatch, verdict,
  holdout, gate, board).
- [ARCHITECTURE.md](ARCHITECTURE.md): where the code lives and the invariants it must keep.
- [CONTRIBUTING.md](CONTRIBUTING.md): how we work, and the changes that need extra care.
- [docs/adr](docs/adr): decisions already made. Don't reopen one without a new ADR.
- The ticket's spec in [docs/specs](docs/specs) when there is one: it names the file scope, the
  acceptance criteria and what is out of scope.

## Commands

```sh
pnpm install
pnpm check                         # typecheck + every test; must pass before a PR
pnpm --filter @temper/server test  # one package (also @temper/core, @temper/web, @temper/plugin-jira, …)
pnpm --filter @temper/server exec vitest run test/intake.test.ts   # one file
pnpm dev                           # dev instance: server on :4610, web on :5173
```

If `pnpm` is not on PATH (Git Bash on Windows, for example), use `corepack pnpm`.

## Rules

1. **Test first.** A failing test for the behaviour, then the code. Never weaken a test to make
   work pass: no deleted assertions, no `.skip` or `.only`. The diff guard rejects these.
2. **Keep the core generic.** Integrations specific to one organisation (its trackers, SSO,
   internal tools) are profile plugins kept in local config, not code here. No real site URLs or
   tokens in the repository, including tests and fixtures.
3. **Erasable TypeScript only.** The server runs with plain `node`, which strips types and nothing
   more (`erasableSyntaxOnly` in `tsconfig.base.json`). No parameter properties
   (`constructor(private db: Db)`), no `enum`, no `namespace`. Relative imports keep their `.ts`
   extension.
4. **No real services in tests.** Tests use the embedded database (PGlite, in memory), the fake
   Jira (`plugins/jira/test/fake-jira.ts`) and the fake agent CLI
   (`apps/server/test/fixtures/fake-claude.mjs`). Nothing calls GitHub, Jira or a model.
5. **Stay in scope.** One change per PR. When working a ticket, touch only its file scope.
6. **Record decisions.** A change to the architecture, or to a trade-off an ADR made, comes with a
   new or updated ADR in `docs/adr/`.

## Commits and pull requests

- `main` is protected: every change goes through a pull request with green CI (`pnpm check` on
  macOS, Linux and Windows).
- Commit subjects are imperative and describe behaviour, optionally prefixed by the area:
  `Board: filter tickets by source`, `Probe isolation with canaries only`. The why goes in the body.
  No Conventional Commits prefixes (`feat:`, `fix:`).
- Fill in the PR template: what changed, why, how you verified it. Close the roadmap issue with
  `Closes #<n>`.
- Releases are `vX.Y.Z` tags made by the `release` workflow; no version number is bumped in files.

## Changes that need extra care

Changes to the agent adapters, the sandbox, the Verifier and holdouts, the gates and diff guard, or
board auth and agent capabilities protect the separation of powers. Read the matching ADR first,
re-run `temper probe-isolation --holdouts <folder>` for adapter or sandbox changes, and say so in
the PR.

## Gotchas

- Every test that opens a database starts an embedded Postgres and runs all migrations. That is
  slow on a busy machine, which is why the vitest timeouts are 30 s.
- The web console is served from `apps/web/dist` by the server. A console change shows in a running
  instance only after `pnpm --filter @temper/web build`.
- `TEMPER_HOME` (default `~/.temper`) holds the database, secrets, worktrees and logs. Tests make
  their own temporary home; never point a test at the real one.
- A database change needs a migration in `packages/core/src/db/migrations`, generated with
  `pnpm --filter @temper/core db:generate`, not just an edit to `schema.ts`.
