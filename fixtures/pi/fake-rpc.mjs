#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";

if (process.env.BYSPACE_E2E_PI_PID) {
  fs.writeFileSync(process.env.BYSPACE_E2E_PI_PID, String(process.pid));
}
if (process.env.BYSPACE_E2E_PI_INVOCATION_LOG) {
  fs.appendFileSync(
    process.env.BYSPACE_E2E_PI_INVOCATION_LOG,
    `${JSON.stringify(process.argv.slice(2))}\n`,
  );
}
const sessionDirIndex = process.argv.indexOf("--session-dir");
const sessionDir = sessionDirIndex >= 0 ? process.argv[sessionDirIndex + 1] : process.cwd();
const sessionFile = path.join(sessionDir, "client-e2e-pi-session.jsonl");
const resumeIndex = process.argv.indexOf("--session");
const launchCountFile = process.env.BYSPACE_E2E_PI_LAUNCH_COUNT;
const launchCount =
  launchCountFile && fs.existsSync(launchCountFile)
    ? Number(fs.readFileSync(launchCountFile, "utf8"))
    : 0;
if (launchCountFile && launchCount > 0 && resumeIndex < 0) {
  process.exit(20);
}
if (resumeIndex >= 0 && path.resolve(process.argv[resumeIndex + 1]) !== path.resolve(sessionFile)) {
  process.exit(21);
}
if (launchCountFile) {
  fs.writeFileSync(launchCountFile, String(launchCount + 1));
}
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(sessionFile, "", { flag: "a", mode: 0o600 });
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let active = false;

lines.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") {
    send({
      id: command.id,
      type: "response",
      command: "get_state",
      success: true,
      data: {
        sessionId: "client-e2e-pi-session",
        sessionFile,
        model: { id: "fake-model", provider: "fake-provider" },
        thinkingLevel: "high",
      },
    });
    return;
  }
  if (command.type === "prompt") {
    active = true;
    send({ type: "agent_start" });
    send({ type: "turn_start" });
    send({ id: command.id, type: "response", command: "prompt", success: true });
    if (command.message !== "hold") {
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "from fake pi" },
      });
      send({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      send({ type: "agent_end", messages: [], willRetry: false });
      send({ type: "agent_settled" });
      active = false;
    }
    return;
  }
  if (command.type === "abort") {
    send({ id: command.id, type: "response", command: "abort", success: true });
    if (active) {
      send({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } });
      send({ type: "agent_end", messages: [], willRetry: false });
      send({ type: "agent_settled" });
      active = false;
    }
    return;
  }
  send({
    id: command.id,
    type: "response",
    command: command.type,
    success: false,
    error: "unsupported",
  });
});
