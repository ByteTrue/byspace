#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { configureDevBySpaceHome, prependNodeModulesBin, runDevChild } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

prependNodeModulesBin(rootDir);

// In a BySpace worktree service, the runner injects BYSPACE_SERVICE_<NAME>_PORT for every peer,
// including this daemon, so that is the port to bind.
if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `0.0.0.0:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();

const localModelsDir =
  process.env.BYSPACE_LOCAL_MODELS_DIR || join(homedir(), ".byspace/models/local-speech");
process.env.BYSPACE_LOCAL_MODELS_DIR = localModelsDir;
mkdirSync(localModelsDir, { recursive: true });

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace Dev Daemon");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log(`  Models:  ${localModelsDir}`);
console.log(`  Listen:  ${process.env.BYSPACE_LISTEN}`);
console.log("══════════════════════════════════════════════════════");

process.env.BYSPACE_CORS_ORIGINS = process.env.BYSPACE_CORS_ORIGINS || "*";
process.env.BYSPACE_NODE_INSPECT = process.env.BYSPACE_NODE_INSPECT || "--inspect=0";

// When spawned as a BySpace service, setup already built server deps.
const skipBuild =
  process.env.BYSPACE_SKIP_DEV_SERVER_BUILD === "1" ||
  (process.env.BYSPACE_SERVICE_DAEMON_PORT !== undefined &&
    process.env.BYSPACE_SKIP_DEV_SERVER_BUILD !== "0");

if (!skipBuild) {
  const build = spawn.sync("npm", ["run", "build:server-deps"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

await runDevChild("npm", ["run", "dev:server:watch"], { cwd: rootDir, env: process.env });
