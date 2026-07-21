import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const [mode, token] = process.argv.slice(2);
if (!new Set(["idle", "load", "tui"]).has(mode) || !/^[A-Za-z0-9_-]+$/.test(token ?? "")) {
  throw new Error("usage: terminal-direct-workload.mjs <idle|load|tui> <token>");
}

const marker = (value) => process.stdout.write(`\u001b]777;${value}\u0007`);
let inputIndex = 0;

function renderTuiFrame(byte) {
  const width = Math.max(40, process.stdout.columns ?? 80);
  const height = Math.max(10, process.stdout.rows ?? 24);
  const selected = String.fromCharCode(byte);
  let frame = "\u001b[?2026h\u001b[H";
  for (let row = 0; row < height; row += 1) {
    const label = ` ${String(row + 1).padStart(3, "0")}  ${selected}  `;
    frame += `\u001b[38;5;${row % 2 === 0 ? 75 : 110}m${(label + "terminal redraw ".repeat(width)).slice(0, width)}\u001b[0m`;
    if (row + 1 < height) frame += "\r\n";
  }
  frame += `\u001b]777;${token}:ECHO:${++inputIndex}:${byte}\u0007\u001b[?2026l`;
  process.stdout.write(frame);
}

function exit() {
  if (mode === "tui") process.stdout.write("\u001b[?2026l\u001b[?25h\u001b[?1049l");
  process.exit(0);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (data) => {
  for (const byte of data) {
    if (byte === 3) exit();
    if (mode === "tui") {
      renderTuiFrame(byte);
    } else {
      process.stdout.write(String.fromCharCode(byte));
      marker(`${token}:ECHO:${++inputIndex}:${byte}`);
    }
  }
});

process.stdout.write("workload ready\r\n");
marker(`${token}:READY`);
if (mode === "tui") process.stdout.write("\u001b[?1049h\u001b[?25l");

if (mode === "load") {
  const deadline = Date.now() + 4_000;
  let line = 0;
  while (Date.now() < deadline) {
    let chunk = "";
    while (chunk.length < 16 * 1024) {
      chunk += `LOAD_${String(++line).padStart(7, "0")}_${"x".repeat(48)}\r\n`;
    }
    if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
    await delay(5);
  }
  marker(`${token}:LOAD_DONE`);
}
