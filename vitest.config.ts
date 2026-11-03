import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@bytetrue\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "packages/relay/src/e2ee.ts"),
      },
      {
        find: /^@bytetrue\/relay$/,
        replacement: path.resolve(__dirname, "packages/relay/src/index.ts"),
      },
    ],
  },
  test: {
    // Fake-timer suites freeze p-throttle's clock, so a real per-second cap deadlocks them.
    env: {
      BYSPACE_GIT_MAX_PROCESSES_PER_SECOND: "10000",
    },
    // This file is shared by the packages with no config of their own (protocol,
    // client, highlight, relay) and by single-file runs from the repo root, so
    // when it is used the root *is* the repo root and everything below matches.
    // Keep out the trees that must never be collected as tests from here:
    //
    // - scripts/*.test.mjs are `node --test` files (run by the CI contract step),
    //   and importing one executes its assertions immediately.
    // - web/ has its own config (its `@/` paths, shims and browser project); run its
    //   tests from web/. Its e2e and perf trees are Playwright specs.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/.dev/**",
      "scripts/**/*.test.mjs",
      "web/**",
      "**/*.browser.{test,spec}.{ts,tsx}",
    ],
  },
});
