import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The published config schema (web/public/schemas/byspace.config.v1.json) is what an editor
// validates config.json against, via the $schema URL in public-docs. Its generator died with the
// Node daemon, so it is hand-maintained now — and it sets additionalProperties: false, which turns
// a missing key into a rejection of a setting the daemon really reads.
//
// The daemon's own setting paths are the checkable contract: every path it treats as reloadable or
// environment-owned must exist in the schema. That caught daemon.tunnel.allowedTargets, documented
// in public-docs/connectivity.md:87 and read by internal/server/tunnels.go:119, missing from a
// schema that forbade it.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

// The body of a Go composite literal, brace-matched so a nested block cannot end it early.
function literalBody(source, declaration) {
  const start = source.indexOf("{", source.indexOf(declaration));
  assert.ok(start > 0, `${declaration} not found`);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && (depth -= 1) === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${declaration} is not closed`);
}

function schemaPaths(schema) {
  const paths = new Set();
  const walk = (node, prefix) => {
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.add(path);
      walk(child, path);
      // A map of named entries (providers, agentProfiles) declares its shape one level down.
      if (child.additionalProperties?.properties) walk(child.additionalProperties, `${path}.*`);
    }
  };
  walk(schema, "");
  return paths;
}

test("every daemon setting path exists in the published config schema", () => {
  const source = read("internal/server/config_reload.go");
  const reloadable = [...literalBody(source, "var reloadablePaths").matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const environmentOwned = [
    ...literalBody(source, "var environmentOwnedPaths").matchAll(/"([a-zA-Z.]+)":/g),
  ].map((match) => match[1]);
  assert.ok(reloadable.length > 10 && environmentOwned.length > 5, "setting paths parsed");

  const declared = schemaPaths(JSON.parse(read("web/public/schemas/byspace.config.v1.json")));
  const missing = [...new Set([...reloadable, ...environmentOwned])].filter(
    (path) => !declared.has(path),
  );
  assert.deepEqual(
    missing,
    [],
    `settings the schema rejects, add them to web/public/schemas/byspace.config.v1.json: ${missing.join(", ")}`,
  );
});
