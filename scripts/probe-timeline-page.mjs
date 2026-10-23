// Direct wire probe: does a tail-40 timeline page contain the cycle stream's end marker?
// No browser, no Playwright — one daemon, one mock agent, raw WebSocket.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const REPO = path.resolve(import.meta.dirname, "..");
const PORT = 6795;
const home = mkdtempSync(path.join(tmpdir(), "probe-home-"));
const repoPath = path.join(home, "repo");

const daemon = spawn(
  path.join(REPO, "bin", "byspace"),
  ["serve", "--addr", `127.0.0.1:${PORT}`, "--home", home],
  {
    env: { ...process.env, BYSPACE_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let daemonLog = "";
daemon.stdout.on("data", (c) => (daemonLog += c.toString()));
daemon.stderr.on("data", (c) => (daemonLog += c.toString()));

// Poll the health endpoint rather than parsing the log: it is the same readiness signal the
// e2e harness uses, and it cannot be fooled by which stream the banner happens to land on.
async function waitForDaemon() {
  for (let i = 0; i < 100; i++) {
    if (daemon.exitCode !== null) throw new Error(`daemon exited early: ${daemonLog.slice(-300)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`daemon did not become healthy within 5s: ${daemonLog.slice(-300)}`);
}

await waitForDaemon();

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const pending = new Map();
let serverReady = false;

function send(message) {
  ws.send(JSON.stringify({ type: "session", message }));
}
function request(message, timeoutMs = 40_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${message.type}`)),
      timeoutMs,
    );
    pending.set(message.requestId, { resolve, reject, timer });
    send(message);
  });
}

ws.on("message", (raw) => {
  const env = JSON.parse(raw.toString());
  const msg = env?.message ?? env;
  const payload = msg?.payload;
  if (payload?.status === "server_info") serverReady = true;
  const responseType = msg?.type ?? "";
  for (const [id, waiter] of pending) {
    // Match on the echoed requestId alone: create_agent answers with a `status` message
    // (payload.status === "agent_created"), not a *_response type, so keying on the type
    // shape would wait forever for it.
    if (payload?.requestId === id) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.resolve(payload);
      return;
    }
  }
  void responseType;
});

const git = (args) => {
  const { spawnSync } = require("node:child_process");
  spawnSync("git", args, { cwd: repoPath });
};

const finish = (code, lines) => {
  console.log(lines.join("\n"));
  try {
    ws.close();
  } catch {}
  try {
    daemon.kill("SIGKILL");
  } catch {}
  rmSync(home, { recursive: true, force: true });
  process.exit(code);
};

ws.on("error", (error) => {
  finish(1, [`WS ERROR: ${error.message}`, `daemon log: ${daemonLog.slice(-400)}`]);
});

ws.on("open", async () => {
  // The daemon answers a hello with server_info; without the handshake it sends nothing and
  // every request below waits forever.
  ws.send(JSON.stringify({ type: "hello", clientId: "probe-timeline", protocolVersion: 1 }));
  const out = [];
  try {
    // oxlint-disable-next-line no-unmodified-loop-condition -- serverReady is set by the message handler.
    for (let i = 0; i < 200 && !serverReady; i++) await new Promise((r) => setTimeout(r, 50));
    if (!serverReady) throw new Error("no server_info after hello");
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(repoPath, { recursive: true });
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "probe@example.com"]);
    git(["config", "user.name", "probe"]);
    writeFileSync(path.join(repoPath, "README.md"), "seed\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "seed"]);

    const project = await request({ type: "project.add.request", requestId: "p1", cwd: repoPath });
    out.push(`project.add: ${JSON.stringify(project).slice(0, 120)}`);
    const wsRes = await request({
      type: "workspace.create.request",
      requestId: "w1",
      cwd: repoPath,
      source: { kind: "path", path: repoPath },
    });
    const workspaceId = wsRes?.workspace?.id;
    out.push(`workspace.create: id=${workspaceId}`);

    const created = await request({
      type: "create_agent_request",
      requestId: "c1",
      workspaceId,
      config: { provider: "mock", cwd: repoPath, model: "ten-second-stream", modeId: "load-test" },
    });
    const agentId = created?.agentId;
    out.push(`create_agent: id=${agentId} status=${created?.status}`);

    await request({
      type: "send_agent_message_request",
      requestId: "s1",
      agentId,
      text: "Start the turn that will be interrupted.",
      activeTurnBehavior: "interrupt",
    });
    out.push("sent first prompt");

    // Let it stream, then interrupt the way the queued-send does.
    await new Promise((r) => setTimeout(r, 1500));
    await request({
      type: "send_agent_message_request",
      requestId: "s2",
      agentId,
      text: "Keep this prompt before its response.",
      activeTurnBehavior: "interrupt",
    });
    out.push("sent interrupting prompt");

    const wait = await request({
      type: "wait_for_finish_request",
      requestId: "f1",
      agentId,
      timeoutMs: 30_000,
    });
    out.push(`wait_for_finish: status=${wait?.status}`);

    for (const limit of [40, 0]) {
      const page = await request({
        type: "fetch_agent_timeline_request",
        requestId: `t${limit}`,
        agentId,
        direction: "tail",
        projection: "projected",
        limit,
      });
      const entries = page?.entries ?? [];
      const types = entries.map((e) => e?.item?.type);
      const texts = entries.map((e) => e?.item?.text ?? "").join(" ");
      out.push(
        `tail limit=${limit}: entries=${entries.length} hasOlder=${page?.hasOlder} hasNewer=${page?.hasNewer} window=${JSON.stringify(page?.window)}`,
      );
      out.push(`  endMarkerPresent=${texts.includes("(end of synthetic stream)")}`);
      out.push(`  promptRowPresent=${texts.includes("Keep this prompt before its response.")}`);
      out.push(
        `  typeCounts=${JSON.stringify(types.reduce((acc, t) => ((acc[t] = (acc[t] ?? 0) + 1), acc), {}))}`,
      );
      out.push(`  lastTypes=${JSON.stringify(types.slice(-6))}`);
    }
    finish(0, out);
  } catch (error) {
    out.push(`ERROR: ${error instanceof Error ? error.stack : String(error)}`);
    out.push(`daemon log tail: ${daemonLog.slice(-400)}`);
    finish(1, out);
  }
});

setTimeout(() => finish(1, ["PROBE TIMEOUT", daemonLog.slice(-400)]), 120_000);
