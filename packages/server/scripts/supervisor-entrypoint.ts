import { fileURLToPath } from "url";
import { existsSync } from "node:fs";
import {
  acquirePidLock,
  PidLockError,
  releasePidLock,
  startPidLockHeartbeat,
  updatePidLock,
} from "../src/server/pid-lock.js";
import { resolveBySpaceHome } from "../src/server/byspace-home.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import { runSupervisor } from "./supervisor.js";
import { resolveSupervisorLogFile } from "./supervisor-log-config.js";
import { applySherpaLoaderEnv } from "../src/server/speech/providers/local/sherpa/sherpa-runtime-env.js";

process.title = "BySpace Supervisor";

interface DaemonRunnerConfig {
  devMode: boolean;
  workerArgs: string[];
}

function parseConfig(argv: string[]): DaemonRunnerConfig {
  let devMode = false;
  const workerArgs: string[] = [];

  for (const arg of argv) {
    if (arg === "--dev") {
      devMode = true;
      continue;
    }
    workerArgs.push(arg);
  }

  return { devMode, workerArgs };
}

function resolveWorkerEntry(): string {
  const candidates = [
    fileURLToPath(new URL("../server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../dist/server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url)),
    fileURLToPath(new URL("../../src/server/daemon-worker.ts", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveDevWorkerEntry(): string {
  const candidate = fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url));
  if (!existsSync(candidate)) {
    throw new Error(`Dev worker entry not found: ${candidate}`);
  }
  return candidate;
}

function resolveWorkerExecArgv(workerEntry: string, devMode: boolean): string[] {
  const execArgv = workerEntry.endsWith(".ts") ? ["--import", "tsx"] : [];
  if (!devMode) {
    return execArgv;
  }
  const devArgs = [
    "--heapsnapshot-near-heap-limit=3",
    "--max-old-space-size=3072",
    "--report-on-fatalerror",
    "--report-directory=/tmp/byspace-reports",
  ];
  const inspectArg = process.env.BYSPACE_NODE_INSPECT ?? "--inspect";
  if (inspectArg !== "0" && inspectArg !== "false" && inspectArg !== "off") {
    devArgs.push(inspectArg);
  }
  return [...devArgs, ...execArgv];
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const workerEntry = config.devMode ? resolveDevWorkerEntry() : resolveWorkerEntry();
  const workerExecArgv = resolveWorkerExecArgv(workerEntry, config.devMode);
  const workerEnv: NodeJS.ProcessEnv = { ...process.env };

  applySherpaLoaderEnv(workerEnv);

  const byspaceHome = resolveBySpaceHome(workerEnv);
  const persistedConfig = loadPersistedConfig(byspaceHome);
  const supervisorLogFile = resolveSupervisorLogFile(byspaceHome, persistedConfig, workerEnv);

  try {
    await acquirePidLock(byspaceHome, null, { ownerPid: process.pid });
  } catch (error) {
    if (error instanceof PidLockError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
      return;
    }
    throw error;
  }

  let lockReleased = false;
  let requestSupervisorShutdown: ((reason: string) => void) | null = null;
  const stopLockHeartbeat = startPidLockHeartbeat(byspaceHome, {
    ownerPid: process.pid,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`PID lock heartbeat failed: ${message}\n`);
      if (error instanceof PidLockError) {
        requestSupervisorShutdown?.("pid_lock_ownership_lost");
      }
    },
  });
  const releaseLock = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    lockReleased = true;
    stopLockHeartbeat();
    await releasePidLock(byspaceHome, {
      ownerPid: process.pid,
    });
  };

  const supervisor = runSupervisor({
    name: "DaemonRunner",
    startupMessage: "Starting daemon worker (IPC restart and crash restart enabled)",
    resolveWorkerEntry: () => workerEntry,
    workerArgs: config.workerArgs,
    workerEnv,
    workerExecArgv,
    restartOnCrash: true,
    logFile: supervisorLogFile,
    onWorkerReady: async ({ listen }) => {
      await updatePidLock(byspaceHome, { listen }, { ownerPid: process.pid });
    },
    onSupervisorExit: releaseLock,
  });
  requestSupervisorShutdown = supervisor.requestShutdown;
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
