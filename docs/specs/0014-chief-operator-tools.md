# Chief of Staff operator tools

## Behaviour
The Chief gains MCP tools to operate the harness for the board: start, cancel and retry tickets;
pause and resume the factory; register projects and environments; trigger a knowledge digest; run
the isolation probe; request a deploy. Board decisions (merge approvals, accepting stuck tickets,
Verifier/holdout changes, skill adoption, deploys, autonomy promotions) are only **proposed**: the
Chief creates a proposal that appears in the conversation as a Confirm button and in the Inbox; it
can never resolve one itself. Every operator action is audited with the conversation as source.

## Acceptance criteria
- AC-1: The Chief can start, cancel and retry tickets and pause/resume the factory from a conversation.
- AC-2: A request to merge or deploy produces a proposal the board confirms with one click; the Chief's capability cannot resolve approvals.
- AC-3: Operator actions appear in the audit log with the chat id.
