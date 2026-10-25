import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The Durable Object class name is written in three files that nothing links
// together: main.go registers it, wrangler.jsonc binds it, build.mjs bakes it
// into the generated JS entry point. When they drift, the build still succeeds
// and the deploy still uploads — the Worker just answers 500 on every socket
// because the binding names a class the wasm never registered.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "workers", "relay");

function read(relative) {
  return readFileSync(path.join(workerDir, relative), "utf8");
}

function goClass() {
  const source = read("main.go");
  const match = source.match(/roomClass\s*=\s*"([^"]+)"/);
  assert.ok(match, "main.go should declare roomClass");
  return match[1];
}

function wranglerClasses() {
  // The file is JSONC with trailing commas, and the repo has no JSONC parser on
  // the Node side; the class names are quoted strings under class_name and
  // new_sqlite_classes, which a targeted regex reads without one.
  const source = read("wrangler.jsonc");
  const bound = [...source.matchAll(/"class_name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const migrated = [...source.matchAll(/"new_sqlite_classes"\s*:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((inner) => inner[1]),
  );
  return { bound, migrated };
}

function buildClass() {
  const source = read("build.mjs");
  const match = source.match(/DURABLE_OBJECT_CLASS\s*=\s*"([^"]+)"/);
  assert.ok(match, "build.mjs should declare DURABLE_OBJECT_CLASS");
  return match[1];
}

test("the Durable Object class name agrees across main.go, wrangler.jsonc and build.mjs", () => {
  const declared = goClass();
  const { bound, migrated } = wranglerClasses();
  assert.deepEqual(bound, [declared], "wrangler.jsonc binds a class main.go does not register");
  assert.deepEqual(
    migrated,
    [declared],
    "wrangler.jsonc migrates a class main.go does not register",
  );
  assert.equal(buildClass(), declared, "build.mjs bakes in a different class name");
});

test("the Worker entry point declares exactly one Durable Object class", () => {
  const source = read("main.go");
  const registrations = [...source.matchAll(/durableobjects\.Register\(/g)];
  assert.equal(registrations.length, 1, "expected a single durableobjects.Register call");
});

test("the Worker build targets the wasm and the JS shim wrangler.jsonc points at", () => {
  const wrangler = read("wrangler.jsonc");
  assert.match(
    wrangler,
    /"main"\s*:\s*"\.\/build\/worker\.mjs"/,
    "wrangler.jsonc should load the generated shim",
  );
  assert.match(
    wrangler,
    /"command"\s*:\s*"npm run build"/,
    "wrangler.jsonc should rebuild before deploying",
  );
  assert.match(
    read("build.mjs"),
    /app\.wasm/,
    "build.mjs should emit app.wasm where the shim loads it",
  );
});

test("the wasm build keeps the socket library out of its dependency graph", () => {
  // The shared core exists so the wasm never links coder/websocket; a direct
  // import in the Worker would pull it in and blow the size budget.
  const source = read("main.go");
  assert.doesNotMatch(source, /coder\/websocket/, "main.go must not import the socket library");
  assert.match(source, /internal\/relay"/, "main.go should use the shared relay core");
});
