import http from "node:http";
import type pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { exportPublicKey, generateKeyPair } from "@bytetrue/byspace-relay";
import { startStandaloneRelayServer } from "@bytetrue/byspace-relay/standalone";
import { startRelayTransport, type RelayTransportController } from "../relay-transport.js";
import { connectRemoteWebService, RemoteWebServiceTargetAcceptor } from "./data-relay.js";

const ACCESS_TOKEN = "remote-web-service-test-token";

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

describe("Remote Web Service Data Relay", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanup.splice(0).map((stop) => stop()));
  });

  it("carries a streaming HTTP response over an authenticated E2EE channel", async () => {
    const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
    cleanup.push(() => relay.stop());
    const upstream = await startHttpServer();
    cleanup.push(() => closeHttpServer(upstream.server));

    const keyPair = generateKeyPair();
    const acceptor = new RemoteWebServiceTargetAcceptor(createLogger());
    let markControlReady!: () => void;
    const controlReady = new Promise<void>((resolve) => {
      markControlReady = resolve;
    });
    const targetTransport: RelayTransportController = startRelayTransport({
      logger: createLogger(markControlReady),
      attachSocket: async (socket) => acceptor.attachSocket(socket),
      relayEndpoint: `127.0.0.1:${relay.port}`,
      relayUseTls: false,
      relayAccessToken: ACCESS_TOKEN,
      serverId: "srv_target",
      daemonKeyPair: keyPair,
    });
    cleanup.push(() => targetTransport.stop());
    await controlReady;

    const stream = await connectRemoteWebService(
      {
        endpoint: `127.0.0.1:${relay.port}`,
        useTls: false,
        accessToken: ACCESS_TOKEN,
      },
      {
        serverId: "srv_target",
        label: "target",
        port: upstream.port,
        daemonPublicKeyB64: exportPublicKey(keyPair.publicKey),
      },
      createLogger(),
    );
    stream.write("GET /events HTTP/1.1\r\nHost: target.localhost\r\nConnection: close\r\n\r\n");

    const response = await readAll(stream);
    stream.destroy();
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("data: first");
    expect(response).toContain("data: second");
  });

  it("rejects the source handshake when the target loopback port is unavailable", async () => {
    const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
    cleanup.push(() => relay.stop());
    const unavailable = await startHttpServer();
    const unavailablePort = unavailable.port;
    await closeHttpServer(unavailable.server);

    const keyPair = generateKeyPair();
    const acceptor = new RemoteWebServiceTargetAcceptor(createLogger());
    let markControlReady!: () => void;
    const controlReady = new Promise<void>((resolve) => {
      markControlReady = resolve;
    });
    const targetTransport = startRelayTransport({
      logger: createLogger(markControlReady),
      attachSocket: async (socket) => acceptor.attachSocket(socket),
      relayEndpoint: `127.0.0.1:${relay.port}`,
      relayUseTls: false,
      relayAccessToken: ACCESS_TOKEN,
      serverId: "srv_target",
      daemonKeyPair: keyPair,
    });
    cleanup.push(() => targetTransport.stop());
    await controlReady;

    await expect(
      connectRemoteWebService(
        {
          endpoint: `127.0.0.1:${relay.port}`,
          useTls: false,
          accessToken: ACCESS_TOKEN,
        },
        {
          serverId: "srv_target",
          label: "target",
          port: unavailablePort,
          daemonPublicKeyB64: exportPublicKey(keyPair.publicKey),
        },
        createLogger(),
      ),
    ).rejects.toThrow();
  });

  it("rejects a client with the wrong Relay access token", async () => {
    const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
    cleanup.push(() => relay.stop());
    const keyPair = generateKeyPair();

    await expect(
      connectRemoteWebService(
        { endpoint: `127.0.0.1:${relay.port}`, useTls: false, accessToken: "wrong" },
        {
          serverId: "srv_target",
          label: "target",
          port: 1234,
          daemonPublicKeyB64: exportPublicKey(keyPair.publicKey),
        },
        createLogger(),
      ),
    ).rejects.toThrow();
  });
});
