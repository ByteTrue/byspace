#!/usr/bin/env node
// Runs the Wails v3 desktop client in dev mode against this checkout's .dev/byspace-home
// on 127.0.0.1:6778 (attaching to an existing dev daemon on 6778 or starting it in-process).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDevBySpaceHome, runDevChild } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const binary = resolve(
  rootDir,
  "bin",
  process.platform === "win32" ? "byspace-app.exe" : "byspace-app",
);

if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `127.0.0.1:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();
process.env.BYSPACE_CORS_ORIGINS = process.env.BYSPACE_CORS_ORIGINS || "*";
process.env.BYSPACE_NODE_ENV = process.env.BYSPACE_NODE_ENV || "development";

const skipBuild = process.env.BYSPACE_SKIP_DEV_DESKTOP_BUILD === "1";
if (!skipBuild) {
  if (process.env.BYSPACE_SKIP_DEV_WEB_BUILD !== "1") {
    execFileSync("make", ["build-web"], { cwd: rootDir, stdio: "inherit" });
  }
  execFileSync("make", ["build-app"], { cwd: rootDir, stdio: "inherit" });
}

if (!existsSync(binary)) {
  process.stderr.write(`${binary} is missing. Run \`make build-app\` in ${rootDir}.\n`);
  process.exit(1);
}

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace Desktop Client Dev (Wails v3)");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log(`  Daemon:  ${process.env.BYSPACE_LISTEN}`);
console.log(`  Binary:  ${binary}`);
console.log("══════════════════════════════════════════════════════");

await runDevChild(binary, ["app"], { cwd: rootDir, env: process.env });
