# 3. PGlite as the embedded database

Status: accepted

## Context
Temper must run with nothing installed but Node. We want Postgres semantics (JSONB, triggers
for the append-only audit log) without operating a server.

## Decision
Use PGlite (Postgres compiled to WASM, in-process) with Drizzle. Data lives under
`~/.temper/<instance>/db`. Tests use in-memory PGlite.

## Consequences
Zero setup, fast isolated tests, real Postgres SQL. Single-process access only, which suits
a single-user local service. If multi-process access is ever needed, Drizzle lets us move to
a real Postgres without rewriting queries.
