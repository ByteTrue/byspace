// Checks a running daemon through a running relay, the way the browser and mobile app connect:
// the real `packages/relay` channel, a real E2EE handshake, a real Go daemon.
//
// It covers the two things unit tests structurally cannot:
//
//   1. the daemon's per-session e2ee challenge. The Go client answers it, so a Go-only test passes
//      even when the TypeScript client does not — and then every browser frame is silently dropped.
//   2. the relay binary-frame gate. A socket that answered the challenge but never proved the
//      daemon password must not be able to spawn a terminal.
//
// Usage (from the repo root, with `bin/byspace`):
//
//   BYSPACE_HOME=/tmp/e2e bin/byspace relay --addr 127.0.0.1:7001 &
//   BYSPACE_HOME=/tmp/e2e bin/byspace serve --addr 127.0.0.1:6799 --home /tmp/e2e \
//     --relay ws://127.0.0.1:7001/ws &
//   printf 'e2e-pass\ne2e-pass\n' | bin/byspace daemon set-password --addr 127.0.0.1:6799
//   npm run build:relay
//   E2E_HOME=/tmp/e2e node scripts/e2e-relay-client-check.mjs
//
// The terminal gate prints the slot it used; confirm `sessions.terminals` stays 0 in the daemon's
// periodic `ws_runtime_metrics` log line for that window.
import { readFile } from "node:fs/promises";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../packages/relay/dist/base64.js";
import { createClientChannel } from "../packages/relay/dist/encrypted-channel.js";
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "../packages/relay/dist/crypto.js";

const relayUrl = process.env.RELAY_URL ?? "ws://127.0.0.1:7001/ws";
const home = process.env.E2E_HOME ?? "/tmp/e2e";
// A fresh connectionId per run: reusing one lets a socket left over from an earlier run receive
// frames meant for this one, which shows up as a frame that will not decrypt.
const runId = `${Date.now().toString(36)}`;
const password = process.env.E2E_PASSWORD ?? "e2e-pass";

const serverId = (await readFile(`${home}/server-id`, "utf8")).trim();
const { publicKeyB64: daemonPublicKeyB64 } = JSON.parse(
  await readFile(`${home}/daemon-keypair.json`, "utf8"),
);

function relayUrlFor(connectionId) {
  const url = new URL(relayUrl);
  url.searchParams.set("serverId", serverId);
  url.searchParams.set("role", "client");
  url.searchParams.set("v", "2");
  url.searchParams.set("connectionId", connectionId);
  return url.toString();
}

async function dial(connectionId) {
  const ws = new WebSocket(relayUrlFor(connectionId));
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    setTimeout(() => reject(new Error("relay dial timed out")), 5000);
  });
  return ws;
}

