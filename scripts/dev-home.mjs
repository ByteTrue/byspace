#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import spawn from "cross-spawn";
import { isMainModule } from "./is-main-module.mjs";

export function defaultDevBySpaceRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function hasFiles(dir) {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function copyJsonTree(source, target) {
  if (!existsSync(source) || !lstatSync(source).isDirectory()) {
    return;
  }

  cpSync(source, target, {
    recursive: true,
    filter: (path) =>
      lstatSync(path).isDirectory() || (path.endsWith(".json") && lstatSync(path).isFile()),
  });
}

export function seedWorktreeBySpaceHome(sourceHome, targetHome) {
  const source = sourceHome || process.env.BYSPACE_DEV_SEED_HOME || join(homedir(), ".byspace");
  const target = targetHome;

  if (!existsSync(source)) {
    console.log(`  Seed:    skipped (${source} missing)`);
    return;
  }

  if (resolve(source) === resolve(target)) {
    console.log("  Seed:    skipped (source is target)");
    return;
  }

  if (process.env.BYSPACE_DEV_RESET_HOME === "1") {
    rmSync(target, { recursive: true, force: true });
  } else if (hasFiles(target)) {
    console.log(`  Seed:    skipped (${target} already has data)`);
    return;
  }

  mkdirSync(target, { recursive: true });
  console.log(`  Seed:    copying metadata from ${source}`);
  copyJsonTree(join(source, "agents"), join(target, "agents"));
  copyJsonTree(join(source, "projects"), join(target, "projects"));
  const configFile = join(source, "config.json");
  if (existsSync(configFile) && lstatSync(configFile).isFile()) {
    cpSync(configFile, join(target, "config.json"));
  }
  console.log(`  Seed:    copied metadata from ${source}`);
}

/**
 * Put this checkout's node_modules/.bin on PATH so npm scripts resolve the local toolchain.
 */
export function prependNodeModulesBin(rootDir) {
  const binDir = join(rootDir, "node_modules/.bin");
  if (!process.env.PATH || process.env.PATH.includes(binDir)) return;

  const separator = process.platform === "win32" ? ";" : ":";
  process.env.PATH = `${binDir}${separator}${process.env.PATH}`;
}

export function configureDevDaemonConfig(byspaceHome, listen = process.env.BYSPACE_LISTEN) {
  if (!listen) return;

  mkdirSync(byspaceHome, { recursive: true });
  const configPath = join(byspaceHome, "config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {}
  cfg.version = cfg.version || 1;
  cfg.daemon = cfg.daemon || {};
  cfg.daemon.listen = listen;
  cfg.daemon.cors = cfg.daemon.cors || {};
  cfg.daemon.cors.allowedOrigins = ["*"];
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

export function resolveDevDaemonEndpoint(listen = process.env.BYSPACE_LISTEN || "127.0.0.1:6778") {
  const endpoint = process.env.BYSPACE_DEV_DAEMON_ENDPOINT;
  if (endpoint) return endpoint;

  if (listen.startsWith("0.0.0.0:")) {
    return `localhost:${listen.slice("0.0.0.0:".length)}`;
  }
  if (listen.startsWith("127.0.0.1:")) {
    return `localhost:${listen.slice("127.0.0.1:".length)}`;
  }
  return listen;
}

export function configureDevBySpaceHome() {
  const seedHome = process.env.BYSPACE_DEV_SEED_HOME;
  const managedHome = process.env.BYSPACE_DEV_MANAGED_HOME === "1";

  if (process.env.BYSPACE_HOME) {
    if (seedHome) {
      seedWorktreeBySpaceHome(seedHome, process.env.BYSPACE_HOME);
    }
    mkdirSync(process.env.BYSPACE_HOME, { recursive: true });
    if (managedHome || seedHome) {
      configureDevDaemonConfig(process.env.BYSPACE_HOME, process.env.BYSPACE_LISTEN);
    }
    return process.env.BYSPACE_HOME;
  }

  const devRoot =
    process.env.BYSPACE_DEV_ROOT || process.env.BYSPACE_WORKTREE_PATH || defaultDevBySpaceRoot();
  const byspaceHome = join(devRoot, ".dev/byspace-home");
  process.env.BYSPACE_HOME = byspaceHome;
  process.env.BYSPACE_DEV_MANAGED_HOME = "1";

  if (seedHome) {
    seedWorktreeBySpaceHome(seedHome, byspaceHome);
  }
  mkdirSync(byspaceHome, { recursive: true });
  configureDevDaemonConfig(byspaceHome, process.env.BYSPACE_LISTEN);
  return byspaceHome;
}

export function configureDevCommandEnv() {
  if (!process.env.BYSPACE_LISTEN) {
    const servicePort = process.env.BYSPACE_SERVICE_DAEMON_PORT;
    if (servicePort) {
      process.env.BYSPACE_LISTEN = `0.0.0.0:${servicePort}`;
    } else {
      process.env.BYSPACE_LISTEN = "127.0.0.1:6778";
    }
  }

  return configureDevBySpaceHome();
}

/**
 * Run a dev command as this wrapper's own process. The exit status is forwarded, and the signals
 * that stop the wrapper are forwarded to the child: without them a stopped wrapper would leave
 * Metro or the server watch running.
 */
export function runDevChild(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  const onSigint = () => child.kill("SIGINT");
  const onSigterm = () => child.kill("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  child.on("exit", (code, signal) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  return child;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    configureDevCommandEnv();
    const [cmd, ...cmdArgs] = args;
    runDevChild(cmd, cmdArgs, { env: process.env });
  } else {
    configureDevBySpaceHome();
  }
}
