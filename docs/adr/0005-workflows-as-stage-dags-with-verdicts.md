# 5. Workflows are YAML stage DAGs routed by verdicts

Status: accepted

## Context
Each ticket type needs its own discipline, and the factory must be able to change its own
process through reviewed changes rather than prompt drift.

## Decision
`workflows/<type>.yaml` declares stages (role, instructions, tool restrictions, loop cap) and
transitions keyed on the stage's final `VERDICT:` line. Workflow files are code: changed by
PR, gated like everything else; changes touching verification need board approval.

## Consequences
Process is versioned, diffable and testable. Natural-language routing is avoided in v0;
verdicts are machine-checkable.
