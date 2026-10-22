# 6. Single-vendor v0 behind an adapter interface

Status: accepted

## Context
Separation of powers is strongest with different vendors per role, but v0 runs only the
`claude` CLI on a subscription.

## Decision
All roles use the `claude-cli` adapter in v0. Separation is achieved by fresh sessions,
per-role skills and config, per-role working directories, physical holdout isolation and,
where possible, different models per role. The adapter interface keeps Codex / Gemini /
OpenCode drop-in.

## Consequences
Correlated blind spots across roles are a known weakness; the Thermostat surfaces it until a
second vendor is configured.
