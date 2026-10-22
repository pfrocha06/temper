# Trials engine

## Why
Three upcoming features need the same machinery: run a stage (or a whole ticket) again in an
isolated worktree under a controlled variation, and measure the outcome with the real gates and
holdouts. Planted-defect trials vary the *code*; harness improvement varies the *harness*;
the replay benchmark varies both against history.

## Behaviour
- A **trial** = (base: ticket + commit, variation, stages to run, budget). Variations: a code
  patch (defect), a harness override (agent instructions, skill set, workflow file, model), or none.
- Trials run in their own worktrees under `~/.temper/trials/`, never touch the ticket's
  worktree, branch, PR, holdouts history or the board inbox, and never push.
- Results are stored per trial: verdict per stage, gate results, holdout results per criterion,
  duration, harness fingerprint (0002), cost signals.
- Trials share the scheduler's capacity and rate-limit handling but run at lower priority than
  real work, with a separate per-day budget (number of agent runs).
- API + a "Trials" view list trials and compare results side by side.

## Acceptance criteria
- AC-1: A trial with no variation of a done ticket reproduces its gate and holdout results.
- AC-2: Trials never create approvals, PRs, pushes or ticket status changes; they use only their own worktrees.
- AC-3: Trial runs never exceed the daily trial budget and yield to real work.
- AC-4: Two trials of the same ticket can be compared criterion by criterion.

## Where
`packages/core` (trials tables + service), `apps/server/src/trials.ts` (new, reuses
`runAgentStage`/`runChecks` with overrides), `apps/server/src/factory.ts` (capacity sharing), `apps/web`.
