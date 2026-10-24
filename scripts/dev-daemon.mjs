#!/usr/bin/env node
// Runs the Go dev daemon on 127.0.0.1:6778 with this checkout's dev home.
//
// Same contract as the Node dev daemon it replaces: BYSPACE_SERVICE_DAEMON_PORT wins when BySpace
// runs it as a workspace service, otherwise BYSPACE_LISTEN defaults to the dev port. The daemon
// serves the web UI embedded in the binary, so `make build` (binary only) is the default; set
// BYSPACE_DEV_BUILD_WEB_UI=1 to re-export the app first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDevBySpaceHome, runDevChild } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const binary = resolve(rootDir, "bin", process.platform === "win32" ? "byspace.exe" : "byspace");

if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `0.0.0.0:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();
process.env.BYSPACE_CORS_ORIGINS = process.env.BYSPACE_CORS_ORIGINS || "*";

// Local speech models live outside the home so a worktree reset does not re-download them.
const localModelsDir =
  process.env.BYSPACE_LOCAL_MODELS_DIR || join(homedir(), ".byspace/models/local-speech");
process.env.BYSPACE_LOCAL_MODELS_DIR = localModelsDir;
mkdirSync(localModelsDir, { recursive: true });

// A workspace service is built during worktree setup, so only rebuild when asked.
const skipBuild =
  process.env.BYSPACE_SKIP_DEV_SERVER_BUILD === "1" ||
  (process.env.BYSPACE_SERVICE_DAEMON_PORT !== undefined &&
    process.env.BYSPACE_SKIP_DEV_SERVER_BUILD !== "0");

if (!skipBuild) {
  const target = process.env.BYSPACE_DEV_BUILD_WEB_UI === "1" ? "build-full" : "build";
  execFileSync("make", [target], { cwd: rootDir, stdio: "inherit" });
}

if (!existsSync(binary)) {
  process.stderr.write(`${binary} is missing. Run \`make build\` in ${rootDir}.\n`);
  process.exit(1);
}

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace Dev Daemon (Go)");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log(`  Models:  ${localModelsDir}`);
console.log(`  Listen:  ${process.env.BYSPACE_LISTEN}`);
console.log(`  Binary:  ${binary}`);
console.log("══════════════════════════════════════════════════════");

await runDevChild(binary, ["serve"], { cwd: rootDir, env: process.env });
