# Autonomy levels per area and temperature enforcement

## Behaviour
- Areas are path prefixes per project (configurable; default: top two path segments).
- Autonomy level per area: 0 board merges everything; 1 board merges with lighter review
  (spot-check sampling); 2 merge-then-verify on the release candidate with automatic revert.
- Promotion requires the area's catch-rate lower bound (0006) to clear a target and is approved
  by the board; demotion is automatic on an escaped bug or a regime rise.
- Enforcement mode for the temperature: the scheduler and gates apply `REGIME_POLICIES`
  (file scope cap, concurrency multiplier, autonomous workflows, spot-check rate). The board
  can pin a regime from the Thermostat (audited) and edit signal weights/bands as versioned settings.

## Acceptance criteria
- AC-1: A level-2 area merges after gates and reverts automatically if post-merge verification fails, opening a bug ticket and raising the temperature.
- AC-2: Promotion is impossible without the catch-rate threshold and a board approval.
- AC-3: With enforcement on, a Hot regime halves concurrency and stops unattended workflows.
- AC-4: Pinning a regime is audited and visible on the Thermostat until unpinned.
