import { spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadConfig, resolveBySpaceHome, spawnProcess } from "@bytetrue/byspace-server";
import { resolveBySpaceHostedRelease } from "@bytetrue/byspace-protocol/release-channel";
import treeKill from "tree-kill";
import { tryConnectToDaemon } from "../../utils/client.js";
import { resolveCliVersion } from "../../version.js";

export interface DaemonStartOptions {
  port?: string;
  listen?: string;
  home?: string;
  foreground?: boolean;
  relay?: boolean;
  relayUseTls?: boolean;
  mcp?: boolean;
  injectMcp?: boolean;
  webUi?: boolean;
  hostnames?: string;
}

export interface LocalDaemonPidInfo {
  pid: number;
  startedAt?: string;
  hostname?: string;
  uid?: number;
  listen?: string;
}

export interface LocalDaemonState {
  home: string;
  listen: string;
  relayEnabled: boolean;
  relayEndpoint: string;
  relayUseTls: boolean;
  relayPublicUseTls: boolean;
  logPath: string;
  pidPath: string;
  pidInfo: LocalDaemonPidInfo | null;
  running: boolean;
  stalePidFile: boolean;
}

export interface DetachedStartResult {
  pid: number | null;
  logPath: string;
  hostedWebUrl: string;
  webUiUrl: string | null;
}

export interface StopLocalDaemonOptions {
  home?: string;
  timeoutMs?: number;
  killTimeoutMs?: number;
  force?: boolean;
}

export interface StopLocalDaemonResult {
  action: "stopped" | "not_running";
  home: string;
  pid: number | null;
  forced: boolean;
  usedLifecycleRpc: boolean;
  reason: "not_running" | "lifecycle_shutdown_rpc" | "owner_pid_signal" | "owner_pid_sigkill";
  message: string;
}

interface ProcessExitDetails {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

type DetachedStartupResult = { exitedEarly: false } | ({ exitedEarly: true } & ProcessExitDetails);

export interface DetachedDaemonProcess extends Pick<ChildProcess, "once" | "pid" | "unref"> {}

export interface ForegroundDaemonProcessResult {
  status: number | null;
  error?: Error;
}

export interface DaemonLaunchRuntime {
  resolveRunnerEntry(): string;
  resolveHome(env: NodeJS.ProcessEnv): string;
  spawnDetached(
    command: string,
    args: string[],
    options: Parameters<typeof spawnProcess>[2],
  ): DetachedDaemonProcess;
  spawnForeground(
    command: string,
    args: string[],
    options: Parameters<typeof spawnSync>[2],
  ): ForegroundDaemonProcessResult;
}

const DETACHED_STARTUP_GRACE_MS = 1200;
const PID_POLL_INTERVAL_MS = 100;
const DAEMON_LOG_FILENAME = "daemon.log";
const DAEMON_PID_FILENAME = "byspace.pid";
const CURRENT_RELEASE_RELAY_ENDPOINT =
  resolveBySpaceHostedRelease(resolveCliVersion()).relayEndpoint;

export const DEFAULT_STOP_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_TIMEOUT_MS = 3_000;

const require = createRequire(import.meta.url);

const defaultDaemonLaunchRuntime: DaemonLaunchRuntime = {
  resolveRunnerEntry: resolveDaemonRunnerEntry,
  resolveHome: resolveBySpaceHome,
  spawnDetached: spawnProcess,
  spawnForeground: spawnSync,
};

const startupReady = (): DetachedStartupResult => ({ exitedEarly: false });

const startupExited = (details: ProcessExitDetails): DetachedStartupResult => ({
  exitedEarly: true,
  ...details,
});

function envWithHome(home?: string): NodeJS.ProcessEnv {
  if (!home) {
    return process.env;
  }

  return { ...process.env, BYSPACE_HOME: home };
}

function buildRunnerArgs(options: DaemonStartOptions): string[] {
  const args: string[] = [];
  if (options.relay === false) {
    args.push("--no-relay");
  }
  if (options.relayUseTls === true) {
    args.push("--relay-use-tls");
  }

  if (options.mcp === false) {
    args.push("--no-mcp");
  }
  if (options.injectMcp === false) {
    args.push("--no-inject-mcp");
  }
  if (options.webUi === true) {
    args.push("--web-ui");
  }
  if (options.webUi === false) {
    args.push("--no-web-ui");
  }

  return args;
}

function buildChildEnv(options: DaemonStartOptions): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.home) {
    childEnv.BYSPACE_HOME = options.home;
  }
  if (options.listen) {
    childEnv.BYSPACE_LISTEN = options.listen;
  } else if (options.port) {
    childEnv.BYSPACE_LISTEN = `127.0.0.1:${options.port}`;
  }
  if (options.hostnames) {
    childEnv.BYSPACE_HOSTNAMES = options.hostnames;
  }
  if (options.relayUseTls === true) {
    childEnv.BYSPACE_RELAY_USE_TLS = "true";
  }
  if (options.webUi === true) {
    childEnv.BYSPACE_WEB_UI_ENABLED = "true";
  }
  if (options.webUi === false) {
    childEnv.BYSPACE_WEB_UI_ENABLED = "false";
  }
  return childEnv;
}

