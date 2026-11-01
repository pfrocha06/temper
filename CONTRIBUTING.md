# Contributing to Temper

Thanks for helping. Temper is early, so the most useful contributions are bug reports with a
reproduction, fixes, and work on the items in the [roadmap](docs/roadmap.md).

## Before you start

1. Read [CONTEXT.md](CONTEXT.md). Use its words exactly: ticket, stage, dispatch, verdict, holdout, gate.
2. Skim [docs/design.md](docs/design.md) and the [ADRs](docs/adr).
3. For anything bigger than a small fix, open an issue first so we can agree on the approach.
   Roadmap items have a spec in [docs/specs](docs/specs) that names the files it touches, its
   acceptance criteria and what is out of scope.

## Set up

```sh
pnpm install
pnpm check      # must pass before you open a PR
pnpm dev        # dev instance on :4610 (server) and :5173 (web)
```

You need Node.js ≥ 22, pnpm, git, and for end-to-end runs the `gh` and `claude` CLIs. The test
suite runs on macOS, Linux and Windows. The tests that use the real gate sandbox run on macOS by
default; on Linux and Windows, install the sandbox (see [Platform support](README.md#platform-support))
and set `TEMPER_TEST_SRT=1`.

## How we work

- **Test first.** Write a failing test for the behaviour, then the code. Tests describe
  behaviour, not implementation.
- **Never weaken a test to make work pass.** Don't delete assertions or add `.skip` / `.only`.
  Temper's own diff guard rejects these in agent work, and reviewers do the same for humans.
- **Keep the core company-agnostic.** No employer, customer or internal-tool names in the
  repository. Company-specific integrations belong in a local profile plugin.
  `pnpm check:agnostic` enforces it; put your own private patterns in
  `~/.temper/agnostic-denylist.txt`, which is never committed.
- **Record decisions.** A change to the architecture or to a trade-off an ADR made comes with a
  new or updated ADR in `docs/adr/`.
- **Update the roadmap** status when you finish a roadmap item.

## Changes that need extra care

These protect the separation of powers, so the maintainer reviews them closely:

- the agent adapter, sandbox settings, or anything that decides what an agent can read or reach.
  Re-run `node apps/server/src/cli.ts probe-isolation --holdouts <holdouts-checkout>` and say so in the PR.
- the Verifier, holdouts handling, the gates, the diff guard, and workflows that touch verification
- board authentication and agent capabilities

## Pull requests

- Keep each PR to one change. Small PRs get reviewed faster.
- Write commit subjects in the imperative, describing the behaviour ("Probe isolation with
  canaries only"), with the why in the body.
- Fill in the PR template: what changed, why, and how you verified it.
- CI runs `pnpm check` on every PR.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE),
the same licence as the project.
