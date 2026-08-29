#!/usr/bin/env npx tsx

/**
 * Regression: `byspace daemon stop` must not send a shutdown RPC to a reachable
 * endpoint when the selected home has no daemon ownership PID file.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const testEnv = {
  BYSPACE_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.BYSPACE_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  BYSPACE_DICTATION_ENABLED: process.env.BYSPACE_DICTATION_ENABLED ?? "0",
  BYSPACE_VOICE_MODE_ENABLED: process.env.BYSPACE_VOICE_MODE_ENABLED ?? "0",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findUnusedPid(): number {
  for (let pid = 999_999; pid > 900_000; pid--) {
    if (!isProcessRunning(pid)) return pid;
  }
  throw new Error("Unable to find unused PID");
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(100);
  }
}

const port = await getAvailablePort();
const host = `127.0.0.1:${port}`;
const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-stop-unowned-reachable-"));
const cliRoot = join(import.meta.dirname, "..");
let workerProcess: ChildProcess | null = null;
let workerLogs = "";

try {
  await writeFile(
    join(byspaceHome, "config.json"),
    `${JSON.stringify({ version: 1, daemon: { listen: host, relay: { enabled: false } } }, null, 2)}\n`,
  );

  workerProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../server/src/server/daemon-worker.ts"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        BYSPACE_HOME: byspaceHome,
        BYSPACE_LISTEN: host,
        BYSPACE_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  workerProcess.stdout?.on("data", (chunk) => {
    workerLogs += chunk.toString();
  });
  workerProcess.stderr?.on("data", (chunk) => {
    workerLogs += chunk.toString();
  });

  await waitFor(
    async () => {
      const result =
        await $`BYSPACE_HOME=${byspaceHome} npx byspace daemon status --home ${byspaceHome} --json`.nothrow();
      if (result.exitCode !== 0) return false;
      const status = JSON.parse(result.stdout) as { connectedDaemon?: unknown; pid?: unknown };
      return status.connectedDaemon === "reachable" && status.pid === null;
    },
    120_000,
    "daemon did not become reachable without a PID file",
  );

  const stopResult =
    await $`BYSPACE_HOME=${byspaceHome} npx byspace daemon stop --home ${byspaceHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  assert.strictEqual(JSON.parse(stopResult.stdout).action, "not_running");

  await sleep(250);
  assert(
    workerProcess.pid && isProcessRunning(workerProcess.pid),
    "unowned daemon must remain running",
  );
  assert(
    !workerLogs.includes("Shutdown requested via websocket"),
    `stop sent a lifecycle shutdown RPC without ownership:\n${workerLogs}`,
  );

  await writeFile(
    join(byspaceHome, "byspace.pid"),
    `${JSON.stringify({ pid: findUnusedPid(), startedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  const legacyPidStop =
    await $`BYSPACE_HOME=${byspaceHome} npx byspace daemon stop --home ${byspaceHome} --json`.nothrow();
  assert.strictEqual(legacyPidStop.exitCode, 0, `stop should succeed: ${legacyPidStop.stderr}`);
  assert.strictEqual(JSON.parse(legacyPidStop.stdout).action, "not_running");

  await sleep(250);
  assert(
    workerProcess.pid && isProcessRunning(workerProcess.pid),
    "unowned endpoint must remain running",
  );
  assert(
    !workerLogs.includes("Shutdown requested via websocket"),
    `legacy PID without a listen target authorized lifecycle shutdown:\n${workerLogs}`,
  );
} finally {
  if (workerProcess?.pid && isProcessRunning(workerProcess.pid)) {
    workerProcess.kill("SIGTERM");
    await sleep(250);
    if (isProcessRunning(workerProcess.pid)) workerProcess.kill("SIGKILL");
  }
  await rm(byspaceHome, { recursive: true, force: true });
}

console.log("=== Unowned reachable daemon stop regression test passed ===");
