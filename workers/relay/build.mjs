#!/usr/bin/env node
// Builds the Cloudflare Workers bundle for the Go relay.
//
// Two steps, because Cloudflare needs a JavaScript entry point and Go produces
// a .wasm: `workers-assets-gen` writes the JS shim that boots the wasm and
// declares the Durable Object class, then the Go compiler emits the wasm it
// loads. Both live under ./build, which wrangler.jsonc points at.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const buildDir = path.join(here, "build");
const wasmFile = path.join(buildDir, "app.wasm");

// The class name must match roomClass in main.go and the class_name in
// wrangler.jsonc; workers-assets-gen bakes it into the generated JS.
const DURABLE_OBJECT_CLASS = "RelayRoom";

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? here,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
}

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

// workers-assets-gen needs to resolve the module from this directory, and the
// module is rooted at the repository, so the Go toolchain has to be told where
// go.mod lives.
run(
  "go",
  [
    "run",
    "github.com/syumai/workers-go/cmd/workers-assets-gen",
    "-mode=go",
    `-durable-objects=${DURABLE_OBJECT_CLASS}`,
  ],
  {
    cwd: here,
    env: { GO111MODULE: "on", GOFLAGS: "-mod=mod" },
  },
);

run("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", wasmFile, "./workers/relay/"], {
  cwd: root,
  env: { GOOS: "js", GOARCH: "wasm" },
});

if (!existsSync(wasmFile)) {
  console.error(`build: expected ${wasmFile} to exist after the Go build`);
  process.exit(1);
}

console.log(`build: wrote ${path.relative(root, buildDir)}/ (${DURABLE_OBJECT_CLASS} + app.wasm)`);
