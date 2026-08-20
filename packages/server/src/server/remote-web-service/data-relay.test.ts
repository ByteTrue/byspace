import { EventEmitter } from "node:events";
import http from "node:http";
import type pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportPublicKey, generateKeyPair, type KeyPair } from "@bytetrue/byspace-relay";
import { startStandaloneRelayServer } from "@bytetrue/byspace-relay/standalone";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
} from "../relay-transport.js";
import {
  connectRemoteWebService,
  type RemoteWebServiceAuthorization,
  RemoteWebServiceTargetAcceptor,
} from "./data-relay.js";
import type { RemoteWebService } from "./remote-web-service-store.js";

const ACCESS_TOKEN = "remote-web-service-test-token";
const SERVICE_ID = "00000000-0000-4000-8000-000000000001";

function createLogger(onControlReady?: () => void): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: (_fields: unknown, message?: string) => {
      if (message === "relay_control_connected") onControlReady?.();
    },
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    silent: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

async function startHttpServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: second\n\n"), 5);
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("remote-ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return { server, port: address.port };
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

async function readAll(stream: NodeJS.ReadWriteStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function createService(targetPublicKeyB64: string, port: number): RemoteWebService {
  return {
    id: SERVICE_ID,
    name: "target",
    hostname: "target.remote.localhost",
    target: {
      serverId: "srv_target",
      label: "target",
      port,
      daemonPublicKeyB64: targetPublicKeyB64,
    },
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

async function startDataPlane(input: {
  cleanup: Array<() => Promise<void>>;
  port: number;
  sourceKeyPair?: KeyPair;
  authorize?: (
    input: RemoteWebServiceAuthorization,
    expected: RemoteWebServiceAuthorization,
  ) => boolean;
  attachSocket?: (socket: RelaySocketLike) => void;
}) {
  const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
  input.cleanup.push(() => relay.stop());
  const targetKeyPair = generateKeyPair();
  const sourceKeyPair = input.sourceKeyPair ?? generateKeyPair();
  const service = createService(exportPublicKey(targetKeyPair.publicKey), input.port);
  const expectedAuthorization = {
    serviceId: service.id,
    sourceDaemonPublicKeyB64: exportPublicKey(sourceKeyPair.publicKey),
    targetPort: service.target.port,
  };
  const acceptor = new RemoteWebServiceTargetAcceptor(createLogger(), async (authorization) =>
    input.authorize
      ? input.authorize(authorization, expectedAuthorization)
      : JSON.stringify(authorization) === JSON.stringify(expectedAuthorization),
  );
  let markControlReady!: () => void;
  const controlReady = new Promise<void>((resolve) => {
    markControlReady = resolve;
  });
  const targetTransport: RelayTransportController = startRelayTransport({
    logger: createLogger(markControlReady),
    attachSocket: async (socket) =>
      input.attachSocket ? input.attachSocket(socket) : acceptor.attachSocket(socket),
    relayEndpoint: `127.0.0.1:${relay.port}`,
    relayUseTls: false,
    relayAccessToken: ACCESS_TOKEN,
    serverId: "srv_target",
    daemonKeyPair: targetKeyPair,
  });
  input.cleanup.push(() => targetTransport.stop());
  await controlReady;
  return { relay, service, sourceKeyPair };
}

function createFakeRelaySocket() {
  const emitter = new EventEmitter();
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let closed: { code?: number; reason?: string } | null = null;
  const socket: RelaySocketLike = {
    readyState: 1,
    peerPublicKeyB64: exportPublicKey(generateKeyPair().publicKey),
    send: (data, callback) => {
      sent.push(data);
      callback?.();
    },
    close: (code, reason) => {
      closed = { code, reason };
      emitter.emit("close", code, reason);
    },
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    once: (event, listener) => {
      emitter.once(event, listener);
    },
  };
  return {
    socket,
    sent,
    emitMessage: (data: string) => emitter.emit("message", data),
    getClosed: () => closed,
  };
}

function connectFixture(
  fixture: Awaited<ReturnType<typeof startDataPlane>>,
  sourceKeyPair?: KeyPair,
) {
  return connectRemoteWebService(
    {
      endpoint: `127.0.0.1:${fixture.relay.port}`,
      useTls: false,
      accessToken: ACCESS_TOKEN,
    },
    fixture.service,
    sourceKeyPair ?? fixture.sourceKeyPair,
    createLogger(),
  );
}

describe("Remote Web Service Data Relay", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanup.splice(0).map((stop) => stop()));
  });

  it("carries a streaming HTTP response over an authorized E2EE channel", async () => {
    const upstream = await startHttpServer();
    cleanup.push(() => closeHttpServer(upstream.server));
    const fixture = await startDataPlane({ cleanup, port: upstream.port });

    const stream = await connectFixture(fixture);
    stream.write("GET /events HTTP/1.1\r\nHost: target.localhost\r\nConnection: close\r\n\r\n");

    const response = await readAll(stream);
    stream.destroy();
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("data: first");
    expect(response).toContain("data: second");
  });

  it("rejects the source handshake when the target loopback port is unavailable", async () => {
    const unavailable = await startHttpServer();
    const unavailablePort = unavailable.port;
    await closeHttpServer(unavailable.server);
    const fixture = await startDataPlane({ cleanup, port: unavailablePort });

    await expect(connectFixture(fixture)).rejects.toThrow();
  });

  it("bounds frames received before the target challenge completes", async () => {
    const fixture = await startDataPlane({
      cleanup,
      port: 1234,
      attachSocket: (socket) => {
        for (let index = 0; index < 40; index += 1) socket.send(new Uint8Array(8192));
      },
    });

    await expect(connectFixture(fixture)).rejects.toThrow("pre-handshake buffer");
  });

  it("issues a fresh target challenge and rejects an open replayed across acceptor restarts", async () => {
    const authorize = vi.fn(async () => true);
    const firstAcceptor = new RemoteWebServiceTargetAcceptor(createLogger(), authorize);
    const first = createFakeRelaySocket();
    firstAcceptor.attachSocket(first.socket);
    await vi.waitFor(() => expect(first.sent.length).toBeGreaterThan(0));
    const firstChallenge = JSON.parse(String(first.sent[0])) as { targetNonce: string };
    const replayedTargetNonce = `${firstChallenge.targetNonce.startsWith("A") ? "B" : "A"}${firstChallenge.targetNonce.slice(1)}`;
    first.emitMessage(
      JSON.stringify({
        type: "remote.web.open",
        version: 1,
        serviceId: SERVICE_ID,
        targetPort: 1234,
        sourceNonce: "AAAAAAAAAAAAAAAAAAAAAA",
        targetNonce: replayedTargetNonce,
      }),
    );
    await vi.waitFor(() => expect(first.getClosed()?.code).toBe(1008));
    expect(authorize).not.toHaveBeenCalled();

    const restartedAcceptor = new RemoteWebServiceTargetAcceptor(createLogger(), authorize);
    const second = createFakeRelaySocket();
    restartedAcceptor.attachSocket(second.socket);
    await vi.waitFor(() => expect(second.sent.length).toBeGreaterThan(0));
    const secondChallenge = JSON.parse(String(second.sent[0])) as { targetNonce: string };
    expect(secondChallenge.targetNonce).not.toBe(firstChallenge.targetNonce);
    second.socket.close(1000, "test complete");
  });

  it("rejects a mapping without a target grant", async () => {
    const upstream = await startHttpServer();
    cleanup.push(() => closeHttpServer(upstream.server));
    const fixture = await startDataPlane({ cleanup, port: upstream.port, authorize: () => false });

    await expect(connectFixture(fixture)).rejects.toThrow("target rejected");
  });

  it("rejects a source daemon whose public key does not match the grant", async () => {
    const upstream = await startHttpServer();
    cleanup.push(() => closeHttpServer(upstream.server));
    const fixture = await startDataPlane({ cleanup, port: upstream.port });

    await expect(connectFixture(fixture, generateKeyPair())).rejects.toThrow("target rejected");
  });

  it("rejects new connections after the target grant is revoked", async () => {
    const upstream = await startHttpServer();
    cleanup.push(() => closeHttpServer(upstream.server));
    let granted = true;
    const fixture = await startDataPlane({
      cleanup,
      port: upstream.port,
      authorize: (authorization, expected) =>
        granted && JSON.stringify(authorization) === JSON.stringify(expected),
    });

    const stream = await connectFixture(fixture);
    stream.end();
    stream.resume();
    granted = false;

    await expect(connectFixture(fixture)).rejects.toThrow("target rejected");
  });

  it("rejects a client with the wrong Relay access token", async () => {
    const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
    cleanup.push(() => relay.stop());
    const targetKeyPair = generateKeyPair();

    await expect(
      connectRemoteWebService(
        { endpoint: `127.0.0.1:${relay.port}`, useTls: false, accessToken: "wrong" },
        createService(exportPublicKey(targetKeyPair.publicKey), 1234),
        generateKeyPair(),
        createLogger(),
      ),
    ).rejects.toThrow();
  });
});
