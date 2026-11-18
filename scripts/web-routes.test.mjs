import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The web router promises one entry per Expo route file, at the same path, so links, bookmarks and
// pairing URLs minted by the old app keep working (web/src/app/router.tsx). That promise was prose
// only: three host-scoped redirects were never ported and `/h/<id>/settings` silently fell through
// to the catch-all, which no test noticed because nothing compared the two trees.
//
// The Expo app's own route modules are the source of truth, read from the tag rather than a
// hand-kept list — a list would need the same discipline the missing files already proved absent.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE_TAG = "archive/expo-app";
const ARCHIVE_APP = "packages/app/src/app";

// Expo layouts wrap their siblings instead of owning a URL; the web shell expresses them as
// components (HostLayout, Root), not routes.
const LAYOUT = /(^|\/)_layout\.tsx$/;

function archivedRoutes() {
  const listing = execFileSync("git", ["ls-tree", "-r", "--name-only", ARCHIVE_TAG, ARCHIVE_APP], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return listing
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !LAYOUT.test(f))
    .map((f) => f.slice(ARCHIVE_APP.length + 1).replace(/\.tsx$/, ""))
    .map((f) => (f === "index" ? "" : f.replace(/\/index$/, "")))
    .map((f) => f.replace(/\[([^\]]+)\]/g, ":$1"));
}

/** Route paths the data router and the workspace layer declare, as absolute paths. */
function declaredPaths() {
  const sources = ["web/src/app/router.tsx", "web/src/app/workspace-layer.tsx"].map((f) =>
    readFileSync(join(repoRoot, f), "utf8"),
  );
  const paths = new Set();
  // `path: "..."` plus the enclosing `h/:serverId` parent, which nests its children.
  for (const text of sources) {
    const hostBlock = text.match(/path:\s*"h\/:serverId"[\s\S]*?children:\s*\[([\s\S]*?)\n\s*\],/);
    const nested = hostBlock
      ? [...hostBlock[1].matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1])
      : [];
    for (const m of text.matchAll(/path:\s*"([^"]+)"/g)) {
      const p = m[1];
      if (p === "*" || p === "h/:serverId") continue;
      paths.add(`/${p}`);
    }
    for (const p of nested) paths.add(`/h/:serverId/${p}`);
    // The workspace layer declares its route once and both files reuse the constant.
    if (/WORKSPACE_ROUTE/.test(text)) paths.add("/h/:serverId/workspace/:workspaceId");
    if (/\{\s*index:\s*true/.test(text)) paths.add("/");
    if (/path:\s*"h\/:serverId"[\s\S]*?\{\s*index:\s*true/.test(text)) paths.add("/h/:serverId");
  }
  return paths;
}

test("every Expo route file has a web route at the same path", () => {
  const declared = declaredPaths();
  const missing = archivedRoutes().filter((route) => !declared.has(`/${route}`));

  assert.deepEqual(
    missing,
    [],
    `Expo routes with no web route (links and bookmarks to these fall through to the catch-all):\n${missing
      .map((r) => `  /${r}`)
      .join("\n")}`,
  );
});
