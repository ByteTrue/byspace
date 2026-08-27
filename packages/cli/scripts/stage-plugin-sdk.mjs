import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDist = path.resolve(cliDirectory, "../plugin/dist");
const targetDist = path.join(cliDirectory, "dist/plugin-sdk");

rmSync(targetDist, { recursive: true, force: true });
mkdirSync(targetDist, { recursive: true });
cpSync(pluginDist, targetDist, { recursive: true });

for (const [entry, target] of [
  ["plugin", "index"],
  ["plugin-server", "server"],
  ["plugin-host", "host"],
]) {
  writeFileSync(
    path.join(cliDirectory, `dist/${entry}.js`),
    `export * from "./plugin-sdk/${target}.js";\n`,
  );
  writeFileSync(
    path.join(cliDirectory, `dist/${entry}.d.ts`),
    `export * from "./plugin-sdk/${target}.js";\n`,
  );
}
