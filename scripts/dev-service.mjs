import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DAEMON_PORT = "6768";
const DEFAULT_EXPO_PORT = "8081";

function resolveRoot(env, cwd) {
  return env.BYSPACE_WORKTREE_PATH || cwd;
}

function resolveNpmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function resolveGitBranch(root) {
  try {
    return execFileSync("git", ["-C", root, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function setIfMissing(env, name, value) {
  if (!env[name]) {
    env[name] = value;
  }
}

export function createServiceConfig(mode, { env = process.env, cwd = process.cwd() } = {}) {
  if (mode !== "daemon" && mode !== "app") {
    throw new Error(`Unknown BySpace service: ${mode}`);
  }

  const root = resolveRoot(env, cwd);
  const home = path.join(root, ".dev", "byspace-home");
  const serviceEnv = {
    ...env,
    BYSPACE_DEV_MANAGED_HOME: "1",
    BYSPACE_DEV_ROOT: root,
    BYSPACE_HOME: home,
  };
  const daemonPort = env.BYSPACE_SERVICE_DAEMON_PORT || DEFAULT_DAEMON_PORT;

  if (mode === "daemon") {
    const port = env.BYSPACE_PORT || DEFAULT_DAEMON_PORT;
    serviceEnv.BYSPACE_SKIP_DEV_SERVER_BUILD = "1";
    serviceEnv.BYSPACE_LISTEN = `0.0.0.0:${port}`;
    setIfMissing(serviceEnv, "BYSPACE_CORS_ORIGINS", "*");
    setIfMissing(serviceEnv, "BYSPACE_NODE_INSPECT", "--inspect=0");
    setIfMissing(
      serviceEnv,
      "BYSPACE_LOCAL_MODELS_DIR",
      path.join(os.homedir(), ".byspace", "models", "local-speech"),
    );
    return {
      mode,
      root,
      home,
      listen: serviceEnv.BYSPACE_LISTEN,
      command: resolveNpmCommand(),
      args: ["run", "dev:server:watch"],
      env: serviceEnv,
    };
  }

  const expoPort = env.BYSPACE_PORT || DEFAULT_EXPO_PORT;
  serviceEnv.BYSPACE_LISTEN = `0.0.0.0:${daemonPort}`;
  serviceEnv.BYSPACE_DEV_DAEMON_ENDPOINT = `localhost:${daemonPort}`;
  serviceEnv.EXPO_PORT = expoPort;
  serviceEnv.APP_VARIANT = "development";
  serviceEnv.EXPO_PUBLIC_BYSPACE_DEV_BUILD_LABEL = resolveGitBranch(root);
  serviceEnv.EXPO_PUBLIC_LOCAL_DAEMON = serviceEnv.BYSPACE_DEV_DAEMON_ENDPOINT;
  setIfMissing(serviceEnv, "BROWSER", "none");

  return {
    mode,
    root,
    home,
    listen: serviceEnv.BYSPACE_LISTEN,
    command: resolveNpmCommand(),
    args: ["run", "start:expo", "--workspace=@bytetrue/byspace-app", "--", "--port", expoPort],
    env: serviceEnv,
  };
}

export function configureManagedHome(home, listen) {
  mkdirSync(home, { recursive: true });
  const configPath = path.join(home, "config.json");
  let config = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    // A missing or invalid local config is replaced with the minimal dev config.
  }

  config.version = config.version || 1;
  config.daemon =
    config.daemon && typeof config.daemon === "object" && !Array.isArray(config.daemon)
      ? config.daemon
      : {};
  config.daemon.listen = listen;
  config.daemon.cors =
    config.daemon.cors &&
    typeof config.daemon.cors === "object" &&
    !Array.isArray(config.daemon.cors)
      ? config.daemon.cors
      : {};
  config.daemon.cors.allowedOrigins = ["*"];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function runService(mode, options = {}) {
  const service = createServiceConfig(mode, options);
  if (mode === "daemon") {
    mkdirSync(service.env.BYSPACE_LOCAL_MODELS_DIR, { recursive: true });
  }
  configureManagedHome(service.home, service.listen);

  console.log(`BySpace ${mode} service`);
  console.log(`  Home:    ${service.home}`);
  console.log(`  Listen:  ${service.listen}`);
  if (mode === "app") {
    console.log(`  Daemon:  ${service.env.BYSPACE_DEV_DAEMON_ENDPOINT}`);
  }

  const child = spawn(service.command, service.args, {
    cwd: service.root,
    env: service.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  return child;
}

function main() {
  const mode = process.argv[2];
  if (!mode) {
    console.error("Usage: node scripts/dev-service.mjs <daemon|app>");
    process.exitCode = 2;
    return;
  }
  runService(mode);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