function resolveServerRunnerFromDir(currentDir: string): string | null {
  const packageJsonPath = path.join(currentDir, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
    if (packageJson.name !== "@bytetrue/byspace-server") return null;
    const distRunner = path.join(currentDir, "dist", "scripts", "supervisor-entrypoint.js");
    if (existsSync(distRunner)) {
      return distRunner;
    }
    return path.join(currentDir, "scripts", "supervisor-entrypoint.ts");
  } catch {
    return null;
  }
}

function resolveDaemonRunnerEntry(): string {
  const serverExportPath = require.resolve("@bytetrue/byspace-server");
  let currentDir = path.dirname(serverExportPath);

  while (true) {
    const entry = resolveServerRunnerFromDir(currentDir);
    if (entry) {
      return entry;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error("Unable to resolve @bytetrue/byspace-server package root for daemon runner");
}

function pidFilePath(byspaceHome: string): string {
  return path.join(byspaceHome, DAEMON_PID_FILENAME);
}

function resolveListenField(listen: unknown, sockPath: unknown): string | undefined {
  if (typeof listen === "string") return listen;
  if (typeof sockPath === "string") return sockPath;
  return undefined;
}

function resolveStopMessage(
  forced: boolean,
  lifecycleRequested: boolean,
  fallbackMessage: string | null | undefined,
): string {
  if (forced) return "Daemon owner process was force-stopped";
  if (lifecycleRequested) return "Daemon stopped gracefully";
  return fallbackMessage ?? "Daemon stopped via owner PID signal";
}

function resolveStopReason(
  forced: boolean,
  lifecycleRequested: boolean,
): StopLocalDaemonResult["reason"] {
  if (forced) return "owner_pid_sigkill";
  if (lifecycleRequested) return "lifecycle_shutdown_rpc";
  return "owner_pid_signal";
}

function readPidFile(pidPath: string): LocalDaemonPidInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(pidPath, "utf-8")) as Record<string, unknown>;
    const pidValue = parsed.pid;
    if (typeof pidValue !== "number" || !Number.isInteger(pidValue) || pidValue <= 0) {
      return null;
    }

    return {
      pid: pidValue,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : undefined,
      uid: typeof parsed.uid === "number" ? parsed.uid : undefined,
      listen: resolveListenField(parsed.listen, parsed.sockPath),
    };
  } catch {
    return null;
  }
}

function tailFile(filePath: string, lines = 30): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNodeErrnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

function signalProcessSafely(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    return false;
  }

  try {
    return signalProcess(pid, signal);
  } catch (err) {
    const code = readNodeErrnoCode(err);
    if (code === "EPERM") {
      return true;
    }
    throw err;
  }
}

async function signalProcessTreeSafely(pid: number, signal: NodeJS.Signals): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    return false;
  }

  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => {
      if (!err) {
        resolve(true);
        return;
      }

      const code = readNodeErrnoCode(err);
      if (code === "ESRCH") {
        resolve(false);
        return;
      }
      if (code === "EPERM") {
        resolve(true);
        return;
      }
      reject(err);
    });
  });
}

