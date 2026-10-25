#!/usr/bin/env node
// Runs the Go CLI against this checkout's dev daemon and dev home.
//
// The dev home and BYSPACE_LISTEN have to be set before the CLI resolves either, so this wrapper
// exists instead of a bare bin/byspace call: `npm run cli -- ls -a` would otherwise read ~/.byspace
// and talk to the packaged daemon on 6777.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDevCommandEnv } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const binary = resolve(rootDir, "bin", process.platform === "win32" ? "byspace.exe" : "byspace");

configureDevCommandEnv();

if (!existsSync(binary)) {
  process.stderr.write(`${binary} is missing. Run \`make build\` in ${rootDir}.\n`);
  process.exit(1);
}

try {
  execFileSync(binary, process.argv.slice(2), { cwd: process.cwd(), stdio: "inherit" });
} catch (error) {
  process.exit(typeof error.status === "number" ? error.status : 1);
}
