# Factory metrics

## Behaviour
A Metrics screen and API: lead time per ticket (ready → done), time per stage, first-pass rate per
stage and per agent, loops per ticket, escalations by cause, board wait time, agent runs per day
vs subscription limits (rate-limit events), knowledge reads per run, all filterable by project,
area, ticket type and harness fingerprint (0002).

## Acceptance criteria
- AC-1: Metrics are computed from the audit log and dispatches only (no new write paths).
- AC-2: Every chart can be filtered by project, ticket type and harness fingerprint.
