# Second agent vendor behind the adapter

## Why
All roles run on one vendor, so their blind spots are correlated (flagged in ADR 6). A different
vendor for the Verifier and Reviewer strengthens separation of powers.

## Behaviour
- A `codex-cli` adapter implementing `AgentAdapter` with the same isolation guarantees as
  `claude-cli`: no user config, explicit skills and MCP servers, sandboxed, denied directories.
- Profiles record which account each adapter uses; Temper refuses to dispatch to an adapter whose
  account is not allowed for the project's profile (e.g. no personal accounts on work repos).
- `probe-isolation` runs against every installed adapter.

## Acceptance criteria
- AC-1: The isolation probe passes for the new adapter.
- AC-2: A dispatch to an adapter not allowed for the profile is refused and audited.
- AC-3: The Thermostat no longer flags single-vendor when Verifier and Builder use different vendors.

## Note
Only add a vendor through an account approved for the code it will see.
