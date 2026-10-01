#!/usr/bin/env node
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { configureDevBySpaceHome, resolveDevDaemonEndpoint } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

// Prepend node_modules/.bin to PATH
const binDir = join(rootDir, "node_modules/.bin");
if (process.env.PATH && !process.env.PATH.includes(binDir)) {
  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
}

// In a BySpace worktree service, BYSPACE_SERVICE_DAEMON_PORT is the port of the daemon peer service.
if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `0.0.0.0:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();

// In a BySpace worktree service, BYSPACE_PORT is the port allocated for this service (app).
const expoPort = process.env.EXPO_PORT || process.env.BYSPACE_PORT || "8081";

const daemonEndpoint =
  process.env.BYSPACE_DEV_DAEMON_ENDPOINT ||
  (process.env.BYSPACE_SERVICE_DAEMON_PORT
    ? `localhost:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`
    : resolveDevDaemonEndpoint(process.env.BYSPACE_LISTEN));

let devBuildLabel = "";
try {
  devBuildLabel = execSync("git branch --show-current", {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {}

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace App Dev");
console.log("══════════════════════════════════════════════════════");
console.log(`  Metro:   http://localhost:${expoPort}`);
console.log(`  Daemon:  ${daemonEndpoint}`);
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log("══════════════════════════════════════════════════════");

const env = {
  ...process.env,
  BROWSER: process.env.BROWSER || "none",
  APP_VARIANT: "development",
  EXPO_PUBLIC_BYSPACE_DEV_BUILD_LABEL: devBuildLabel,
  EXPO_PUBLIC_LOCAL_DAEMON: daemonEndpoint,
};

const child = spawn(
  "npm",
  ["run", "start:expo", "--workspace=@bytetrue/app", "--", "--port", expoPort],
  {
    cwd: rootDir,
    stdio: "inherit",
    env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
