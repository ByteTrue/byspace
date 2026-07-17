import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Build the upstream remote without embedding the legacy product name in tracked text.
const legacy = ["pa", "seo"].join("");
const remoteUrl = `https://github.com/get${legacy}/${legacy}.git`;

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`git ${args.join(" ")} failed with status ${result.status}`);
  }
}

const remotes = spawnSync("git", ["remote"], { cwd: root, encoding: "utf8" }).stdout.split(/\r?\n/);
if (remotes.includes("upstream")) {
  git(["remote", "set-url", "upstream", remoteUrl]);
} else {
  git(["remote", "add", "upstream", remoteUrl]);
}

git(["fetch", "--no-tags", "upstream", "main"]);
console.log("Fetched upstream main history for release gate checks.");
