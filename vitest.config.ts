import fs from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const appDir = path.resolve(__dirname, "packages/app");
const appNodeModules = path.resolve(appDir, "node_modules");
const rootNodeModules = path.resolve(__dirname, "node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

export default defineConfig({
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@bytetrue\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "packages/relay/src/e2ee.ts"),
      },
      {
        find: /^@bytetrue\/relay$/,
        replacement: path.resolve(__dirname, "packages/relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(appDir, "src") },
      { find: "@server", replacement: path.resolve(__dirname, "packages/server/src") },
      {
        find: "react-native",
        replacement: path.resolve(rootNodeModules, "react-native-web/dist/index.js"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      { find: "react-dom", replacement: resolvePackageEntry("react-dom") },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
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
    // - packages/cli/tests holds `npx tsx` standalone scripts, not Vitest tests.
    //   They run real `byspace` commands at module top level, so merely importing
    //   them starts and stops a live daemon -- and from the repo root that is the
    //   developer's own one on 6777. `npx vitest list` is enough to trigger it,
    //   because listing imports the modules too. The CLI runs them through
    //   tests/run-all.ts; Vitest never should.
    // - scripts/*.test.mjs are `node --test` files (run by the CI contract step),
    //   and importing one executes its assertions immediately.
    // - app e2e/perf are Playwright specs, and browser tests need the app
    //   package's own browser project. Nothing here can execute them.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/.dev/**",
      "packages/cli/tests/**",
      "scripts/**/*.test.mjs",
      "packages/app/e2e/**",
      "packages/app/perf/**",
      "**/*.browser.{test,spec}.{ts,tsx}",
    ],
  },
});
