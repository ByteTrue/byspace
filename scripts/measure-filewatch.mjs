#!/usr/bin/env node
/**
 * Measures the Linux file observation backend: attach cost on a 10k-file tree, write-to-callback
 * latency, and the descriptor count one subscription holds.
 *
 * Why a script and not a plain go test: the numbers belong in docs/file-observation.md, and a
 * reviewer needs the exact command that produced them.
 *
 *   node scripts/measure-filewatch.mjs
 *
 * Linux only. The backend is build-tagged, so on another platform the benchmark does not exist.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync(
  "go",
  [
    "test",
    "./internal/filewatch",
    "-run",
    "^$",
    "-bench",
    "BenchmarkLinuxObservation",
    "-benchtime",
    "1x",
    "-v",
  ],
  { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error) {
  console.error(`measure-filewatch: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
