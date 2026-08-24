import os from "node:os";
import http from "node:http";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";

import { createBySpaceDaemon, parseListenString, type BySpaceDaemonConfig } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { AgentManagerShuttingDownError } from "./agent/agent-manager.js";
import { hashDaemonPassword } from "./auth.js";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { createTestBySpaceDaemon } from "./test-utils/byspace-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { isPlatform } from "../test-utils/platform.js";
import { findFreePort } from "./service-proxy.js";
import {
  configureGitProcessPolicy,
  snapshotGitCommandRuntimeMetrics,
} from "../utils/run-git-command.js";
import { DEFAULT_GIT_PROCESS_POLICY } from "../utils/git-process-scheduler.js";

interface HeldAgentClose {
  started: Promise<void>;
  arm(): void;
  closeSession(): Promise<void>;
  finish(): void;
}

interface BlockedDaemonShutdown {
  probeReconnect(): Promise<WebSocketProbeResult>;
  tryCreateAgent(): Promise<"created" | "rejected">;
  finish(): Promise<void>;
}

type WebSocketProbeResult =
  | { status: "connected" }
  | { status: "rejected"; statusCode: number | null };

describe("byspace daemon bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("starts and serves health endpoint", async () => {
    const daemonHandle = await createTestBySpaceDaemon();
    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/health`, {
        headers: daemonHandle.agentMcpAuthHeader
          ? { Authorization: daemonHandle.agentMcpAuthHeader }
          : undefined,
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.status).toBe("ok");
      expect(typeof payload.timestamp).toBe("string");
    } finally {
      await daemonHandle.close();
    }
  });

  test("hosts the authenticated Data Relay on a separate listener", async () => {
    const dataRelayPort = await findFreePort();
    const daemonHandle = await createTestBySpaceDaemon({
      dataRelayListen: `127.0.0.1:${dataRelayPort}`,
      dataRelayAccessToken: "test-data-relay-token",
    });
    try {
      const relayHealth = await fetch(`http://127.0.0.1:${dataRelayPort}/health`);
      await expect(relayHealth.json()).resolves.toEqual({ status: "ok" });

      const daemonRouteOnRelay = await fetch(`http://127.0.0.1:${dataRelayPort}/api/health`);
      expect(daemonRouteOnRelay.status).toBe(404);
    } finally {
      await daemonHandle.close();
    }

    await expect(fetch(`http://127.0.0.1:${dataRelayPort}/health`)).rejects.toThrow();
  });

  test("reload applies live HTTP, MCP, Git, provider, relay, and app policies", async () => {
    const byspaceHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-config-reload-runtime-"));
    const byspaceHome = path.join(byspaceHomeRoot, ".byspace");
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "byspace-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "byspace-config-reload-agent-"));
    await mkdir(byspaceHome, { recursive: true });
    const configPath = path.join(byspaceHome, "config.json");
    const initialPersisted = {
      version: 1 as const,
      daemon: {
        listen: "127.0.0.1:0",
        hostnames: ["127.0.0.1", "before.example.test"],
        cors: { allowedOrigins: ["https://before.example.test"] },
        trustedProxies: [],
        mcp: { enabled: true, injectIntoAgents: false },
        git: { maxProcessesPerSecond: 64, maxProcessConcurrency: 8 },
        relay: {
          enabled: false,
          endpoint: "127.0.0.1:9",
          publicEndpoint: "127.0.0.1:9",
          useTls: false,
          publicUseTls: false,
        },
      },
      app: { baseUrl: "https://before.example.test" },
    };
    await writeFile(configPath, `${JSON.stringify(initialPersisted, null, 2)}\n`, "utf-8");
    const config = loadConfig(byspaceHome, { env: {} });
    config.staticDir = staticDir;
    config.agentClients = createTestAgentClients();
    config.agentStoragePath = path.join(byspaceHome, "agents");
    config.isDev = true;
    config.speech = {
      enabled: false,
      sttLanguage: "auto",
      local: {
        modelsDir: "/tmp",
        models: { dictationStt: null },
      },
    };
    const daemon = await createBySpaceDaemon(config, pino({ level: "silent" }));
    let client: DaemonClient | null = null;
    let proxyUpstream: http.Server | null = null;

    try {
      await daemon.start();
      const target = daemon.getListenTarget();
      if (!target || target.type !== "tcp") throw new Error("Expected a TCP listener");
      client = new DaemonClient({
        url: `ws://127.0.0.1:${target.port}/ws`,
        appVersion: "0.4.0",
      });
      await client.connect();

      proxyUpstream = http.createServer((req, res) => {
        res.end(String(req.headers["x-forwarded-proto"] ?? "missing"));
      });
      await new Promise<void>((resolve) => proxyUpstream?.listen(0, "127.0.0.1", resolve));
      const proxyAddress = proxyUpstream.address();
      if (!proxyAddress || typeof proxyAddress === "string") {
        throw new Error("Expected proxy upstream TCP address");
      }
      const proxyRoute = daemon.serviceProxy.registerWorkspaceService({
        workspaceId: "workspace-config-reload",
        projectSlug: "reload",
        branchName: "main",
        scriptName: "proxy",
        port: proxyAddress.port,
      });
      const proxyHost = `${proxyRoute.hostname}:${target.port}`;

      expect(
        (await httpGetWithHost(target.port, "before.example.test", "/api/health")).status,
      ).toBe(200);
      expect((await httpGetWithHost(target.port, "after.example.test", "/api/health")).status).toBe(
        403,
      );
      const beforeCors = await fetch(`http://127.0.0.1:${target.port}/api/health`, {
        headers: { Origin: "https://before.example.test" },
      });
      expect(beforeCors.headers.get("access-control-allow-origin")).toBe(
        "https://before.example.test",
      );
      const beforeMcp = await fetch(`http://127.0.0.1:${target.port}/mcp/agents`, {
        method: "POST",
      });
      expect(beforeMcp.status).toBe(406);
      const beforeProxyReload = await httpGetWithHost(target.port, proxyHost, "/", {
        "x-forwarded-proto": "https",
      });
      expect(await beforeProxyReload.text()).toBe("http");

      const reloadedPersisted = {
        ...initialPersisted,
        daemon: {
          ...initialPersisted.daemon,
          hostnames: ["127.0.0.1", "after.example.test"],
          cors: { allowedOrigins: ["https://after.example.test"] },
          trustedProxies: true as const,
          mcp: { enabled: false, injectIntoAgents: false },
          git: { maxProcessesPerSecond: 5, maxProcessConcurrency: 1 },
          relay: { ...initialPersisted.daemon.relay, enabled: true },
        },
        app: { baseUrl: "https://after.example.test" },
        agents: {
          catalogRefreshTimeoutMs: 5_000,
          providers: { codex: { enabled: false } },
        },
      };
      await writeFile(configPath, `${JSON.stringify(reloadedPersisted, null, 2)}\n`, "utf-8");

      const result = await client.reloadDaemonConfig("runtime-policies");

      expect(result).toEqual({
        requestId: "runtime-policies",
        appliedPaths: [
          "agents.catalogRefreshTimeoutMs",
          "agents.providers",
          "app.baseUrl",
          "daemon.cors.allowedOrigins",
          "daemon.git.maxProcessConcurrency",
          "daemon.git.maxProcessesPerSecond",
          "daemon.hostnames",
          "daemon.mcp.enabled",
          "daemon.relay.enabled",
          "daemon.trustedProxies",
        ],
        restartRequiredPaths: [],
        overrideControlledPaths: [],
      });
      expect(
        (await httpGetWithHost(target.port, "before.example.test", "/api/health")).status,
      ).toBe(403);
      expect((await httpGetWithHost(target.port, "after.example.test", "/api/health")).status).toBe(
        200,
      );
      const afterCors = await fetch(`http://127.0.0.1:${target.port}/api/health`, {
        headers: { Origin: "https://after.example.test" },
      });
      expect(afterCors.headers.get("access-control-allow-origin")).toBe(
        "https://after.example.test",
      );
      const afterProxyReload = await httpGetWithHost(target.port, proxyHost, "/", {
        "x-forwarded-proto": "https",
      });
      expect(await afterProxyReload.text()).toBe("https");
      await expect(
        probeWebSocketConnection(`ws://127.0.0.1:${target.port}/ws`, {
          host: "after.example.test",
          origin: "https://after.example.test",
        }),
      ).resolves.toEqual({ status: "connected" });
      await expect(
        probeWebSocketConnection(`ws://127.0.0.1:${target.port}/ws`, {
          host: "after.example.test",
          origin: "https://before.example.test",
        }),
      ).resolves.toEqual({ status: "rejected", statusCode: 403 });
      expect(
        (
          await fetch(`http://127.0.0.1:${target.port}/mcp/agents`, {
            method: "POST",
          })
        ).status,
      ).toBe(404);
      expect(snapshotGitCommandRuntimeMetrics()).toMatchObject({
        concurrencyLimit: 1,
        maxProcessesPerSecond: 5,
      });
      await expect(
        daemon.agentManager.createAgent({ provider: "codex", cwd: agentCwd }, undefined, {
          workspaceId: undefined,
        }),
      ).rejects.toThrow(/disabled/i);
      expect((await client.getDaemonStatus()).relay?.enabled).toBe(true);
      expect((await client.getDaemonPairingOffer()).url).toContain(
        "https://after.example.test/#offer=",
      );
    } finally {
      configureGitProcessPolicy(DEFAULT_GIT_PROCESS_POLICY);
      await client?.close().catch(() => undefined);
      await daemon.stop().catch(() => undefined);
      if (proxyUpstream) {
        await new Promise<void>((resolve) => proxyUpstream?.close(() => resolve()));
      }
      await Promise.all([
        rm(byspaceHomeRoot, { recursive: true, force: true }),
        rm(staticDir, { recursive: true, force: true }),
        rm(agentCwd, { recursive: true, force: true }),
      ]);
    }
  });

  function httpGetWithHost(
    port: number,
    host: string,
    requestPath: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: requestPath, headers: { host, ...headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 0,
                headers: res.headers as HeadersInit,
              }),
            );
          });
        },
      );
      req.on("error", reject);
    });
  }

  test("proxies registered service hosts before daemon auth while daemon APIs stay protected", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("service-ok");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: hashDaemonPassword("secret") },
    });
    try {
      daemonHandle.daemon.serviceProxy.registerWorkspaceService({
        workspaceId: "workspace-service-auth",
        projectSlug: "repo",
        branchName: "main",
        scriptName: "web",
        port: address.port,
      });

      const serviceResponse = await httpGetWithHost(
        daemonHandle.port,
        `web--repo.localhost:${daemonHandle.port}`,
        "/",
      );
      expect(serviceResponse.status).toBe(200);
      expect(await serviceResponse.text()).toBe("service-ok");

      const daemonResponse = await httpGetWithHost(
        daemonHandle.port,
        `daemon.localhost:${daemonHandle.port}`,
        "/api/status",
      );
      expect(daemonResponse.status).toBe(401);
    } finally {
      await daemonHandle.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test("configured public service namespace misses never reach daemon APIs", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      serviceProxy: {
        publicBaseUrl: "https://services.example.com",
        standaloneListen: null,
      },
    });
    try {
      const response = await httpGetWithHost(
        daemonHandle.port,
        `missing.services.example.com:${daemonHandle.port}`,
        "/api/status",
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
    } finally {
      await daemonHandle.close();
    }
  });

  test("rolls back daemon listener when standalone service proxy startup fails", async () => {
    const occupiedServer = http.createServer((_req, res) => {
      res.end("occupied");
    });
    await new Promise<void>((resolve) => occupiedServer.listen(0, "127.0.0.1", resolve));
    const address = occupiedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected occupied TCP address");
    }

    const byspaceHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-standalone-rollback-"));
    const byspaceHome = path.join(byspaceHomeRoot, ".byspace");
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "byspace-static-"));
    await mkdir(byspaceHome, { recursive: true });
    const config: BySpaceDaemonConfig = {
      listen: "127.0.0.1:0",
      byspaceHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: false,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(byspaceHome, "agents"),
      relayEnabled: false,
      appBaseUrl: "https://byspace.pages.dev",
      openai: undefined,
      speech: undefined,
      serviceProxy: {
        standaloneListen: `127.0.0.1:${address.port}`,
      },
    };
    const daemon = await createBySpaceDaemon(config, pino({ level: "silent" }));

    try {
      await expect(daemon.start()).rejects.toThrow();
      await expect(fetch(`http://127.0.0.1:${daemon.port}/api/health`)).rejects.toThrow();
    } finally {
      await daemon.stop().catch(() => undefined);
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
      await rm(byspaceHomeRoot, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  test("local service namespace misses never reach daemon APIs", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: hashDaemonPassword("secret") },
    });
    try {
      const response = await httpGetWithHost(
        daemonHandle.port,
        `missing--repo.localhost:${daemonHandle.port}`,
        "/api/status",
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
    } finally {
      await daemonHandle.close();
    }
  });

  test("daemon websocket still upgrades when service proxy upgrade handler is mounted", async () => {
    const daemonHandle = await createTestBySpaceDaemon();
    const ws = new WebSocket(`ws://127.0.0.1:${daemonHandle.port}/ws`);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
      await daemonHandle.close();
    }
  });

  test("stops new connections and agent registrations before closing agents", async () => {
    const shutdown = await beginDaemonShutdownWithAgentClosing();
    try {
      await expect(
        Promise.all([shutdown.probeReconnect(), shutdown.tryCreateAgent()]),
      ).resolves.toEqual([{ status: "rejected", statusCode: 503 }, "rejected"]);
    } finally {
      await shutdown.finish();
    }
  });

  test("standalone listener exposes services only", async () => {
    const standalonePort = await findFreePort();
    const upstream = http.createServer((_req, res) => {
      res.end("service-ok");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Expected upstream TCP address");
    }

    const daemonHandle = await createTestBySpaceDaemon({
      serviceProxy: { standaloneListen: `127.0.0.1:${standalonePort}` },
    });
    try {
      daemonHandle.daemon.serviceProxy.registerWorkspaceService({
        workspaceId: "workspace-standalone",
        projectSlug: "repo",
        branchName: "main",
        scriptName: "web",
        port: upstreamAddress.port,
      });

      const serviceResponse = await httpGetWithHost(
        standalonePort,
        `web--repo.localhost:${standalonePort}`,
        "/",
      );
      expect(serviceResponse.status).toBe(200);
      expect(await serviceResponse.text()).toBe("service-ok");

      for (const requestPath of ["/api/health", "/ws", "/mcp/agents", "/index.html", "/files/x"]) {
        const response = await httpGetWithHost(
          standalonePort,
          `daemon.localhost:${standalonePort}`,
          requestPath,
        );
        expect(response.status).toBe(404);
      }
    } finally {
      await daemonHandle.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test("rolls back already-open standalone listener when main daemon listen fails", async () => {
    const mainPort = await findFreePort();
    const standalonePort = await findFreePort();
    const occupiedMain = http.createServer((_req, res) => {
      res.end("occupied-main");
    });
    await new Promise<void>((resolve) => occupiedMain.listen(mainPort, "127.0.0.1", resolve));

    const byspaceHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-main-rollback-"));
    const byspaceHome = path.join(byspaceHomeRoot, ".byspace");
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "byspace-static-"));
    await mkdir(byspaceHome, { recursive: true });
    const config: BySpaceDaemonConfig = {
      listen: `127.0.0.1:${mainPort}`,
      byspaceHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: false,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(byspaceHome, "agents"),
      relayEnabled: false,
      appBaseUrl: "https://byspace.pages.dev",
      openai: undefined,
      speech: undefined,
      serviceProxy: { standaloneListen: `127.0.0.1:${standalonePort}` },
    };
    const daemon = await createBySpaceDaemon(config, pino({ level: "silent" }));

    try {
      await expect(daemon.start()).rejects.toThrow();
      await expect(fetch(`http://127.0.0.1:${standalonePort}/api/health`)).rejects.toThrow();
    } finally {
      await daemon.stop().catch(() => undefined);
      await new Promise<void>((resolve) => occupiedMain.close(() => resolve()));
      await rm(byspaceHomeRoot, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  test("redacts Agent MCP debug request credentials and bodies", async () => {
    const logLines: string[] = [];
    const logger = pino(
      { level: "debug" },
      {
        write: (line: string) => {
          logLines.push(line);
        },
      },
    );
    const daemonHandle = await createTestBySpaceDaemon({
      logger,
      mcpDebug: true,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/mcp/agents`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-debug-token",
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            apiKey: "secret-body-token",
          },
        }),
      });

      await response.text();
      const logs = logLines.join("\n");
      expect(logs).toContain("Agent MCP request");
      expect(logs).toContain("[redacted]");
      expect(logs).toContain('"method":"tools/call"');
      expect(logs).toContain('"hasParams":true');
      expect(logs).not.toContain("secret-debug-token");
      expect(logs).not.toContain("secret-body-token");
      expect(logs).not.toContain("apiKey");
    } finally {
      await daemonHandle.close();
    }
  });

  test("does not download a configured missing speech model during daemon start", async () => {
    const originalFetch = globalThis.fetch;
    const downloadFetch = vi.fn(() => {
      throw new Error("daemon start must not download speech models");
    });
    vi.stubGlobal("fetch", downloadFetch);

    const daemonHandle = await createTestBySpaceDaemon({
      speech: {
        enabled: true,
        sttLanguage: "auto",
        local: {
          modelsDir: path.join(os.tmpdir(), `byspace-missing-models-${Date.now()}`),
          models: { dictationStt: "fire-red-asr2-aed-int8" },
        },
      },
    });

    try {
      const response = await originalFetch(`http://127.0.0.1:${daemonHandle.port}/api/health`);
      expect(response.ok).toBe(true);
      expect(downloadFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
      await daemonHandle.close();
    }
  });

  test("parses whitespace-padded numeric port strings", () => {
    expect(parseListenString(" 6777 ")).toEqual({
      type: "tcp",
      host: "127.0.0.1",
      port: 6777,
    });
  });

  test("parses IPv6 listen targets correctly", () => {
    expect(parseListenString("[::1]:6777")).toEqual({
      type: "tcp",
      host: "::1",
      port: 6777,
    });
    expect(parseListenString("[::]:6777")).toEqual({
      type: "tcp",
      host: "::",
      port: 6777,
    });
  });

  test("rejects Windows absolute paths that are not named pipes", () => {
    // A Windows drive path like C:\daemon must NOT be silently parsed as TCP
    // (split(":") would yield host="C" and port="\\daemon" which is nonsensical).
    expect(() => parseListenString(String.raw`C:\daemon`)).toThrow();
    expect(() => parseListenString(String.raw`D:\Users\foo\.byspace\daemon.sock`)).toThrow();
    // Single-letter "host" with no valid port is not a valid listen string
    expect(() => parseListenString(String.raw`C:\some\path`)).toThrow();
  });

  test("parses Windows named pipes as managed IPC listen targets", () => {
    expect(parseListenString(String.raw`\\.\pipe\byspace-managed-test`)).toEqual({
      type: "pipe",
      path: String.raw`\\.\pipe\byspace-managed-test`,
    });
    expect(parseListenString(`pipe://${String.raw`\\.\pipe\byspace-managed-test`}`)).toEqual({
      type: "pipe",
      path: String.raw`\\.\pipe\byspace-managed-test`,
    });
  });

  // POSIX-only: Unix socket listen paths are invalid Windows listen targets.
  test.skipIf(isPlatform("win32"))(
    "generates a relay pairing offer for unix socket listeners",
    async () => {
      const byspaceHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-socket-relay-"));
      const byspaceHome = path.join(byspaceHomeRoot, ".byspace");
      const staticDir = await mkdtemp(path.join(os.tmpdir(), "byspace-static-"));
      const socketPath = path.join(byspaceHomeRoot, "run", "byspace.sock");
      await mkdir(path.dirname(socketPath), { recursive: true });
      await mkdir(byspaceHome, { recursive: true });
      const logger = pino({ level: "silent" });

      const config: BySpaceDaemonConfig = {
        listen: socketPath,
        byspaceHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: false,
        staticDir,
        mcpDebug: false,
        agentClients: createTestAgentClients(),
        agentStoragePath: path.join(byspaceHome, "agents"),
        relayEnabled: true,
        relayEndpoint: "127.0.0.1:9",
        relayPublicEndpoint: "127.0.0.1:9",
        appBaseUrl: "https://byspace.pages.dev",
        openai: undefined,
        speech: undefined,
      };

      const daemon = await createBySpaceDaemon(config, logger);

      try {
        await daemon.start();
        const pairing = await generateLocalPairingOffer({
          byspaceHome,
          relayEnabled: true,
          relayEndpoint: "127.0.0.1:9",
          relayPublicEndpoint: "127.0.0.1:9",
          appBaseUrl: "https://byspace.pages.dev",
          includeQr: false,
        });
        expect(pairing.relayEnabled).toBe(true);
        expect(pairing.url?.startsWith("https://byspace.pages.dev/#offer=")).toBe(true);
      } finally {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        await rm(byspaceHomeRoot, { recursive: true, force: true });
        await rm(staticDir, { recursive: true, force: true });
      }
    },
  );
});

function holdAgentClose(): HeldAgentClose {
  let armed = false;
  let markStarted = () => {};
  let finish = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    started,
    arm() {
      armed = true;
    },
    async closeSession() {
      if (!armed) {
        return;
      }
      markStarted();
      await finished;
    },
    finish: () => finish(),
  };
}

async function beginDaemonShutdownWithAgentClosing(): Promise<BlockedDaemonShutdown> {
  const heldAgentClose = holdAgentClose();
  const daemonHandle = await createTestBySpaceDaemon({
    cleanup: false,
    agentClients: createTestAgentClients({ closeSession: heldAgentClose.closeSession }),
  });
  const agentCwd = await mkdtemp(path.join(os.tmpdir(), "byspace-shutdown-agent-"));
  await daemonHandle.daemon.agentManager.createAgent(
    {
      provider: "codex",
      cwd: agentCwd,
    },
    undefined,
    { workspaceId: undefined },
  );

  heldAgentClose.arm();
  const stopPromise = daemonHandle.daemon.stop();
  await heldAgentClose.started;

  return {
    probeReconnect: () => probeWebSocketConnection(`ws://127.0.0.1:${daemonHandle.port}/ws`),
    async tryCreateAgent() {
      try {
        await daemonHandle.daemon.agentManager.createAgent(
          {
            provider: "codex",
            cwd: agentCwd,
          },
          undefined,
          { workspaceId: undefined },
        );
        return "created";
      } catch (error) {
        if (error instanceof AgentManagerShuttingDownError) {
          return "rejected";
        }
        throw error;
      }
    },
    async finish() {
      heldAgentClose.finish();
      await stopPromise;
      await daemonHandle.daemon.agentManager.flush().catch(() => undefined);
      await Promise.all([
        rm(path.dirname(daemonHandle.byspaceHome), { recursive: true, force: true }),
        rm(daemonHandle.staticDir, { recursive: true, force: true }),
        rm(agentCwd, { recursive: true, force: true }),
      ]);
    },
  };
}

function probeWebSocketConnection(
  url: string,
  headers?: { host?: string; origin?: string },
): Promise<WebSocketProbeResult> {
  const ws = new WebSocket(url, {
    headers: {
      ...(headers?.host ? { Host: headers.host } : {}),
      ...(headers?.origin ? { Origin: headers.origin } : {}),
    },
  });
  return new Promise((resolve) => {
    ws.once("open", () => {
      ws.close();
      resolve({ status: "connected" });
    });
    ws.once("error", () => resolve({ status: "rejected", statusCode: null }));
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve({ status: "rejected", statusCode: response.statusCode ?? null });
    });
  });
}
