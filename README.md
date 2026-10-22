# Temper

A local, always-on autonomous software factory. Agents build and maintain software;
you set direction and grant autonomy. Trust is measured, not assumed.

- Design: [docs/design.md](docs/design.md)
- Glossary: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr](docs/adr)

## Develop

```sh
pnpm install
pnpm check                 # agnostic check + typecheck + tests
pnpm dev                   # dev instance: server on :4610 + web on :5173 (separate data from the service)
```

Requires Node ≥ 22, pnpm, git, the `gh` CLI and the `claude` CLI (logged in). On Linux the gate
sandbox also needs `bubblewrap`, `socat` and `ripgrep`. `TEMPER_GATE_SANDBOX=off` runs gate commands
unsandboxed, for development on platforms the sandbox does not support only.

## Run it as a service

```sh
# 1. Profile: which git host account the server acts as (never committed)
cat > ~/.temper/profile.json <<'JSON'
{ "name": "work", "github": { "user": "<your-gh-user>" }, "adapters": ["claude-cli"], "plugins": ["github"] }
JSON

# 2. Build, verify and start a release (launchd, UI on http://127.0.0.1:4600),
#    then sign in as the board (the API requires the board token; agents never see it)
node apps/server/src/cli.ts deploy --ref main
node apps/server/src/cli.ts open

# 3. Prove agents, and the gate commands that run their code, cannot read your holdouts
#    before trusting the factory
node apps/server/src/cli.ts probe-isolation --holdouts <holdouts-checkout>

# 4. Register a project (Temper itself is the first one)
node apps/server/src/cli.ts project add --name temper --repo . \
  --remote https://github.com/<owner>/temper.git \
  --holdouts <holdouts-checkout> \
  --test "pnpm install --frozen-lockfile --prefer-offline && pnpm check" \
  --setup "pnpm install --frozen-lockfile --prefer-offline" \
  --app 'pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @temper/web build && TEMPER_HOME=$(mktemp -d) TEMPER_HEARTBEAT_MS=3600000 node apps/server/src/main.ts' \
  --holdouts-setup "pnpm install --frozen-lockfile --prefer-offline" \
  --health /api/status \
  --holdouts-cmd "node run.mjs"

# 5. Hand it work
node apps/server/src/cli.ts import-spec --project <id> --file spec.md --start
```

`temper rollback` returns to the previous release; `temper pause` stops new dispatches.
