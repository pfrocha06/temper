# Temper — design

Temper is a local, always-on autonomous software factory with its own web UI.
Agents build and maintain software; the human sets direction and grants autonomy.
Its first product is itself.

It blends three bodies of practice:

- **Matt Pocock's skills** — alignment first (grilling), glossary + ADRs, spec → tracer-bullet
  tickets → TDD → review → PR with evidence, retros.
- **pstack (Lauren Tan)** — playbook routing per task type, prove-it-works against the real
  artifact, adversarial review, verification skills, encoding lessons in structure.
- **Paperclip** — agents as an organisation: roles, tickets, heartbeats, budgets, the human
  as the board, an append-only audit log.

## The differentiator: trust is measured

Most harnesses trust an agent's self-report. Temper does not.

1. **Separation of powers.** The agent that builds never owns the proof. A Verifier writes
   *holdout* behaviour tests from the spec into a separate repository the Builder cannot read.
   Builders receive only failing acceptance-criterion IDs, never test source.
2. **Testing the testers.** Planted defects (mutations, reverted tickets, replayed escapes) are
   periodically sent through every verifier. Each verifier earns a measured catch rate per
   area of the codebase.
3. **Temperature.** A single health signal computed from the audit log (reverts, flaky
   verifications, escaped bugs, holdout failures, review disagreement). It tightens or relaxes
   the regime automatically: heats fast, cools only on evidence, never on elapsed time.

Autonomy is granted **per area** from measured catch rates, approved by the human, and is
lost automatically when the temperature rises.

## Human role (the board)

The human owns:

- specs (via grilling),
- autonomy promotions,
- changes to holdouts, the Verifier agent, skills and workflows that touch verification,
- deploys (until an area earns auto-deploy),
- random spot-check PRs, sampled at a rate that rises with temperature.

Everything else runs without the human.

## Profiles

A **profile** binds an identity: agent adapters + accounts, git host credentials, issue
trackers, target repositories, plugins. A profile only dispatches to its own adapters and
repos. Company-specific integrations are profile plugins kept in local config, never in this
repository.

## Agents

v0 roles, all on the `claude` CLI behind a swappable adapter interface:

| Role | Does | Never |
|---|---|---|
| Planner | grills, writes spec, splits tickets | writes code |
| Builder | TDD in a worktree, commits locally | reads holdouts, edits tests outside its ticket, pushes |
| Verifier | owns holdouts + the verification skill, runs them against the running app | edits product code |
| Reviewer | adversarial review of the diff against the spec | edits code |

Each run is a fresh session with a Temper-controlled config: only the skills, instructions
and MCP servers assigned to the role. No user-level memory, skills or MCP servers leak in.
Agents are versioned, audited records editable in the UI; Verifier edits need approval.

**Agents never touch the network-facing side of git.** Only the server pushes, opens PRs and
merges, through one audited code path, after gates pass.

## Work

Ticket types, each mapped to a YAML workflow in `workflows/`:

| Type | Distinguishing gate |
|---|---|
| feature | holdouts + before/after evidence |
| bugfix | reproduction first; ends in a regression test |
| refactor | no behaviour change: no test diff, all suites + holdouts green |
| investigation | read-only; output is a cited document |
| prototype | throwaway branch, never merged; output is a decision |
| perf | baseline number + explain-the-number |
| chore | low blast radius, reviewer-only |
| skill | blind A/B eval evidence + human approval |
| verification | Verifier-owned + human approval |

A workflow is a DAG of **stages**. Each stage names an agent role, its tool restrictions and
a loop cap. Stages end with exactly one verdict line (`VERDICT: PASS|FAIL|BLOCKED`);
transitions route on it. Each stage writes named **artifacts** (`spec.md`, `changes.md`,
`review.md`, `verification.md`) shown as tabs on the ticket. A run can be replayed from any
stage with human feedback.

The unit of execution is a **dispatch**: one attempt at one stage of one ticket. A retry is
a new dispatch. Every dispatch ends with exactly one outcome.

Every heartbeat: **reconcile, then dispatch** — cancel dispatches whose ticket left the
active state, clean orphaned worktrees, then fill free slots within per-role concurrency and
run-rate caps. Rate-limit responses pause the role automatically.

Tickets declare a **file scope**; overlapping scopes are flagged before dispatch.

## Definition of done

At autonomy levels 0–1 (all areas start at 0), merge requires:

- Builder tests green, with the red→green test hashes recorded,
- holdouts green against the running app,
- no blocking review findings,
- PR body with before/after evidence and a merge-risk call,
- no test-file changes unless a verification ticket authorises them,
- clean secret scan (gitleaks).

At level ≥ 2 (later): merge first, then verify the release candidate on the RC port with the
verification skills and Playwright; on failure auto-revert, open a bug ticket with evidence,
raise the temperature.

## Releases

The running instance is always a pinned release built from a tag into
`~/.temper/releases/<tag>`. Agents only change worktrees. Promotion boots the candidate on
the RC port, health-checks it, then swaps; failure rolls back automatically. The previous
release is always one click away.

## Skills

A pinned registry in `skills/`: vendored upstream skills (with their licences and source
commits recorded in `skills/registry.json`) plus local skills. Agents propose new skills as
PRs with eval evidence; the human approves. Human-authored skills go live directly.

## Secrets and data

Environment values are never displayed. The audit log is redacted before write. A secret
scan is a hard gate before any push.

The server itself runs Builder code: the test command and the candidate app. Both run in the
same sandbox as agent runs (Anthropic's sandbox runtime): no reads of holdouts or Temper's data,
writes only to the worktree and a private temp dir, no outbound network, no server environment.
A deterministic probe proves this before the first gate runs; while it fails, those stages go
to the board.

## Stack

TypeScript pnpm monorepo. Node server on Hono; Postgres embedded in-process (PGlite) via
Drizzle; React + Vite + Tailwind + shadcn/ui; SSE for live updates; Vitest + Playwright.
Runs as a launchd service: UI on `:4600`, release candidate on `:4601`, data in `~/.temper/`.

```
apps/server             API, scheduler, orchestrator, gates, git service, CLI
apps/web                UI: Board, Ticket, Runs, Inbox, Thermostat, Agents, Skills
packages/core           domain: tickets, dispatches, audit, temperature, workflows, db
packages/adapters/*     agent CLI adapters (claude-cli first)
plugins/*               issue-tracker / git-host plugins (github first)
workflows/              per-ticket-type workflow YAML
skills/                 skill registry
```

## v0 is done when

On Temper's own repo: a spec is imported → the Planner writes tickets → the Builder TDDs one
in a worktree → the Verifier writes holdouts and runs them against the running app → the
Reviewer reviews → the server opens a PR with evidence → the human merges → the human deploys
with auto-rollback. Temperature is computed and logged but not enforced.

The first self-built epic after v0: planted-defect trials, so the temperature has ground truth.

## Known risks

- A single model vendor for every role weakens separation of powers; the Thermostat flags it.
- Vendor terms for always-on headless subscription use should be checked before relying on it.
