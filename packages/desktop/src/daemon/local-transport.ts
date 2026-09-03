import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { userInfo, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import {
  buildSshTunnelArgs,
  DEFAULT_SSH_DAEMON_PORT,
  validatePort,
  validateSshHost,
} from "@getpaseo/protocol/ssh-transport";
import { app, BrowserWindow } from "electron";
import { Client as SshClient } from "ssh2";
import {
  createFileKnownHostsStore,
  sshHostKeyFingerprint,
  sshKnownHostsKey,
  verifySshHostKey,
  type KnownHostsStore,
} from "./ssh-known-hosts";
import {
  createHostKeyPromptManager,
  SSH_HOST_KEY_PROMPT_TIMEOUT_MS,
  type HostKeyPromptManager,
  type SshHostKeyPrompt,
} from "./ssh-host-key-prompt";
import { WebSocket, type RawData } from "ws";

export interface LocalTransportTarget {
  transportType: "socket" | "pipe";
  transportPath: string;
}

export interface SshTransportTarget {
  transportType: "ssh";
  host: string;
  sshPort?: number;
  daemonPort?: number;
  password?: string;
}

export type TransportTarget = LocalTransportTarget | SshTransportTarget;

export interface TransportEventPayload {
  sessionId: string;
  kind: "open" | "message" | "close" | "error";
  text?: string | null;
  binaryBase64?: string | null;
  code?: number | null;
  reason?: string | null;
  error?: string | null;
}

interface Session {
  id: string;
  target: TransportTarget;
  ws: TransportWebSocket | null;
  state: "opening" | "open" | "closed";
  closeTarget: (() => void) | null;
  cancelSetupDeadline: () => void;
}

interface OpenTransportSessionInput {
  sessionId: string;
  target: TransportTarget;
}

export interface TransportEndpoint {
  url: string;
  close: () => void;
  failureDetail: () => string | null;
}

export interface TransportWebSocket {
  readonly readyState: number;
  once(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: RawData, isBinary: boolean) => void): void;
  on(event: "close", listener: (code: number, reason?: Buffer | string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  send(data: string | Buffer, callback: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
}

export interface LocalTransportManagerDependencies {
  resolveEndpoint(target: TransportTarget): Promise<TransportEndpoint>;
  createWebSocket(url: string): TransportWebSocket;
  scheduleTimeout(callback: () => void, delayMs: number): () => void;
  emitEvent(payload: TransportEventPayload): void;
}

export interface LocalTransportManager {
  open(rawInput: unknown): void;
  send(input: { sessionId: string; text?: string; binaryBase64?: string }): Promise<void>;
  close(sessionId: string): void;
  closeAll(): void;
}

const WS_ENDPOINT_PATH = "/ws";
const SSH_STDERR_LIMIT = 8192;
// Long enough to cover a fingerprint dialog (120s) plus handshake slack; the
// renderer-side probe timeout is raised to match.
export const LOCAL_TRANSPORT_SETUP_TIMEOUT_MS = 180_000;
const SSH_CONNECT_TIMEOUT_MS = 10_000;
const SSH_HANDSHAKE_TIMEOUT_MS = SSH_CONNECT_TIMEOUT_MS + SSH_HOST_KEY_PROMPT_TIMEOUT_MS + 10_000;
const SSH_HOST_KEY_PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_SSH_PORT = 22;

let knownHostsStore: KnownHostsStore | null = null;
let hostKeyPromptManager: HostKeyPromptManager | null = null;

function getKnownHostsStore(): KnownHostsStore {
  if (knownHostsStore === null) {
    knownHostsStore = createFileKnownHostsStore(app.getPath("userData"));
  }
  return knownHostsStore;
}

function getHostKeyPromptManager(): HostKeyPromptManager {
  if (hostKeyPromptManager === null) {
    hostKeyPromptManager = createHostKeyPromptManager({
      emitPrompt: emitHostKeyPrompt,
      scheduleTimeout: (callback, delayMs) => {
        const timeout = setTimeout(callback, delayMs);
        timeout.unref();
        return () => clearTimeout(timeout);
      },
    });
  }
  return hostKeyPromptManager;
}

function emitHostKeyPrompt(prompt: SshHostKeyPrompt): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("paseo:event:ssh-host-key-prompt", prompt);
  }
}

/** IPC entry point: the renderer answers a host-key prompt. */
export function respondSshHostKeyPrompt(rawInput: unknown): void {
  const promptId =
    typeof rawInput === "object" && rawInput !== null && "promptId" in rawInput
      ? String((rawInput as { promptId: unknown }).promptId)
      : "";
  const decision =
    typeof rawInput === "object" && rawInput !== null && "decision" in rawInput
      ? String((rawInput as { decision: unknown }).decision)
      : "";
  if (!promptId || (decision !== "trust" && decision !== "cancel")) {
    return;
  }
  getHostKeyPromptManager().respond({ promptId, decision });
}

export function cancelAllSshHostKeyPrompts(): void {
  hostKeyPromptManager?.cancelAll();
}

function emitTransportEvent(payload: TransportEventPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("paseo:event:local-daemon-transport-event", payload);
  }
}

