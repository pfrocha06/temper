# Holdouts

The hidden behaviour checks for one project. Temper's Builder never reads this folder; the
Verifier writes checks here, and the server runs them against the Builder's running app.
Temper commits every change here and rejects ones that weaken or remove a check.

- `baseline/`: checks every version of the app must pass.
- `tickets/<ticket-id>/`: checks the Verifier writes for one ticket from its acceptance criteria.
  Once that ticket merges they keep running as regression checks.
- `lib/`: helpers. `check.mjs` (named checks), `http.mjs` (API calls), `candidate.mjs` (the
  candidate's files), `browser.mjs` (Playwright, optional).
- `run.mjs`: runs everything and prints one `AC-<id>: PASS|FAIL <message>` line per check.

## Adding checks

1. **Write acceptance criteria** in the ticket or spec (`AC-1: …`). The Verifier turns them
   into checks under `tickets/`.
2. **Ask for a verification ticket** for checks that belong to no single feature. The Verifier
   writes them, the Reviewer reviews them, and you approve them.
3. **Write one yourself.** Add `baseline/<name>.holdout.mjs`, then commit it here:

   ```js
   import { assert, suite } from "../lib/check.mjs";
   import { get } from "../lib/http.mjs";

   export default suite(async (check, { url, candidatePath }) => {
     await check("health", async () => {
       const { status, body } = await get(url, "/api/health");
       assert(status === 200, `status ${status}`);
       assert(body?.ok, "health does not report ok");
     });
   });
   ```

   `url` is the candidate app; `candidatePath` is its checkout (read-only).

Try them by hand: `TEMPER_APP_URL=http://127.0.0.1:3000 node run.mjs`.
