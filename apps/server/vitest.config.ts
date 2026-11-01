import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test opens an embedded Postgres and runs every migration; on a loaded CI runner
    // (or Windows) that can take longer than the 10s default.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
