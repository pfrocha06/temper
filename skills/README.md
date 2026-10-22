# Skills

- `vendor/` — pinned upstream skills, copied by `pnpm vendor:skills` from the commits in
  `sources.json`. Each owner folder keeps its upstream licence. Do not edit by hand; bump the
  commit in `sources.json` (a chore ticket) and re-run.
- `local/` — skills authored for Temper, by the board directly or by agents through `skill`
  tickets (eval evidence + board approval).
- `registry.json` — generated index the server reads to resolve agent skill names.

Agents only ever see the skills assigned to their role; nothing from a user's own CLI setup.
