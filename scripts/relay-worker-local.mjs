import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Starts an isolated local workerd instance. It never starts a BySpace daemon,
// contacts a deployed hostname, or opens a real agent/session.
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
let mode = process.argv.includes("--live-budget") ? "live" : "default";
const DAILY_BUDGETS = { default: 12, live: 4, budget: 8, close: 12, concurrent: 1_000_000 };
if (process.argv.includes("--budget")) mode = "budget";
if (process.argv.includes("--close")) mode = "close";
if (process.argv.includes("--concurrent")) mode = "concurrent";
const DAILY_BUDGET = DAILY_BUDGETS[mode];
const port = await freePort();
const stateDirectory = mkdtempSync(`${tmpdir()}/byspace-relay-local-`);
const origin = `http://127.0.0.1:${port}`;
const wsOrigin = `ws://127.0.0.1:${port}`;
const wrangler = spawn(
  process.execPath,
  [
    resolvePath(ROOT, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--local",
    `--persist-to=${stateDirectory}`,
    "--ip=127.0.0.1",
    `--port=${port}`,
    "--log-level=log",
    "--config=workers/relay/wrangler.jsonc",
    `--var=RELAY_DAILY_REQUEST_BUDGET:${DAILY_BUDGET}`,
  ],
  {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1" },
  },
);
let workerLog = "";
wrangler.stdout.on("data", (data) => {
  workerLog += data;
});
wrangler.stderr.on("data", (data) => {
  workerLog += data;
});

try {
  await waitForWorker();
  if (mode === "budget") await testSharedBudget();
  else if (mode === "live") await testLiveBudget();
  else if (mode === "close") await testClose();
  else if (mode === "concurrent") await testConcurrentStreams();
  else await testRouting();
} catch (error) {
  console.error(workerLog.slice(-8000));
  throw error;
} finally {
  if (wrangler.exitCode === null) wrangler.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => wrangler.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  rmSync(stateDirectory, { recursive: true, force: true });
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) =>
    probe.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const availablePort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return availablePort;
}

async function waitForWorker() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (wrangler.exitCode !== null)
      throw new Error(`local Worker exited (${wrangler.exitCode})\n${workerLog}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local Worker did not become ready\n${workerLog}`);
}