/**
 * Build a WebSocket URL that connects through a Unix domain socket or Windows
 * named pipe.  The `ws` library supports these via the `ws+unix://` scheme:
 *
 *   ws+unix:///path/to/socket:/ws
 *   ws+unix://./pipe/paseo:/ws        (Windows named pipe)
 *
 * The part before `:` is the IPC path, the part after is the HTTP request
 * path used during the WebSocket upgrade handshake.
 */
function buildLocalWebSocketUrl(target: LocalTransportTarget): string {
  const ipcPath = target.transportPath;
  return `ws+unix://${ipcPath}:${WS_ENDPOINT_PATH}`;
}

function describeTransportTarget(target: TransportTarget): string {
  if (target.transportType === "ssh") {
    return `Remote SSH host ${target.host}`;
  }
  return target.transportType === "pipe" ? "local daemon pipe" : "local daemon socket";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTransportTarget(value: unknown): TransportTarget {
  if (!isRecord(value)) {
    throw new Error("Desktop transport target must be an object.");
  }

  if (value.transportType === "socket" || value.transportType === "pipe") {
    const transportPath = typeof value.transportPath === "string" ? value.transportPath.trim() : "";
    if (!transportPath) {
      throw new Error("Local transport path is required.");
    }
    return { transportType: value.transportType, transportPath };
  }

  if (value.transportType === "ssh") return parseSshTransportTarget(value);
  throw new Error("Unsupported desktop transport type.");
}

function parseSshTransportTarget(value: Record<string, unknown>): SshTransportTarget {
  const host = validateSshHost(typeof value.host === "string" ? value.host : "");
  const sshPort =
    value.sshPort === undefined ? undefined : validatePortValue(value.sshPort, "SSH port");
  const daemonPort =
    value.daemonPort === undefined ? undefined : validatePortValue(value.daemonPort, "Daemon port");
  const password =
    typeof value.password === "string" && value.password.length > 0 ? value.password : undefined;
  return {
    transportType: "ssh",
    host,
    ...(sshPort !== undefined ? { sshPort } : {}),
    ...(daemonPort !== undefined ? { daemonPort } : {}),
    ...(password !== undefined ? { password } : {}),
  };
}

function validatePortValue(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`${label} must be between 1 and 65535.`);
  try {
    return validatePort(value, label);
  } catch {
    throw new Error(`${label} must be between 1 and 65535.`);
  }
}

function parseOpenTransportSessionInput(value: unknown): OpenTransportSessionInput {
  if (!isRecord(value)) {
    throw new Error("Desktop transport open input must be an object.");
  }

  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
    throw new Error("Desktop transport session ID is invalid.");
  }

  return {
    sessionId,
    target: parseTransportTarget(value.target),
  };
}

export function buildSshArgs(target: SshTransportTarget): string[] {
  return buildSshTunnelArgs({
    host: target.host,
    ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    daemonPort: target.daemonPort ?? DEFAULT_SSH_DAEMON_PORT,
  });
}

function formatSshFailure(
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const detail = stderr.trim();
  if (detail) return detail;
  if (signal) return `ssh exited with signal ${signal}`;
  return `ssh exited with code ${code ?? "unknown"}`;
}

function splitSshUserHost(host: string): { username: string; hostname: string } {
  const at = host.lastIndexOf("@");
  if (at === -1) {
    return { username: userInfo().username, hostname: host };
  }
  return { username: host.slice(0, at), hostname: host.slice(at + 1) };
}

