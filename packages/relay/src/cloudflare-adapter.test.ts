import { afterEach, describe, expect, it, vi } from "vitest";
import relayWorker, { RelayDurableObject } from "./cloudflare-adapter.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];
type RelayEnvArg = Parameters<typeof relayWorker.fetch>[1];

function createWorkerEnv(
  relay: unknown,
  limit = vi.fn(async () => ({ success: true })),
): RelayEnvArg {
  return { RELAY: relay, RELAY_RATE_LIMITER: { limit } } as unknown as RelayEnvArg;
}

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment: ReturnType<typeof vi.fn>;
  deserializeAttachment: ReturnType<typeof vi.fn>;
};

function createMockSocket(attachment: unknown = null): MockSocket {
  let storedAttachment = attachment;
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      storedAttachment = value;
    }),
    deserializeAttachment: vi.fn(() => storedAttachment),
  } as unknown as MockSocket;
}

function createMockState() {
  const socketsByTag = new Map<string, WebSocket[]>();
  const state = {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn((tag?: string): WebSocket[] => {
      if (!tag) {
        const out: WebSocket[] = [];
        for (const sockets of socketsByTag.values()) out.push(...sockets);
        return out;
      }
      return socketsByTag.get(tag) ?? [];
    }),
  };

  return {
    state,
    setTagSockets: (tag: string, sockets: WebSocket[]) => {
      socketsByTag.set(tag, sockets);
    },
  };
}

async function withMockWebSocketPair(
  run: (sockets: { clientWs: MockSocket; serverWs: MockSocket }) => Promise<void> | void,
): Promise<void> {
  const serverWs = createMockSocket();
  const clientWs = createMockSocket();
  const WebSocketPairMock = class {
    [index: number]: WebSocket;
    constructor() {
      this[0] = clientWs as unknown as WebSocket;
      this[1] = serverWs as unknown as WebSocket;
    }
  };

  const previousPair = (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPairMock;
  try {
    await run({ clientWs, serverWs });
  } finally {
    if (previousPair === undefined) {
      delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
    } else {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = previousPair;
    }
  }
}

const swallow = () => undefined;

describe("RelayDurableObject versioning", () => {
  it("accepts legacy v1 client sockets without connectionId", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=1", {
        headers: {
          Upgrade: "websocket",
        },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
    });
  });

  it("assigns a connectionId when v2 client connects without one", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({
        role: "client",
        connectionId: expect.stringMatching(/^conn_/),
      });
    });
  });
});

