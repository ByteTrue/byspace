import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// web/src has three kinds of directory, and the kind is a dependency rule:
//
//   ui/        vendored shadcn originals. `npx shadcn add` overwrites them, so an app dependency
//              here is silently reverted the next time a component is added.
//   platform/  web stand-ins for the RN/Expo APIs the app was ported from. A stand-in that knows
//              about a feature is no longer a stand-in.
//   <feature>/ everything else, free to import each other.
//
// Both restricted kinds may use npm packages, themselves, and each other (a media query or a
// clipboard call is a primitive, not a feature). Neither may reach a feature directory.
//
// oxlint's no-restricted-imports cannot express this: it supports positive glob patterns only, so
// the rule would have to enumerate every feature directory and would silently pass a new one.
// Enumerating the two restricted roots instead means a new feature directory is covered on arrival.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = "web/src";
const RESTRICTED = ["ui", "platform"];

// Module specifiers only. A bare "@/..." inside a string literal is data — the app suggests home
// paths like "~/dev" and parses file links, and those must not be read as imports.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*|\bimport\(\s*|\bvi\.mock\(\s*|\brequire\(\s*)["'](@\/[^"']+)["']/g;

// The working tree, not `git ls-files`: a violation in a file that is not committed yet must fail
// here too, otherwise the guard only catches it after the commit that introduced it.
function trackedSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir))) {
      const relative = `${dir}/${entry}`;
      if (statSync(join(repoRoot, relative)).isDirectory()) walk(relative);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(relative);
    }
  };
  walk(srcRoot);
  return out;
}

test("ui/ and platform/ do not depend on feature directories", () => {
  const violations = [];
  for (const file of trackedSources()) {
    const relative = file.slice(`${srcRoot}/`.length);
    const role = RESTRICTED.find((name) => relative.startsWith(`${name}/`));
    if (!role) continue;
    const source = readFileSync(join(repoRoot, file), "utf8");
    for (const [, spec] of source.matchAll(SPECIFIER)) {
      const target = spec.slice("@/".length);
      const allowed = RESTRICTED.some((name) => target === name || target.startsWith(`${name}/`));
      if (!allowed) violations.push(`${file} -> ${spec}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `ui/ and platform/ may only import npm packages, ui/ and platform/:\n${violations.join("\n")}`,
  );
});

test("the app resolves through one alias", () => {
  // `~/` was the second root of the pre-merge layout. Two aliases meant an import said which tree
  // a module came from, which stopped being true once the trees were merged.
  const stragglers = trackedSources().filter((file) =>
    /(?:\bfrom\s*|\bimport\s*|\bimport\(\s*|\bvi\.mock\(\s*)["']~\//.test(
      readFileSync(join(repoRoot, file), "utf8"),
    ),
  );
  assert.deepEqual(
    stragglers,
    [],
    `these files still import through ~/: \n${stragglers.join("\n")}`,
  );

  const vite = readFileSync(join(repoRoot, "web/vite.config.ts"), "utf8");
  const tsconfig = readFileSync(join(repoRoot, "web/tsconfig.json"), "utf8");
  assert.match(vite, /find: \/\^@\\\//, "vite should alias @/");
  assert.doesNotMatch(vite, /\^~\\\//, "vite should not alias ~/");
  assert.ok(tsconfig.includes('"@/*": ["./src/*"]'), "tsconfig @/* should point at src");
  assert.doesNotMatch(tsconfig, /"~\/\*"/, "tsconfig should not declare ~/*");
});

test("shadcn CLI installs into the vendored root", () => {
  // components.json is where `npx shadcn add` writes. If it points anywhere else, the next added
  // component lands outside ui/ and the vendored rule stops covering it.
  const config = JSON.parse(readFileSync(join(repoRoot, "web/components.json"), "utf8"));
  assert.equal(config.aliases.ui, "@/ui");
  assert.equal(config.aliases.utils, "@/lib/utils");
  for (const [name, target] of Object.entries(config.aliases)) {
    assert.ok(target.startsWith("@/"), `components.json alias ${name} should use @/: ${target}`);
  }
});
