import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { userInfo, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { Client as SshClient } from "ssh2";
import { WebSocket, type RawData } from "ws";
import {
  buildSshTunnelArgs,
  DEFAULT_SSH_DAEMON_PORT,
  validatePort,
  validateSshHost,
} from "@getpaseo/protocol/ssh-transport";
import {
  sshHostKeyFingerprint,
  sshKnownHostsKey,
  verifySshHostKey,
  type KnownHostsStore,
} from "./known-hosts.js";
import {
  createHostKeyPromptManager,
  type HostKeyPromptManager,
  type SshHostKeyPrompt,
} from "./host-key-prompt.js";

/**
 * Daemon-owned SSH tunnels: relay a WebSocket session from this daemon to a
 * remote daemon over SSH. Ported from the Electron local-transport (desktop
 * shell) so the web client keeps Remote SSH after the desktop retires.
 *
 * Key/agent auth shells out to the system ssh binary in batch mode — the
 * daemon never sees the credentials. Password auth runs an in-process ssh2
 * handshake; the password exists only for the lifetime of that handshake.
 */

const WS_ENDPOINT_PATH = "/ws";
const SSH_STDERR_LIMIT = 8192;
const SSH_CONNECT_TIMEOUT_MS = 10_000;
const SSH_HOST_KEY_PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_SSH_PORT = 22;
// Handshake timeout covers the host-key prompt round trip plus slack.
export const TUNNEL_SETUP_TIMEOUT_MS = 180_000;
export const DEFAULT_TUNNEL_MAX = 8;

export interface SshTunnelTarget {
  host: string;
  sshPort?: number;
  daemonPort?: number;
  password?: string;
}

export type TunnelAuthMode = "key" | "password";

export interface TunnelSshEventFrame {
  kind: "frame";
  tunnelId: string;
  text?: string;
  binaryBase64?: string;
}

export type TunnelEvent =
  | TunnelSshEventFrame
  | { kind: "state"; tunnelId: string; state: "opening" | "open" | "closed"; error: string | null }
  | { kind: "host-key-prompt"; prompt: SshHostKeyPrompt };

export interface SshHostKeyProbe {
  hostKey: Buffer;
  keyType: string;
  fingerprint: string;
}

export interface SshTunnelManagerOptions {
  knownHosts: KnownHostsStore;
  maxTunnels?: number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => () => void;
  spawnSsh?: typeof spawn;
  createSshClient?: () => SshClient;
  probeSshHostKeyFn?: typeof probeSshHostKey;
}

export interface TunnelHandle {
  readonly tunnelId: string;
  readonly state: "opening" | "open" | "closed";
  close(): void;
}

export interface TunnelListEntry {
  tunnelId: string;
  host: string;
  sshPort?: number;
  daemonPort?: number;
  authMode: TunnelAuthMode;
  state: "opening" | "open" | "closed";
  openedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitSshUserHost(host: string): { username: string; hostname: string } {
  const at = host.lastIndexOf("@");
  if (at === -1) {
    return { username: userInfo().username, hostname: host };
  }
  return { username: host.slice(0, at), hostname: host.slice(at + 1) };
}

function parseSshHostKeyType(hostKey: Buffer): string {
  if (hostKey.length < 5) {
    return "ssh";
  }
  const nameLength = hostKey.readUInt32BE(0);
  if (nameLength <= 0 || 4 + nameLength > hostKey.length) {
    return "ssh";
  }
  return hostKey.toString("utf8", 4, 4 + nameLength);
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

/**
 * Captures the remote host key without authenticating: a single 'none' auth
 * attempt after the handshake is enough to expose the key, and no credentials
 * are ever involved. Returns null when the host is unreachable or the probe
 * times out.
 */
export function probeSshHostKey(
  target: SshTunnelTarget,
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
  target: SshTunnelTarget;
  keyType: string;
  keyBase64: string;
}): { path: string; cleanup: () => void } {
  const line = buildManagedKnownHostsLine({
    hostname: splitSshUserHost(input.target.host).hostname,
    ...(input.target.sshPort !== undefined ? { sshPort: input.target.sshPort } : {}),
    keyType: input.keyType,
    keyBase64: input.keyBase64,
  });
  const filePath = join(tmpdir(), `byspace-tunnel-known-hosts-${randomUUID()}`);
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

interface TunnelRecord {
  tunnelId: string;
  target: SshTunnelTarget;
  authMode: TunnelAuthMode;
  readonly state: "opening" | "open" | "closed";
  openedAt: number;
  close(): void;
  receiveClientFrame(input: { text?: string; binaryBase64?: string }): void;
}

export class SshTunnelManager {
  private readonly tunnels = new Map<string, TunnelRecord>();
  private readonly knownHosts: KnownHostsStore;
  private readonly maxTunnels: number;
  /** Routes a host-key prompt to the session that owns the pending tunnel. */
  private readonly promptOwners = new Map<string, (event: TunnelEvent) => void>();
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => () => void;
  private readonly spawnSsh: typeof spawn;
  private readonly createSshClient: () => SshClient;
  private readonly probeFn: typeof probeSshHostKey;
  private readonly promptManager: HostKeyPromptManager;

  constructor(options: SshTunnelManagerOptions) {
    this.knownHosts = options.knownHosts;
    this.maxTunnels = options.maxTunnels ?? DEFAULT_TUNNEL_MAX;
    this.scheduleTimeout = options.scheduleTimeout ?? defaultScheduleTimeout;
    this.spawnSsh = options.spawnSsh ?? spawn;
    this.createSshClient = options.createSshClient ?? (() => new SshClient());
    this.probeFn = options.probeSshHostKeyFn ?? probeSshHostKey;
    this.promptManager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: this.scheduleTimeout,
    });
  }

  list(): TunnelListEntry[] {
    return [...this.tunnels.values()].map((tunnel) => {
      const entry: TunnelListEntry = {
        tunnelId: tunnel.tunnelId,
        host: tunnel.target.host,
        authMode: tunnel.authMode,
        state: tunnel.state,
        openedAt: tunnel.openedAt,
      };
      if (tunnel.target.sshPort !== undefined) entry.sshPort = tunnel.target.sshPort;
      if (tunnel.target.daemonPort !== undefined) {
        entry.daemonPort = tunnel.target.daemonPort;
      }
      return entry;
    });
  }

  respondHostKey(input: { promptId: string; decision: "trust" | "cancel" }): boolean {
    return this.promptManager.respond(input);
  }

  closeTunnel(tunnelId: string): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return true; // idempotent close
    tunnel.close();
    return true;
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      tunnel.close();
    }
    this.promptManager.cancelAll();
  }

  async probe(input: { host: string; sshPort?: number }): Promise<{
    reachable: boolean;
    fingerprint: string | null;
    keyType: string | null;
    pinnedFingerprint: string | null;
    verdict: "new" | "pinned" | "changed" | null;
  }> {
    const host = validateSshHost(input.host);
    const sshPort =
      input.sshPort === undefined ? undefined : validatePort(input.sshPort, "SSH port");
    const target: SshTunnelTarget = { host, ...(sshPort !== undefined ? { sshPort } : {}) };
    const probe = await this.probeFn(target, { createClient: this.createSshClient });
    if (!probe) {
      return {
        reachable: false,
        fingerprint: null,
        keyType: null,
        pinnedFingerprint: null,
        verdict: null,
      };
    }
    const knownHostsKey = sshKnownHostsKey({ host, ...(sshPort !== undefined ? { sshPort } : {}) });
    const pinned = await this.knownHosts.load();
    const pinnedFingerprint = pinned[knownHostsKey] ?? null;
    let verdict: "new" | "pinned" | "changed";
    if (pinnedFingerprint === null) {
      verdict = "new";
    } else if (pinnedFingerprint === probe.fingerprint) {
      verdict = "pinned";
    } else {
      verdict = "changed";
    }
    return {
      reachable: true,
      fingerprint: probe.fingerprint,
      keyType: probe.keyType,
      pinnedFingerprint,
      verdict,
    };
  }

  async open(input: {
    tunnelId: string;
    host: string;
    sshPort?: number;
    daemonPort?: number;
    authMode: TunnelAuthMode;
    password?: string;
    emitEvent: (event: TunnelEvent) => void;
  }): Promise<{ ok: true } | { ok: false; error: string; errorCode: string }> {
    if (this.tunnels.has(input.tunnelId)) {
      return {
        ok: false,
        error: `Tunnel already exists: ${input.tunnelId}`,
        errorCode: "already_exists",
      };
    }
    const active = [...this.tunnels.values()].filter((t) => t.state !== "closed").length;
    if (active >= this.maxTunnels) {
      return {
        ok: false,
        error: `Tunnel limit reached (${this.maxTunnels}). Close an existing tunnel first.`,
        errorCode: "limit_reached",
      };
    }
    if (input.authMode === "password" && !input.password) {
      return {
        ok: false,
        error: "Password auth requires a password.",
        errorCode: "password_required",
      };
    }

    const host = validateSshHost(input.host);
    const sshPort =
      input.sshPort === undefined ? undefined : validatePort(input.sshPort, "SSH port");
    const daemonPort =
      input.daemonPort === undefined ? undefined : validatePort(input.daemonPort, "Daemon port");
    const target: SshTunnelTarget = {
      host,
      ...(sshPort !== undefined ? { sshPort } : {}),
      ...(daemonPort !== undefined ? { daemonPort } : {}),
      ...(input.password !== undefined ? { password: input.password } : {}),
    };

    const record = this.startTunnel(input.tunnelId, target, input.authMode, input.emitEvent);
    this.tunnels.set(input.tunnelId, record);
    return { ok: true };
  }

  sendFrame(input: { tunnelId: string; text?: string; binaryBase64?: string }): boolean {
    const tunnel = this.tunnels.get(input.tunnelId);
    if (!tunnel || tunnel.state === "closed") {
      return false;
    }
    tunnel.receiveClientFrame(input);
    return true;
  }

  private startTunnel(
    tunnelId: string,
    target: SshTunnelTarget,
    authMode: TunnelAuthMode,
    emitEvent: (event: TunnelEvent) => void,
  ): TunnelRecord {
    let server: Server | null = null;
    let socket: Socket | null = null;
    let child: ChildProcessWithoutNullStreams | null = null;
    let conn: SshClient | null = null;
    let ws: WebSocket | null = null;
    let stderr = "";
    let failure: string | null = null;
    let state: "opening" | "open" | "closed" = "opening";
    let cancelSetupDeadline: () => void = () => undefined;

    const setState = (next: "opening" | "open" | "closed", error: string | null = null): void => {
      if (state === "closed" && next === "closed") return;
      state = next;
      emitEvent({ kind: "state", tunnelId, state: next, error });
      if (next === "closed") {
        this.tunnels.delete(tunnelId);
      }
    };

    const record: TunnelRecord = {
      tunnelId,
      target,
      authMode,
      openedAt: Date.now(),
      get state() {
        return state;
      },
      close() {
        if (state === "closed") return;
        cancelSetupDeadline();
        server?.close();
        server = null;
        socket?.destroy();
        socket = null;
        if (child && !child.killed) child.kill();
        child = null;
        conn?.end();
        conn = null;
        if (ws) {
          try {
            if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
            else if (ws.readyState === WebSocket.OPEN) ws.close();
          } catch {
            // Best-effort close.
          }
        }
        ws = null;
        setState("closed", failure);
      },
      receiveClientFrame(input) {
        let payload: string | Buffer | null = null;
        if (typeof input.text === "string") {
          payload = input.text;
        } else if (typeof input.binaryBase64 === "string") {
          payload = Buffer.from(input.binaryBase64, "base64");
        }
        if (payload === null) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(payload, (error) => {
            if (error) {
              failure = `Tunnel write failed: ${error.message}`;
              record.close();
            }
          });
        } else if (child && child.stdin.writable) {
          child.stdin.write(payload);
        }
      },
    };

    cancelSetupDeadline = this.scheduleTimeout(() => {
      if (state === "opening") {
        failure = "Tunnel setup timed out.";
        record.close();
      }
    }, TUNNEL_SETUP_TIMEOUT_MS);

    // Dialed from the daemon through its own tunnel listener: the HTTP
    // upgrade travels over SSH to the remote daemon, so "open" fires only
    // after the remote daemon answers.
    const forwardFrame = (data: RawData, isBinary: boolean): void => {
      if (state !== "open") return;
      if (isBinary || data instanceof Buffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        emitEvent({
          kind: "frame",
          tunnelId,
          binaryBase64: buf.toString("base64"),
        });
        return;
      }
      emitEvent({ kind: "frame", tunnelId, text: data.toString() });
    };

    const dialThroughTunnel = (listenPort: number): void => {
      ws = new WebSocket(`ws://127.0.0.1:${listenPort}${WS_ENDPOINT_PATH}`);
      ws.on("open", () => {
        setState("open");
      });
      ws.on("message", forwardFrame);
      ws.on("close", (code: number, reason: Buffer | string) => {
        if (state === "opening") {
          failure =
            failure ??
            `Remote daemon closed the connection before the session became ready (code ${code}${
              reason ? `: ${reason}` : ""
            }).`;
        }
        record.close();
      });
      ws.on("error", (error: Error) => {
        const detail = failure ? `${error.message}: ${failure}` : error.message;
        if (state === "opening") {
          failure = `Failed to connect to the remote daemon: ${detail}`;
        }
        record.close();
      });
    };

    server = createServer((acceptedSocket) => {
      socket = acceptedSocket;
      server?.close();
      server = null;

      if (authMode === "password") {
        conn = this.connectPasswordTunnel(target, acceptedSocket, {
          onReady: () => undefined,
          onFailure: (message: string) => {
            if (failure === null) failure = message;
            record.close();
          },
          emitEvent,
        });
        return;
      }

      void (async () => {
        const preparation = await this.prepareKeyPathSpawn({ target, emitEvent });
        if (preparation.outcome === "proceed" && acceptedSocket.destroyed) {
          preparation.cleanup();
          return;
        }
        if (preparation.outcome === "cancelled") {
          failure = preparation.message;
          record.close();
          return;
        }
        const extraArgs = preparation.outcome === "proceed" ? preparation.extraArgs : [];
        const cleanup = preparation.outcome === "proceed" ? preparation.cleanup : () => undefined;

        child = this.spawnSsh(
          "ssh",
          [
            ...buildSshTunnelArgs({
              host: target.host,
              ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
              daemonPort: target.daemonPort ?? DEFAULT_SSH_DAEMON_PORT,
            }),
            ...extraArgs,
          ],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        ) as ChildProcessWithoutNullStreams;
        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr = `${stderr}${chunk.toString()}`.slice(-SSH_STDERR_LIMIT);
        });
        child.on("error", (error: Error) => {
          cleanup();
          failure = error.message;
          record.close();
        });
        child.on("exit", (code, signal) => {
          cleanup();
          if (state !== "closed" && (code !== 0 || signal)) {
            const detail = stderr.trim();
            if (failure === null) {
              if (detail) {
                failure = detail;
              } else if (signal) {
                failure = `ssh exited with signal ${signal}`;
              } else {
                failure = `ssh exited with code ${code ?? "unknown"}`;
              }
            }
          }
          record.close();
        });

        acceptedSocket.on("error", () => undefined);
        acceptedSocket.on("close", () => {
          if (child && !child.killed) child.kill();
          cleanup();
        });
        acceptedSocket.pipe(child.stdin);
        child.stdout.pipe(acceptedSocket);
        return undefined;
      })().catch((error: Error) => {
        failure = error.message;
        record.close();
      });
    });
    server.once("error", (error: Error) => {
      failure = error.message;
      record.close();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        failure = "Failed to allocate the SSH tunnel port.";
        record.close();
        return;
      }
      dialThroughTunnel(address.port);
    });

    return record;
  }

  /**
   * Key-auth spawn preparation: probe the host key, prompt the client when it
   * is new or changed, and hand ssh a managed known_hosts file holding
   * exactly the approved key. The daemon user's own known_hosts is never
   * read or written for these connections.
   */
  private async prepareKeyPathSpawn(input: {
    target: SshTunnelTarget;
    emitEvent: (event: TunnelEvent) => void;
  }): Promise<
    | { outcome: "proceed"; extraArgs: string[]; cleanup: () => void }
    | { outcome: "fallback" }
    | { outcome: "cancelled"; message: string }
  > {
    const probe = await this.probeFn(input.target, { createClient: this.createSshClient });
    if (!probe) {
      return { outcome: "fallback" };
    }
    const knownHostsKey = sshKnownHostsKey({
      host: input.target.host,
      ...(input.target.sshPort !== undefined ? { sshPort: input.target.sshPort } : {}),
    });
    const pinned = await this.knownHosts.load();
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
      const decision = await this.askHostKeyPrompt(prompt, input.emitEvent);
      if (decision !== "trust") {
        return {
          outcome: "cancelled",
          message: `Connection to ${input.target.host} cancelled: the host key was not trusted.`,
        };
      }
      await this.knownHosts
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
   * with the password would expose it to the process list or an askpass
   * helper. Host keys are only accepted after the client confirms the
   * fingerprint; the pin is stored so later connections can verify it.
   */
  private connectPasswordTunnel(
    target: SshTunnelTarget,
    acceptedSocket: Socket,
    callbacks: {
      onReady: () => void;
      onFailure: (message: string) => void;
      emitEvent: (event: TunnelEvent) => void;
    },
  ): SshClient {
    const { username, hostname } = splitSshUserHost(target.host);
    const password = target.password ?? "";
    const daemonPort = target.daemonPort ?? DEFAULT_SSH_DAEMON_PORT;
    const client = this.createSshClient();
    const SSH_HANDSHAKE_TIMEOUT_MS = SSH_CONNECT_TIMEOUT_MS + 120_000 + 10_000;

    client.on("ready", () => {
      client.forwardOut("127.0.0.1", 0, "127.0.0.1", daemonPort, (error, forwarded) => {
        if (error || !forwarded) {
          callbacks.onFailure(
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
        callbacks.onReady();
      });
    });

    // Some servers (notably Dropbear on embedded devices) only offer
    // keyboard-interactive instead of the plain password method.
    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => password));
    });

    client.on("error", (error: Error & { level?: string }) => {
      callbacks.onFailure(describeSsh2Error(error));
    });

    void (async () => {
      const knownHostsKey = sshKnownHostsKey({ host: target.host, sshPort: target.sshPort });
      const pinned = await this.knownHosts.load();
      client.connect({
        host: hostname,
        port: target.sshPort ?? DEFAULT_SSH_PORT,
        username,
        password,
        tryKeyboard: true,
        readyTimeout: SSH_HANDSHAKE_TIMEOUT_MS,
        // Async form: the handshake (and therefore the password) is suspended
        // until the client answers the fingerprint prompt.
        hostVerifier: (hostKey: Buffer, verify: (accepted: boolean) => void) => {
          void this.verifyHostKeyWithPrompt({
            target,
            knownHostsKey,
            hostKey,
            pinned,
            emitEvent: callbacks.emitEvent,
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
      callbacks.onFailure(error.message);
    });

    return client;
  }

  /** Registers the owning tunnel's emitter for a prompt, asks, then unregisters. */
  private async askHostKeyPrompt(
    prompt: SshHostKeyPrompt,
    emitEvent: (event: TunnelEvent) => void,
  ): Promise<"trust" | "cancel"> {
    this.promptOwners.set(prompt.promptId, emitEvent);
    try {
      return await this.promptManager.ask(prompt);
    } finally {
      this.promptOwners.delete(prompt.promptId);
    }
  }

  private async verifyHostKeyWithPrompt(input: {
    target: SshTunnelTarget;
    knownHostsKey: string;
    hostKey: Buffer;
    pinned: Record<string, string>;
    emitEvent: (event: TunnelEvent) => void;
  }): Promise<boolean> {
    const { target, knownHostsKey, hostKey, pinned } = input;
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
    const decision = await this.askHostKeyPrompt(prompt, input.emitEvent);
    if (decision === "trust") {
      await this.knownHosts
        .save({ ...pinned, [knownHostsKey]: fingerprint })
        .catch(() => undefined);
      return true;
    }
    return false;
  }
}

function defaultScheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timeout = setTimeout(callback, delayMs);
  timeout.unref();
  return () => clearTimeout(timeout);
}

export function parseTunnelOpenInput(value: unknown): {
  tunnelId: string;
  host: string;
  sshPort?: number;
  daemonPort?: number;
  authMode: TunnelAuthMode;
  password?: string;
} {
  if (!isRecord(value)) {
    throw new Error("Tunnel open input must be an object.");
  }
  const tunnelId = typeof value.tunnelId === "string" ? value.tunnelId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(tunnelId)) {
    throw new Error("Tunnel ID is invalid.");
  }
  const authMode = value.authMode === "password" ? "password" : "key";
  const password =
    typeof value.password === "string" && value.password.length > 0 ? value.password : undefined;
  if (authMode === "password" && !password) {
    throw new Error("Password auth requires a password.");
  }
  return {
    tunnelId,
    host: typeof value.host === "string" ? value.host : "",
    ...(typeof value.sshPort === "number" ? { sshPort: value.sshPort } : {}),
    ...(typeof value.daemonPort === "number" ? { daemonPort: value.daemonPort } : {}),
    authMode,
    ...(password !== undefined ? { password } : {}),
  };
}
