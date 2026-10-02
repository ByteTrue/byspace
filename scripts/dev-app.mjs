#!/usr/bin/env node
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configureDevBySpaceHome,
  prependNodeModulesBin,
  resolveDevDaemonEndpoint,
  runDevChild,
} from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

prependNodeModulesBin(rootDir);

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

// BYSPACE_LISTEN already carries the daemon peer's address in a service, and
// resolveDevDaemonEndpoint maps its wildcard host to localhost.
const daemonEndpoint = resolveDevDaemonEndpoint(process.env.BYSPACE_LISTEN);

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

runDevChild("npm", ["run", "start:expo", "--workspace=@bytetrue/app", "--", "--port", expoPort], {
  cwd: rootDir,
  env,
});
