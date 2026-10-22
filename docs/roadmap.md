# Roadmap

## North star

A harness whose agents improve themselves over time, so the board can trust them with more and
more work without approving each step: autonomy is earned per area from measured evidence
(catch rates, clean merges) and lost automatically when trust drops. Later the factory also runs
**automations and scheduled tasks**, and reads **many data sources** (issue trackers, wikis,
meeting notes from an AI notetaker, chat) through connectors — so work can start from where
decisions are actually made, not only from specs typed into Temper.

What is built, what is next, and where the spec for each next step lives. Specs in
`docs/specs/` are written to be picked up cold by another agent (or imported into Temper
itself with `temper import-spec`, or handed to the Chief of Staff in a conversation).

## How to pick up an item

1. Read `CONTEXT.md` (vocabulary), `docs/design.md` and the ADRs in `docs/adr/`.
2. Read the spec. Each one names the files it touches, its acceptance criteria and what is out of scope.
3. Work test-first. `pnpm check` must pass. If you touch the agent adapter or sandbox settings,
   re-run `node apps/server/src/cli.ts probe-isolation --holdouts <holdouts>`.
4. Never weaken a holdout to make work pass; changes to holdouts, the Verifier, skills or
   workflows that touch verification go to the board.
5. Holdouts are shared by every in-flight ticket: a check for new behaviour must not run ahead of
   the code. Put it in that ticket's own holdouts, or feature-detect it in the candidate
   (`lib/candidate.mjs`) when it belongs in `baseline/`.
6. Update this file's status column when you finish.

## Built

Ticket workflows with verdict routing · four isolated agent roles plus the Chief of Staff ·
heartbeat scheduler · worktrees with server-side setup · gates (tests, diff guard, secret
scan, holdouts incl. browser UI checks, regressions of merged tickets) · separate holdouts repo
with isolation probe · server-only PRs and merges · board inbox · temperature (shadow mode) ·
append-only audit log · releases with verify, backup and auto-rollback · web console ·
board auth with per-run agent capabilities · knowledge base + `temper` MCP server ·
environments · Chief of Staff conversations · Tools inventory
(the last five are landing with the next deploy).

## Next, in order

| # | Item | Spec | Status |
|---|---|---|---|
| 1 | Harness fingerprint on every run | [0002](specs/0002-harness-fingerprint.md) | todo |
| 2 | Merge readiness: wait for CI, preview link, screenshots, auto-rebase | [0003](specs/0003-merge-readiness.md) | todo |
| 3 | Notifications and the Chief's daily briefing | [0004](specs/0004-notifications-and-briefing.md) | todo |
| 4 | Trials engine (shared "re-run it and measure" machinery) | [0005](specs/0005-trials-engine.md) | todo |
| 5 | Planted-defect trials and verifier catch rates | [0006](specs/0006-planted-defect-trials.md) | todo |
| 6 | Harness self-improvement loop (Propose–Probe–Compose, lessons, replay benchmark) | [0007](specs/0007-harness-self-improvement.md) | todo |
| 7 | Autonomy levels per area and temperature enforcement | [0008](specs/0008-autonomy-levels.md) | todo |
| 8 | Operations hygiene: timeouts, flaky retry, cleanup, revert, spot checks, holdouts push | [0009](specs/0009-operations-hygiene.md) | todo |
| 9 | Factory metrics | [0010](specs/0010-metrics.md) | todo |
| 10 | Second agent vendor (Codex) behind the adapter | [0011](specs/0011-second-vendor.md) | todo |
| 11 | Off-machine backups | [0012](specs/0012-offsite-backup.md) | todo |
| 12 | Providers settings: usage, subscription limits, caps, logos, Usage dashboard | [0013](specs/0013-providers-and-usage.md) | done (follow-ups: per-ticket wasted tokens in the report; UTC vs local day buckets) |
| 13 | Chief of Staff operator tools (board decisions only as confirmable proposals) | [0014](specs/0014-chief-operator-tools.md) | done (follow-ups: resolved proposals in chat history; richer stored chat-action detail) |
| 14 | Connector catalog from the MCP Registry with generic OAuth and a credential proxy | [0015](specs/0015-connector-catalog.md) | todo |
| 15 | Environment and project management UI | [0016](specs/0016-environments-ui.md) | todo |
| 16 | Automations and scheduled tasks | — (later) | idea |
| 17 | Data sources beyond code: wikis, meeting notetaker, chat, as knowledge and work intake | — (later) | idea |

Items 4–6 share machinery; build them in order. Item 7 depends on 5. Item 6 is inspired by
Harness² (google-research/harness2): an editable harness improved by proposing edits, probing
them on the same task and composing what worked — here with gates and holdouts as ground truth
instead of an LLM judge.

## Parked

- Personal-machine install (profiles exist; access to the repo from the personal account is undecided).
- Licence (undecided; ask Legal before publishing or using outside the hosting organisation).
- Jira plugin (deliberately not built).
- OpenViking or another context database behind the knowledge store interface (needs embedding/VLM API keys; licence to verify).
