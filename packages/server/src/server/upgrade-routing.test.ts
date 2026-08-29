import http from "node:http";
import net from "node:net";
import express from "express";
import pino from "pino";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceProxySubsystem, findFreePort } from "./service-proxy.js";
import { attachDaemonUpgradeRouting } from "./upgrade-routing.js";

const logger = pino({ level: "silent" });

/**
 * The daemon carries two upgrade owners on one port: the service proxy forwards
 * a workspace script's own WebSockets, and the daemon's `/ws` protocol socket
 * serves the app. A dev server behind the proxy needs its HMR sockets (Metro
 * uses `/hot` and `/message`) to reach upstream untouched.
 */
interface Fixture {
  daemonPort: number;
  scriptHostname: string;
  close(): Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  const upstreamPort = await findFreePort();
  const upstreamSockets: net.Socket[] = [];
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200).end("upstream");
  });
  upstream.on("upgrade", (req, socket) => {
    upstreamSockets.push(socket);
    socket.on("error", () => socket.destroy());
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Upstream-Path: ${req.url}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

  const serviceProxy = createServiceProxySubsystem({ logger });
  const route = serviceProxy.registerWorkspaceService({
    workspaceId: "workspace-a",
    projectSlug: "repo",
    branchName: "feature",
    scriptName: "dev",
    port: upstreamPort,
  });

  const app = express();
  app.set("trust proxy", true);
  app.use(serviceProxy.middleware());
  app.use((_req, res) => {
    res.status(404).send("404 Not Found");
  });
  const daemon = http.createServer(app);

  // Registration order matches bootstrap: the proxy decides first, the daemon
  // socket routes what is left.
  daemon.on("upgrade", serviceProxy.upgradeHandler({ passthroughUnknown: true }));
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    socket.send("daemon-ws");
  });
  attachDaemonUpgradeRouting({
    server: daemon,
    path: "/ws",
    handleUpgrade: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, req);
      });
    },
  });

  const daemonPort = await findFreePort();
  await new Promise<void>((resolve) => daemon.listen(daemonPort, "127.0.0.1", resolve));

  return {
    daemonPort,
    scriptHostname: route.hostname,
    async close() {
      for (const socket of upstreamSockets) socket.destroy();
      wss.close();
      daemon.closeAllConnections();
      await new Promise<void>((resolve) => daemon.close(() => resolve()));
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    },
  };
}

function readUpgradeResponse(params: {
  port: number;
  host: string;
  path: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: params.port }, () => {
      socket.write(
        [
          `GET ${params.path} HTTP/1.1`,
          `Host: ${params.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    let raw = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no upgrade response for ${params.path} (received ${raw.length} bytes)`));
    }, 5_000);
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      if (!raw.includes("\r\n\r\n")) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(raw.slice(0, raw.indexOf("\r\n\r\n")));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (raw.length === 0) reject(new Error(`upgrade closed with no response for ${params.path}`));
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("daemon upgrade routing", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await startFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("forwards a workspace service's own WebSocket paths to that service", async () => {
    // Metro's HMR socket. The daemon's `/ws` server must not answer for it:
    // rejecting the handshake makes the dev client reload the page forever.
    const response = await readUpgradeResponse({
      port: fixture.daemonPort,
      host: fixture.scriptHostname,
      path: "/hot",
    });

    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("X-Upstream-Path: /hot");
  });

  it("still serves the daemon protocol socket on /ws", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${fixture.daemonPort}/ws`);
    const message = await new Promise<string>((resolve, reject) => {
      socket.on("message", (data) => resolve(data.toString()));
      socket.on("error", reject);
    });
    socket.close();

    expect(message).toBe("daemon-ws");
  });

  it("leaves a workspace service's /ws to that service", async () => {
    // Vite's HMR socket is "/ws". On a script hostname the service owns it, not
    // the daemon protocol socket that happens to share the port.
    const response = await readUpgradeResponse({
      port: fixture.daemonPort,
      host: fixture.scriptHostname,
      path: "/ws",
    });

    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("X-Upstream-Path: /ws");
  });

  it("rejects an upgrade nobody owns", async () => {
    const response = await readUpgradeResponse({
      port: fixture.daemonPort,
      host: `127.0.0.1:${fixture.daemonPort}`,
      path: "/hot",
    });

    expect(response).toContain("400 Bad Request");
  });
});
