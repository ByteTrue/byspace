import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Surface parity guards.
//
// The port is a rewrite, not a redesign: every name a client can type (a CLI command, an MCP tool, an
// HTTP route, an environment variable the daemon reads) has to survive it. Four CLI commands silently
// did not, and nothing noticed until one was typed. These extractors turn "did we keep the surface?"
// into an assertion instead of a memory exercise.
//
// Each extractor returns the set of names one side exposes. The guards compare node's set against
// Go's, so a name dropped by the port fails; a name Go adds is fine (it is not a regression).

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "test-results", "playwright-report"]);

function walk(dir, options = {}) {
  const { extensions = [], skipTests = false, out = [] } = options;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, { ...options, out });
      continue;
    }
    if (extensions.length > 0 && !extensions.some((ext) => path.endsWith(ext))) continue;
    if (skipTests && /\.(test|spec|e2e)\./.test(path)) continue;
    out.push(path);
  }
  return out;
}

function readAll(files) {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

// --- MCP tools -------------------------------------------------------------------------------
//
// node registers with `registerTool(\n  "name",`; Go declares each with mcpToolDef("name", ...).

export function nodeMcpTools(root) {
  const source = readAll(
    walk(join(root, "archive/packages/server/src"), { extensions: [".ts"], skipTests: true }),
  );
  return new Set(
    [...source.matchAll(/registerTool\(\s*"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]),
  );
}

export function goMcpTools(root) {
  const source = readAll(
    walk(join(root, "internal/server"), { extensions: [".go"], skipTests: true }),
  );
  return new Set([...source.matchAll(/mcpToolDef\(\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]));
}

// --- HTTP routes -----------------------------------------------------------------------------
//
// Only the daemon's own routes count. The web UI server falls back to index.html for everything,
// so `app.get("/")`-style registrations are matched by their literal path and compared literally.

export function nodeHttpRoutes(root) {
  const source = readAll(
    walk(join(root, "archive/packages/server/src"), { extensions: [".ts"], skipTests: true }),
  );
  const routes = new Set();
  for (const match of source.matchAll(/\.(?:get|post|put|delete|all)\(\s*"(\/[^"]*)"/g)) {
    routes.add(match[1]);
  }
  return routes;
}

export function goHttpRoutes(root) {
  const source = readAll(walk(join(root, "internal"), { extensions: [".go"], skipTests: true }));
  const routes = new Set();
  for (const match of source.matchAll(/"(\/api\/[a-z0-9/_:-]*|\/mcp\/[a-z0-9/_:-]*)"/g)) {
    routes.add(match[1]);
  }
  return routes;
}

// --- Environment variables -------------------------------------------------------------------
//
// Only variables the daemon or CLI actually reads. A literal mentioned in a test fixture or a doc
// string is not an input, and counting it made the first pass report a gap that did not exist.

export function nodeEnvVars(root) {
  const source = readAll([
    ...walk(join(root, "archive/packages/server/src"), { extensions: [".ts"], skipTests: true }),
    ...walk(join(root, "archive/packages/cli/src"), { extensions: [".ts"], skipTests: true }),
  ]);
  const found = new Set();
  for (const match of source.matchAll(/process\.env\.(BYSPACE_[A-Z0-9_]+)/g)) found.add(match[1]);
  for (const match of source.matchAll(/process\.env\[["'](BYSPACE_[A-Z0-9_]+)["']\]/g)) {
    found.add(match[1]);
  }
  return found;
}

export function goEnvVars(root) {
  const source = readAll(walk(join(root, "internal"), { extensions: [".go"], skipTests: true }));
  return new Set([...source.matchAll(/"?(BYSPACE_[A-Z0-9_]+)"?/g)].map((m) => m[1]));
}

// Variables that only exist to drive the node project's own end-to-end runs. The Go suite builds its
// fixtures differently, so there is nothing to port: they pin a real opencode build, which the Go
// tests never spawn.
const NODE_E2E_ONLY_ENV = new Set([
  "BYSPACE_REAL_OMO_VERSION",
  "BYSPACE_REAL_OPENCODE_MODEL",
  "BYSPACE_REAL_OPENCODE_VERSION",
]);

export function envVarGaps(root) {
  const go = goEnvVars(root);
  return [...nodeEnvVars(root)]
    .filter((name) => !go.has(name) && !NODE_E2E_ONLY_ENV.has(name))
    .sort();
}

export function mcpToolGaps(root) {
  const go = goMcpTools(root);
  return [...nodeMcpTools(root)].filter((name) => !go.has(name)).sort();
}

export function httpRouteGaps(root) {
  // The root route is the web UI's fallback page, not a daemon API; Go serves the bundle under the
  // same catch-all, so comparing it literally would report a gap that is not one.
  const go = goHttpRoutes(root);
  return [...nodeHttpRoutes(root)].filter((route) => route !== "/" && !go.has(route)).sort();
}
