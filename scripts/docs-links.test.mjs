import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative as relativePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Documentation links rot silently: deleting a doc, retiring a feature page, or
// renaming a file leaves in-repo links pointing nowhere, and nothing fails until
// a reader clicks. This guard makes the rot loud at CI time.
//
// Two link shapes are checked, because the docs use both:
//   - relative paths  `](../docs/thing.md)`   resolved against the linking file
//   - docs routes     `](/docs/thing)`        resolved against public-docs/<thing>.md
//
// Skipped on purpose: http(s) URLs, mailto, bare anchors, and bywork/ history.
// byissue entries are frozen records of what was true when they were written;
// rewriting their links would falsify the record.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCANNED = [
  "AGENTS.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.md",
  "README.zh-CN.md",
  "docs",
  "public-docs",
  ".github",
  ".agents/skills",
  "skills",
];

const EXTERNAL = /^(https?:|mailto:|tel:|#|data:)/;
// Routes rendered by scripts/build-public-docs.mjs (served from the
// relay Worker assets) that have no 1:1 public-docs source file.
// /download stays out: no directly downloadable artifacts exist (issue 074).
const EXTERNAL_ROUTES = new Set(["/download"]);

function markdownFiles(root) {
  const absolute = join(repoRoot, root);
  if (!existsSync(absolute)) return [];
  if (absolute.endsWith(".md")) return [absolute];

  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function linksIn(text) {
  const links = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    links.push(match[1]);
  }
  return links;
}

function resolvesAsDocsRoute(target) {
  const route = target.split("#")[0].split("?")[0];
  if (!route.startsWith("/docs/")) return true;
  if (EXTERNAL_ROUTES.has(route)) return true;

  const slug = route.slice("/docs/".length);
  if (slug === "") return true;

  return (
    existsSync(join(repoRoot, "public-docs", `${slug}.md`)) ||
    existsSync(join(repoRoot, "public-docs", slug))
  );
}

function isResolvableLink(file, target) {
  if (EXTERNAL.test(target)) return true;
  if (target.startsWith("/")) return resolvesAsDocsRoute(target);

  const withoutAnchor = target.split("#")[0].split("?")[0];
  if (withoutAnchor === "") return true;

  return existsSync(resolve(dirname(file), withoutAnchor));
}

test("in-repo documentation links resolve", () => {
  const broken = [];

  for (const root of SCANNED) {
    for (const file of markdownFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const target of linksIn(text)) {
        if (!isResolvableLink(file, target)) {
          broken.push(`${relativePath(repoRoot, file)}: ${target}`);
        }
      }
    }
  }

  assert.deepEqual(broken, [], `broken in-repo documentation links:\n${broken.join("\n")}`);
});

// The app deep-links into public-docs on GitHub, so deleting one of those pages
// breaks a button inside the product rather than only a doc cross-reference.
test("every public-docs file the app links to exists", () => {
  const appSource = join(repoRoot, "web", "src");
  if (!existsSync(appSource)) return;

  const referenced = new Set();
  for (const entry of readdirSync(appSource, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;

    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(/public-docs\/[a-z0-9-]+\.md/g)) {
      referenced.add(match[0]);
    }
  }

  assert.ok(referenced.size > 0, "expected the app to link at least one public-docs page");
  for (const path of referenced) {
    assert.ok(
      existsSync(join(repoRoot, path)),
      `${path} is linked from the app but does not exist`,
    );
  }
});

// Prose cites code by path in backticks — `internal/server/server.go:3752` — far more often than it
// links to it. Those citations rot the same way links do, and the link check above never saw them:
// 17 had already gone stale, several pointing at the retired Node daemon. Only repo-anchored paths
// are checked; a relative fragment like `provider/registry.ts` is illustrating a shape, not naming a
// file.
const CODE_PATH =
  /`((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|go|mjs|js|json|md|py|sh|css))(?::\d+(?:-\d+)?)?`/g;

// Names the docs invent to show a pattern rather than point at a file.
const ILLUSTRATIVE = /(^|\/)(acme|thing|your-script)[._-]/;

const repoDirs = new Set(
  readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name),
);

// Build outputs the docs name deliberately (docs/protocol-validation.md says ws-outbound.aot.ts
// "is generated runtime code and is gitignored") are absent from a fresh checkout. Existence on
// disk is the wrong question for those; being ignored is the contract they actually claim.
const ignored = (target) =>
  spawnSync("git", ["check-ignore", "-q", "--", target], { cwd: repoRoot }).status === 0;

test("code paths cited in prose exist", () => {
  const broken = [];

  for (const root of SCANNED) {
    for (const file of markdownFiles(root)) {
      const relative = relativePath(repoRoot, file);
      // archive-parity.md is a guide to reading the tagged Node tree; its paths are tag-relative
      // on purpose and resolve with `git show v0.20.0:<path>`, not on disk.
      const readsArchive = relative === "docs/archive-parity.md";
      const text = readFileSync(file, "utf8");

      for (const match of text.matchAll(CODE_PATH)) {
        const target = match[1];
        if (!repoDirs.has(target.split("/")[0])) continue;
        if (ILLUSTRATIVE.test(target)) continue;
        if (readsArchive && /^packages\/(server|cli)\//.test(target)) continue;
        if (existsSync(join(repoRoot, target))) continue;
        if (ignored(target)) continue;
        broken.push(`${relative}: ${target}`);
      }
    }
  }

  assert.deepEqual(
    broken,
    [],
    `code paths cited in docs that no longer exist:\n${broken.join("\n")}`,
  );
});
