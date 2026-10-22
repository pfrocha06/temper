# Glossary

Shared vocabulary for humans and agents working on Temper. Use these words exactly.

- **Board** — the human. Approves what the factory may not decide alone.
- **Profile** — one identity's bundle of adapters, accounts, git host, trackers, repos and plugins.
- **Project** — one target repository Temper works on.
- **Area** — a path-scoped region of a project; autonomy is granted per area.
- **Ticket** — a unit of work with a type, a spec excerpt, acceptance criteria and a file scope.
- **Ticket type** — feature, bugfix, refactor, investigation, prototype, perf, chore, skill, verification.
- **Workflow** — the stage DAG a ticket type runs through, defined in `workflows/<type>.yaml`.
- **Stage** — one step of a workflow, executed by one agent role, ending in one verdict.
- **Verdict** — `PASS`, `FAIL` or `BLOCKED`, emitted as the last `VERDICT:` line of a stage.
- **Dispatch** — one attempt at one stage of one ticket. Retries are new dispatches.
- **Artifact** — a named document a stage writes (`spec.md`, `changes.md`, `review.md`, …).
- **Agent** — a versioned definition of a role: adapter, model, skills, permissions, limits.
- **Adapter** — the bridge to an agent CLI (`claude-cli` first).
- **Heartbeat** — the scheduler tick: reconcile, then dispatch.
- **Holdout** — a behaviour test written by the Verifier that the Builder can never read.
- **Gate** — a hard check the server enforces before a transition (tests, holdouts, secret scan…).
- **Audit event** — an append-only record of something that happened. Never updated or deleted.
- **Temperature** — a 0–1 health signal from audit events; maps to a regime.
- **Regime** — Cool, Warm, Hot or Fever: the policy the scheduler and gates apply.
- **Autonomy level** — per area: 0 human merges; 1 human merges with lighter review; 2+ merge-then-verify.
- **Planted defect** — a known bug sent through verifiers to measure their catch rate.
- **Release** — a pinned build of Temper the service runs; RC is a candidate on the RC port.
