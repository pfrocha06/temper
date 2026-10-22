# Notifications and the Chief's daily briefing

## Why
The factory blocks on the board, but the board only finds out by looking. This was agreed in the
original design (in-app inbox + macOS notifications) and never built.

## Behaviour
1. **macOS notifications** when an approval is requested (merge, escalation, decision, agent or
   skill change) and when the temperature regime rises. Clicking opens the console at that item.
   Implemented server-side (e.g. `osascript`/`terminal-notifier`), behind a profile setting, with
   quiet hours.
2. **Phone push (optional)** via an ntfy or Pushover topic configured in the profile; messages
   contain titles only, never code, diffs or secrets.
3. **Daily briefing**: at a configured time the Chief of Staff writes a short briefing — what
   shipped, what is stuck and why, what it plans next, temperature trend, notable knowledge
   changes — saved as a Chief conversation message and sent as a notification.

## Acceptance criteria
- AC-1: A new approval produces exactly one notification (none during quiet hours; they are batched after).
- AC-2: Notification content never includes diffs, code or environment values.
- AC-3: The briefing appears in a Chief conversation at the configured time and links to the tickets it mentions.

## Where
`apps/server/src/notify.ts` (new), `apps/server/src/profile.ts`, `apps/server/src/factory.ts`
(hooks on approval/regime events), scheduler for the briefing, `apps/web` settings.
