import { createHash } from "node:crypto";
import { argv, stdin, stdout } from "node:process";

function option(name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}

const count = Number(option("--count", "1000"));
const intervalMs = Number(option("--interval-ms", "1"));
const mode = option("--mode", "stream");
const tokenPrefix = option("--token", "terminal-workload-token");
const payload = option("--payload", "x");
const digest = createHash("sha256");
let nextSequence = 0;
let timer = null;
let started = false;
let finished = false;

function finishOutput() {
  if (finished) return;
  finished = true;
  stdout.write(`WORKLOAD_DONE:${count}:${digest.digest("hex")}\n`);
}

function nextOutputLine() {
  const line = `OUT:${nextSequence}:${payload}\n`;
  digest.update(line);
  nextSequence += 1;
  return line;
}

function emitTimed() {
  if (nextSequence >= count) {
    finishOutput();
    return;
  }
  stdout.write(nextOutputLine());
  timer = setTimeout(emitTimed, intervalMs);
}

function emitBurst() {
  while (nextSequence < count) {
    if (!stdout.write(nextOutputLine())) {
      stdout.once("drain", emitBurst);
      return;
    }
  }
  finishOutput();
}

function handleLine(line) {
  if (line === "GO") {
    if (!started) {
      started = true;
      if (mode === "burst") emitBurst();
      else emitTimed();
    }
    return;
  }
  const tokenPrefixWithSeparator = `${tokenPrefix}:`;
  if (!line.startsWith(tokenPrefixWithSeparator)) return;
  const fields = line.slice(tokenPrefixWithSeparator.length).split(":");
  if (fields.length !== 2 || !/^[0-9]+$/u.test(fields[0]) || !/^[A-Za-z0-9_-]+$/u.test(fields[1])) {
    return;
  }
  stdout.write(`ECHO:${fields[0]}:${fields[1]}\n`);
}

stdin.setEncoding("utf8");
stdin.setRawMode?.(true);
stdout.write("WORKLOAD_READY\n");
let pending = "";
stdin.on("data", (chunk) => {
  if (mode === "echo") {
    stdout.write(chunk);
    return;
  }
  pending += chunk;
  const lines = pending.split(/\r\n|[\r\n]/u);
  pending = lines.pop() ?? "";
  for (const line of lines) handleLine(line);
});

stdin.on("end", () => {
  if (timer) clearTimeout(timer);
});
