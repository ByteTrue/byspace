import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const artifact = resolve(root, "artifacts", `bytetrue-byspace-${version}.tgz`);
const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
const dryRun = args.includes("--dry-run");
const skipPack = args.includes("--skip-pack");

if (tagIndex >= 0 && !tag) throw new Error("--tag requires a value");

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed`);
}

if (!skipPack) run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "pack:byspace"]);
const publishArgs = ["publish", artifact, "--access", "public"];
if (tag) publishArgs.push("--tag", tag);
if (dryRun) publishArgs.push("--dry-run");
if (process.env.GITHUB_ACTIONS === "true") publishArgs.push("--provenance");
run(process.platform === "win32" ? "npm.cmd" : "npm", publishArgs);
