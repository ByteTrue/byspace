import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.ok(bound.length > 0, "wrangler.jsonc should bind a Durable Object");
  for (const name of bound) {
    assert.equal(name, declared, "wrangler.jsonc binds a class main.go does not register");
  }
  for (const name of migrated) {
    assert.equal(name, declared, "wrangler.jsonc migrates a class main.go does not register");
  }
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

test("the Worker serves the web export on the same paths as the hosted one", () => {
  // The Worker is a drop-in for the TypeScript one, which serves the PWA from
  // [assets] and keeps /ws and /health on the relay script. An environment
  // without the assets block silently serves 404 for the app itself.
  const source = read("wrangler.jsonc");
  assert.equal(
    [...source.matchAll(/"directory"\s*:\s*"([^"]+)"/g)].length,
    2,
    "both the default and beta environments need an assets directory",
  );
  assert.equal(
    [...source.matchAll(/"run_worker_first"\s*:\s*\[[^\]]*"\/ws"[^\]]*"\/health"[^\]]*\]/g)].length,
    2,
    "/ws and /health must stay on the relay script in both environments",
  );
});

test("every environment binds the Durable Object it registers", () => {
  // Wrangler does not inherit top-level bindings or migrations into a named
  // environment. A beta block without its own durable_objects deploys fine and
  // then answers 500 on every socket, which is exactly the kind of failure
  // nobody finds until they try the beta build.
  const source = read("wrangler.jsonc");
  const declared = goClass();
  const bindings = [...source.matchAll(/"class_name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bindings, [declared, declared], "default and beta each need one RELAY binding");
  const migrations = [...source.matchAll(/"new_sqlite_classes"\s*:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((inner) => inner[1]),
  );
  assert.deepEqual(migrations, [declared, declared], "default and beta each need the migration");
});

test("the deploy workflow publishes both channels to the Go Worker", () => {
  // A Cloudflare custom domain routes to exactly one Worker, so the workflow has to deploy the one
  // each hostname points at. This used to assert a split — beta to workers/relay, stable to
  // packages/relay — because the Go relay was unproven and the TypeScript worker kept production.
  // The split is gone: one implementation serves every hostname, so a branch in the workflow would
  // silently reintroduce a second relay with a second Durable Object namespace.
  const workflow = readFileSync(path.join(root, ".github/workflows/deploy-app.yml"), "utf8");
  assert.match(
    workflow,
    /working-directory:\s*workers\/relay/,
    "every channel deploys workers/relay",
  );
  // Comments name the retired worker to explain the history, so strip them before asserting that
  // nothing *deploys* it — otherwise the explanation itself fails the check.
  const steps = workflow
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(
    steps,
    /packages\/relay/,
    "nothing deploys packages/relay any more; its Worker adapter is retired",
  );
  assert.match(workflow, /GO_VERSION/, "the Worker is wasm, so the job needs a Go toolchain");

  // The stable hostname has to be declared by the Go Worker, or a deploy would leave it pointing at
  // the retired TypeScript Worker and production would go dark. `relay.byspace.cc.cd` is
  // deliberately absent: one origin per channel carries both the PWA and its relay.
  const routes = new Set(
    [...read("wrangler.jsonc").matchAll(/"pattern"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  );
  for (const hostname of ["app.byspace.cc.cd", "app-beta.byspace.cc.cd"]) {
    assert.ok(routes.has(hostname), `wrangler.jsonc should declare ${hostname}`);
  }
});

// The TypeScript Worker adapter must stay gone.
//
// Retiring it is what makes the split unrepeatable: with no adapter there is nothing for a future
// workflow branch or a manual `wrangler deploy` to publish back onto a production hostname.
test("the TypeScript Worker adapter is retired", () => {
  for (const retired of [
    "packages/relay/wrangler.toml",
    "packages/relay/src/cloudflare-adapter.ts",
    "packages/relay/src/cutover-proxy.ts",
  ]) {
    assert.ok(
      !existsSync(path.join(root, retired)),
      `${retired} is back; the Go Worker is the only relay`,
    );
  }
  // The package itself stays: packages/client imports its E2EE primitives.
  assert.ok(existsSync(path.join(root, "packages/relay/src/e2ee.ts")), "e2ee primitives stay");
});

// The relay Durable Object must accept sockets with the hibernation API.
//
// A socket taken with websocket.Upgrade keeps the object (and its billed
// duration) awake for the connection's whole lifetime. Measured on this account
// that cost 16.2s per connection against the hibernating TypeScript worker's
// 4.1ms: 2860 requests burned 46.3k GB-s, more than the free plan's monthly
// allowance, and every WebSocket handshake started failing with
// "Exceeded allowed duration in Durable Objects free tier."
test("the relay worker accepts sockets hibernating", () => {
  const source = readFileSync(new URL("../workers/relay/main.go", import.meta.url), "utf8");
  assert.match(
    source,
    /UpgradeHibernating\(/,
    "the relay must use websocket.UpgradeHibernating: websocket.Upgrade keeps the Durable Object awake and bills its whole lifetime",
  );
  assert.match(
    source,
    /AcceptHibernatingConn\(/,
    "an upgraded socket must be registered with the hibernation API, or the object is never evicted",
  );
  assert.doesNotMatch(
    source,
    /\bcfws\.Upgrade\(|\bwebsocket\.Upgrade\(/,
    "the non-hibernating Upgrade must not come back",
  );
});

// Message handling must be a Durable Object trigger, not a goroutine.
//
// With hibernation the object is evicted between messages, so a read loop on a
// goroutine would be reading a socket that no longer exists in this instance.
test("the relay worker routes messages from the trigger", () => {
  const source = readFileSync(new URL("../workers/relay/main.go", import.meta.url), "utf8");
  assert.match(
    source,
    /func \(r \*room\) WebSocketMessage\(/,
    "the room must implement WebSocketMessageHandler",
  );
  assert.match(
    source,
    /func \(r \*room\) WebSocketClose\(/,
    "the room must implement WebSocketCloseHandler, or departures never notify the control channel",
  );
  assert.doesNotMatch(
    source,
    /go r\.serve\(/,
    "a per-connection goroutine read loop cannot survive hibernation",
  );
});
