# Operations hygiene

Small, independent items; each can be its own ticket.

1. **Stage timeouts**: per stage (workflow field, default 45 min) — a hung run is cancelled and escalated.
2. **Flaky test retry**: a failing `builder_tests` gate re-runs once; pass-on-retry records a `flaky_verification` signal.
3. **Cleanup**: periodic GC of worktrees and app processes for done/cancelled tickets, stale `.setup-ok` markers, old trial dirs.
4. **Revert action**: board action on a done ticket that opens a revert PR and records a `revert` signal.
5. **Spot-check sampling**: a share of merges (by regime) is sent to the board for after-the-fact review.
6. **Holdouts push**: the server pushes the holdouts repo after each verify commit (server-only network).
7. **Redaction review**: record redaction hits (counts per pattern) so over-eager rules are visible; one historical `changes.md` line was redacted for an unknown reason.
8. **Stuck banner quality**: escalations from crashes include the failing command and a suggested action.

## Acceptance criteria
One per item, e.g. AC-1: a stage exceeding its timeout is cancelled and an escalation is created.
