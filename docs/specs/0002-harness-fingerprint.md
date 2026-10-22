# Harness fingerprint on every run

## Why
The harness — everything around the model — changes over time: agent versions, skill commits,
workflow files, knowledge, model, CLI version. Today a dispatch records only its agent version,
so we cannot tell which setup produced which outcome. Every later improvement (trials, replay,
self-improvement, catch rates) compares outcomes across harness versions and needs this.

## Behaviour
- Each agent dispatch stores a **harness fingerprint**: agent id@version, model actually used
  (from the CLI `init` event), adapter id + CLI version, the commit of each skill it received
  (from `skills/registry.json`), the hash of its workflow file, the ids of knowledge entries in its
  prompt, the MCP servers it had, and the temperature snapshot id.
- A short **fingerprint hash** (stable over the same inputs) is stored alongside, so runs can be
  grouped by identical harness.
- Gate dispatches store the gate checks and the project's test/app/holdouts commands' hash.
- The ticket page and Live runs show the fingerprint (collapsed) and highlight when two attempts
  of the same stage ran on different harnesses.
- `GET /api/dispatches/:id` returns it; `GET /api/harness/:hash/dispatches` lists runs on one harness.

## Acceptance criteria
- AC-1: A new agent dispatch has a fingerprint containing every field above; the model is the one the CLI reported, not the configured alias.
- AC-2: Two dispatches with identical inputs have the same fingerprint hash; changing any one input (e.g. a skill commit) changes it.
- AC-3: Fingerprints never contain secrets or environment values (only names, ids, hashes).
- AC-4: The ticket page shows when attempts of one stage ran on different harnesses.

## Where
`packages/core/src/db/schema.ts` (new `harness` jsonb + `harness_hash` on `dispatches`, migration),
`packages/core/src/dispatches.ts`, `apps/server/src/factory.ts` (`runAgentStage`, `runGateStage`,
`digestTicket`), `apps/server/src/api.ts`, `apps/web/src/features/{ticket,runs}`.

## Out of scope
Comparing outcomes between harnesses (that is the trials engine, 0005).
