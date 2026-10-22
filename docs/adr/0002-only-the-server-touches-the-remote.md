# 2. Only the server touches the remote

Status: accepted

## Context
If agents can push, open PRs or merge, any gate can be bypassed by an agent that decides to.

## Decision
Agents commit locally inside their worktree and hold no git-host credentials. The server
pushes, opens PRs, labels and merges through one audited code path, after gates pass.

## Consequences
Gates are enforceable rather than advisory. Agent failure modes around the remote are
eliminated. The server's git service becomes security-critical and is reviewed as such.
