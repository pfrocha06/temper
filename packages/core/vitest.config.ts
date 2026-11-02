import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test opens an embedded Postgres and runs every migration. While `pnpm -r test` runs
    // every package at once (as `temper deploy` does), that can take longer than the 10s default.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // One worker per core (vitest's default) starts that many embedded Postgres instances at
    // once; on a 16-core machine that pushed the load past 50 and timed tests out. Four is
    // faster there, and no fewer than a CI runner gets by default.
    maxWorkers: 4,
  },
});
