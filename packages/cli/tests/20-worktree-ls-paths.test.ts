#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePaseoHomePath, resolvePaseoWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalBySpaceHome = process.env.BYSPACE_HOME;

try {
  {
    console.log("Test 1: resolves explicit BYSPACE_HOME when set");
    process.env.BYSPACE_HOME = "/tmp/byspace-explicit-home";

    assert.strictEqual(resolvePaseoHomePath(), "/tmp/byspace-explicit-home");
    assert.strictEqual(resolvePaseoWorktreesDir(), "/tmp/byspace-explicit-home/worktrees");
    console.log("\u2713 explicit BYSPACE_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.byspace when BYSPACE_HOME is unset");
    delete process.env.BYSPACE_HOME;

    assert.strictEqual(resolvePaseoHomePath(), join(homedir(), ".byspace"));
    assert.strictEqual(resolvePaseoWorktreesDir(), join(homedir(), ".byspace", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalBySpaceHome === undefined) {
    delete process.env.BYSPACE_HOME;
  } else {
    process.env.BYSPACE_HOME = originalBySpaceHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
