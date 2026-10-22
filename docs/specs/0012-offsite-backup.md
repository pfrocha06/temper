# Off-machine backups

## Behaviour
Nightly encrypted export of the Temper database (and `~/.temper/profile.json` without secrets) to a
configurable destination (a private git repo, a cloud bucket or an external disk), with retention
and a tested restore command (`temper restore <backup>`).

## Acceptance criteria
- AC-1: A restore into a fresh TEMPER_HOME reproduces tickets, audit log, knowledge and agents.
- AC-2: Backups are encrypted at rest and never include the board token or adapter credentials.
