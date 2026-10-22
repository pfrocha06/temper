# Health endpoint

Temper needs a cheap, unauthenticated way for releases, launchd checks and humans to see
which build is running and whether it is healthy.

## Behaviour

- `GET /api/health` returns `200` with JSON `{ ok: true, version, instance, uptimeSeconds }`.
- `version` is the short git commit of the code the server was started from, or `"unknown"`
  when it is not running from a git checkout.
- `instance` is the configured instance name (`main`, `rc`, …).
- `uptimeSeconds` is a non-negative integer that increases while the server runs.
- The endpoint must not touch the database, so it stays fast and answers even if the database
  is slow.
- The deploy health check (`waitHealthy`) uses `/api/health` instead of `/api/status`.

## Out of scope

Authentication, readiness of agent adapters, UI changes.
