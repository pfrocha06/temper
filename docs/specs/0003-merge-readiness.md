# Merge readiness

## Why
The first real PRs showed the board being asked to merge before GitHub CI finished, with no way
to try the change and no visual evidence, and nothing refreshes a PR when `main` moves.

## Behaviour
1. **Wait for CI.** The `pr` gate waits for the PR's required checks (via the GitHub plugin)
   before requesting the merge approval. A failing check routes back to the Builder with the
   failing job's log tail as feedback. A configurable timeout escalates.
2. **Preview.** When the merge approval is requested, the server boots the candidate app
   (`appCommand`) on a free port and keeps it running until the approval is resolved. The Inbox
   card and the ticket banner show "Open preview". Previews are stopped on resolve, cancel or
   server shutdown; at most N run at once.
3. **Screenshots.** For tickets whose file scope touches UI paths, the Verifier (or a gate step)
   captures before/after screenshots of the affected screens with Playwright (base = main
   release, after = candidate) and attaches them to the PR body and the ticket artifacts.
4. **Auto-rebase.** When `main` moves while a ticket waits for merge, the server rebases the
   ticket branch in its worktree. A clean rebase re-runs the gates (not the agents); a conflict
   routes the ticket back to the Builder with the conflict as feedback.

## Acceptance criteria
- AC-1: No merge approval is created while required CI checks are pending; a failed check sends the ticket back to build with the job log tail.
- AC-2: The merge approval carries a working preview URL that stops serving after the approval is resolved.
- AC-3: A UI ticket's PR body includes before/after screenshots.
- AC-4: A ticket waiting for merge is rebased automatically when main moves; gates re-run; conflicts go back to the Builder.

## Where
`plugins/github/src/index.ts` (checks API, rebase helpers), `apps/server/src/factory.ts`
(`runPrGate`), `apps/server/src/app-runner.ts`, holdouts `lib/browser.mjs` (screenshots),
`apps/web/src/features/{inbox,ticket}`.

## Out of scope
Merge queues and stacked PRs.