async function signalProcessTreeOrOwnerSafely(
  pid: number,
  signal: NodeJS.Signals,
): Promise<boolean> {
  try {
    return await signalProcessTreeSafely(pid, signal);
  } catch {
    return signalProcessSafely(pid, signal);
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<boolean> {
    if (!isProcessRunning(pid)) return true;
    if (Date.now() >= deadline) return !isProcessRunning(pid);
    await sleep(PID_POLL_INTERVAL_MS);
    return poll();
  }
  return poll();
}

async function waitForDaemonUnreachable(
  state: LocalDaemonState,
  timeoutMs: number,
): Promise<boolean> {
  const host = resolveTcpHostFromListen(state.listen);
  if (!host) {
    return true;
  }

  const reachableHost = host;
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<boolean> {
    const client = await tryConnectToDaemon({ host: reachableHost, timeout: 500 });
    if (!client) {
      return true;
    }
    await client.close().catch(() => undefined);
    if (Date.now() >= deadline) {
      const finalClient = await tryConnectToDaemon({
        host: reachableHost,
        timeout: PID_POLL_INTERVAL_MS,
      });
      if (!finalClient) {
        return true;
      }
      await finalClient.close().catch(() => undefined);
      return false;
    }
    await sleep(PID_POLL_INTERVAL_MS);
    return poll();
  }

  return poll();
}

function removeStalePidFile(state: LocalDaemonState): void {
  if (!state.stalePidFile) {
    return;
  }

  try {
    unlinkSync(state.pidPath);
  } catch {
    // Best-effort cleanup only. The successful lifecycle stop is authoritative.
  }
}

function createNotRunningStopResult(
  state: LocalDaemonState,
  pid: number | null,
  message: string,
): StopLocalDaemonResult {
  return {
    action: "not_running",
    home: state.home,
    pid,
    forced: false,
    usedLifecycleRpc: false,
    reason: "not_running",
    message,
  };
}

function createStopTimeoutError(
  state: LocalDaemonState,
  pid: number | null,
  timeoutMs: number,
): Error {
  if (!state.running) {
    const host = resolveTcpHostFromListen(state.listen);
    return new Error(
      `Timed out waiting for daemon${host ? ` at ${host}` : ""} to stop after ${Math.ceil(
        timeoutMs / 1000,
      )}s`,
    );
  }
  return new Error(
    `Timed out waiting for daemon PID ${pid} to stop after ${Math.ceil(timeoutMs / 1000)}s`,
  );
}

async function signalDaemonOwnerForStop(
  state: LocalDaemonState,
  pid: number | null,
): Promise<StopLocalDaemonResult | null> {
  if (pid === null) {
    return createNotRunningStopResult(state, null, "Daemon is not running");
  }

  const signaled = await signalProcessTreeOrOwnerSafely(pid, "SIGTERM");
  if (signaled) {
    return null;
  }

  return createNotRunningStopResult(state, pid, "Daemon process was already stopped");
}

async function waitForStopAfterRequest(args: {
  state: LocalDaemonState;
  pid: number | null;
  timeoutMs: number;
  killTimeoutMs: number;
  force?: boolean;
}): Promise<{ stopped: boolean; forced: boolean }> {
  const { state, pid, timeoutMs, killTimeoutMs, force } = args;
  let stopped =
    state.running && pid !== null
      ? await waitForPidExit(pid, timeoutMs)
      : await waitForDaemonUnreachable(state, timeoutMs);

  if (!stopped && force && state.running && pid !== null) {
    await signalProcessTreeOrOwnerSafely(pid, "SIGKILL");
    stopped = await waitForPidExit(pid, killTimeoutMs);
    return { stopped, forced: true };
  }

  return { stopped, forced: false };
}

type LifecycleShutdownAttempt = { requested: true } | { requested: false; reason: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveLocalBySpaceHome(home?: string): string {
  return resolveBySpaceHome(envWithHome(home));
}

export function resolveTcpHostFromListen(listen: string): string | null {
  const normalized = listen.trim();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("unix://") ||
    normalized.startsWith("pipe://") ||
    normalized.startsWith("\\\\.\\pipe\\") ||
    /^[A-Za-z]:[/\\]/.test(normalized)
  ) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return `127.0.0.1:${normalized}`;
  }

  if (normalized.includes(":")) {
    return normalized;
  }

  return null;
}

