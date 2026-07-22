import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClientConfig } from "@bytetrue/byspace-client/internal/daemon-client";
import type { DaemonConnectionDependencies, DaemonProbeClient } from "./test-daemon-connection";

class FakeDaemonClient implements DaemonProbeClient {
  readonly lastError: string | null;

  constructor(
    private readonly probe: FakeDaemonProbe,
    readonly config: DaemonClientConfig,
  ) {
    this.lastError = probe.nextLastError;
  }

  async connect(): Promise<void> {
    if (this.probe.nextConnectError) {
      throw this.probe.nextConnectError;
    }
  }

  getLastServerInfoMessage() {
    return {
      serverId: "srv_probe_test",
      hostname: "probe-host",
    };
  }

  async close(): Promise<void> {
    this.probe.closedClients.push(this);
  }
}

class FakeDaemonProbe {
  createdClients: FakeDaemonClient[] = [];
  closedClients: FakeDaemonClient[] = [];
  clientIdsRequested = 0;
  nextConnectError: Error | null = null;
  nextLastError: string | null = null;

  readonly deps: DaemonConnectionDependencies<FakeDaemonClient> = {
    getClientId: async () => {
      this.clientIdsRequested += 1;
      return "cid_shared_probe_test";
    },
    resolveAppVersion: () => null,
    createClient: (config) => {
      const client = new FakeDaemonClient(this, config);
      this.createdClients.push(client);
      return client;
    },
  };

  failNextConnection(error: Error, lastError: string | null): void {
    this.nextConnectError = error;
    this.nextLastError = lastError;
  }

  createdConfigs(): DaemonClientConfig[] {
    return this.createdClients.map((client) => client.config);
  }
}

describe("test-daemon-connection connectToDaemon", () => {
  let probe: FakeDaemonProbe;

  beforeEach(() => {
    vi.stubGlobal("__DEV__", false);
    probe = new FakeDaemonProbe();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks plaintext non-loopback direct connections before opening a socket on HTTPS", async () => {
    const { connectToDaemon, isPlaintextDirectConnectionBlocked } =
      await import("./test-daemon-connection");
    const connection = {
      id: "direct:192.168.1.20:6777",
      type: "directTcp" as const,
      endpoint: "192.168.1.20:6777",
    };

    expect(isPlaintextDirectConnectionBlocked(connection, "https:")).toBe(true);
    expect(isPlaintextDirectConnectionBlocked(connection, "http:")).toBe(false);
    expect(isPlaintextDirectConnectionBlocked({ ...connection, useTls: true }, "https:")).toBe(
      false,
    );
    expect(
      isPlaintextDirectConnectionBlocked({ ...connection, endpoint: "127.0.0.2:6777" }, "https:"),
    ).toBe(false);

    vi.stubGlobal("window", { location: { protocol: "https:" } });
    await expect(connectToDaemon(connection, undefined, probe.deps)).rejects.toMatchObject({
      message: "TLS is required for non-local direct connections from an HTTPS page",
    });
    expect(probe.createdClients).toHaveLength(0);
  });

  it("reuses the app clientId for direct connections", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const first = await connectToDaemon(
      {
        id: "direct:lan:6777",
        type: "directTcp",
        endpoint: "lan:6777",
      },
      undefined,
      probe.deps,
    );
    await first.client.close();

    const second = await connectToDaemon(
      {
        id: "direct:lan:6777",
        type: "directTcp",
        endpoint: "lan:6777",
      },
      undefined,
      probe.deps,
    );
    await second.client.close();

    const [firstConfig, secondConfig] = probe.createdConfigs();
    expect(firstConfig?.clientId).toBe("cid_shared_probe_test");
    expect(secondConfig?.clientId).toBe("cid_shared_probe_test");
    expect(probe.clientIdsRequested).toBe(2);
  });

  it("passes direct TCP connection passwords into the client config", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const result = await connectToDaemon(
      {
        id: "direct:lan:6777",
        type: "directTcp",
        endpoint: "lan:6777",
        password: "shared-secret",
      },
      undefined,
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.password).toBe("shared-secret");
  });

  it("uses relay TLS from the stored connection", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const tlsResult = await connectToDaemon(
      {
        id: "relay:wss:[::1]:443",
        type: "relay",
        relayEndpoint: "[::1]:443",
        useTls: true,
        daemonPublicKeyB64: "pubkey",
      },
      { serverId: "srv_probe_test" },
      probe.deps,
    );
    await tlsResult.client.close();

    const plainResult = await connectToDaemon(
      {
        id: "relay:byspace-relay.bytetrue.workers.dev:443",
        type: "relay",
        relayEndpoint: "byspace-relay.bytetrue.workers.dev:443",
        useTls: false,
        daemonPublicKeyB64: "pubkey",
      },
      { serverId: "srv_probe_test" },
      probe.deps,
    );
    await plainResult.client.close();

    expect(probe.createdConfigs()[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(probe.createdConfigs()[1]?.url).toMatch(
      /^ws:\/\/byspace-relay\.bytetrue\.workers\.dev:443\/ws\?/,
    );
  });

  it("surfaces auth rejection as an incorrect password", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    probe.failNextConnection(
      new Error("Transport closed (code 4001)"),
      "Transport closed (code 4001)",
    );

    await expect(
      connectToDaemon(
        {
          id: "direct:lan:6777",
          type: "directTcp",
          endpoint: "lan:6777",
          password: "wrong-secret",
        },
        undefined,
        probe.deps,
      ),
    ).rejects.toMatchObject({
      message: "Incorrect password",
    });
  });

  it("keeps generic transport failures generic when a password was supplied", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    probe.failNextConnection(new Error("Transport error"), "Transport error");

    await expect(
      connectToDaemon(
        {
          id: "direct:lan:6777",
          type: "directTcp",
          endpoint: "lan:6777",
          password: "shared-secret",
        },
        undefined,
        probe.deps,
      ),
    ).rejects.toMatchObject({
      message: "Transport error",
    });
  });
});
