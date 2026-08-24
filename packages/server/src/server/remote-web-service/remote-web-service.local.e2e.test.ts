import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { startStandaloneRelayServer } from "@bytetrue/byspace-relay/standalone";
import { loadOrCreateDaemonKeyPair } from "../daemon-keypair.js";
import { getOrCreateServerId } from "../server-id.js";
import { findFreePort } from "../service-proxy.js";
import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";

const ACCESS_TOKEN = "remote-web-service-e2e-token";

interface HttpResult {
  status: number;
  body: string;
}

function requestRemote(port: number, hostname: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/events",
        headers: { host: hostname },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function requestEventually(port: number, hostname: string): Promise<HttpResult> {
  let last: HttpResult | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last = await requestRemote(port, hostname);
    if (last.status === 200) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return last ?? { status: 0, body: "" };
}

function handleUpstreamRequest(req: IncomingMessage, res: ServerResponse): void {
  expect(req.url).toBe("/events");
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write("data: one\n\n");
  setTimeout(() => res.end("data: two\n\n"), 5);
}

function attachUpstreamWebSockets(server: http.Server, webSocketServer: WebSocketServer): void {
  server.on("upgrade", (req, socket, head) => {
    webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, req);
    });
  });
  webSocketServer.on("connection", (webSocket) => {
    webSocket.on("message", (message) => webSocket.send(`echo:${String(message)}`));
  });
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

function closeWebSocket(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (webSocket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    webSocket.once("close", resolve);
    webSocket.close();
  });
}

function connectWebSocket(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
  });
}

function nextWebSocketMessage(webSocket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    webSocket.once("message", (message) => resolve(String(message)));
  });
}

describe("Remote Web Service daemon-to-daemon path", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const stop of cleanup.splice(0).toReversed()) await stop().catch(() => undefined);
  });

  it("streams HTTP from a target loopback service through two daemons", async () => {
    const relay = await startStandaloneRelayServer({ accessToken: ACCESS_TOKEN });
    cleanup.push(() => relay.stop());
    const relayEndpoint = `127.0.0.1:${relay.port}`;

    const upstream = http.createServer(handleUpstreamRequest);
    const upstreamWebSockets = new WebSocketServer({ noServer: true });
    attachUpstreamWebSockets(upstream, upstreamWebSockets);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => closeHttpServer(upstream));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const target = await createTestBySpaceDaemon({
      dataRelayEndpoint: relayEndpoint,
      dataRelayUseTls: false,
      dataRelayAccessToken: ACCESS_TOKEN,
    });
    cleanup.push(() => target.close());
    const source = await createTestBySpaceDaemon({
      dataRelayEndpoint: relayEndpoint,
      dataRelayUseTls: false,
      dataRelayAccessToken: ACCESS_TOKEN,
    });
    cleanup.push(() => source.close());

    const targetKey = await loadOrCreateDaemonKeyPair(target.byspaceHome);
    const sourceKey = await loadOrCreateDaemonKeyPair(source.byspaceHome);
    const mapping = await source.daemon.remoteWebServiceManager.create({
      name: "home-web",
      target: {
        serverId: getOrCreateServerId(target.byspaceHome),
        label: "home",
        port: upstreamAddress.port,
        daemonPublicKeyB64: targetKey.publicKeyB64,
      },
    });
    await target.daemon.remoteWebServiceManager.grant({
      serviceId: mapping.id,
      sourceDaemonPublicKeyB64: sourceKey.publicKeyB64,
      targetPort: upstreamAddress.port,
    });

    const response = await requestEventually(source.port, mapping.hostname);
    expect(response.status).toBe(200);
    expect(response.body).toContain("data: one");
    expect(response.body).toContain("data: two");

    const webSocket = new WebSocket(`ws://127.0.0.1:${source.port}/socket`, {
      headers: { Host: mapping.hostname },
    });
    cleanup.push(() => closeWebSocket(webSocket));
    await connectWebSocket(webSocket);
    const echoed = nextWebSocketMessage(webSocket);
    webSocket.send("hmr");
    await expect(echoed).resolves.toBe("echo:hmr");
    await closeWebSocket(webSocket);

    await target.daemon.remoteWebServiceManager.revokeGrant(mapping.id);
    await expect(requestRemote(source.port, mapping.hostname)).resolves.toMatchObject({
      status: 502,
    });
  });
  it("dynamically configures Data Relay via daemon config store and tunnels HTTP/WebSocket", async () => {
    const upstream = http.createServer(handleUpstreamRequest);
    const upstreamWebSockets = new WebSocketServer({ noServer: true });
    attachUpstreamWebSockets(upstream, upstreamWebSockets);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => closeHttpServer(upstream));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Expected upstream TCP address");
    }

    // Start source and target with NO Data Relay initially
    const source = await createTestBySpaceDaemon();
    cleanup.push(() => source.close());
    const target = await createTestBySpaceDaemon();
    cleanup.push(() => target.close());

    expect(source.daemon.remoteWebServiceManager.isDataRelayConfigured()).toBe(false);
    expect(target.daemon.remoteWebServiceManager.isDataRelayConfigured()).toBe(false);

    // Find a free port for Data Relay listener on source host
    const dataRelayPort = await findFreePort();
    const relayEndpoint = `127.0.0.1:${dataRelayPort}`;

    // Dynamically patch source to host Data Relay and connect locally
    source.daemon.daemonConfigStore.patch({
      dataRelay: {
        listen: relayEndpoint,
        endpoint: relayEndpoint,
        useTls: false,
        accessToken: ACCESS_TOKEN,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(source.daemon.remoteWebServiceManager.isDataRelayConfigured()).toBe(true);

    // Dynamically patch target to connect to source's Data Relay
    target.daemon.daemonConfigStore.patch({
      dataRelay: {
        endpoint: relayEndpoint,
        useTls: false,
        accessToken: ACCESS_TOKEN,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(target.daemon.remoteWebServiceManager.isDataRelayConfigured()).toBe(true);

    const targetKey = await loadOrCreateDaemonKeyPair(target.byspaceHome);
    const sourceKey = await loadOrCreateDaemonKeyPair(source.byspaceHome);
    const mapping = await source.daemon.remoteWebServiceManager.create({
      name: "dynamic-web",
      target: {
        serverId: getOrCreateServerId(target.byspaceHome),
        label: "target-host",
        port: upstreamAddress.port,
        daemonPublicKeyB64: targetKey.publicKeyB64,
      },
    });
    await target.daemon.remoteWebServiceManager.grant({
      serviceId: mapping.id,
      sourceDaemonPublicKeyB64: sourceKey.publicKeyB64,
      targetPort: upstreamAddress.port,
    });

    // Test HTTP request through the dynamically established tunnel
    const response = await requestEventually(source.port, mapping.hostname);
    expect(response.status).toBe(200);
    expect(response.body).toContain("data: one");
    expect(response.body).toContain("data: two");

    // Test WebSocket connection through the dynamically established tunnel
    const webSocket = new WebSocket(`ws://127.0.0.1:${source.port}/socket`, {
      headers: { Host: mapping.hostname },
    });
    cleanup.push(() => closeWebSocket(webSocket));
    await connectWebSocket(webSocket);
    const echoed = nextWebSocketMessage(webSocket);
    webSocket.send("dynamic-hmr");
    await expect(echoed).resolves.toBe("echo:dynamic-hmr");
    await closeWebSocket(webSocket);
  });
});
