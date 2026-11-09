import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadSnapshot() {
  return JSON.parse(
    readFileSync(join(defaultRoot, "scripts", "node-surface-snapshot.json"), "utf8"),
  );
}

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
  const archiveServer = join(root, "archive/packages/server/src");
  if (!existsSync(archiveServer)) {
    return new Set(loadSnapshot().mcpTools);
  }
  const source = readAll(walk(archiveServer, { extensions: [".ts"], skipTests: true }));
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
  const archiveServer = join(root, "archive/packages/server/src");
  if (!existsSync(archiveServer)) {
    return new Set(loadSnapshot().httpRoutes);
  }
  const source = readAll(walk(archiveServer, { extensions: [".ts"], skipTests: true }));
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
  const archiveServer = join(root, "archive/packages/server/src");
  if (!existsSync(archiveServer)) {
    return new Set(loadSnapshot().envVars);
  }
  const source = readAll([
    ...walk(archiveServer, { extensions: [".ts"], skipTests: true }),
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

// Surfaces this repo deliberately retired, with the decision that retired them.
//
// The guard's job is to catch names lost by accident during the port; a deliberate removal has to
// say so here instead of quietly editing the snapshot. Each entry is one name a client could type,
// so the list doubles as the record of what an older client will find missing.
const RETIRED_MCP_TOOLS_DECISION =
  "byissue/issues/2026-11-09-x-retire-mcp-tools-for-skill-cli.md (BySpace tools moved to the bundled skill + CLI)";
const RETIRED_HTTP_ROUTES_DECISION =
  "byissue/issues/2026-11-09-x-retire-mcp-tools-for-skill-cli.md (the pi subagent report endpoint was a stub)";

const RETIRED_MCP_TOOLS = new Set([
  "archive_agent",
  "archive_workspace",
  "cancel_agent",
  "capture_terminal",
  "create_agent",
  "create_heartbeat",
  "create_schedule",
  "create_terminal",
  "create_workspace",
  "delete_heartbeat",
  "delete_schedule",
  "get_agent_activity",
  "get_agent_status",
  "inspect_provider",
  "inspect_schedule",
  "kill_agent",
  "kill_terminal",
  "list_agents",
  "list_models",
  "list_pending_permissions",
  "list_profiles",
  "list_providers",
  "list_schedules",
  "list_terminals",
  "list_workspace_scripts",
  "list_workspaces",
  "pause_schedule",
  "rename_branch",
  "rename_workspace",
  "respond_to_permission",
  "resume_schedule",
  "run_schedule_once",
  "schedule_logs",
  "send_agent_prompt",
  "send_terminal_keys",
  "set_agent_mode",
  "start_workspace_script",
  "stop_workspace_script",
  "update_agent",
  "update_schedule",
]);

const RETIRED_HTTP_ROUTES = new Set(["/api/subagent-report"]);

export function retiredSurfaces() {
  return { mcpTools: RETIRED_MCP_TOOLS_DECISION, httpRoutes: RETIRED_HTTP_ROUTES_DECISION };
}

export function mcpToolGaps(root) {
  const go = goMcpTools(root);
  return [...nodeMcpTools(root)]
    .filter((name) => !go.has(name) && !RETIRED_MCP_TOOLS.has(name))
    .sort();
}

export function httpRouteGaps(root) {
  // The root route is the web UI's fallback page, not a daemon API; Go serves the bundle under the
  // same catch-all, so comparing it literally would report a gap that is not one.
  const go = goHttpRoutes(root);
  return [...nodeHttpRoutes(root)]
    .filter((route) => route !== "/" && !go.has(route) && !RETIRED_HTTP_ROUTES.has(route))
    .sort();
}