export function describeSsh2Error(error: Error & { level?: string }): string {
  const message = error.message.trim();
  if (
    error.level === "client-authentication" ||
    /all configured authentication methods failed/iu.test(message)
  ) {
    return "Authentication failed (wrong username or password, or the host has password authentication disabled).";
  }
  if (/timed out while waiting for handshake/iu.test(message)) {
    return "Connection timed out";
  }
  return message.length > 0 ? message : "SSH connection failed";
}

export function resolveSshFailureDetail(failure: string | null, stderr: string): string | null {
  return failure ?? (stderr.trim() || null);
}

export function parseSshHostKeyType(hostKey: Buffer): string {
  if (hostKey.length < 5) {
    return "ssh";
  }
  const nameLength = hostKey.readUInt32BE(0);
  if (nameLength <= 0 || 4 + nameLength > hostKey.length) {
    return "ssh";
  }
  return hostKey.toString("utf8", 4, 4 + nameLength);
}

interface SshHostKeyProbe {
  hostKey: Buffer;
  keyType: string;
  fingerprint: string;
}

/**
 * Captures the remote host key without authenticating: a single 'none' auth
 * attempt after the handshake is enough to expose the key, and no credentials
 * are ever involved. Returns null when the host is unreachable or the probe
 * times out.
 */
export function probeSshHostKey(
  target: SshTransportTarget,
  deps?: { createClient?: () => SshClient },
): Promise<SshHostKeyProbe | null> {
  const { username, hostname } = splitSshUserHost(target.host);
  const client = deps?.createClient?.() ?? new SshClient();
  let resolveProbe!: (result: SshHostKeyProbe | null) => void;
  const promise = new Promise<SshHostKeyProbe | null>((resolve) => {
    resolveProbe = resolve;
  });
  let settled = false;
  const finish = (result: SshHostKeyProbe | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    try {
      client.end();
    } catch {
      // Best-effort teardown of a probe that already failed.
    }
    resolveProbe(result);
  };
  const timer = setTimeout(() => finish(null), SSH_HOST_KEY_PROBE_TIMEOUT_MS);
  timer.unref();
  client.on("error", () => finish(null));
  client.connect({
    host: hostname,
    port: target.sshPort ?? DEFAULT_SSH_PORT,
    username,
    readyTimeout: SSH_HOST_KEY_PROBE_TIMEOUT_MS,
    authHandler: () => false,
    hostVerifier: (hostKey: Buffer) => {
      finish({
        hostKey,
        keyType: parseSshHostKeyType(hostKey),
        fingerprint: sshHostKeyFingerprint(hostKey),
      });
      return true;
    },
  });
  return promise;
}