describe("RelayDurableObject control nudge/reset behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not nudge or reset control after the client already disconnected", () => {
    vi.useFakeTimers();
    const clientId = "clt_stale_timer";
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", []);
    setTagSockets(`client:${clientId}`, []);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("resets control when the client remains connected but no server-data socket appears", () => {
    vi.useFakeTimers();
    const clientId = "clt_waiting_for_daemon";
    const control = createMockSocket();
    const client = createMockSocket({
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", [client]);
    setTagSockets(`client:${clientId}`, [client]);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(control.close).toHaveBeenCalledWith(1011, "Control unresponsive");
  });

  it("rejects a client-selected v2 connectionId", async () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const response = await relay.fetch(
      new Request(
        "https://relay.test/ws?role=client&serverId=srv_test&connectionId=clt_same_session&v=2",
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("rejects new v2 clients when the Durable Object reaches socket capacity", async () => {
    const { state, setTagSockets } = createMockState();
    setTagSockets(
      "client",
      Array.from({ length: 256 }, () => createMockSocket()),
    );
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const response = await relay.fetch(
      new Request("https://relay.test/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      }),
    );

    expect(response.status).toBe(503);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("rejects malformed daemon v2 connectionIds", async () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    for (const connectionId of ["", " leading", "line%0Abreak", "snowman_%E2%98%83"]) {
      const response = await relay.fetch(
        new Request(
          `https://relay.test/ws?role=server&serverId=srv_test&connectionId=${connectionId}&v=2`,
          { headers: { Upgrade: "websocket" } },
        ),
      );
      expect(response.status).toBe(400);
    }
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("does not disconnect a client when a server-data replacement exists", () => {
    const connectionId = "conn_replaced";
    const oldServer = createMockSocket({
      version: "2",
      role: "server",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const replacement = createMockSocket();
    const client = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [oldServer, replacement]);
    setTagSockets(`client:${connectionId}`, [client]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(oldServer as unknown as WebSocket, 1008, "Replaced", true);

    expect(client.close).not.toHaveBeenCalled();
  });

  it("keeps server data socket alive while at least one client socket remains", () => {
    const clientId = "clt_multi";
    const disconnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const stillConnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets("client", [stillConnectedClient]);
    setTagSockets(`client:${clientId}`, [stillConnectedClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(
      disconnectedClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });
});

describe("RelayDurableObject pending frame budgets", () => {
  it("rejects oversized frames before routing", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "conn_oversized",
      serverId: "srv_test",
      createdAt: Date.now(),
    });

    relay.webSocketMessage(client as unknown as WebSocket, new ArrayBuffer((2 << 20) + 1));

    expect(client.close).toHaveBeenCalledWith(1009, "Relay frame exceeds size limit");
  });

  it("bounds the number of pending connection buffers", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const bufferFrame = (
      relay as unknown as {
        bufferFrame(connectionId: string, message: string | ArrayBuffer): boolean;
      }
    ).bufferFrame.bind(relay);

    for (let index = 0; index < 64; index++) {
      expect(bufferFrame(`conn_${index}`, new ArrayBuffer(1))).toBe(true);
    }
    expect(bufferFrame("conn_excess", new ArrayBuffer(1))).toBe(false);
  });

  it("bounds pending bytes per connection and in aggregate", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const bufferFrame = (
      relay as unknown as {
        bufferFrame(connectionId: string, message: string | ArrayBuffer): boolean;
      }
    ).bufferFrame.bind(relay);
    const maxFrame = new ArrayBuffer(2 << 20);

    expect(bufferFrame("conn_bytes", maxFrame)).toBe(true);
    expect(bufferFrame("conn_bytes", new ArrayBuffer(1))).toBe(false);
    for (let index = 1; index < 8; index++) {
      expect(bufferFrame(`conn_bytes_${index}`, maxFrame)).toBe(true);
    }
    expect(bufferFrame("conn_over_total", new ArrayBuffer(1))).toBe(false);
  });
});

describe("relay worker endpoint routing", () => {
  it("routes missing v to legacy v1 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server", {
        headers: { Upgrade: "websocket" },
      }),
      createWorkerEnv({ idFromName, get }),
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v1:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:1");
  });

  it("routes v=2 to v2 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_abcdefghijkl&role=server&v=2", {
        headers: { Upgrade: "websocket" },
      }),
      createWorkerEnv({ idFromName, get }),
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v2:srv_abcdefghijkl");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:2");
  });

  it("rejects invalid v values", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=nope", {
        headers: { Upgrade: "websocket" },
      }),
      createWorkerEnv({ idFromName, get }),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 1 or 2)");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-canonical v2 server ids before admission or DO routing", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const limit = vi.fn(async () => ({ success: true }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=attacker-selected&role=client&v=2", {
        headers: { Upgrade: "websocket" },
      }),
      createWorkerEnv({ idFromName, get }, limit),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v2 serverId parameter");
    expect(limit).not.toHaveBeenCalled();
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("rate limits websocket admission by role and edge source before DO routing", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const limit = vi.fn(async () => ({ success: false }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_abcdefghijkl&role=client&v=2", {
        headers: { Upgrade: "websocket", "CF-Connecting-IP": "203.0.113.9" },
      }),
      createWorkerEnv({ idFromName, get }, limit),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "client:203.0.113.9" });
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("fails closed when relay admission is unavailable", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const limit = vi.fn(async () => {
      throw new Error("limiter unavailable");
    });

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_abcdefghijkl&role=server&v=2", {
        headers: { Upgrade: "websocket" },
      }),
      createWorkerEnv({ idFromName, get }, limit),
    );

    expect(response.status).toBe(503);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
