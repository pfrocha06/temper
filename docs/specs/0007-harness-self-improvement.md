# Harness self-improvement loop

Inspired by Harness² (google-research/harness2): treat the harness as editable and improve it by
proposing edits, probing them on the same task, and composing what worked. Temper's advantage is
ground truth: gates and holdouts measure "better" instead of an LLM judge.

## Editable harness components
Agent instructions (system prompt), skills (vendored + local), workflow files (stages and
instructions), guardrails (gates, diff guard rules, tool permissions), knowledge entries, MCP
servers per role, model per role.

## Behaviour
1. **Trigger.** A stage that fails or escalates repeatedly (configurable, e.g. 2 tickets in 7 days
   with the same failure class), or the Chief's retro on a finished epic, or the board's request.
2. **Propose.** The Chief of Staff reads the failing runs, existing harness lessons and the
   current harness, and proposes K small edits, each with a hypothesis.
3. **Probe.** For each edit, the trials engine (0005) re-runs the failing stage on the same
   ticket base in parallel worktrees (parallel mode) or applies edits one after another
   (sequential mode), within a probe budget K set in the profile.
4. **Compose.** The Chief compares outcomes (verdicts, gate and holdout results, durations) and
   composes the edits that helped into one harness change.
5. **Replay benchmark.** Before adoption, the composed change is replayed on a fixed set of past
   tickets (a growing benchmark, including escaped bugs) and must not regress any of them.
6. **Adopt.** The change arrives as a `skill` ticket or an agent/workflow change PR for the board,
   with the evidence table attached. Verifier-touching changes always need the board.
7. **Harness lessons.** Every probe outcome is recorded as an evidence-backed lesson
   (e.g. "Builder skips commits unless reminded; adding X fixed 3/3 probes — dispatches …"),
   kept separate from project knowledge and curated by the Chief. Lessons inform future proposals.

## Acceptance criteria
- AC-1: A repeated failure triggers a proposal with K candidate edits, each with a hypothesis.
- AC-2: Each candidate is probed on the same ticket base within the budget; results are recorded.
- AC-3: A composed change is replayed on the benchmark and is rejected if any benchmark ticket regresses.
- AC-4: Adoption always goes through a PR or approval with the evidence; nothing changes the live harness silently.
- AC-5: Lessons record their evidence (dispatch ids, before/after outcomes) and are visible on the Knowledge screen under their own kind.

## Where
`apps/server/src/improve.ts` (new), trials engine (0005), harness fingerprint (0002),
`packages/core/src/knowledge.ts` (lesson kind with evidence), Chief prompts in `apps/server/src/prompt.ts`,
`apps/web` (Improvements view).

## Out of scope
Changing model weights; changing holdouts (the Verifier owns them; the board approves).
