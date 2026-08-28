import { execFile, spawn, type ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ConnectionOfferSchema } from "@byspace/protocol/connection-offer";
import { afterEach, expect, test } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { DaemonClient } from "./daemon-client.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const goRoot = join(repositoryRoot, "go");
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

interface PendingConnection {
  client: WebSocket;
  daemon?: WebSocket;
  ready: boolean;
}

class MockRelay {
  private server: Server | null = null;
  private websocketServer: WebSocketServer | null = null;
  private sockets = new Set<WebSocket>();
  private control: WebSocket | null = null;
  private pending = new Map<string, PendingConnection>();
  private nextConnection = 1;
  private port = 0;
  readonly frames: Array<{ direction: "client" | "daemon"; data: Buffer; binary: boolean }> = [];
  capturedHello: string | null = null;
  tamperNextClientApplicationFrame = false;
  replayNextClientApplicationFrame = false;

  get origin(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  clientURL(serverId: string): string {
    const url = new URL("/ws", this.origin);
    url.searchParams.set("serverId", serverId);
    url.searchParams.set("role", "client");
    url.searchParams.set("v", "2");
    return url.toString();
  }

  async start(port = 0): Promise<void> {
    this.websocketServer = new WebSocketServer({ noServer: true });
    this.server = createServer();
    this.server.on("upgrade", (request, socket, head) => {
      const requestURL = new URL(request.url ?? "/", "http://relay.invalid");
      this.websocketServer?.handleUpgrade(request, socket, head, (websocket) => {
        this.sockets.add(websocket);
        websocket.once("close", () => this.sockets.delete(websocket));
        this.route(websocket, requestURL);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Mock Relay did not bind TCP");
    this.port = address.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.control = null;
    this.pending.clear();
    const server = this.server;
    const websocketServer = this.websocketServer;
    this.server = null;
    this.websocketServer = null;
    await Promise.all([
      server ? new Promise<void>((resolve) => server.close(() => resolve())) : Promise.resolve(),
      websocketServer
        ? new Promise<void>((resolve) => websocketServer.close(() => resolve()))
        : Promise.resolve(),
    ]);
  }

  async waitForControl(): Promise<void> {
    await waitUntil(() => this.control?.readyState === WebSocket.OPEN, 8_000, "Relay control");
  }

  private route(websocket: WebSocket, requestURL: URL): void {
    const role = requestURL.searchParams.get("role");
    const connectionId = requestURL.searchParams.get("connectionId");
    if (requestURL.pathname === "/ws" && role === "server" && !connectionId) {
      this.control?.terminate();
      this.control = websocket;
      websocket.once("close", () => {
        if (this.control === websocket) this.control = null;
      });
      websocket.send(
        JSON.stringify({ type: "sync", connectionIds: Array.from(this.pending.keys()) }),
      );
      return;
    }
    if (requestURL.pathname === "/ws" && role === "client") {
      const assignedConnectionId = `conn_${this.nextConnection++}`;
      const pending: PendingConnection = { client: websocket, ready: false };
      this.pending.set(assignedConnectionId, pending);
      websocket.once("close", () => {
        pending.daemon?.close();
        this.pending.delete(assignedConnectionId);
        if (this.control?.readyState === WebSocket.OPEN) {
          this.control.send(
            JSON.stringify({ type: "disconnected", connectionId: assignedConnectionId }),
          );
        }
      });
      if (this.control?.readyState !== WebSocket.OPEN) {
        websocket.close(1013, "daemon unavailable");
        return;
      }
      this.control.send(JSON.stringify({ type: "connected", connectionId: assignedConnectionId }));
      return;
    }
    if (requestURL.pathname === "/ws" && role === "server" && connectionId) {
      const pending = this.pending.get(connectionId);
      if (!pending) {
        websocket.close(1008, "unknown connection");
        return;
      }
      pending.daemon = websocket;
      this.bridge(pending);
      return;
    }
    websocket.close(1008, "unknown route");
  }

  private bridge(pending: PendingConnection): void {
    const daemon = pending.daemon;
    if (!daemon) return;
    pending.client.on("message", (raw, binary) => {
      let data = rawDataBuffer(raw);
      this.frames.push({ direction: "client", data: Buffer.from(data), binary });
      if (!binary && data[0] === 0x7b) {
        try {
          const message = JSON.parse(data.toString("utf8")) as { type?: unknown };
          if (message.type === "e2ee_hello") this.capturedHello = data.toString("utf8");
        } catch {
          // Non-JSON text is encrypted base64 traffic.
        }
      }
      if (pending.ready && this.tamperNextClientApplicationFrame) {
        this.tamperNextClientApplicationFrame = false;
        data = Buffer.from(data);
        data[0] ^= 1;
      }
      if (daemon.readyState === WebSocket.OPEN) {
        daemon.send(data, { binary });
        if (pending.ready && this.replayNextClientApplicationFrame) {
          this.replayNextClientApplicationFrame = false;
          daemon.send(data, { binary });
        }
      }
    });
    daemon.on("message", (raw, binary) => {
      const data = rawDataBuffer(raw);
      this.frames.push({ direction: "daemon", data: Buffer.from(data), binary });
      if (!binary && data.includes(Buffer.from('"type":"e2ee_ready"'))) pending.ready = true;
      if (pending.client.readyState === WebSocket.OPEN) pending.client.send(data, { binary });
    });
    daemon.once("close", (code, reason) => {
      if (pending.client.readyState !== WebSocket.OPEN) return;
      const forwardedCode = code === 1005 || code === 1006 || code === 1015 ? 1011 : code;
      pending.client.close(forwardedCode, reason.toString());
    });
  }
}

test("copied DaemonClient reaches the Go daemon through an authenticated untrusted Relay", async () => {
  if (process.platform === "win32") return;

  const root = await mkdtemp(join(tmpdir(), "byspace-go-relay-"));
  const home = join(root, "home");
  const cliHome = join(root, "cli-home");
  const bin = join(root, "bin");
  const web = join(root, "web");
  const project = join(root, "project");
  const daemonBinary = join(root, "byspace");
  await Promise.all([mkdir(home), mkdir(cliHome), mkdir(bin), mkdir(web), mkdir(project)]);
  await writeFile(join(web, "index.html"), "<!doctype html><head></head>", "utf8");
  await execFileAsync("go", ["build", "-o", daemonBinary, "./cmd/byspace"], { cwd: goRoot });
  const fakePi = join(bin, "pi");
  await writeFile(
    fakePi,
    await readFile(join(repositoryRoot, "fixtures", "pi", "fake-rpc.mjs"), "utf8"),
    "utf8",
  );
  await chmod(fakePi, 0o755);

  const relay = new MockRelay();
  await relay.start();
  const invocationLog = join(root, "pi-invocations.ndjson");
  let daemonOutput = "";
  const spawnDaemon = (): ChildProcess => {
    const child = spawn(
      daemonBinary,
      [
        "daemon",
        "start",
        "--foreground",
        "--home",
        home,
        "--listen",
        "127.0.0.1:0",
        "--web-dir",
        web,
        "--relay-url",
        relay.origin,
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          BYSPACE_E2E_PI_INVOCATION_LOG: invocationLog,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (chunk) => (daemonOutput += String(chunk)));
    child.stderr?.on("data", (chunk) => (daemonOutput += String(chunk)));
    return child;
  };
  let daemon = spawnDaemon();
  const clients: DaemonClient[] = [];
  cleanup.push(async () => {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    await relay.stop();
    if (daemon.exitCode === null) {
      daemon.kill("SIGKILL");
      await waitForExit(daemon).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  });

  await waitForPidRecord(home, daemon, () => daemonOutput);
  await relay.waitForControl();
  const { stdout: pairOutput } = await execFileAsync(
    daemonBinary,
    ["pair", "--home", home, "--relay-url", relay.origin, "--json"],
    { cwd: project },
  );
  const pairResult = JSON.parse(pairOutput) as { offer: unknown; url: string };
  const offer = ConnectionOfferSchema.parse(pairResult.offer);
  expect(offer.v).toBe(3);
  if (offer.v !== 3) throw new Error("authenticated offer required");

  const createClient = (token = offer.clientAuthTokenB64): DaemonClient => {
    const client = new DaemonClient({
      url: relay.clientURL(offer.serverId),
      clientId: `relay_e2e_${clients.length}`,
      clientType: "cli",
      reconnect: { enabled: false },
      connectTimeoutMs: 3_000,
      e2ee: {
        enabled: true,
        daemonPublicKeyB64: offer.daemonPublicKeyB64,
        clientAuthTokenB64: token,
      },
    });
    clients.push(client);
    return client;
  };

  const client = createClient();
  await connectClient(client, "initial Relay client", () => daemonOutput);
  expect(client.getLastServerInfoMessage()?.features?.pairingOfferRpc).toBe(true);
  const remotePairingOffer = await client.getDaemonPairingOffer();
  expect(remotePairingOffer.relayEnabled).toBe(true);
  expect(remotePairingOffer.url).toContain("#offer=");
  expect((await client.fetchWorkspaces()).entries).toHaveLength(1);
  const created = await client.createAgent({
    provider: "pi",
    cwd: project,
    initialPrompt: "remote tracer secret",
    clientMessageId: "remote-create-1",
  });
  const firstTimeline = await waitForTimeline(client, created.id, 2);
  expect(firstTimeline.entries.map((entry) => entry.item.type)).toEqual([
    "user_message",
    "assistant_message",
  ]);
  expect(
    Buffer.concat(relay.frames.map((frame) => frame.data)).includes("remote tracer secret"),
  ).toBe(false);
  expect(relay.capturedHello).toContain('"auth":{"scheme":"hmac-sha256-v1"');

  await execFileWithInput(
    daemonBinary,
    ["host", "import", "--home", cliHome],
    `${pairResult.url}\n`,
    project,
  );
  const { stdout: hostListOutput } = await execFileAsync(
    daemonBinary,
    ["host", "list", "--home", cliHome, "--json"],
    { cwd: project },
  );
  expect(hostListOutput).not.toContain(offer.clientAuthTokenB64);
  expect(hostListOutput).not.toContain(offer.daemonPublicKeyB64);
  expect(JSON.parse(hostListOutput)).toEqual([
    {
      serverId: offer.serverId,
      relayEndpoint: offer.relay.endpoint,
      useTls: offer.relay.useTls ?? false,
    },
  ]);
  const { stdout: cliAgentList } = await execFileAsync(
    daemonBinary,
    ["agent", "list", "--host", offer.serverId, "--home", cliHome, "--json"],
    { cwd: project },
  );
  expect(
    (JSON.parse(cliAgentList) as { entries: Array<{ agent: { id: string } }> }).entries.map(
      (entry) => entry.agent.id,
    ),
  ).toContain(created.id);
  const { stdout: cliTimeline } = await execFileAsync(
    daemonBinary,
    ["agent", "timeline", created.id, "--host", offer.serverId, "--home", cliHome, "--json"],
    { cwd: project },
  );
  expect(cliTimeline).toContain("remote tracer secret");
  expect(cliTimeline).not.toContain(offer.clientAuthTokenB64);

  const staleHello = relay.capturedHello;
  if (!staleHello) throw new Error("Relay did not observe the authenticated hello");
  await expectRejectedRawHandshake(relay.clientURL(offer.serverId), staleHello);

  const wrongToken = `${offer.clientAuthTokenB64[0] === "A" ? "B" : "A"}${offer.clientAuthTokenB64.slice(1)}`;
  const unauthorized = createClient(wrongToken);
  await expect(unauthorized.connect()).rejects.toThrow();

  const unauthorizedCliHome = join(root, "unauthorized-cli-home");
  await mkdir(unauthorizedCliHome);
  const unauthorizedOffer = { ...offer, clientAuthTokenB64: wrongToken };
  const unauthorizedURL = `https://app.byspace.cc.cd/#offer=${Buffer.from(
    JSON.stringify(unauthorizedOffer),
  ).toString("base64url")}`;
  await execFileWithInput(
    daemonBinary,
    ["host", "import", "--home", unauthorizedCliHome],
    `${unauthorizedURL}\n`,
    project,
  );
  await expect(
    execFileAsync(
      daemonBinary,
      ["agent", "list", "--host", offer.serverId, "--home", unauthorizedCliHome],
      { cwd: project },
    ),
  ).rejects.toThrow();

  const wrongKeyCliHome = join(root, "wrong-key-cli-home");
  await mkdir(wrongKeyCliHome);
  const wrongKeyOffer = {
    ...offer,
    daemonPublicKeyB64: Buffer.alloc(32, 7).toString("base64"),
  };
  const wrongKeyURL = `https://app.byspace.cc.cd/#offer=${Buffer.from(
    JSON.stringify(wrongKeyOffer),
  ).toString("base64url")}`;
  await execFileWithInput(
    daemonBinary,
    ["host", "import", "--home", wrongKeyCliHome],
    `${wrongKeyURL}\n`,
    project,
  );
  await expect(
    execFileAsync(
      daemonBinary,
      ["agent", "list", "--host", offer.serverId, "--home", wrongKeyCliHome],
      { cwd: project },
    ),
  ).rejects.toThrow();

  const mismatchedServerId = "srv_zzzzzzzzzzzz";
  const mismatchedOffer = { ...offer, serverId: mismatchedServerId };
  const mismatchedURL = `https://app.byspace.cc.cd/#offer=${Buffer.from(
    JSON.stringify(mismatchedOffer),
  ).toString("base64url")}`;
  await execFileWithInput(
    daemonBinary,
    ["host", "import", "--home", cliHome],
    `${mismatchedURL}\n`,
    project,
  );
  await expect(
    execFileAsync(
      daemonBinary,
      ["agent", "list", "--host", mismatchedServerId, "--home", cliHome],
      { cwd: project },
    ),
  ).rejects.toThrow();

  relay.tamperNextClientApplicationFrame = true;
  const tampered = createClient();
  await expect(tampered.connect()).rejects.toThrow();

  await client.close();
  const relayPort = Number(new URL(relay.origin).port);
  await relay.stop();
  await relay.start(relayPort);
  await relay.waitForControl();

  const resumed = createClient();
  await connectClient(resumed, "client after Relay restart");
  expect((await resumed.fetchAgents()).entries.map((entry) => entry.agent.id)).toContain(
    created.id,
  );
  await resumed.sendAgentMessage(created.id, "stream", { messageId: "remote-message-2" });
  const resumedTimeline = await waitForTimeline(resumed, created.id, 4);
  expect(resumedTimeline.entries.at(-1)?.item).toMatchObject({
    type: "assistant_message",
    text: "from fake pi",
  });
  expect(Buffer.concat(relay.frames.map((frame) => frame.data)).includes("remote-message-2")).toBe(
    false,
  );

  const agentCountBeforeReplay = (await resumed.fetchAgents()).entries.length;
  relay.replayNextClientApplicationFrame = true;
  await resumed.createAgent({ provider: "pi", cwd: project }).catch(() => undefined);
  const afterReplay = createClient();
  await connectClient(afterReplay, "client after replay rejection");
  expect((await afterReplay.fetchAgents()).entries).toHaveLength(agentCountBeforeReplay + 1);

  await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home], { cwd: project });
  await waitForExit(daemon);
  expect(daemon.exitCode).toBe(0);

  daemonOutput = "";
  daemon = spawnDaemon();
  await waitForPidRecord(home, daemon, () => daemonOutput);
  await relay.waitForControl();
  const afterDaemonRestart = createClient();
  await connectClient(afterDaemonRestart, "client after daemon restart");
  expect((await afterDaemonRestart.fetchAgents()).entries.map((entry) => entry.agent.id)).toContain(
    created.id,
  );
  await afterDaemonRestart.sendAgentMessage(created.id, "after daemon restart", {
    messageId: "remote-message-3",
  });
  const restartTimeline = await waitForTimeline(afterDaemonRestart, created.id, 6);
  expect(restartTimeline.entries.at(-1)?.item).toMatchObject({
    type: "assistant_message",
    text: "from fake pi",
  });
  const invocations = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  expect(invocations.at(-1)).toContain("--session");

  let cliFollowOutput = "";
  let cliFollowError = "";
  const cliFollow = spawn(
    daemonBinary,
    [
      "agent",
      "timeline",
      created.id,
      "--host",
      offer.serverId,
      "--home",
      cliHome,
      "--follow",
      "--json",
    ],
    { cwd: project, stdio: ["ignore", "pipe", "pipe"] },
  );
  cliFollow.stdout?.on("data", (chunk) => (cliFollowOutput += String(chunk)));
  cliFollow.stderr?.on("data", (chunk) => (cliFollowError += String(chunk)));
  await waitUntil(() => cliFollowOutput.includes("after daemon restart"), 8_000, "CLI follower");
  await afterDaemonRestart.sendAgentMessage(created.id, "observed by remote CLI", {
    messageId: "remote-message-4",
  });
  await waitUntil(
    () => cliFollowOutput.includes("observed by remote CLI"),
    8_000,
    `CLI remote Timeline update: ${cliFollowError}`,
  );
  cliFollow.kill("SIGTERM");
  await waitForExit(cliFollow);
  expect(cliFollow.exitCode).toBe(0);
  expect(cliFollowOutput).not.toContain(offer.clientAuthTokenB64);

  await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home], { cwd: project });
  await waitForExit(daemon);
  expect(daemon.exitCode).toBe(0);
}, 120_000);

const liveRelayTest = process.env.RUN_LIVE_RELAY_E2E === "1" ? test : test.skip;

liveRelayTest(
  "Go daemon, copied DaemonClient, and Go CLI traverse the production Relay",
  async () => {
    if (process.platform === "win32") return;

    const relayOrigin = process.env.PASEO_LIVE_RELAY_URL ?? "wss://relay.byspace.cc.cd";
    const root = await mkdtemp(join(tmpdir(), "byspace-live-relay-"));
    const home = join(root, "home");
    const cliHome = join(root, "cli-home");
    const bin = join(root, "bin");
    const web = join(root, "web");
    const project = join(root, "project");
    const daemonBinary = join(root, "byspace");
    await Promise.all([mkdir(home), mkdir(cliHome), mkdir(bin), mkdir(web), mkdir(project)]);
    await writeFile(join(web, "index.html"), "<!doctype html><head></head>", "utf8");
    await execFileAsync("go", ["build", "-o", daemonBinary, "./cmd/byspace"], { cwd: goRoot });
    const fakePi = join(bin, "pi");
    await writeFile(
      fakePi,
      await readFile(join(repositoryRoot, "fixtures", "pi", "fake-rpc.mjs"), "utf8"),
      "utf8",
    );
    await chmod(fakePi, 0o755);

    let daemonOutput = "";
    const daemon = spawn(
      daemonBinary,
      [
        "daemon",
        "start",
        "--foreground",
        "--home",
        home,
        "--listen",
        "127.0.0.1:0",
        "--web-dir",
        web,
        "--relay-url",
        relayOrigin,
      ],
      {
        cwd: project,
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    daemon.stdout?.on("data", (chunk) => (daemonOutput += String(chunk)));
    daemon.stderr?.on("data", (chunk) => (daemonOutput += String(chunk)));
    const clients: DaemonClient[] = [];
    cleanup.push(async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      if (daemon.exitCode === null) {
        daemon.kill("SIGKILL");
        await waitForExit(daemon).catch(() => undefined);
      }
      await rm(root, { recursive: true, force: true });
    });

    await waitForPidRecord(home, daemon, () => daemonOutput);
    const { stdout: pairOutput } = await execFileAsync(
      daemonBinary,
      ["pair", "--home", home, "--relay-url", relayOrigin, "--json"],
      { cwd: project },
    );
    const pairResult = JSON.parse(pairOutput) as { offer: unknown; url: string };
    const offer = ConnectionOfferSchema.parse(pairResult.offer);
    if (offer.v !== 3) throw new Error("authenticated production offer required");

    const relayURL = new URL("/ws", relayOrigin);
    relayURL.searchParams.set("serverId", offer.serverId);
    relayURL.searchParams.set("role", "client");
    relayURL.searchParams.set("v", "2");

    let client: DaemonClient | undefined;
    let connectError: unknown;
    for (let attempt = 0; attempt < 20 && !client; attempt++) {
      const candidate = new DaemonClient({
        url: relayURL.toString(),
        clientId: `live_relay_${randomUUID()}`,
        clientType: "cli",
        reconnect: { enabled: false },
        connectTimeoutMs: 5_000,
        e2ee: {
          enabled: true,
          daemonPublicKeyB64: offer.daemonPublicKeyB64,
          clientAuthTokenB64: offer.clientAuthTokenB64,
        },
      });
      clients.push(candidate);
      try {
        await candidate.connect();
        client = candidate;
      } catch (error) {
        connectError = error;
        await candidate.close().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!client) {
      throw new Error(`production Relay client did not connect\n${daemonOutput}`, {
        cause: connectError,
      });
    }

    const prompt = `production-relay-smoke-${randomUUID()}`;
    const created = await client.createAgent({
      provider: "pi",
      cwd: project,
      initialPrompt: prompt,
      clientMessageId: `live-create-${randomUUID()}`,
    });
    const timeline = await waitForTimeline(client, created.id, 2);
    expect(timeline.entries.map((entry) => entry.item.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);

    await execFileWithInput(
      daemonBinary,
      ["host", "import", "--home", cliHome],
      `${pairResult.url}\n`,
      project,
    );
    const { stdout: cliAgents } = await execFileAsync(
      daemonBinary,
      ["agent", "list", "--host", offer.serverId, "--home", cliHome, "--json"],
      { cwd: project },
    );
    expect(cliAgents).toContain(created.id);
    expect(cliAgents).not.toContain(offer.clientAuthTokenB64);
    expect(cliAgents).not.toContain(offer.daemonPublicKeyB64);

    const { stdout: cliTimeline } = await execFileAsync(
      daemonBinary,
      ["agent", "timeline", created.id, "--host", offer.serverId, "--home", cliHome, "--json"],
      { cwd: project },
    );
    expect(cliTimeline).toContain(prompt);
    expect(cliTimeline).not.toContain(offer.clientAuthTokenB64);
    expect(cliTimeline).not.toContain(offer.daemonPublicKeyB64);

    await client.close();
    await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home], { cwd: project });
    await waitForExit(daemon);
    expect(daemon.exitCode).toBe(0);
  },
  180_000,
);

async function execFileWithInput(
  executable: string,
  args: string[],
  input: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`command exited ${code}: ${stderr}`));
    });
    child.stdin?.end(input);
  });
}

function rawDataBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

async function expectRejectedRawHandshake(url: string, staleHello: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    let ready = false;
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("stale Relay handshake was not rejected"));
    }, 5_000);
    socket.on("message", (raw, binary) => {
      if (binary) return;
      const text = rawDataBuffer(raw).toString("utf8");
      if (text.includes('"type":"e2ee_challenge"')) socket.send(staleHello);
      if (text.includes('"type":"e2ee_ready"')) ready = true;
    });
    socket.once("close", () => {
      clearTimeout(timer);
      if (ready) reject(new Error("stale Relay handshake reached ready state"));
      else resolve();
    });
    socket.once("error", () => undefined);
  });
}

async function connectClient(
  client: DaemonClient,
  label: string,
  diagnostics: () => string = () => "",
): Promise<void> {
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Failed to connect ${label}\n${diagnostics()}`, { cause: error });
  }
}

async function waitForTimeline(client: DaemonClient, agentId: string, count: number) {
  let latest = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: 0 });
  await waitUntil(
    async () => {
      latest = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: 0 });
      return latest.entries.length >= count;
    },
    8_000,
    `timeline length ${count}`,
  );
  return latest;
}

async function waitForPidRecord(
  home: string,
  daemon: ChildProcess,
  output: () => string,
): Promise<{ listen: string }> {
  let record: { listen: string } | undefined;
  await waitUntil(
    async () => {
      if (daemon.exitCode !== null) throw new Error(`daemon exited early\n${output()}`);
      try {
        record = JSON.parse(await readFile(join(home, "byspace.pid"), "utf8")) as {
          listen: string;
        };
        return Boolean(record.listen);
      } catch {
        return false;
      }
    },
    8_000,
    "daemon PID record",
  );
  return record!;
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
