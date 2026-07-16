import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const artifact = join(root, "artifacts", `bytetrue-byspace-${version}.tgz`);
const installRoot = mkdtempSync(join(tmpdir(), "byspace-install-smoke-"));
const npmCli = process.env.npm_execpath;
const binaryScript = join(installRoot, "node_modules", "@bytetrue", "byspace", "bin", "byspace");
const binaryArgs = ["--disable-warning=DEP0040", binaryScript];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

function runNpm(args, options = {}) {
  return npmCli
    ? run(process.execPath, [npmCli, ...args], options)
    : run("npm", args, { ...options, shell: process.platform === "win32" });
}

function runBinary(args, options = {}) {
  return run(process.execPath, [...binaryArgs, ...args], options);
}

function spawnBinary(args, options = {}) {
  return spawnSync(process.execPath, [...binaryArgs, ...args], options);
}

function removeInstallRoot() {
  try {
    rmSync(installRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 1_000 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (process.platform === "win32" && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(code))) {
      console.warn(`Windows kept the stopped smoke-test directory locked: ${installRoot}`);
      return;
    }
    throw error;
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve a TCP port");
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
  return address.port;
}

function waitForDaemon(env) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = spawnBinary(["daemon", "status", "--json"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.status === 0) {
      try {
        const status = JSON.parse(result.stdout);
        if (status.localDaemon === "running" && status.connectedDaemon === "reachable")
          return status;
      } catch {
        // The next bounded probe will retry while startup output settles.
      }
    }
    sleep(250);
  }
  throw new Error("Packaged daemon did not become ready within 20 seconds");
}

let daemonStarted = false;
let env;
let failure;
let cleanupFailure;
try {
  runNpm(["run", "pack:byspace"], { timeout: 600_000 });
  const port = await reservePort();
  const home = join(installRoot, "home");
  env = {
    ...process.env,
    BYSPACE_HOME: home,
    BYSPACE_LISTEN: `127.0.0.1:${port}`,
  };

  runNpm(["install", "--prefix", installRoot, "--no-audit", "--no-fund", artifact], {
    timeout: 300_000,
  });
  const installedVersion = runBinary(["--version"], { env }).trim();
  if (installedVersion !== version) {
    throw new Error(`Installed version ${installedVersion} does not match ${version}`);
  }
  if (!runBinary(["--help"], { env }).includes("Usage: byspace")) {
    throw new Error("Installed CLI help did not render");
  }

  runBinary(["daemon", "start", "--no-relay"], { env });
  daemonStarted = true;
  const status = waitForDaemon(env);
  if (status.home !== home || status.listen !== `127.0.0.1:${port}`) {
    throw new Error(`Daemon used unexpected paths: ${JSON.stringify(status)}`);
  }
  process.stdout.write(`BySpace ${version} package smoke passed on port ${port}.\n`);
} catch (error) {
  failure = error;
} finally {
  if (daemonStarted && env && existsSync(binaryScript)) {
    const stop = spawnBinary(
      ["daemon", "stop", "--force", "--timeout", "5", "--kill-timeout", "5"],
      {
        env,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (stop.status !== 0) {
      process.stderr.write(stop.stdout ?? "");
      process.stderr.write(stop.stderr ?? "");
      cleanupFailure = new Error(
        "Packaged daemon cleanup failed; installation prefix was preserved",
      );
    }
  }
  if (!cleanupFailure) {
    removeInstallRoot();
  }
}

if (cleanupFailure) throw cleanupFailure;
if (failure) throw failure;
