import { describe, expect, it, vi } from "vitest";
import {
  buildSshArgs,
  buildManagedKnownHostsLine,
  connectPasswordSshTunnel,
  createLocalTransportManager,
  describeSsh2Error,
  LOCAL_TRANSPORT_SETUP_TIMEOUT_MS,
  parseSshHostKeyType,
  parseTransportTarget,
  prepareKeyPathSpawn,
  resolveSshFailureDetail,
  type TransportEndpoint,
  type TransportEventPayload,
  type TransportWebSocket,
} from "./local-transport";
import { createHostKeyPromptManager, type SshHostKeyPrompt } from "./ssh-host-key-prompt";
import { createInMemoryKnownHostsStore, sshHostKeyFingerprint } from "./ssh-known-hosts";

interface FakeSshClient {
  handlers: Map<string, (...args: never[]) => void>;
  connect: ReturnType<typeof vi.fn> & { mock: { calls: Array<Record<string, unknown>> } };
  forwardOut: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

vi.mock("ssh2", () => {
  class FakeSshClient {
    static readonly instances: FakeSshClient[] = [];
    handlers = new Map<string, (...args: never[]) => void>();
    on = vi.fn((event: string, handler: never) => {
      this.handlers.set(event, handler as (...args: never[]) => void);
    });
    connect = vi.fn();
    forwardOut = vi.fn();
    end = vi.fn();

    constructor() {
      FakeSshClient.instances.push(this);
    }
  }
  return { Client: FakeSshClient };
});

async function createSshClientHarness(): Promise<FakeSshClient[]> {
  const mod = (await import("ssh2")) as unknown as {
    Client: { new (): FakeSshClient; instances: FakeSshClient[] };
  };
  mod.Client.instances.length = 0;
  return mod.Client.instances;
}

const SESSION_INPUT = {
  sessionId: "local-session-test",
  target: { transportType: "ssh", host: "build-box" },
} as const;

function createConnectingSocket(): TransportWebSocket & {
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} {
  return {
    readyState: 0,
    once: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  } as unknown as TransportWebSocket & {
    close: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  };
}

function createEndpoint(): TransportEndpoint & { close: ReturnType<typeof vi.fn> } {
  return {
    url: "ws://127.0.0.1:12345/ws",
    close: vi.fn(),
    failureDetail: () => null,
  };
}

interface ScheduledTimeout {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
}

function createManagerHarness(
  resolveEndpoint: () => Promise<TransportEndpoint>,
  sockets: TransportWebSocket[],
) {
  const events: TransportEventPayload[] = [];
  const scheduledTimeouts: ScheduledTimeout[] = [];
  const createWebSocket = vi.fn(() => {
    const socket = sockets.shift();
    if (!socket) {
      throw new Error("No fake WebSocket is available");
    }
    return socket;
  });
  const manager = createLocalTransportManager({
    resolveEndpoint,
    createWebSocket,
    scheduleTimeout(callback, delayMs) {
      const scheduled = { callback, delayMs, cancelled: false };
      scheduledTimeouts.push(scheduled);
      return () => {
        scheduled.cancelled = true;
      };
    },
    emitEvent: (event) => events.push(event),
  });
  return { createWebSocket, events, manager, scheduledTimeouts };
}

describe("Remote SSH desktop transport", () => {
  it("builds a batch-mode SSH stdio tunnel with optional connection settings", () => {
    expect(
      buildSshArgs({
        transportType: "ssh",
        host: "deploy@example.com",
        sshPort: 2222,
        daemonPort: 7777,
      }),
    ).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-p",
      "2222",
      "-W",
      "127.0.0.1:7777",
      "deploy@example.com",
    ]);
  });

