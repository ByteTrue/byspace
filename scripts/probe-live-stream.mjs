// Live-wire probe: what does the daemon broadcast during a turn, and does the end marker arrive?
//
// The rewind spec's first assertion fails on the marker while `wait_for_finish` already reported
// idle. This spec only watches the live stream (no timeline fetch), so the question is whether the
// daemon emits the marker as a live timeline event at all, and what its item looks like on the wire.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const REPO = path.resolve(import.meta.dirname, "..");
const PORT = 6796;
const home = mkdtempSync(path.join(tmpdir(), "probe-live-"));
const repoPath = path.join(home, "repo");

const daemon = spawn(
  path.join(REPO, "bin", "byspace"),
  ["serve", "--addr", `127.0.0.1:${PORT}`, "--home", home],
  { env: { ...process.env, BYSPACE_HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
);
let daemonLog = "";
daemon.stdout.on("data", (c) => (daemonLog += c.toString()));
daemon.stderr.on("data", (c) => (daemonLog += c.toString()));

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
  throw new Error(`daemon did not become healthy: ${daemonLog.slice(-300)}`);
}

await waitForDaemon();

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const pending = new Map();
let serverReady = false;

// Every live agent_stream timeline event, in arrival order.
const liveTimeline = [];
const liveEventTypes = [];

const send = (message) => ws.send(JSON.stringify({ type: "session", message }));
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

ws.on("error", (error) => finish(1, [`WS ERROR: ${error.message}`, daemonLog.slice(-400)]));

// oxlint-disable-next-line complexity -- a wire probe: every branch reports a different failure mode.
ws.on("message", (raw) => {
  const env = JSON.parse(raw.toString());
  const msg = env?.message ?? env;
  const payload = msg?.payload;
  if (payload?.status === "server_info") serverReady = true;

  if (msg?.type === "agent_stream" && payload?.agentId) {
    const event = payload.event;
    liveEventTypes.push(event?.type);
    if (event?.type === "timeline") {
      const item = event.item ?? {};
      liveTimeline.push({
        type: item.type,
        messageId: item.messageId ?? null,
        clientMessageId: item.clientMessageId ?? null,
        seq: payload.seq ?? null,
        textLen: (item.text ?? "").length,
        textHead: (item.text ?? "").slice(0, 30),
        textTail: (item.text ?? "").slice(-30),
      });
    }
    return;
  }

  for (const [id, waiter] of pending) {
    if (payload?.requestId === id) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.resolve(payload);
      return;
    }
  }
});

function finish(code, lines) {
  console.log(lines.join("\n"));
  try {
    ws.close();
  } catch {}
  try {
    daemon.kill("SIGKILL");
  } catch {}
  rmSync(home, { recursive: true, force: true });
  process.exit(code);
}

const git = (args) => require("node:child_process").spawnSync("git", args, { cwd: repoPath });

