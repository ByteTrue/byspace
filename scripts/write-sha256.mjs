#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.argv.length < 3) {
  console.error("usage: write-sha256.mjs <file> [...file]");
  process.exit(2);
}

for (const file of process.argv.slice(2)) {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  const output = `${file}.sha256`;
  writeFileSync(output, `${digest}  ${path.basename(file)}\n`);
  console.log(output);
}