function resolveWebUiUrl(listen: string): string | null {
  const host = resolveTcpHostFromListen(listen);
  if (!host) return null;

  try {
    const url = new URL(`http://${host}`);
    if (
      url.hostname === "0.0.0.0" ||
      url.hostname.startsWith("127.") ||
      url.hostname === "[::]" ||
      url.hostname === "[::1]"
    ) {
      url.hostname = "localhost";
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveLocalDaemonState(options: { home?: string } = {}): LocalDaemonState {
  const env: NodeJS.ProcessEnv = {
    ...envWithHome(options.home),
    // Status should reflect local persisted config + pid file, not inherited daemon env overrides.
    // This is CLI-side defensive scrubbing; the daemon RPC is authoritative when available.
    BYSPACE_LISTEN: undefined,
    BYSPACE_HOSTNAMES: undefined,
    BYSPACE_ALLOWED_HOSTS: undefined,
    BYSPACE_RELAY_ENABLED: undefined,
    BYSPACE_RELAY_ENDPOINT: undefined,
    BYSPACE_RELAY_PUBLIC_ENDPOINT: undefined,
    BYSPACE_RELAY_USE_TLS: undefined,
    BYSPACE_RELAY_PUBLIC_USE_TLS: undefined,
  };
  const home = resolveBySpaceHome(env);
  const config = loadConfig(home, { env });
  const pidPath = pidFilePath(home);
  const logPath = path.join(home, DAEMON_LOG_FILENAME);
  const pidInfo = existsSync(pidPath) ? readPidFile(pidPath) : null;
  const running = pidInfo ? isProcessRunning(pidInfo.pid) : false;
  const listen = pidInfo?.listen ?? config.listen;

  return {
    home,
    listen,
    relayEnabled: config.relayEnabled ?? true,
    relayEndpoint:
      config.relayPublicEndpoint ?? config.relayEndpoint ?? CURRENT_RELEASE_RELAY_ENDPOINT,
    relayUseTls: config.relayUseTls ?? false,
    relayPublicUseTls: config.relayPublicUseTls ?? config.relayUseTls ?? false,
    logPath,
    pidPath,
    pidInfo,
    running,
    stalePidFile: Boolean(pidInfo) && !running,
  };
}

export function tailDaemonLog(home?: string, lines = 30): string | null {
  const logPath = path.join(resolveLocalBySpaceHome(home), DAEMON_LOG_FILENAME);
  return tailFile(logPath, lines);
}

export async function startLocalDaemonDetached(
  options: DaemonStartOptions,
  runtime: DaemonLaunchRuntime = defaultDaemonLaunchRuntime,
): Promise<DetachedStartResult> {
  if (options.listen && options.port) {
    throw new Error("Cannot use --listen and --port together");
  }

  const daemonRunnerEntry = runtime.resolveRunnerEntry();
  const childEnv = buildChildEnv(options);

  const byspaceHome = runtime.resolveHome(childEnv);
  const logPath = path.join(byspaceHome, DAEMON_LOG_FILENAME);
  const config = loadConfig(byspaceHome, { env: childEnv });
  const hostedWebUrl = config.appBaseUrl;
  if (!hostedWebUrl) {
    throw new Error("Hosted Web URL is not configured");
  }
  const child = runtime.spawnDetached(
    process.execPath,
    [...process.execArgv, daemonRunnerEntry, ...buildRunnerArgs(options)],
    {
      detached: true,
      envMode: "internal",
      env: childEnv,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );

  child.unref();

  const startup = await new Promise<DetachedStartupResult>((resolve) => {
    let settled = false;

    const finish = (value: DetachedStartupResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(startupReady()), DETACHED_STARTUP_GRACE_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      finish(startupExited({ code: null, signal: null, error }));
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      finish(startupExited({ code, signal }));
    });
  });

  if (startup.exitedEarly) {
    const reason = startup.error
      ? startup.error.message
      : `exit code ${startup.code ?? "unknown"}${startup.signal ? ` (${startup.signal})` : ""}`;
    const recentLogs = tailFile(logPath);
    throw new Error(
      [
        `Daemon failed to start in background (${reason}).`,
        recentLogs ? `Recent daemon logs:\n${recentLogs}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    pid: child.pid ?? null,
    logPath,
    webUiUrl: config.webUi?.enabled ? resolveWebUiUrl(config.listen) : null,
    hostedWebUrl,
  };
}

export function startLocalDaemonForeground(
  options: DaemonStartOptions,
  runtime: DaemonLaunchRuntime = defaultDaemonLaunchRuntime,
): number {
  if (options.listen && options.port) {
    throw new Error("Cannot use --listen and --port together");
  }

  const daemonRunnerEntry = runtime.resolveRunnerEntry();
  const childEnv = buildChildEnv(options);
  const result = runtime.spawnForeground(
    process.execPath,
    [...process.execArgv, daemonRunnerEntry, ...buildRunnerArgs(options)],
    {
      env: childEnv,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

async function requestLifecycleShutdown(
  state: LocalDaemonState,
  timeoutMs: number,
): Promise<LifecycleShutdownAttempt> {
  const ownedListen = state.pidInfo?.listen;
  if (!ownedListen) {
    return {
      requested: false,
      reason: "daemon PID file has no listen target, falling back to owner PID signal",
    };
  }

  const host = resolveTcpHostFromListen(ownedListen);
  if (!host) {
    return {
      requested: false,
      reason: "daemon listen target is not TCP, falling back to owner PID signal",
    };
  }

  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());
  const client = await tryConnectToDaemon({ host, timeout: Math.min(remainingTimeoutMs(), 5000) });
  if (!client) {
    return {
      requested: false,
      reason: `daemon websocket at ${host} is not reachable, falling back to owner PID signal`,
    };
  }

  try {
    await client.shutdownServer({ timeout: Math.min(remainingTimeoutMs(), 5000) });
    return { requested: true };
  } catch (error) {
    return {
      requested: false,
      reason: `daemon lifecycle shutdown request failed (${getErrorMessage(
        error,
      )}), falling back to owner PID signal`,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function stopLocalDaemon(
  options: StopLocalDaemonOptions = {},
): Promise<StopLocalDaemonResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
  const state = resolveLocalDaemonState({ home: options.home });

  // The home-scoped PID file is the ownership proof. Without it, the configured
  // endpoint may belong to another daemon and must never receive a shutdown RPC.
  if (!state.pidInfo) {
    return createNotRunningStopResult(state, null, "Daemon is not running");
  }
  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());

  const shutdownAttempt = await requestLifecycleShutdown(state, remainingTimeoutMs());
  const lifecycleRequested = shutdownAttempt.requested;

  if (!state.running && !lifecycleRequested) {
    const staleSuffix =
      state.stalePidFile && state.pidInfo ? ` (stale PID file for ${state.pidInfo.pid})` : "";
    return createNotRunningStopResult(
      state,
      state.pidInfo?.pid ?? null,
      `Daemon is not running${staleSuffix}`,
    );
  }

  const pid = state.pidInfo?.pid ?? null;
  const fallbackMessage = shutdownAttempt.requested ? null : shutdownAttempt.reason;
  if (!lifecycleRequested) {
    const notRunningResult = await signalDaemonOwnerForStop(state, pid);
    if (notRunningResult) return notRunningResult;
  }

  const { stopped, forced } = await waitForStopAfterRequest({
    state,
    pid,
    timeoutMs: remainingTimeoutMs(),
    killTimeoutMs,
    force: options.force,
  });
  if (!stopped) {
    throw createStopTimeoutError(state, pid, timeoutMs);
  }

  if (lifecycleRequested) {
    removeStalePidFile(state);
  }

  return {
    action: "stopped",
    home: state.home,
    pid,
    forced,
    usedLifecycleRpc: lifecycleRequested,
    reason: resolveStopReason(forced, lifecycleRequested),
    message: resolveStopMessage(forced, lifecycleRequested, fallbackMessage),
  };
}
