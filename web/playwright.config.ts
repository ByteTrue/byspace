import { defineConfig, devices } from "@playwright/test";

// E2E_WEB_PORT is set dynamically by global-setup.ts after finding a free port
// This allows multiple test runs in parallel across different worktrees
const baseURL =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_WEB_PORT ?? "8082"}`;
const relayDeploymentSpec = "**/relay-deployment-reconnect.real.spec.ts";
// A locally installed browser (chrome/msedge) lets a single spec run on a machine where
// `playwright install` stalls. CI never sets this: it uses the downloaded build.
const localChannel = process.env.E2E_CHANNEL;

function videoMode(): "on" | "on-first-retry" | "retain-on-failure" | "off" {
  // Recording needs ffmpeg, which a machine that cannot reach the Playwright CDN never got.
  if (process.env.E2E_VIDEO === "off") return "off";
  if (process.env.E2E_RECORD_VIDEO === "1") return "on";
  if (process.env.CI) return "on-first-retry";
  return "retain-on-failure";
}

export default defineConfig({
  testDir: "./e2e/browser",
  globalSetup: "./e2e/support/global-setup.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // Files run concurrently, while each worker owns its daemon state. Keeping a
  // spec on one worker avoids repeating its file-level setup across daemons.
  fullyParallel: false,
  // Two workers per shard in CI. The web harness shares one static server and gives each worker
  // its own daemon; the Expo-era Metro server that made two workers flake on a small runner is
  // gone. Three workers measured no faster (the slowest shard is bound by long tests, not worker
  // count) and used more daemons and browsers, so keep two. E2E_WORKERS overrides it.
  workers: Number(process.env.E2E_WORKERS ?? (process.env.CI ? "2" : "1")),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: videoMode(),
  },
  projects: [
    {
      name: "browser",
      testIgnore: ["**/*.real.spec.ts"],
      use: { ...devices["Desktop Chrome"], ...(localChannel ? { channel: localChannel } : {}) },
    },
    {
      name: "real-provider",
      testMatch: ["**/*.real.spec.ts"],
      testIgnore: [relayDeploymentSpec],
      use: { ...devices["Desktop Chrome"], ...(localChannel ? { channel: localChannel } : {}) },
    },
    {
      name: "relay-deployment",
      testMatch: [relayDeploymentSpec],
      use: { ...devices["Desktop Chrome"], ...(localChannel ? { channel: localChannel } : {}) },
    },
  ],
  // Note: Metro is started by global-setup.ts on a dynamic port to allow parallel test runs
});
