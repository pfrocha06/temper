# Security policy

Temper runs AI agents against your repositories and holds credentials for your git host, so its
isolation guarantees are the heart of the project. Reports are very welcome.

## Reporting a vulnerability

**Don't open a public issue.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/pfrocha06/temper/security/advisories/new)
(the repository's **Security** tab, then **Report a vulnerability**).

Include what you found, how to reproduce it, and what an attacker gains. This is a
maintainer-run project: expect an acknowledgement within a week, and a fix or a plan once the
issue is understood. You'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest `main` gets security fixes. There are no versioned releases yet.

## In scope

Anything that breaks the trust model in [docs/design.md](docs/design.md), for example:

- an agent run reading the holdouts repository or Temper's secrets and data (`~/.temper`)
- an agent reaching the network, the board API, or another run's capability
- an agent, or code it wrote, getting the server to push, merge, deploy, or approve on its behalf
- Builder code getting holdout contents back through gate output or feedback
- secrets leaking into the audit log, artifacts, the console or a PR
- bypassing board authentication on the local API (including DNS rebinding)

`node apps/server/src/cli.ts probe-isolation --holdouts <path>` checks the main agent-isolation
guarantees. A way to make it pass while isolation is broken is in scope too.

## Out of scope

- Vulnerabilities in the `claude` CLI, `gh`, or other upstream tools themselves. Please report
  those upstream. How Temper configures or calls them is in scope.
- Attacks that need someone who already has the board token, or local access to the account
  running Temper.
