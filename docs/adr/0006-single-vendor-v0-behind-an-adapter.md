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
Correlated blind spots across roles are a known weakness; the Agents screen flags it while the
Builder and Verifier share a vendor.

## Update
The `codex-cli` adapter ([spec 0011](../specs/0011-second-vendor.md)) is the second vendor. v0's
default stays all-Claude; the board moves the Verifier or Reviewer to Codex per agent.
