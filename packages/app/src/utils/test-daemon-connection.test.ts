import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClientConfig } from "@getpaseo/client/internal/daemon-client";

vi.mock("@/constants/platform", () => ({
  getIsElectron: () => false,
  isWeb: true,
}));
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
    createDesktopTransportFactory: () => null,
    buildDesktopTransportUrl: (target) => {
      if (target.transportType === "ssh") {
        return `paseo+desktop://ssh?host=${encodeURIComponent(target.host)}`;
      }
      return `paseo+desktop://${target.transportType}?path=${encodeURIComponent(target.transportPath)}`;
    },
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

  it("rejects insecure direct TCP from hosted HTTPS before creating a client", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    const { connectToDaemon } = await import("./test-daemon-connection");

    await expect(
      connectToDaemon(
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "192.168.1.20:6767",
        },
        undefined,
        probe.deps,
      ),
    ).rejects.toThrow(
      "Insecure direct connections are unavailable from hosted HTTPS pages. Enable SSL or the relay.",
    );
    expect(probe.createdClients).toHaveLength(0);
    expect(probe.clientIdsRequested).toBe(0);
  });

  it("allows loopback direct TCP from hosted HTTPS", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    for (const endpoint of [
      "localhost:6767",
      "dev.localhost:6767",
      "127.0.0.1:6767",
      "[::1]:6767",
    ]) {
      const result = await connectToDaemon(
        {
          id: `direct:${endpoint}`,
          type: "directTcp",
          endpoint,
        },
        {
          browserContext: { isWeb: true, isElectron: false, protocol: "https:" },
        },
        probe.deps,
      );
      await result.client.close();
    }

    expect(probe.createdClients).toHaveLength(4);
  });

  it("allows TLS direct TCP, relay, HTTP, and non-web connections", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const tlsResult = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "192.168.1.20:6767",
        useTls: true,
      },
      { browserContext: { isWeb: true, isElectron: false, protocol: "https:" } },
      probe.deps,
    );
    await tlsResult.client.close();

    const relayResult = await connectToDaemon(
      {
        id: "relay:relay.example:443",
        type: "relay",
        relayEndpoint: "relay.example:443",
        useTls: false,
        daemonPublicKeyB64: "pubkey",
      },
      {
        serverId: "srv_probe_test",
        browserContext: { isWeb: true, isElectron: false, protocol: "https:" },
      },
      probe.deps,
    );
    await relayResult.client.close();

    const httpResult = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "192.168.1.20:6767",
      },
      { browserContext: { isWeb: true, isElectron: false, protocol: "http:" } },
      probe.deps,
    );
    await httpResult.client.close();

    const nativeResult = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "192.168.1.20:6767",
      },
      { browserContext: { isWeb: false, isElectron: false, protocol: "https:" } },
      probe.deps,
    );
    await nativeResult.client.close();

    const electronResult = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "192.168.1.20:6767",
      },
      { browserContext: { isWeb: true, isElectron: true, protocol: "https:" } },
      probe.deps,
    );
    await electronResult.client.close();

    expect(probe.createdClients).toHaveLength(5);
    expect(probe.createdConfigs()[0]?.url).toMatch(/^wss:\/\//);
  });

  it("reuses the app clientId for direct connections", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const first = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "lan:6767",
      },
      undefined,
      probe.deps,
    );
    await first.client.close();

    const second = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "lan:6767",
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

  it("keeps direct TCP probes on the renderer WebSocket", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const deps = {
      ...probe.deps,
      createWebSocketTransportFactory: () => {
        throw new Error("Direct TCP must not use the desktop WebSocket bridge");
      },
    };

    const result = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "lan:6767",
      },
      undefined,
      deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.transportFactory).toBeUndefined();
  });

  it("encodes the local socket target into the client config", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const result = await connectToDaemon(
      {
        id: "socket:/tmp/paseo.sock",
        type: "directSocket",
        path: "/tmp/paseo.sock",
      },
      undefined,
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.url).toBe("paseo+desktop://socket?path=%2Ftmp%2Fpaseo.sock");
  });

  it("uses the desktop transport for Remote SSH connections", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const transportFactory = vi.fn();
    const result = await connectToDaemon(
      {
        id: "ssh:deploy%40example.com:2222:%2Fkeys%2Fpaseo",
        type: "remoteSsh",
        host: "deploy@example.com",
        sshPort: 2222,
        daemonPort: 7777,
      },
      undefined,
      {
        ...probe.deps,
        createDesktopTransportFactory: () => transportFactory,
      },
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]).toMatchObject({
      url: "paseo+desktop://ssh?host=deploy%40example.com",
      transportFactory,
    });
  });

  it("passes direct TCP connection passwords into the client config", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const result = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "lan:6767",
        password: "shared-secret",
      },
      undefined,
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.password).toBe("shared-secret");
  });

  it("passes performance tracing into the connected client", async () => {
    const { connectToDaemon } = await import("./test-daemon-connection");
    const trace = {
      isEnabled: () => true,
      beginSection: vi.fn(),
      endSection: vi.fn(),
    };
    const result = await connectToDaemon(
      {
        id: "direct:lan:6767",
        type: "directTcp",
        endpoint: "lan:6767",
      },
      { trace },
      probe.deps,
    );
    await result.client.close();

    expect(probe.createdConfigs()[0]?.trace).toBe(trace);
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
        id: "relay:relay.paseo.sh:443",
        type: "relay",
        relayEndpoint: "relay.paseo.sh:443",
        useTls: false,
        daemonPublicKeyB64: "pubkey",
      },
      { serverId: "srv_probe_test" },
      probe.deps,
    );
    await plainResult.client.close();

    expect(probe.createdConfigs()[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(probe.createdConfigs()[1]?.url).toMatch(/^ws:\/\/relay\.paseo\.sh:443\/ws\?/);
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
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
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
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
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