// oxlint-disable-next-line complexity -- a wire probe: the whole scenario in one function, so a failure line names its step.
ws.on("open", async () => {
  // The daemon answers a hello with server_info; without the handshake it sends nothing and the
  // readiness wait below never resolves.
  ws.send(JSON.stringify({ type: "hello", clientId: "probe-live", protocolVersion: 1 }));
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

    await request({ type: "project.add.request", requestId: "p1", cwd: repoPath });
    const wsRes = await request({
      type: "workspace.create.request",
      requestId: "w1",
      cwd: repoPath,
      source: { kind: "path", path: repoPath },
    });
    const workspaceId = wsRes?.workspace?.id;
    const created = await request({
      type: "create_agent_request",
      requestId: "c1",
      workspaceId,
      config: { provider: "mock", cwd: repoPath, model: "ten-second-stream", modeId: "load-test" },
    });
    const agentId = created?.agentId;
    out.push(`agent=${agentId} workspace=${workspaceId}`);

    const prompt = "Keep this completed turn after rewind.";
    await request({
      type: "send_agent_message_request",
      requestId: "s1",
      agentId,
      text: prompt,
      activeTurnBehavior: "interrupt",
    });
    const wait = await request({
      type: "wait_for_finish_request",
      requestId: "f1",
      agentId,
      timeoutMs: 30_000,
    });
    out.push(`wait_for_finish: status=${wait?.status}`);

    // Two more turns, the stress shape the pagination and outline specs seed with.
    for (const index of [1, 2]) {
      await request({
        type: "send_agent_message_request",
        requestId: `s${index + 1}`,
        agentId,
        text: `timeline-pagination-turn-${index}: emit 1 coalesced agent stream updates`,
        activeTurnBehavior: "interrupt",
      });
      await request({
        type: "wait_for_finish_request",
        requestId: `f${index + 1}`,
        agentId,
        timeoutMs: 30_000,
      });
    }

    // What the chat outline rail renders from. It returns null below two prompts, which is the
    // failure shape the outline specs report.
    const prompts = await request({
      type: "agent.timeline.list_prompts.request",
      requestId: "lp1",
      agentId,
    });
    out.push(
      `list_prompts: error=${JSON.stringify(prompts?.error)} count=${prompts?.prompts?.length}`,
    );
    for (const p of (prompts?.prompts ?? []).slice(0, 5))
      out.push(`  PROMPT ${JSON.stringify(p).slice(0, 160)}`);

    const tail = await request({
      type: "fetch_agent_timeline_request",
      requestId: "t0",
      agentId,
      direction: "tail",
      projection: "projected",
      limit: 0,
    });
    const types = (tail?.entries ?? []).map((e) => e?.item?.type);
    out.push(
      `tail(all): entries=${types.length} typeCounts=${JSON.stringify(types.reduce((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {}))}`,
    );
    const users = (tail?.entries ?? []).filter((e) => e?.item?.type === "user_message");
    out.push(`user_message rows: ${users.length}`);

    // The chat outline rail accepts the prompt index only when its epoch equals the epoch the
    // client already holds from fetch_agent_timeline. Two different values here mean the client
    // drops the index as stale and the rail never renders.
    out.push(
      `EPOCH fetch_agent_timeline=${JSON.stringify(tail?.epoch)} list_prompts=${JSON.stringify(prompts?.epoch)} MATCH=${tail?.epoch === prompts?.epoch}`,
    );
    for (const u of users)
      out.push(
        `  USER ${JSON.stringify({ messageId: u.item.messageId ?? null, clientMessageId: u.item.clientMessageId ?? null, text: (u.item.text ?? "").slice(0, 40) })}`,
      );

    // Let the last frames land.
    await new Promise((r) => setTimeout(r, 500));

    out.push(
      `live event type counts: ${JSON.stringify(
        liveEventTypes.reduce((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {}),
      )}`,
    );
    out.push(`live timeline events: ${liveTimeline.length}`);
    const markerEvents = liveTimeline.filter(
      (e) => e.textHead.includes("end of synthetic") || e.textTail.includes("end of synthetic"),
    );
    out.push(`marker-carrying live events: ${markerEvents.length}`);
    for (const m of markerEvents) out.push(`  MARKER ${JSON.stringify(m)}`);
    out.push(`last 3 live timeline events:`);
    for (const e of liveTimeline.slice(-3)) out.push(`  ${JSON.stringify(e)}`);
    out.push(
      `distinct messageIds: ${JSON.stringify([...new Set(liveTimeline.map((e) => e.messageId))])}`,
    );
    out.push(
      `distinct item types: ${JSON.stringify([...new Set(liveTimeline.map((e) => e.type))])}`,
    );

    finish(0, out);
  } catch (error) {
    out.push(`ERROR: ${error instanceof Error ? error.stack : String(error)}`);
    out.push(`daemon log: ${daemonLog.slice(-400)}`);
    finish(1, out);
  }
});

setTimeout(() => finish(1, ["PROBE TIMEOUT", daemonLog.slice(-400)]), 120_000);