function formatKnownHostsPattern(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

export function buildManagedKnownHostsLine(input: {
  hostname: string;
  sshPort?: number;
  keyType: string;
  keyBase64: string;
}): string {
  const pattern =
    input.sshPort === undefined
      ? formatKnownHostsPattern(input.hostname)
      : `[${formatKnownHostsPattern(input.hostname)}]:${input.sshPort}`;
  return `${pattern} ${input.keyType} ${input.keyBase64}`;
}

function writeManagedKnownHostsFile(input: {
  target: SshTransportTarget;
  keyType: string;
  keyBase64: string;
}): { path: string; cleanup: () => void } {
  const line = buildManagedKnownHostsLine({
    hostname: splitSshUserHost(input.target.host).hostname,
    ...(input.target.sshPort !== undefined ? { sshPort: input.target.sshPort } : {}),
    keyType: input.keyType,
    keyBase64: input.keyBase64,
  });
  const filePath = join(tmpdir(), `byspace-ssh-known-hosts-${randomUUID()}`);
  writeFileSync(filePath, `${line}\n`, { mode: 0o600 });
  return {
    path: filePath,
    cleanup: () => {
      try {
        unlinkSync(filePath);
      } catch {
        // Best-effort cleanup of a per-connection temp file.
      }
    },
  };
}

export type KeyPathSpawnPreparation =
  | { outcome: "proceed"; extraArgs: string[]; cleanup: () => void }
  /** Probe failed (unreachable, timeout, config aliases) — fall back to the system ssh behavior. */
  | { outcome: "fallback" }
  | { outcome: "cancelled"; message: string };

/**
 * Decides whether a key-authenticated spawn may proceed: probe the host key,
 * prompt the user when it is new or changed, and hand ssh a managed
 * known_hosts file holding exactly the approved key. The user's own
 * known_hosts is never read or written for these connections.
 */
export async function prepareKeyPathSpawn(input: {
  target: SshTransportTarget;
  knownHostsStore: KnownHostsStore;
  promptManager: HostKeyPromptManager;
  probeSshHostKeyFn?: typeof probeSshHostKey;
}): Promise<KeyPathSpawnPreparation> {
  const probe = await (input.probeSshHostKeyFn ?? probeSshHostKey)(input.target);
  if (!probe) {
    return { outcome: "fallback" };
  }
  const knownHostsKey = sshKnownHostsKey({
    host: input.target.host,
    ...(input.target.sshPort !== undefined ? { sshPort: input.target.sshPort } : {}),
  });
  const pinned = await input.knownHostsStore.load();
  const verdict = verifySshHostKey({ knownHostsKey, fingerprint: probe.fingerprint }, pinned);
  if (verdict.action !== "accept") {
    const prompt: SshHostKeyPrompt =
      verdict.action === "accept-and-pin"
        ? {
            promptId: `ssh-host-key:${knownHostsKey}:${probe.fingerprint}`,
            target: input.target.host,
            kind: "first-use",
            fingerprint: probe.fingerprint,
          }
        : {
            promptId: `ssh-host-key:${knownHostsKey}:${probe.fingerprint}`,
            target: input.target.host,
            kind: "changed",
            fingerprint: probe.fingerprint,
            pinnedFingerprint: verdict.pinnedFingerprint,
          };
    const decision = await input.promptManager.ask(prompt);
    if (decision !== "trust") {
      return {
        outcome: "cancelled",
        message: `Connection to ${input.target.host} cancelled: the host key was not trusted.`,
      };
    }
    await input.knownHostsStore
      .save({ ...pinned, [knownHostsKey]: probe.fingerprint })
      .catch(() => undefined);
  }
  const file = writeManagedKnownHostsFile({
    target: input.target,
    keyType: probe.keyType,
    keyBase64: probe.hostKey.toString("base64"),
  });
  return {
    outcome: "proceed",
    extraArgs: [
      "-o",
      `UserKnownHostsFile=${file.path}`,
      "-o",
      `GlobalKnownHostsFile=${file.path}`,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "CheckHostIP=no",
    ],
    cleanup: file.cleanup,
  };
}

/**
 * Password-authenticated tunnels use ssh2 instead of the system ssh binary:
 * OpenSSH cannot be prompted for a password in batch mode, and shelling out
 * with the password would expose it to the process list or an askpass helper.
 * Host keys are only accepted after the user confirms the fingerprint in the
 * renderer prompt; the pin is stored so later connections can verify it.
 */
export function connectPasswordSshTunnel(input: {
  target: SshTransportTarget;
  acceptedSocket: Socket;
  knownHostsStore: KnownHostsStore;
  onFailure: (message: string) => void;
  promptManager?: HostKeyPromptManager;
}): SshClient {
  const { target, acceptedSocket, knownHostsStore: hostsStore, onFailure } = input;
  const promptManager = input.promptManager ?? getHostKeyPromptManager();
  const { username, hostname } = splitSshUserHost(target.host);
  const password = target.password ?? "";
  const daemonPort = target.daemonPort ?? DEFAULT_SSH_DAEMON_PORT;
  const client = new SshClient();

  client.on("ready", () => {
    client.forwardOut("127.0.0.1", 0, "127.0.0.1", daemonPort, (error, forwarded) => {
      if (error || !forwarded) {
        onFailure(
          `Failed to open daemon port ${daemonPort} on ${target.host}${
            error ? `: ${error.message}` : ""
          } (is the BySpace daemon running on the remote host?)`,
        );
        client.end();
        return;
      }
      forwarded.on("close", () => {
        acceptedSocket.destroy();
      });
      acceptedSocket.on("error", () => undefined);
      acceptedSocket.on("close", () => {
        forwarded.end();
        client.end();
      });
      forwarded.pipe(acceptedSocket);
      acceptedSocket.pipe(forwarded);
    });
  });

  // Some servers (notably Dropbear on embedded devices) only offer
  // keyboard-interactive instead of the plain password method.
  client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
    finish(prompts.map(() => password));
  });

  client.on("error", (error: Error & { level?: string }) => {
    onFailure(describeSsh2Error(error));
  });

  void (async () => {
    const knownHostsKey = sshKnownHostsKey({ host: target.host, sshPort: target.sshPort });
    const pinned = await hostsStore.load();
    client.connect({
      host: hostname,
      port: target.sshPort ?? DEFAULT_SSH_PORT,
      username,
      password,
      tryKeyboard: true,
      readyTimeout: SSH_HANDSHAKE_TIMEOUT_MS,
      // Async form: the handshake (and therefore the password) is suspended
      // until the user answers the fingerprint prompt in the renderer.
      hostVerifier: (hostKey: Buffer, verify: (accepted: boolean) => void) => {
        void verifyHostKeyWithPrompt({
          target,
          knownHostsKey,
          hostKey,
          pinned,
          hostsStore,
          onFailure,
          promptManager,
        })
          .then((trusted) => {
            verify(trusted);
            return undefined;
          })
          .catch(() => {
            verify(false);
            return undefined;
          });
      },
    });
  })().catch((error: Error) => {
    onFailure(error.message);
  });

  return client;
}

