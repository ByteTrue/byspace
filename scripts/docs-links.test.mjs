import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative as relativePath, resolve } from "node:path";
import test from "node:test";

// Documentation links rot silently: deleting a doc, retiring a feature page, or
// renaming a file leaves in-repo links pointing nowhere, and nothing fails until
// a reader clicks. This guard makes the rot loud at CI time.
//
// Two link shapes are checked, because the docs use both:
//   - relative paths  `](../docs/thing.md)`   resolved against the linking file
//   - docs routes     `](/docs/thing)`        resolved against public-docs/<thing>.md
//
// Skipped on purpose: http(s) URLs, mailto, bare anchors, and byissue/ history.
// byissue entries are frozen records of what was true when they were written;
// rewriting their links would falsify the record.

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

const SCANNED = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.md",
  "README.ja.md",
  "README.ko.md",
  "README.zh-CN.md",
  "docs",
  "public-docs",
  ".github",
  ".agents/skills",
  "skills",
];

const EXTERNAL = /^(https?:|mailto:|tel:|#|data:)/;
// Docs routes that are served by an external site rather than a public-docs file.
const EXTERNAL_ROUTES = new Set(["/changelog", "/download", "/docs", "/docs/"]);

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
  const appSource = join(repoRoot, "packages", "app", "src");
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
