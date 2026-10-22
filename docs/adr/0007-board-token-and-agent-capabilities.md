# 7. Board token for the API, scoped capabilities for agents

Status: accepted

## Context
A probe showed a sandboxed agent could call Temper's API on localhost. With no authentication it
could have approved its own merge, edited the Verifier, or read holdout detail from artifacts.

## Decision
- Every `/api` route except `/api/health` requires the board token: an HttpOnly, same-site cookie
  set by `/auth?token=…` (opened by `temper open`), or a bearer token for the CLI. The token is a
  0600 file in `~/.temper/secrets`. Requests with a non-local Host are refused.
- Every agent run is denied `~/.temper/secrets`, the instance databases and backups.
- Agents reach Temper only through `/api/agent/*` with a capability scoped to one run's role,
  environment and project, revoked when the run ends. Workers can read knowledge; only the Chief
  of Staff can write knowledge and create tickets.
- Apps under test run with their own throwaway token, passed to holdouts.

## Verification
`temper probe-isolation` plants random canaries (never the real token) in the holdouts and secrets
directories, has a Builder-configured run try eight read routes on each, and checks the board API
refuses it. A run with too few attempts reports INCONCLUSIVE rather than passing.

## Consequences
The UI needs a one-time sign-in per browser. Agent tooling must go through capabilities, which keeps
what each role can do explicit and auditable.
