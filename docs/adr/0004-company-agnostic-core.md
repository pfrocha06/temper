# 4. Company-agnostic core, company specifics as profile plugins

Status: accepted

## Context
Temper runs both on a work machine and a personal machine.

## Decision
The repository knows nothing about any company. Company-specific trackers, SSO, internal
MCP servers, skills and vendor restrictions are profile plugins kept in local config.
`pnpm check:agnostic` fails on known company terms; extra private patterns are read from
`~/.temper/agnostic-denylist.txt`, which is never committed.

## Consequences
One codebase serves both installs. Integrations must be built as plugins against stable
interfaces from the start.
