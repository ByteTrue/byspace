import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
// Build a tiny loader: transpile each migration module and run the registry.
const files = [
  "runner.ts",
  "001-init.ts",
  "002-042.ts",
  "040-088.ts",
  "084-339.ts",
  "090-509.ts",
  "120-549.ts",
  "rebuild.ts",
  "index.ts",
];
const dir = "src/server/multica/migrations/";
const mods = {};
for (const f of files) {
  const js = ts.transpileModule(readFileSync(dir + f, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url =
    "data:text/javascript;base64," +
    Buffer.from(
      js
        .replace(/\.js"/g, '.mjs"')
        .replace(/from "\.\/([^"]+)"/g, 'from "data:text/javascript;base64,"'),
    ).toString("base64");
  mods[f] = url;
}
// Simpler: use tsx via dynamic import on the compiled paths — but tsx from mjs is awkward.
