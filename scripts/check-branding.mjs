import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const legacyName = ["Pa", "seo"].join("");
const legacyLower = legacyName.toLowerCase();
const legacyUpper = legacyName.toUpperCase();
const legacyEnvPrefix = `${legacyUpper}_`;
const legacyPort = ["67", "67"].join("");
const forbiddenNames = [legacyName, legacyLower, legacyUpper, legacyEnvPrefix];
const legacyPortPattern = new RegExp(`(?<!\\d)${legacyPort}(?!\\d)`);
const ignoredFiles = new Set([
  "CHANGELOG.md",
  "LICENSE",
  ".byspace/upstream-sync.json",
  ".agents/skills/upstream-sync/SKILL.md",
]);
const attribution = `BySpace is forked from [${legacyName}](https://github.com/get${legacyLower}/${legacyLower}).`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function gitFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.toString("utf8").trim());
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => {
      const fullPath = resolve(root, path);
      return existsSync(fullPath) && statSync(fullPath).isFile();
    });
}

for (const path of gitFiles()) {
  const pathAllowed = ignoredFiles.has(path) || path.startsWith(".cs/");
  if (!pathAllowed) {
    for (const value of forbiddenNames) {
      if (path.includes(value)) fail(`Legacy identity in active path: ${path}`);
    }
  }

  const buffer = readFileSync(resolve(root, path));
  if (buffer.includes(0) || pathAllowed) continue;
  let text = buffer.toString("utf8");
  if (path === "README.md") text = text.replace(attribution, "");
  for (const value of forbiddenNames) {
    if (text.includes(value)) fail(`Legacy identity '${value}' in active file: ${path}`);
  }
  if (legacyPortPattern.test(text)) fail(`Legacy port in active file: ${path}`);
}

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const cliPackage = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf8"));
if (rootPackage.name !== "byspace") fail(`Root package name is '${rootPackage.name}'`);
if (cliPackage.name !== "@bytetrue/byspace") fail(`Public package name is '${cliPackage.name}'`);
if (cliPackage.bin?.byspace !== "bin/byspace")
  fail("Public CLI bin must be byspace -> bin/byspace");
const cliBinPath = resolve(root, "packages/cli/bin/byspace");
if (!existsSync(cliBinPath) || !statSync(cliBinPath).isFile())
  fail("Public CLI bin file is missing");
if (process.platform !== "win32" && (statSync(cliBinPath).mode & 0o111) === 0) {
  fail("Public CLI bin file is not executable");
}

if (!process.exitCode) process.stdout.write("BySpace active identity is clean.\n");
