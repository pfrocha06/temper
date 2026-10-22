# 1. Holdouts live in a separate repository

Status: accepted

## Context
Holdout tests only measure anything if the Builder cannot read them. A git worktree shares
the full object store, so tests in the same repo are readable through `git show` / `git log -p`
even when sparse-checked-out, and they appear in PR diffs.

## Decision
Holdouts live in a separate private repository per project, configured in the profile.
Only the server and the Verifier's sandbox can read it. Builders receive failing
acceptance-criterion IDs and one-line messages, never test source.

## Consequences
Physical isolation; nothing leaks by accident. Cost: a second repo per project and no
single PR carrying code + holdouts. Encrypted-in-repo (git-crypt/sops) remains a contained
future migration if the split proves annoying.

## Verification
`temper probe-isolation --holdouts <path>` plants a random canary in the holdouts directory and
has a Builder-configured run try eight ways to read it (Read, Grep, Glob, cat, node, python,
copy-then-read, symlink-then-read). The first run found a real leak: permission rules with a
single leading `/` are relative, so the Read tool was not denied. Absolute rules use `//`, and
the sandbox disallows unsandboxed commands. Re-run the probe after any adapter or CLI upgrade.
