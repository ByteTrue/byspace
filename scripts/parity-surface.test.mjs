import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  envVarGaps,
  goEnvVars,
  goHttpRoutes,
  goMcpTools,
  httpRouteGaps,
  mcpToolGaps,
  nodeEnvVars,
  nodeHttpRoutes,
  nodeMcpTools,
} from "./parity-surface.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every name a client can type has to survive the rewrite. These four surfaces each lost something
// in the port and nothing caught it, so "did we keep it?" is an assertion now.

test("keeps every MCP tool the node daemon registered", () => {
  assert.deepEqual(mcpToolGaps(root), [], "MCP tools disappeared in the port");
});

test("keeps every HTTP route the node daemon served", () => {
  assert.deepEqual(httpRouteGaps(root), [], "HTTP routes disappeared in the port");
});

test("reads every environment variable the node daemon read", () => {
  assert.deepEqual(envVarGaps(root), [], "environment inputs disappeared in the port");
});

// The extractors themselves need guarding: a regex that quietly matches nothing makes every test
// above pass on an empty surface, which is exactly how the first CLI audit reported "all clear".
test("the extractors actually find a surface", () => {
  assert.ok(
    nodeMcpTools(root).size >= 30,
    `node MCP surface looks empty: ${nodeMcpTools(root).size}`,
  );
  assert.ok(goMcpTools(root).size >= 30, `go MCP surface looks empty: ${goMcpTools(root).size}`);
  assert.ok(
    nodeHttpRoutes(root).size >= 3,
    `node route surface looks empty: ${nodeHttpRoutes(root).size}`,
  );
  assert.ok(
    goHttpRoutes(root).size >= 3,
    `go route surface looks empty: ${goHttpRoutes(root).size}`,
  );
  assert.ok(
    nodeEnvVars(root).size >= 10,
    `node env surface looks empty: ${nodeEnvVars(root).size}`,
  );
  assert.ok(goEnvVars(root).size >= 10, `go env surface looks empty: ${goEnvVars(root).size}`);
});