async function verifyHostKeyWithPrompt(input: {
  target: SshTransportTarget;
  knownHostsKey: string;
  hostKey: Buffer;
  pinned: Record<string, string>;
  hostsStore: KnownHostsStore;
  onFailure: (message: string) => void;
  promptManager: HostKeyPromptManager;
}): Promise<boolean> {
  const { target, knownHostsKey, hostKey, pinned, hostsStore, onFailure, promptManager } = input;
  const fingerprint = sshHostKeyFingerprint(hostKey);
  const verdict = verifySshHostKey({ knownHostsKey, fingerprint }, pinned);
  if (verdict.action === "accept") {
    return true;
  }
  const prompt: SshHostKeyPrompt =
    verdict.action === "accept-and-pin"
      ? {
          promptId: `ssh-host-key:${knownHostsKey}:${fingerprint}`,
          target: target.host,
          kind: "first-use",
          fingerprint,
        }
      : {
          promptId: `ssh-host-key:${knownHostsKey}:${fingerprint}`,
          target: target.host,
          kind: "changed",
          fingerprint,
          pinnedFingerprint: verdict.pinnedFingerprint,
        };
  const decision = await promptManager.ask(prompt);
  if (decision === "trust") {
    await hostsStore.save({ ...pinned, [knownHostsKey]: fingerprint }).catch(() => undefined);
    return true;
  }
  onFailure(`Connection to ${target.host} cancelled: the host key was not trusted.`);
  return false;
}

function createSshProxy(target: SshTransportTarget): Promise<TransportEndpoint> {
  let server: Server | null = null;
  let socket: Socket | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let conn: SshClient | null = null;
  let stderr = "";
  let failure: string | null = null;

  function close(): void {
    server?.close();
    server = null;
    socket?.destroy();
    socket = null;
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
    conn?.end();
    conn = null;
  }

  return new Promise((resolve, reject) => {
    server = createServer((acceptedSocket) => {
      socket = acceptedSocket;
      server?.close();
      server = null;

      if (target.password !== undefined) {
        conn = connectPasswordSshTunnel({
          target,
          acceptedSocket,
          knownHostsStore: getKnownHostsStore(),
          onFailure: (message) => {
            if (failure === null) {
              failure = message;
            }
            acceptedSocket.destroy();
          },
        });
        return;
      }

      void prepareKeyPathSpawn({
        target,
        knownHostsStore: getKnownHostsStore(),
        promptManager: getHostKeyPromptManager(),
      }).then((preparation) => {
        if (preparation.outcome === "proceed" && acceptedSocket.destroyed) {
          preparation.cleanup();
          return;
        }
        if (preparation.outcome === "cancelled") {
          failure = preparation.message;
          acceptedSocket.destroy();
          return;
        }
        const extraArgs = preparation.outcome === "proceed" ? preparation.extraArgs : [];
        const cleanup = preparation.outcome === "proceed" ? preparation.cleanup : () => undefined;

        child = spawn("ssh", [...buildSshArgs(target), ...extraArgs], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr = `${stderr}${chunk.toString()}`.slice(-SSH_STDERR_LIMIT);
        });
        child.on("error", (error) => {
          cleanup();
          failure = error.message;
          acceptedSocket.destroy(error);
        });
        child.on("exit", (code, signal) => {
          cleanup();
          if (code !== 0 || signal) {
            failure = formatSshFailure(stderr, code, signal);
          }
          acceptedSocket.destroy(failure ? new Error(failure) : undefined);
        });

        acceptedSocket.on("error", () => undefined);
        acceptedSocket.on("close", () => {
          if (child && !child.killed) {
            child.kill();
          }
          cleanup();
        });
        acceptedSocket.pipe(child.stdin);
        child.stdout.pipe(acceptedSocket);
        return undefined;
      });
      return undefined;
    });
    server.once("error", (error) => {
      close();
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        close();
        reject(new Error("Failed to allocate the Remote SSH proxy port."));
        return;
      }
      resolve({
        url: `ws://127.0.0.1:${address.port}${WS_ENDPOINT_PATH}`,
        close,
        failureDetail: () => resolveSshFailureDetail(failure, stderr),
      });
    });
  });
}