// checkChannel drives the shipped client channel to server_info.
async function checkChannel() {
  const ws = await dial(`e2e_ts_channel_${runId}`);
  const inbox = [];
  const waiters = [];
  const deliver = (text) => {
    const waiter = waiters.shift();
    if (waiter) waiter(text);
    else inbox.push(text);
  };
  const nextMessage = (timeoutMs) => {
    const queued = inbox.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no frame within ${timeoutMs}ms`)),
        timeoutMs,
      );
      waiters.push((text) => {
        clearTimeout(timer);
        resolve(text);
      });
    });
  };

  const transport = {
    send: (data) => {
      ws.send(data);
      return Promise.resolve();
    },
    close: (code, reason) => ws.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.addEventListener("message", (event) => {
    transport.onmessage?.({ data: event.data, isBinary: typeof event.data !== "string" });
  });
  ws.addEventListener("close", (event) => transport.onclose?.(event.code, event.reason ?? ""));
  ws.addEventListener("error", () => transport.onerror?.(new Error("relay socket error")));

  const channel = await createClientChannel(transport, daemonPublicKeyB64, {
    onmessage: (data) => {
      // Text frames arrive decoded; binary frames arrive as an ArrayBuffer.
      deliver(typeof data === "string" ? data : new TextDecoder().decode(data));
    },
  });

  await channel.send(
    JSON.stringify({
      type: "session",
      message: {
        type: "auth.password.submit.request",
        requestId: "e2e_pw",
        password,
      },
    }),
  );
  const auth = JSON.parse(await nextMessage(8000))?.message?.payload;
  const authOk = auth?.ok === true;
  console.log(`challenge echo + relay password: ${authOk ? "accepted" : "REFUSED"}`);
  if (!authOk) return false;

  await channel.send(
    JSON.stringify({
      type: "hello",
      clientId: `e2e_ts_channel_${runId}`,
      clientType: "web",
      protocolVersion: 1,
      capabilities: {},
    }),
  );
  const info = JSON.parse(await nextMessage(8000))?.message?.payload;
  const ok = info?.status === "server_info" && info?.serverId === serverId;
  console.log(`server_info: ${ok ? "received" : "MISSING"}`);
  console.log(`features.hostSync: ${info?.features?.hostSync === true}`);
  ws.close();
  return ok;
}

// checkTerminalGate sends terminal input without ever proving the daemon password. The daemon must
// not act on it. This one is asserted from outside the process by the caller reading the metrics
// log; here it only reports that the frame went out.
async function checkTerminalGate() {
  const slot = Number(process.env.E2E_SLOT ?? "9");
  const keyPair = generateKeyPair();
  const shared = deriveSharedKey(keyPair.secretKey, importPublicKey(daemonPublicKeyB64));
  const ws = new WebSocket(
    `${relayUrl}?serverId=${encodeURIComponent(serverId)}&role=client&v=2&connectionId=e2e_terminal_gate_${runId}`,
  );
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    setTimeout(() => reject(new Error("relay dial timed out")), 5000);
  });
  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
    if (!text.trimStart().startsWith("{")) return;
    const ready = JSON.parse(text);
    if (ready.type !== "e2ee_ready") return;
    ws.send(
      arrayBufferToBase64(
        encrypt(shared, JSON.stringify({ type: "e2ee_challenge", challenge: ready.challenge })),
      ),
    );
    // Terminal input (opcode 0x02, then the slot) as binary ciphertext — the family the relay gate
    // used to skip entirely.
    const payload = new Uint8Array([0x02, slot, ...new TextEncoder().encode("id\n")]);
    ws.send(encrypt(shared, payload.buffer));
    console.log(`unauthenticated terminal input sent for slot ${slot}`);
  });
  ws.send(
    JSON.stringify({
      type: "e2ee_hello",
      key: exportPublicKey(keyPair.publicKey),
      capabilities: { binaryCiphertext: true },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  ws.close();
}

// checkDecryptable is the control for the gate above: with the password, a terminal frame does
// land, so a broken wire is not mistaken for the gate working.
async function checkAuthenticatedTerminal() {
  const slot = Number(process.env.E2E_SLOT2 ?? "8");
  const keyPair = generateKeyPair();
  const shared = deriveSharedKey(keyPair.secretKey, importPublicKey(daemonPublicKeyB64));
  const ws = new WebSocket(
    `${relayUrl}?serverId=${encodeURIComponent(serverId)}&role=client&v=2&connectionId=e2e_terminal_auth_${runId}`,
  );
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    setTimeout(() => reject(new Error("relay dial timed out")), 5000);
  });
  const send = (plain) => {
    const body = typeof plain === "string" ? plain : plain;
    ws.send(arrayBufferToBase64(encrypt(shared, body)));
  };
  const replies = [];
  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
    if (text.trimStart().startsWith("{")) {
      const ready = JSON.parse(text);
      if (ready.type === "e2ee_ready") {
        send(JSON.stringify({ type: "e2ee_challenge", challenge: ready.challenge }));
        send(
          JSON.stringify({
            type: "session",
            message: {
              type: "auth.password.submit.request",
              requestId: "e2e_auth_pw",
              password,
            },
          }),
        );
      }
      return;
    }
    let opened;
    try {
      opened = decrypt(shared, base64ToArrayBuffer(text));
    } catch {
      // Not ours to read (a frame sealed under an earlier handshake); only the auth reply matters.
      return;
    }
    replies.push(JSON.parse(new TextDecoder().decode(opened)));
    if (replies.at(-1)?.message?.payload?.ok === true) {
      const payload = new Uint8Array([0x02, slot, ...new TextEncoder().encode("id\n")]);
      ws.send(encrypt(shared, payload.buffer));
      console.log(`authenticated terminal input sent for slot ${slot}`);
    }
  });
  ws.send(
    JSON.stringify({
      type: "e2ee_hello",
      key: exportPublicKey(keyPair.publicKey),
      capabilities: { binaryCiphertext: true },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  ws.close();
}

const channelOk = await checkChannel();
await checkTerminalGate();
// E2E_SKIP_AUTH=1 leaves the control out, so a fresh daemon can be checked for "terminals stays
// 0" after the unauthenticated frame: that is the assertion the gate exists for.
if (process.env.E2E_SKIP_AUTH !== "1") {
  await checkAuthenticatedTerminal();
}
process.exit(channelOk ? 0 : 1);
