#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

// Worktree setup uses bash on macOS/Linux and PowerShell on Windows. Keep setup-time
// environment handling and file copies in Node so one command works in every shell.
const sourceRoot = process.env.BYSPACE_SOURCE_CHECKOUT_PATH;
const targetRoot = process.env.BYSPACE_WORKTREE_PATH || process.cwd();

if (!sourceRoot || samePath(sourceRoot, targetRoot)) {
  process.exit(0);
}

seedBySpaceHome();
copyServerEnv();

function seedBySpaceHome() {
  const source = process.env.BYSPACE_DEV_SEED_HOME || join(sourceRoot, ".dev/byspace-home");
  const target = join(targetRoot, ".dev/byspace-home");

  if (!existsSync(source)) {
    console.log(`  Seed:    skipped (${source} missing)`);
    return;
  }

  if (samePath(source, target)) {
    console.log("  Seed:    skipped (source is target)");
    return;
  }

  if (process.env.BYSPACE_DEV_RESET_HOME === "1") {
    rmSync(target, { recursive: true, force: true });
  } else if (hasEntries(target)) {
    console.log(`  Seed:    skipped (${target} already has data)`);
    return;
  }

  mkdirSync(target, { recursive: true });
  console.log(`  Seed:    copying metadata from ${source}`);
  copyJsonTree(join(source, "agents"), join(target, "agents"));
  copyJsonTree(join(source, "projects"), join(target, "projects"));

  const config = join(source, "config.json");
  if (isRegularFile(config)) {
    cpSync(config, join(target, "config.json"));
  }

  console.log(`  Seed:    copied metadata from ${source}`);
}

// Durable JSON metadata only. Runtime files, logs, sockets, and symlinks are not copied.
function copyJsonTree(source, target) {
  if (!isDirectory(source)) return;

  cpSync(source, target, {
    recursive: true,
    filter: (path) => isDirectory(path) || isRegularJsonFile(path),
  });
}

function copyServerEnv() {
  const source = join(sourceRoot, "packages/server/.env");
  const target = join(targetRoot, "packages/server/.env");

  // Untracked local config is optional; its absence must not fail worktree creation.
  if (!isRegularFile(source)) {
    console.log(`  Env:     skipped (${source} missing)`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  console.log(`  Env:     copied ${source}`);
}

function hasEntries(path) {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isRegularJsonFile(path) {
  return path.endsWith(".json") && isRegularFile(path);
}
