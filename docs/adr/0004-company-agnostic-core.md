# 4. Company-agnostic core, company specifics as profile plugins

Status: accepted

## Context
People run Temper with different trackers, SSO, internal tools and vendor rules.

## Decision
The repository knows nothing about any company. Company-specific trackers, SSO, internal
MCP servers, skills and vendor restrictions are profile plugins kept in local config.

## Consequences
One codebase serves every install. Integrations must be built as plugins against stable
interfaces from the start.