  it("rejects unsafe SSH targets at the IPC boundary", () => {
    expect(() =>
      parseTransportTarget({ transportType: "ssh", host: "-oProxyCommand=bad" }),
    ).toThrow("SSH host is invalid");
    expect(() =>
      parseTransportTarget({ transportType: "ssh", host: "build-box", sshPort: 0 }),
    ).toThrow("SSH port must be between 1 and 65535");
    expect(() =>
      parseTransportTarget({ transportType: "ssh", host: "build-box", daemonPort: 65536 }),
    ).toThrow("Daemon port must be between 1 and 65535");
  });

  it("surfaces SSH stderr before the child exit event settles", () => {
    expect(resolveSshFailureDetail(null, "Permission denied.\n")).toBe("Permission denied.");
    expect(resolveSshFailureDetail("ssh exited with code 255", "earlier stderr")).toBe(
      "ssh exited with code 255",
    );
  });
});

describe("password SSH transport", () => {
  const passwordTarget = {
    transportType: "ssh",
    host: "deploy@example.com",
    password: "s3cret",
  } as const;

  function createFakeSocket(): Record<"on" | "once", ReturnType<typeof vi.fn>> & {
    destroy: ReturnType<typeof vi.fn>;
    pipe: ReturnType<typeof vi.fn>;
  } {
    return {
      on: vi.fn(),
      once: vi.fn(),
      destroy: vi.fn(),
      pipe: vi.fn(),
    };
  }

  async function createClientHarness() {
    return createSshClientHarness();
  }

  it("parses the password from the IPC target", () => {
    expect(parseTransportTarget(passwordTarget)).toEqual(passwordTarget);
    expect(parseTransportTarget({ transportType: "ssh", host: "build-box", password: "" })).toEqual(
      { transportType: "ssh", host: "build-box" },
    );
  });

  it("asks the user on first use, pins on trust, and forwards to the daemon port", async () => {
    const instances = await createClientHarness();
    const store = createInMemoryKnownHostsStore();
    const failures: string[] = [];
    const prompts: SshHostKeyPrompt[] = [];
    const promptManager = createHostKeyPromptManager({
      emitPrompt: (prompt) => prompts.push(prompt),
      scheduleTimeout: () => () => undefined,
    });

    connectPasswordSshTunnel({
      target: passwordTarget,
      acceptedSocket: createFakeSocket() as never,
      knownHostsStore: store,
      onFailure: (message) => failures.push(message),
      promptManager,
    });
    const client = instances[0]!;
    await Promise.resolve();

    (client.handlers.get("ready") as () => void)();
    expect(client.forwardOut).toHaveBeenCalledWith(
      "127.0.0.1",
      0,
      "127.0.0.1",
      6777,
      expect.any(Function),
    );
    expect(client.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "example.com",
        username: "deploy",
        password: "s3cret",
        port: 22,
      }),
    );

    const connectConfig = client.connect.mock.calls[0]![0] as {
      hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => void;
    };
    const verify = vi.fn();
    const verifierResult = connectConfig.hostVerifier(Buffer.from("first-key"), verify);
    expect(verifierResult).toBeUndefined();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ target: "deploy@example.com", kind: "first-use" });

    promptManager.respond({ promptId: prompts[0]!.promptId, decision: "trust" });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith(true));
    expect((await store.load())["deploy@example.com"]).toBe(
      sshHostKeyFingerprint(Buffer.from("first-key")),
    );
    expect(failures).toEqual([]);
  });

  it("fails the handshake when the user rejects the fingerprint", async () => {
    const instances = await createClientHarness();
    const store = createInMemoryKnownHostsStore();
    const failures: string[] = [];
    const prompts: SshHostKeyPrompt[] = [];
    const promptManager = createHostKeyPromptManager({
      emitPrompt: (prompt) => prompts.push(prompt),
      scheduleTimeout: () => () => undefined,
    });

    connectPasswordSshTunnel({
      target: passwordTarget,
      acceptedSocket: createFakeSocket() as never,
      knownHostsStore: store,
      onFailure: (message) => failures.push(message),
      promptManager,
    });
    const client = instances[0]!;
    await Promise.resolve();

    const connectConfig = client.connect.mock.calls[0]![0] as {
      hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => void;
    };
    const verify = vi.fn();
    connectConfig.hostVerifier(Buffer.from("first-key"), verify);
    promptManager.respond({ promptId: prompts[0]!.promptId, decision: "cancel" });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith(false));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("not trusted");
    expect(await store.load()).toEqual({});
  });

  it("prompts with both fingerprints when the pinned key changes", async () => {
    const instances = await createClientHarness();
    const store = createInMemoryKnownHostsStore({ "deploy@example.com": "SHA256:pinned" });
    const failures: string[] = [];
    const prompts: SshHostKeyPrompt[] = [];
    const promptManager = createHostKeyPromptManager({
      emitPrompt: (prompt) => prompts.push(prompt),
      scheduleTimeout: () => () => undefined,
    });

    connectPasswordSshTunnel({
      target: passwordTarget,
      acceptedSocket: createFakeSocket() as never,
      knownHostsStore: store,
      onFailure: (message) => failures.push(message),
      promptManager,
    });
    const client = instances[0]!;
    await Promise.resolve();

    const connectConfig = client.connect.mock.calls[0]![0] as {
      hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => void;
    };
    const verify = vi.fn();
    connectConfig.hostVerifier(Buffer.from("attacker-key"), verify);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      kind: "changed",
      pinnedFingerprint: "SHA256:pinned",
      fingerprint: sshHostKeyFingerprint(Buffer.from("attacker-key")),
    });

    promptManager.respond({ promptId: prompts[0]!.promptId, decision: "trust" });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith(true));
    expect((await store.load())["deploy@example.com"]).toBe(
      sshHostKeyFingerprint(Buffer.from("attacker-key")),
    );
    expect(failures).toEqual([]);
  });

  it("accepts a known fingerprint without prompting", async () => {
    const instances = await createClientHarness();
    const knownFingerprint = sshHostKeyFingerprint(Buffer.from("first-key"));
    const store = createInMemoryKnownHostsStore({ "deploy@example.com": knownFingerprint });
    const prompts: SshHostKeyPrompt[] = [];
    const promptManager = createHostKeyPromptManager({
      emitPrompt: (prompt) => prompts.push(prompt),
      scheduleTimeout: () => () => undefined,
    });

    connectPasswordSshTunnel({
      target: passwordTarget,
      acceptedSocket: createFakeSocket() as never,
      knownHostsStore: store,
      onFailure: () => undefined,
      promptManager,
    });
    const client = instances[0]!;
    await Promise.resolve();

    const connectConfig = client.connect.mock.calls[0]![0] as {
      hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => void;
    };
    const verify = vi.fn();
    connectConfig.hostVerifier(Buffer.from("first-key"), verify);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith(true));
    expect(prompts).toEqual([]);
  });

  it("maps ssh2 failures to readable messages", () => {
    expect(
      describeSsh2Error({
        level: "client-authentication",
        message: "All configured authentication methods failed",
      }),
    ).toContain("Authentication failed");
    expect(describeSsh2Error({ message: "Timed out while waiting for handshake" })).toBe(
      "Connection timed out",
    );
    expect(describeSsh2Error({ message: "connect ECONNREFUSED" })).toBe("connect ECONNREFUSED");
    expect(describeSsh2Error({ message: "  " })).toBe("SSH connection failed");
  });

  it("parses the SSH key type from the wire-format host key", () => {
    const keyType = "ssh-ed25519";
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32BE(keyType.length, 0);
    const hostKey = Buffer.concat([nameLength, Buffer.from(keyType), Buffer.from("key-bytes")]);
    expect(parseSshHostKeyType(hostKey)).toBe("ssh-ed25519");
    expect(parseSshHostKeyType(Buffer.from("tiny"))).toBe("ssh");
  });

  it("builds managed known_hosts lines with bracketed non-standard ports", () => {
    expect(
      buildManagedKnownHostsLine({
        hostname: "example.com",
        keyType: "ssh-ed25519",
        keyBase64: "AAA",
      }),
    ).toBe("example.com ssh-ed25519 AAA");
    expect(
      buildManagedKnownHostsLine({
        hostname: "example.com",
        sshPort: 2222,
        keyType: "ssh-ed25519",
        keyBase64: "AAA",
      }),
    ).toBe("[example.com]:2222 ssh-ed25519 AAA");
  });

  it("prompts on first use and stages a pinned known_hosts file for key-path spawns", async () => {
    const store = createInMemoryKnownHostsStore();
    const prompts: SshHostKeyPrompt[] = [];
    const promptManager = createHostKeyPromptManager({
      emitPrompt: (prompt) => prompts.push(prompt),
      scheduleTimeout: () => () => undefined,
    });
    const hostKey = Buffer.concat([
      Buffer.from([0, 0, 0, 11]),
      Buffer.from("ssh-ed25519"),
      Buffer.from("key-bytes"),
    ]);
    const probe = { hostKey, keyType: "ssh-ed25519", fingerprint: sshHostKeyFingerprint(hostKey) };
    const target = { transportType: "ssh", host: "deploy@example.com" } as const;

    const firstPromise = prepareKeyPathSpawn({
      target,
      knownHostsStore: store,
      promptManager,
      probeSshHostKeyFn: () => Promise.resolve(probe),
    });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]).toMatchObject({ target: "deploy@example.com", kind: "first-use" });
    promptManager.respond({ promptId: prompts[0]!.promptId, decision: "cancel" });
    expect(await firstPromise).toMatchObject({ outcome: "cancelled" });

    // Trust: pin is saved and ssh is pointed at a managed known_hosts file.
    const second = await prepareKeyPathSpawn({
      target,
      knownHostsStore: store,
      promptManager: {
        ask: (prompt) => {
          prompts.push(prompt);
          return Promise.resolve("trust");
        },
        respond: () => undefined,
        cancelAll: () => undefined,
      },
      probeSshHostKeyFn: () => Promise.resolve(probe),
    });
    expect(second.outcome).toBe("proceed");
    if (second.outcome === "proceed") {
      expect(second.extraArgs).toContain("StrictHostKeyChecking=yes");
      expect(second.extraArgs.some((arg) => arg.startsWith("UserKnownHostsFile="))).toBe(true);
      second.cleanup();
    }
    expect((await store.load())["deploy@example.com"]).toBe(probe.fingerprint);
    expect(prompts).toHaveLength(2);
  });

  it("re-prompts when the key changes and prompts nothing when the pin matches", async () => {
    const hostKey = Buffer.concat([
      Buffer.from([0, 0, 0, 11]),
      Buffer.from("ssh-ed25519"),
      Buffer.from("key-bytes"),
    ]);
    const target = { transportType: "ssh", host: "deploy@example.com" } as const;
    const probe = { hostKey, keyType: "ssh-ed25519", fingerprint: sshHostKeyFingerprint(hostKey) };

    // Known fingerprint: no prompt, straight to proceed.
    const prompts: SshHostKeyPrompt[] = [];
    const store = createInMemoryKnownHostsStore({
      "deploy@example.com": sshHostKeyFingerprint(hostKey),
    });
    const result = await prepareKeyPathSpawn({
      target,
      knownHostsStore: store,
      promptManager: {
        ask: (prompt) => {
          prompts.push(prompt);
          return Promise.resolve("cancel");
        },
        respond: () => undefined,
        cancelAll: () => undefined,
      },
      probeSshHostKeyFn: () => Promise.resolve(probe),
    });
    expect(result.outcome).toBe("proceed");
    expect(prompts).toEqual([]);

    // Changed fingerprint with a rejecting user: cancelled.
    const changedKey = Buffer.concat([
      Buffer.from([0, 0, 0, 11]),
      Buffer.from("ssh-ed25519"),
      Buffer.from("other-bytes"),
    ]);
    const changedProbe = {
      hostKey: changedKey,
      keyType: "ssh-ed25519",
      fingerprint: sshHostKeyFingerprint(changedKey),
    };
    const result2 = await prepareKeyPathSpawn({
      target,
      knownHostsStore: store,
      promptManager: {
        ask: (prompt) => {
          prompts.push(prompt);
          return Promise.resolve("cancel");
        },
        respond: () => undefined,
        cancelAll: () => undefined,
      },
      probeSshHostKeyFn: () => Promise.resolve(changedProbe),
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ kind: "changed" });
    expect(result2.outcome).toBe("cancelled");
  });
});

