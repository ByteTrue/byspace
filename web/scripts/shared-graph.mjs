#!/usr/bin/env node
// Walks web/'s import graph the way vite.config.ts resolves it (`@/` -> overrides, then
// packages/app/src; `.web` files first) and reports which bare packages it reaches and through
// which chain. Usage: node web/scripts/shared-graph.mjs [package-prefix ...]
// Transitional, like the shared-source mechanism itself; deleted at the cutover.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = path.join(webRoot, "src");
const overridesDir = path.join(webSrc, "overrides");
const appSrc = path.resolve(webRoot, "../packages/app/src");
const EXTENSIONS = [".web.tsx", ".web.ts", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"];
// Same rule as vite.config.ts: a file in src/shims/ stands in for the package it is named after.
const ALIASED = new Set(
  fs.readdirSync(path.join(webSrc, "shims")).map((file) => file.replace(/\.tsx?$/, "")),
);

function resolveFile(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  return null;
}

function resolveSpecifier(importer, spec) {
  if (spec.startsWith("@/")) {
    const rel = spec.slice(2);
    return resolveFile(path.join(overridesDir, rel)) ?? resolveFile(path.join(appSrc, rel));
  }
  if (spec.startsWith("~/")) return resolveFile(path.join(webSrc, spec.slice(2)));
  if (spec.startsWith(".")) return resolveFile(path.resolve(path.dirname(importer), spec));
  return null;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const parents = new Map();
const bare = new Map();
const queue = [path.join(webSrc, "main.tsx")];
parents.set(queue[0], null);
while (queue.length > 0) {
  const file = queue.shift();
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT_RE)) {
    if (match[1]) continue; // `import type` is erased
    const spec = match[2] ?? match[3];
    const resolved = resolveSpecifier(file, spec);
    if (resolved) {
      if (!parents.has(resolved)) {
        parents.set(resolved, file);
        queue.push(resolved);
      }
      continue;
    }
    if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/")) continue;
    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (!bare.has(pkg)) bare.set(pkg, file);
  }
}

const short = (file) => path.relative(path.resolve(webRoot, ".."), file);
function chain(file) {
  const steps = [];
  for (let current = file; current; current = parents.get(current)) steps.push(short(current));
  return steps.toReversed().join("\n    -> ");
}

const filters = process.argv.slice(2);
const appFiles = [...parents.keys()].filter((file) => file.startsWith(appSrc)).length;
console.log(`modules: ${parents.size} (${appFiles} from packages/app/src)`);
for (const [pkg, file] of [...bare.entries()].sort()) {
  if (ALIASED.has(pkg)) continue;
  if (filters.length > 0 && !filters.some((prefix) => pkg.startsWith(prefix))) continue;
  console.log(filters.length > 0 ? `\n${pkg}\n    ${chain(file)}` : pkg);
}
