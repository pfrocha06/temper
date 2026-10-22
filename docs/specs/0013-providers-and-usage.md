# Providers settings: usage, subscription limits, caps, logos

## Behaviour
- **Settings → Providers** lists every agent provider (Claude Code now; Codex, Gemini, OpenCode
  later) with its logo, install/version, login (`claude auth status`: method, account, org,
  subscription type), models seen, and which roles use it.
- **Usage**: every agent run (stages, digests, Chief conversations, trials) records the
  provider's usage report (tokens per model, API time) and every rate-limit event the CLI emits
  (limit type, status, reset time, overage). The page shows runs and tokens today, in the current
  session window and this week, plus the latest status per limit type with its reset time.
- **Caps** per provider: runs or tokens per day, per session window and per week. When a cap is
  hit, new dispatches for that provider wait, an Inbox notice explains which cap and when it
  resets, and the scheduler resumes automatically. Rate-limit events from the CLI pause the
  provider until the reported reset time.
- **Logos** wherever a run appears (run lists, pipeline, agents, chats).

## Acceptance criteria
- AC-1: A finished run stores its usage (tokens per model) and any rate-limit events.
- AC-2: The Providers page shows login, subscription type and usage per window for Claude Code.
- AC-3: Hitting a configured cap stops new dispatches for that provider and creates one Inbox notice; work resumes after the window resets.
- AC-4: Limit types the CLI reports are shown as reported; nothing assumes a specific subscription plan.