describe("local transport session lifecycle", () => {
  it("releases an opening transport when its setup deadline expires", async () => {
    const firstEndpoint = createEndpoint();
    const secondEndpoint = createEndpoint();
    const firstSocket = createConnectingSocket();
    const secondSocket = createConnectingSocket();
    const endpoints = [firstEndpoint, secondEndpoint];
    const { events, manager, scheduledTimeouts } = createManagerHarness(
      async () => endpoints.shift() ?? createEndpoint(),
      [firstSocket, secondSocket],
    );

    manager.open(SESSION_INPUT);
    await Promise.resolve();

    expect(scheduledTimeouts[0]?.delayMs).toBe(LOCAL_TRANSPORT_SETUP_TIMEOUT_MS);
    scheduledTimeouts[0]?.callback();

    expect(firstSocket.terminate).toHaveBeenCalledTimes(1);
    expect(firstEndpoint.close).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        sessionId: SESSION_INPUT.sessionId,
        kind: "error",
        error: "Connection to Remote SSH host build-box timed out during setup.",
      },
    ]);

    manager.close(SESSION_INPUT.sessionId);
    expect(firstSocket.terminate).toHaveBeenCalledTimes(1);
    expect(firstEndpoint.close).toHaveBeenCalledTimes(1);

    expect(() => manager.open(SESSION_INPUT)).not.toThrow();
    await Promise.resolve();
    manager.close(SESSION_INPUT.sessionId);
    expect(secondSocket.terminate).toHaveBeenCalledTimes(1);
    expect(secondEndpoint.close).toHaveBeenCalledTimes(1);
  });

  it("releases a connecting transport when the caller closes it", async () => {
    const endpoint = createEndpoint();
    const socket = createConnectingSocket();
    const { events, manager, scheduledTimeouts } = createManagerHarness(
      async () => endpoint,
      [socket],
    );

    manager.open(SESSION_INPUT);
    await Promise.resolve();
    manager.close(SESSION_INPUT.sessionId);
    manager.close(SESSION_INPUT.sessionId);

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(endpoint.close).toHaveBeenCalledTimes(1);
    expect(scheduledTimeouts[0]?.cancelled).toBe(true);
    expect(events).toEqual([]);
  });

  it("closes an endpoint that resolves after the caller cancels setup", async () => {
    const endpoint = createEndpoint();
    let resolveEndpoint: ((endpoint: TransportEndpoint) => void) | null = null;
    const endpointPromise = new Promise<TransportEndpoint>((resolve) => {
      resolveEndpoint = resolve;
    });
    const socket = createConnectingSocket();
    const { createWebSocket, events, manager } = createManagerHarness(
      () => endpointPromise,
      [socket],
    );

    manager.open(SESSION_INPUT);
    manager.close(SESSION_INPUT.sessionId);
    resolveEndpoint?.(endpoint);
    await Promise.resolve();
    await Promise.resolve();

    expect(endpoint.close).toHaveBeenCalledTimes(1);
    expect(createWebSocket).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
