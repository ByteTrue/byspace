#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { configureDevBySpaceHome } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

// Prepend node_modules/.bin to PATH
const binDir = join(rootDir, "node_modules/.bin");
if (process.env.PATH && !process.env.PATH.includes(binDir)) {
  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
}

// In a BySpace worktree service, BYSPACE_PORT is set by the service runner.
if (process.env.BYSPACE_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `0.0.0.0:${process.env.BYSPACE_PORT}`;
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
  (process.env.BYSPACE_PORT !== undefined && process.env.BYSPACE_SKIP_DEV_SERVER_BUILD !== "0");

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

const child = spawn("npm", ["run", "dev:server:watch"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
