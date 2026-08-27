import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const [resourcesArgument, binName] = process.argv.slice(2);
if (!resourcesArgument || !binName || process.argv.length !== 4) {
  throw new Error(
    "Usage: node scripts/verify-desktop-package.mjs <resources-directory> <bin-name>",
  );
}

const resources = path.resolve(resourcesArgument);
const asar = path.join(resources, "app.asar");
const requiredResources = [
  path.join(resources, "app-update.yml"),
  path.join(resources, "bin", binName),
  path.join(resources, "app.asar.unpacked", "node_modules", "node-pty"),
  path.join(resources, "app.asar.unpacked", "node_modules", "@esbuild"),
];

for (const requiredPath of [asar, ...requiredResources]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing packaged Desktop resource: ${requiredPath}`);
  }
}

const packageJson = JSON.parse(extractFile(asar, "package.json").toString("utf8"));
if (packageJson.name !== "@bytetrue/byspace-desktop") {
  throw new Error(`Unexpected packaged Desktop package name: ${String(packageJson.name)}`);
}

const entries = new Set(listPackage(asar).map((entry) => entry.replaceAll("\\", "/")));
for (const entry of [
  "/dist/main.js",
  "/dist/preload.js",
  "/dist/daemon/node-entrypoint-runner.js",
  "/node_modules/@bytetrue/byspace/bin/byspace",
  "/node_modules/@bytetrue/byspace-server/dist/scripts/supervisor-entrypoint.js",
  "/node_modules/@bytetrue/byspace-server/dist/server/server/daemon-worker.js",
  "/node_modules/esbuild/lib/main.js",
]) {
  if (!entries.has(entry)) {
    throw new Error(`Missing packaged Desktop ASAR entry: ${entry}`);
  }
}

const updateConfig = readFileSync(path.join(resources, "app-update.yml"), "utf8");
if (!updateConfig.includes("provider: github") || !updateConfig.includes("repo: byspace")) {
  throw new Error("Packaged Desktop updater configuration is invalid");
}

console.log(`Verified packaged Desktop resources: ${resources}`);
