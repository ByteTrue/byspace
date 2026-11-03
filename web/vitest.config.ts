import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_TESTS = "src/**/*.browser.{test,spec}.{ts,tsx}";

// The app's own resolution (src/core under `@/`), so a test loads what the build loads.
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    define: {
      __DEV__: "false",
      global: "globalThis",
    },
    resolve: {
      alias: [
        // The ligatures addon reads Node's diagnostics_channel at import time, which a test browser
        // does not have; nothing under test draws ligatures.
        {
          find: /^@xterm\/addon-ligatures(\/lib\/addon-ligatures\.mjs)?$/,
          replacement: path.join(webRoot, "test-stubs/xterm-addon-ligatures.ts"),
        },
        // CI builds only the app's dependencies (`build:app-deps`) before these tests, not the relay
        // package that @bytetrue/client imports, so it is read from source.
        {
          find: /^@bytetrue\/relay\/e2ee$/,
          replacement: path.resolve(webRoot, "../packages/relay/src/e2ee.ts"),
        },
        {
          find: /^@bytetrue\/relay$/,
          replacement: path.resolve(webRoot, "../packages/relay/src/index.ts"),
        },
      ],
    },
    test: {
      maxWorkers: 2,
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["src/**/*.{test,spec}.{ts,tsx}"],
            exclude: [...configDefaults.exclude, BROWSER_TESTS],
            setupFiles: [path.join(webRoot, "vitest.setup.ts")],
          },
        },
        {
          extends: true,
          test: {
            name: "browser",
            include: [BROWSER_TESTS],
            fileParallelism: false,
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              connectTimeout: 180_000,
              instances: [{ browser: "chromium" }],
              screenshotDirectory: ".vitest-screenshots",
            },
            globalSetup: path.join(webRoot, "src/core/runtime/websocket-test-global-setup.ts"),
          },
        },
      ],
    },
  }),
);