async function workerWarnings() {
  // Local workerd exposes DO console logs through its observability API rather than Wrangler's stdout.
  const response = await fetch(`${origin}/cdn-cgi/local/explorer/api/local/observability/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT message FROM logs" }),
  });
  assert.equal(response.status, 200);
  return response.text();
}

function connect(serverId, role, connectionId) {
  const query = new URLSearchParams({ serverId, role, v: "2" });
  if (connectionId) query.set("connectionId", connectionId);
  const socket = new WebSocket(`${wsOrigin}/ws?${query}`);
  const messages = [];
  const waits = [];
  const closed = new Promise((resolve) =>
    socket.addEventListener("close", (event) => resolve(event), { once: true }),
  );
  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : String(event.data);
    const waiter = waits.shift();
    if (waiter) waiter.resolve(data);
    else messages.push(data);
  });
  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timed out")), 10_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener("error", () => reject(new Error("local relay socket failed")), {
      once: true,
    });
  });
  function next() {
    if (messages.length) return Promise.resolve(messages.shift());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("relay message timed out")), 10_000);
      waits.push({
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
      });
    });
  }
  return { socket, opened, next, closed };
}

async function testRouting() {
  const control = connect("local-routing-proof", "server");
  await control.opened;
  assert.equal(JSON.parse(await control.next()).type, "sync");
  control.socket.send(JSON.stringify({ type: "ping" }));
  assert.equal(JSON.parse(await control.next()).type, "pong");

  const client = connect("local-routing-proof", "client", "local-one");
  await client.opened;
  assert.equal(JSON.parse(await control.next()).type, "connected");
  const daemon = connect("local-routing-proof", "server", "local-one");
  await daemon.opened;
  const opaque = JSON.stringify({
    nonce: "local-only",
    ciphertext: "opaque-relay-payload",
  });
  client.socket.send(opaque);
  assert.equal(await daemon.next(), opaque);
  daemon.socket.send(opaque);
  assert.equal(await client.next(), opaque);

  // Crossing the observation threshold leaves both new handshakes and established traffic intact.
  const other = connect("another-room", "server");
  await other.opened;
  assert.equal(JSON.parse(await other.next()).type, "sync");
  console.log("PASS routing and handshake availability after the observation threshold");
  for (const peer of [client, daemon, control]) peer.socket.close();
}

async function testSharedBudget() {
  // Different rooms share one observation counter, without disconnecting clients at the threshold.
  for (let index = 0; index < DAILY_BUDGET / 2 + 1; index++) {
    const peer = connect(`local-shared-room-${index}`, "server");
    await peer.opened;
    assert.equal(JSON.parse(await peer.next()).type, "sync");
    peer.socket.close();
  }
  assert.match(await workerWarnings(), /relay daily request observation threshold exceeded/);
  console.log("PASS rooms share one observation counter without refusing excess handshakes");
}

async function closeResult(peer) {
  return Promise.race([
    peer.closed,
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
}

async function testClose() {
  const control = connect("local-close", "server");
  await control.opened;
  assert.equal(JSON.parse(await control.next()).type, "sync");
  control.socket.close(1000, "done");
  const close = await closeResult(control);
  assert.equal(close?.code, 1000, "control close should complete normally");
  assert.equal(close?.reason, "done");

  const client = await rawSocket("local-raw-close", "client", "raw-one");
  const daemon = await rawSocket("local-raw-close", "server", "raw-one");
  client.close(1000, "done");
  const clientFrame = await client.nextFrame();
  client.close(1000, "done");
  assert.equal(clientFrame?.opcode, 8);
  assert.equal(clientFrame?.payload.readUInt16BE(), 1000);
  assert.equal(clientFrame?.payload.subarray(2).toString(), "done");
  const daemonFrame = await daemon.nextFrame();
  assert.equal(daemonFrame?.opcode, 8, "daemon should receive the client's departure close frame");
  assert.equal(daemonFrame?.payload.readUInt16BE(), 1001);
  assert.equal(daemonFrame?.payload.subarray(2).toString(), "Client disconnected");
  daemon.close(1001, "Client disconnected");
  client.destroy();
  daemon.destroy();

  const secondClient = await rawSocket("local-raw-close-two", "client", "raw-two");
  const secondDaemon = await rawSocket("local-raw-close-two", "server", "raw-two");
  secondDaemon.close(1000, "done");
  const secondDaemonFrame = await secondDaemon.nextFrame();
  assert.equal(secondDaemonFrame?.payload.readUInt16BE(), 1000);
  const secondClientFrame = await secondClient.nextFrame();
  assert.equal(secondClientFrame?.opcode, 8);
  assert.equal(secondClientFrame?.payload.readUInt16BE(), 1012);
  assert.equal(secondClientFrame?.payload.subarray(2).toString(), "Server disconnected");
  secondClient.destroy();
  secondDaemon.destroy();
  console.log("PASS close handshakes and raw peer departure close frames");
}

async function rawSocket(serverId, role, connectionId) {
  const key = randomBytes(16).toString("base64");
  const socket = createConnection(port, "127.0.0.1");
  let buffer = Buffer.alloc(0);
  socket.on("connect", () => {
    const query = new URLSearchParams({ serverId, role, v: "2", connectionId });
    socket.write(
      `GET /ws?${query} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        `Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
  });
  const frames = [];
  const waits = [];
  let upgraded = false;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headers = buffer.subarray(0, end).toString();
      assert.match(headers, /^HTTP\/1\.1 101 /);
      assert.match(
        headers,
        new RegExp(
          `sec-websocket-accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64").replace(/[+/=]/g, "\\$&")}`,
          "i",
        ),
      );
      buffer = buffer.subarray(end + 4);
      upgraded = true;
      waits.shift()?.();
    }
    while (buffer.length >= 2) {
      const length = buffer[1] & 127;
      if (length >= 126 || buffer.length < 2 + length) return;
      const opcode = buffer[0] & 15;
      const payload = buffer.subarray(2, 2 + length);
      buffer = buffer.subarray(2 + length);
      frames.push({ opcode, payload });
    }
  });
  await new Promise((resolve, reject) => {
    waits.push(resolve);
    setTimeout(() => reject(new Error(`raw ${role} upgrade timed out`)), 3000).unref();
  });
  return {
    close(code, reason) {
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code);
      payload.write(reason, 2);
      const mask = randomBytes(4);
      const masked = payload.map((byte, index) => byte ^ mask[index % 4]);
      socket.write(Buffer.concat([Buffer.from([0x88, 0x80 | payload.length]), mask, masked]));
    },
    async nextFrame() {
      const deadline = Date.now() + 3000;
      while (!frames.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return frames.shift() ?? null;
    },
    destroy() {
      socket.destroy();
    },
  };
}

async function testConcurrentStreams() {
  const streams = Array.from({ length: 6 }, (_, index) => ({
    id: `stream-${index}`,
    client: connect("local-concurrent-streams", "client", `stream-${index}`),
    daemon: connect("local-concurrent-streams", "server", `stream-${index}`),
  }));
  await Promise.all(streams.flatMap(({ client, daemon }) => [client.opened, daemon.opened]));
  const expected =
    Array.from({ length: 250 }, (_, index) => `data: ${index}\n\n`).join("") + "data: [DONE]\n\n";

  await Promise.all(
    streams.map(async ({ client, daemon }) => {
      const received = (async () => {
        let body = "";
        while (!body.endsWith("data: [DONE]\n\n")) body += await client.next();
        return body;
      })();
      for (const chunk of expected.match(/data: .*\n\n/g)) daemon.socket.send(chunk);
      assert.equal(await received, expected, "each response must arrive intact and unmixed");
    }),
  );
  console.log("PASS six concurrent opaque streaming responses arrive intact and unmixed");
  for (const { client, daemon } of streams) {
    client.socket.close();
    daemon.socket.close();
  }
}

// Crossing the daily observation threshold must not cut a live response.
async function testLiveBudget() {
  const daemon = connect("local-live-budget", "server", "local-one");
  await daemon.opened;
  const client = connect("local-live-budget", "client", "local-one");
  await client.opened;
  client.socket.send("must-still-route");
  assert.equal(await daemon.next(), "must-still-route");
  assert.match(await workerWarnings(), /relay daily request observation threshold exceeded/);
  console.log("PASS live message forwarding continues after the observation threshold");
  daemon.socket.close();
}
