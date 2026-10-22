# Planted-defect trials and verifier catch rates

## Why
"Trust is measured" is Temper's core claim, and today nothing measures it. The temperature is
built from signals the agents themselves produce. Planted defects are ground truth they cannot game.

## Behaviour
- Nightly (and on demand), sample merged tickets per area and create defect trials (0005):
  1. **mutations** on lines the ticket changed,
  2. **spec reverts**: the ticket's spec with its code reverted,
  3. **escape replays**: the bug-introducing diff of every escaped bug,
  4. **saboteur** (later): an agent writes a plausible wrong implementation from the spec.
- Each defect is presented to every verifier as a normal candidate: builder tests, holdouts,
  Reviewer, interrogate. Clean controls (unmodified merges) measure false positives.
- Per verifier × area, store caught / missed / false positives and a Beta (or Wilson) lower bound.
- Escaped bugs weigh most. A defect nobody catches opens a `verification` ticket for that area.
- The Thermostat shows catch rates per area and verifier, and the temperature uses
  "escape-replay catch rate below target" as an additional signal.

## Acceptance criteria
- AC-1: A planted mutation that breaks an acceptance criterion is caught by holdouts and recorded as caught.
- AC-2: Clean controls are run and false positives are recorded separately.
- AC-3: Catch rates per verifier × area with lower bounds are visible on the Thermostat.
- AC-4: A defect no verifier catches opens a verification ticket automatically.

## Where
`apps/server/src/defects/` (new: mutation, revert, replay generators), trials engine (0005),
`packages/core/src/health.ts`, `apps/web/src/features/thermostat`.