async function resolveTransportEndpoint(target: TransportTarget): Promise<TransportEndpoint> {
  if (target.transportType === "ssh") {
    return createSshProxy(target);
  }
  return {
    url: buildLocalWebSocketUrl(target),
    close: () => undefined,
    failureDetail: () => null,
  };
}

function decodeTransportMessage(input: { text?: string; binaryBase64?: string }): string | Buffer {
  if (typeof input.text === "string") {
    return input.text;
  }

  if (typeof input.binaryBase64 === "string") {
    return Buffer.from(input.binaryBase64, "base64");
  }

  throw new Error("Local transport send requires text or binary payload.");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLocalTransportManager(
  deps: LocalTransportManagerDependencies,
): LocalTransportManager {
  const sessions = new Map<string, Session>();

  function isCurrent(session: Session): boolean {
    return sessions.get(session.id) === session && session.state !== "closed";
  }

  function emitEvent(payload: TransportEventPayload): void {
    try {
      deps.emitEvent(payload);
    } catch {
      // A renderer may disappear while the main process is broadcasting an event.
    }
  }

  function disposeSession(session: Session): void {
    if (session.state === "closed") {
      return;
    }

    session.state = "closed";
    try {
      session.cancelSetupDeadline();
    } catch {
      // Continue releasing the socket and endpoint if a runtime adapter fails.
    }
    session.cancelSetupDeadline = () => undefined;
    if (sessions.get(session.id) === session) {
      sessions.delete(session.id);
    }

    const ws = session.ws;
    session.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch {
        // Closing is best-effort; the endpoint still owns the underlying transport.
      }
    }

    const closeTarget = session.closeTarget;
    session.closeTarget = null;
    try {
      closeTarget?.();
    } catch {
      // Closing is best-effort and must not prevent the registry from being released.
    }
  }

  function failOpeningSession(session: Session, message: string): void {
    if (!isCurrent(session) || session.state !== "opening") {
      return;
    }
    disposeSession(session);
    emitEvent({ sessionId: session.id, kind: "error", error: message });
  }

  async function connectSession(session: Session): Promise<void> {
    let endpoint: TransportEndpoint;
    try {
      endpoint = await deps.resolveEndpoint(session.target);
    } catch (error) {
      failOpeningSession(
        session,
        `Failed to connect to ${describeTransportTarget(session.target)}: ${getErrorMessage(error)}`,
      );
      return;
    }

    if (!isCurrent(session) || session.state !== "opening") {
      try {
        endpoint.close();
      } catch {
        // The cancelled session no longer owns any other resources to release.
      }
      return;
    }

    let targetClosed = false;
    session.closeTarget = () => {
      if (targetClosed) {
        return;
      }
      targetClosed = true;
      endpoint.close();
    };

    let ws: TransportWebSocket;
    try {
      ws = deps.createWebSocket(endpoint.url);
    } catch (error) {
      failOpeningSession(
        session,
        `Failed to connect to ${describeTransportTarget(session.target)}: ${getErrorMessage(error)}`,
      );
      return;
    }
    session.ws = ws;

    ws.once("open", () => {
      if (!isCurrent(session) || session.state !== "opening") {
        return;
      }
      session.cancelSetupDeadline();
      session.cancelSetupDeadline = () => undefined;
      session.state = "open";
      emitEvent({ sessionId: session.id, kind: "open" });
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isCurrent(session) || session.state !== "open") {
        return;
      }
      if (isBinary || data instanceof Buffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        emitEvent({
          sessionId: session.id,
          kind: "message",
          binaryBase64: buf.toString("base64"),
        });
        return;
      }

      emitEvent({
        sessionId: session.id,
        kind: "message",
        text: data.toString(),
      });
    });

    ws.on("close", (code: number, reason?: Buffer | string) => {
      if (!isCurrent(session)) {
        return;
      }
      if (session.state === "opening") {
        const failureDetail = endpoint.failureDetail();
        const detail = failureDetail ? `: ${failureDetail}` : "";
        failOpeningSession(
          session,
          `${describeTransportTarget(session.target)} closed before the session became ready${detail}.`,
        );
        return;
      }

      disposeSession(session);
      emitEvent({
        sessionId: session.id,
        kind: "close",
        code,
        reason: reason ? String(reason) : "",
      });
    });

    ws.on("error", (error: Error) => {
      if (!isCurrent(session)) {
        return;
      }
      const failureDetail = endpoint.failureDetail();
      const detail = failureDetail ? `${error.message}: ${failureDetail}` : error.message;
      if (session.state === "opening") {
        failOpeningSession(
          session,
          `Failed to connect to ${describeTransportTarget(session.target)}: ${detail}`,
        );
        return;
      }

      emitEvent({ sessionId: session.id, kind: "error", error: detail });
    });
  }

  function open(rawInput: unknown): void {
    const { sessionId, target } = parseOpenTransportSessionInput(rawInput);
    if (sessions.has(sessionId)) {
      throw new Error(`Local transport session already exists: ${sessionId}`);
    }

    const session: Session = {
      id: sessionId,
      target,
      ws: null,
      state: "opening",
      closeTarget: null,
      cancelSetupDeadline: () => undefined,
    };
    sessions.set(sessionId, session);
    session.cancelSetupDeadline = deps.scheduleTimeout(() => {
      failOpeningSession(
        session,
        `Connection to ${describeTransportTarget(target)} timed out during setup.`,
      );
    }, LOCAL_TRANSPORT_SETUP_TIMEOUT_MS);
    void connectSession(session);
  }

  async function send(input: {
    sessionId: string;
    text?: string;
    binaryBase64?: string;
  }): Promise<void> {
    const session = sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Local transport session not found: ${input.sessionId}`);
    }

    const ws = session.ws;
    if (session.state !== "open" || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        session.state === "opening"
          ? "Local transport session is not open yet."
          : "Local transport session is closed.",
      );
    }

    const payload = decodeTransportMessage(input);
    await new Promise<void>((resolve, reject) => {
      ws.send(payload, (error) => {
        if (error) {
          reject(new Error(`Local transport write failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  function close(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      disposeSession(session);
    }
  }

  function closeAll(): void {
    for (const session of sessions.values()) {
      disposeSession(session);
    }
  }

  return { open, send, close, closeAll };
}

const localTransportManager = createLocalTransportManager({
  resolveEndpoint: resolveTransportEndpoint,
  createWebSocket: (url) => new WebSocket(url),
  scheduleTimeout: (callback, delayMs) => {
    const timeout = setTimeout(callback, delayMs);
    timeout.unref();
    return () => clearTimeout(timeout);
  },
  emitEvent: emitTransportEvent,
});

export function openLocalTransportSession(rawInput: unknown): void {
  localTransportManager.open(rawInput);
}

export async function sendLocalTransportMessage(input: {
  sessionId: string;
  text?: string;
  binaryBase64?: string;
}): Promise<void> {
  await localTransportManager.send(input);
}

export function closeLocalTransportSession(sessionId: string): void {
  localTransportManager.close(sessionId);
}

export function closeAllTransportSessions(): void {
  localTransportManager.closeAll();
}
