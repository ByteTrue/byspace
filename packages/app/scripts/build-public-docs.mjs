/**
 * Renders public-docs/ and CHANGELOG.md into the web export
 * (packages/app/dist/docs/ and dist/changelog.html) so the hosted relay
 * Worker serves them from the same origin as the app (issue 074).
 *
 * Inputs are trusted repo content; link forms in the wild (measured
 * 2026-10-10): "/docs/x" routes, absolute http(s), bare anchors, one
 * "./x.md" same-dir link. Relative-repo links (../) do not occur.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DOCS_SRC = join(REPO_ROOT, "public-docs");
const CHANGELOG_SRC = join(REPO_ROOT, "CHANGELOG.md");
const OUT_ROOT = join(REPO_ROOT, "packages", "app", "dist");
const OUT_DOCS = join(OUT_ROOT, "docs");

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { fm: {}, body: text };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    fm[key] = value;
  }
  return { fm, body: text.slice(match[0].length) };
}

// Rewrite link targets for the hosted site:
//   "/docs/x"        -> "/docs/x"          (already a route; .html file backs it)
//   "./x.md" or "x.md" (same-dir) -> "/docs/<dir>/x" (strip .md, route form)
//   http(s) / anchors -> unchanged
function rewriteLinks(token) {
  if (token.type !== "inline") return;
  for (const child of token.children ?? []) {
    if (child.type !== "link_open") continue;
    const href = child.attrGet("href") ?? "";
    if (/^(https?:|#|mailto:)/.test(href)) continue;
    if (href.startsWith("/docs")) continue;
    // "./events.md#anchor" / "events.md" -> "/docs/<dir>/events#anchor"
    const mdMatch = href.match(/^(?:\.\/)?([^#]*\.md)(#.*)?$/);
    if (mdMatch) {
      const stripped = mdMatch[1].replace(/\.md$/, "").replace(/^\.\//, "");
      child.attrSet(
        "href",
        "/docs/" + (REWRITE_DIR ? REWRITE_DIR + "/" : "") + stripped + (mdMatch[2] ?? ""),
      );
    }
  }
}
let REWRITE_DIR = "";

async function collectPages(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectPages(join(dir, entry.name), acc);
    } else if (entry.name.endsWith(".md")) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CSS = `:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#141615;color:#d9dedb;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:#7cb8c9;text-decoration:none}a:hover{text-decoration:underline}
.layout{display:flex;min-height:100vh}
.sidebar{width:250px;flex-shrink:0;padding:24px 16px;border-right:1px solid #232726;background:#161918;position:sticky;top:0;height:100vh;overflow-y:auto}
.sidebar h3{margin:20px 8px 6px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#7a827f}
.sidebar h3:first-child{margin-top:0}
.sidebar a{display:block;padding:5px 10px;border-radius:6px;color:#c3cbc7;font-size:14px}
.sidebar a.active{background:#232a29;color:#fff}
.main{flex:1;min-width:0;padding:40px 24px 96px;max-width:820px;margin:0 auto}
.content h1{font-size:30px;line-height:1.25;color:#f2f5f3;margin:0 0 8px}
.content h2{font-size:21px;margin:36px 0 10px;color:#e8ecea;border-bottom:1px solid #232726;padding-bottom:6px}
.content h3{font-size:17px;margin:26px 0 8px;color:#e8ecea}
.content p{margin:12px 0}
.content ul,.content ol{padding-left:24px}
.content li{margin:5px 0}
.content code{background:#1f2423;border:1px solid #2a2f2e;border-radius:4px;padding:1px 5px;font-size:.88em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.content pre{background:#101312;border:1px solid #232726;border-radius:8px;padding:14px 16px;overflow-x:auto;line-height:1.5}
.content pre code{background:none;border:none;padding:0;font-size:.85em}
.content blockquote{border-left:3px solid #2f4a45;margin:14px 0;padding:4px 16px;background:#171b1a;border-radius:0 6px 6px 0}
.content table{border-collapse:collapse;margin:14px 0;font-size:.92em}
.content th,.content td{border:1px solid #2a2f2e;padding:7px 11px;text-align:left}
.content th{background:#1c201f}
.content hr{border:none;border-top:1px solid #232726;margin:28px 0}
.topbar{display:none}
@media(max-width:860px){
  .layout{flex-direction:column}
  .sidebar{width:auto;position:static;height:auto;border-right:none;border-bottom:1px solid #232726}
  .main{padding:24px 16px 72px}
}
.meta{color:#8a928e;font-size:14px;margin:0 0 24px}`;

function renderPage({ title, description, navHtml, bodyHtml, siteTitle }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(siteTitle ?? title)}</title>
${description ? `<meta name="description" content="${esc(description)}" />` : ""}
<meta name="theme-color" content="#181B1A" />
<meta name="robots" content="index,follow" />
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">${navHtml}</nav>
<main class="main">
<article class="content">
${bodyHtml}
</article>
</main>
</div>
</body>
</html>
`;
}

async function main() {
  const pages = await collectPages(DOCS_SRC);
  if (pages.length === 0) throw new Error("no markdown found in public-docs/");

  const parsed = [];
  for (const abs of pages) {
    const text = await readFile(abs, "utf8");
    const { fm, body } = parseFrontmatter(text);
    const relToDocs = relative(DOCS_SRC, abs).replace(/\\/g, "/");
    const route = relToDocs.replace(/\.md$/, "");
    parsed.push({ abs, relToDocs, route, fm, body });
  }

  // Navigation: group by category, sort by order then nav label.
  const groups = new Map();
  for (const page of parsed) {
    const category = page.fm.category ?? "Docs";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(page);
  }
  const sortedGroups = [...groups.entries()]
    .map(([name, list]) => ({
      name,
      list: list.sort(
        (a, b) =>
          Number(a.fm.order ?? 999) - Number(b.fm.order ?? 999) ||
          String(a.fm.nav ?? "").localeCompare(String(b.fm.nav ?? "")),
      ),
    }))
    .sort((a, b) => {
      const min = (g) => Math.min(...g.list.map((p) => Number(p.fm.order ?? 999)));
      return min(a) - min(b);
    });

  const navHtml = sortedGroups
    .map(
      (group) =>
        `<h3>${esc(group.name)}</h3>` +
        group.list
          .map((p) => {
            // Directory index routes collapse to the directory with a trailing
            // slash ("sdk/index" -> "/docs/sdk/", top "index" -> "/docs/") so
            // Workers assets serves them directly instead of a 307 hop.
            const href =
              p.route === "index" ? "/docs/" : "/docs/" + p.route.replace(/\/index$/, "/");
            return `<a href="${esc(href)}">${esc(p.fm.nav ?? p.fm.title ?? p.route)}</a>`;
          })
          .join(""),
    )
    .join("");

  let written = 0;
  for (const page of parsed) {
    REWRITE_DIR = page.route.includes("/") ? page.route.split("/")[0] : "";
    // markdown-it token streams are flat; every inline token sits at the top
    // level, so one pass rewrites all link targets.
    const tokens = md.parse(page.body, {});
    for (const token of tokens) rewriteLinks(token);
    const bodyHtml = md.renderer.render(tokens, md.options, {});
    const outDir = join(OUT_DOCS, dirname(page.relToDocs));
    await mkdir(outDir, { recursive: true });
    const outFile = join(OUT_DOCS, page.route + ".html");
    // Canonical nav href for this page, matching the rewrite above.
    const activeHref =
      page.route === "index" ? "/docs/" : "/docs/" + page.route.replace(/\/index$/, "/");
    const navWithActive = navHtml.replace(
      'href="' + esc(activeHref) + '"',
      'class="active" href="' + esc(activeHref) + '"',
    );
    const html = renderPage({
      title: page.fm.title,
      description: page.fm.description,
      navHtml: navWithActive,
      activeHref,
      bodyHtml,
      siteTitle: (page.fm.title ?? page.route) + " · BySpace Docs",
    });
    await writeFile(outFile, html);
    written++;
  }

  // Changelog: same chrome, no sidebar categories (single page).
  const changelogText = await readFile(CHANGELOG_SRC, "utf8");
  REWRITE_DIR = "";
  const clTokens = md.parse(changelogText, {});
  for (const token of clTokens) rewriteLinks(token);
  const clBody = md.renderer.render(clTokens, md.options, {});
  const clNav = navHtml + '<h3>Reference</h3><a href="/changelog">Changelog</a>';
  const clHtml = renderPage({
    title: "Changelog",
    description: "BySpace release history.",
    navHtml: clNav,
    bodyHtml: clBody,
    siteTitle: "Changelog · BySpace Docs",
  });
  await writeFile(join(OUT_ROOT, "changelog.html"), clHtml);

  console.log(`[docs] rendered ${written} pages -> packages/app/dist/docs + changangelog.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
