import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { SshTunnelManager, DEFAULT_TUNNEL_MAX, type TunnelEvent } from "./index.js";
import { createInMemoryKnownHostsStore } from "./known-hosts.js";

interface Harness {
  manager: SshTunnelManager;
  events: TunnelEvent[];
  open(
    tunnelId: string,
    input?: Partial<Parameters<SshTunnelManager["open"]>[0]>,
  ): ReturnType<SshTunnelManager["open"]>;
}

function fakeSshChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdin: new EventEmitter(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    kill() {
      child.killed = true;
      child.emit("exit", 0, null);
    },
  });
  (child.stdout as unknown as EventEmitter & { pipe: (dst: unknown) => void }).pipe = () =>
    undefined;
  (child.stdin as unknown as EventEmitter & { write: (d: unknown) => boolean }).write = () => true;
  return child;
}

function createHarness(options?: { maxTunnels?: number }): Harness {
  const events: TunnelEvent[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const manager = new SshTunnelManager({
    knownHosts: createInMemoryKnownHostsStore(),
    ...(options?.maxTunnels !== undefined ? { maxTunnels: options.maxTunnels } : {}),
    scheduleTimeout: () => () => undefined,
    spawnSsh: ((_cmd: string, _args: string[], _opts: unknown) => {
      const child = fakeSshChild();
      children.push(child);
      return child;
    }) as unknown as (typeof import("node:child_process"))["spawn"],
    probeSshHostKeyFn: (async () => null) as unknown as typeof import("./index.js").probeSshHostKey,
  });
  // Reach into the private createServer side effects through the node:net
  // module: the manager calls createServer; we patch it via a shim server.
  return {
    manager,
    events,
    open(tunnelId, input) {
      return manager.open({
        tunnelId,
        host: "remote.example",
        authMode: "key",
        ...input,
        emitEvent: (event) => events.push(event),
      });
    },
    get children() {
      return children;
    },
  } as unknown as Harness;
}

describe("SshTunnelManager.open", () => {
  it("rejects duplicate tunnel ids", async () => {
    const h = createHarness();
    const first = await h.open("t1");
    expect(first).toEqual({ ok: true });
    const second = await h.open("t1");
    expect(second).toEqual({
      ok: false,
      error: "Tunnel already exists: t1",
      errorCode: "already_exists",
    });
  });

  it("enforces the concurrent tunnel limit", async () => {
    const h = createHarness({ maxTunnels: 1 });
    expect(await h.open("t1")).toEqual({ ok: true });
    const second = await h.open("t2");
    expect(second).toEqual({
      ok: false,
      error: expect.stringContaining("Tunnel limit reached (1)"),
      errorCode: "limit_reached",
    });
  });

  it("rejects password auth without a password", async () => {
    const h = createHarness();
    const result = await h.open("t1", { authMode: "password" });
    expect(result).toEqual({
      ok: false,
      error: "Password auth requires a password.",
      errorCode: "password_required",
    });
  });

  it("rejects invalid hosts by throwing (the session layer maps this to invalid_input)", async () => {
    const h = createHarness();
    await expect(h.open("t1", { host: "bad host" })).rejects.toThrow("SSH host is invalid");
  });

  it("defaults the tunnel limit", () => {
    expect(DEFAULT_TUNNEL_MAX).toBe(8);
  });
});

describe("SshTunnelManager.closeTunnel", () => {
  it("is idempotent for unknown tunnels", () => {
    const h = createHarness();
    expect(h.manager.closeTunnel("missing")).toBe(true);
  });
});

describe("SshTunnelManager.probe", () => {
  it("reports unreachable hosts without fingerprints", async () => {
    const h = createHarness();
    const probe = await h.manager.probe({ host: "remote.example" });
    expect(probe).toEqual({
      reachable: false,
      fingerprint: null,
      keyType: null,
      pinnedFingerprint: null,
      verdict: null,
    });
  });

  it("reports a new host as first use", async () => {
    const events: TunnelEvent[] = [];
    const manager = new SshTunnelManager({
      knownHosts: createInMemoryKnownHostsStore(),
      scheduleTimeout: () => () => undefined,
      probeSshHostKeyFn: (async () => ({
        hostKey: Buffer.from("key-material"),
        keyType: "ssh-ed25519",
        fingerprint: "SHA256:abc",
      })) as unknown as typeof import("./index.js").probeSshHostKey,
    });
    void events;
    const probe = await manager.probe({ host: "remote.example" });
    expect(probe).toEqual({
      reachable: true,
      fingerprint: "SHA256:abc",
      keyType: "ssh-ed25519",
      pinnedFingerprint: null,
      verdict: "new",
    });
  });

  it("detects changed fingerprints against the pin store", async () => {
    const manager = new SshTunnelManager({
      knownHosts: createInMemoryKnownHostsStore({ "remote.example": "SHA256:old" }),
      scheduleTimeout: () => () => undefined,
      probeSshHostKeyFn: (async () => ({
        hostKey: Buffer.from("key-material"),
        keyType: "ssh-ed25519",
        fingerprint: "SHA256:new",
      })) as unknown as typeof import("./index.js").probeSshHostKey,
    });
    const probe = await manager.probe({ host: "remote.example" });
    expect(probe).toMatchObject({ verdict: "changed", pinnedFingerprint: "SHA256:old" });
  });
});

describe("SshTunnelManager.respondHostKey", () => {
  it("returns false for unknown prompts", () => {
    const manager = new SshTunnelManager({
      knownHosts: createInMemoryKnownHostsStore(),
      scheduleTimeout: () => () => undefined,
    });
    expect(manager.respondHostKey({ promptId: "missing", decision: "trust" })).toBe(false);
  });
});

describe("SshTunnelManager.sendFrame", () => {
  it("rejects frames for unknown tunnels", () => {
    const h = createHarness();
    expect(h.manager.sendFrame({ tunnelId: "missing", text: "hi" })).toBe(false);
  });
});

describe("parseTunnelOpenInput", () => {
  it("rejects non-objects and invalid ids", async () => {
    const { parseTunnelOpenInput } = await import("./index.js");
    expect(() => parseTunnelOpenInput(null)).toThrow();
    expect(() =>
      parseTunnelOpenInput({ tunnelId: "bad id", host: "h", authMode: "key" }),
    ).toThrow();
  });
});
