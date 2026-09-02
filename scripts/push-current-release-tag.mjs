import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usageAndExit(code = 0) {
  process.stderr.write(`Usage: node scripts/push-current-release-tag.mjs [--branch main]\n`);
  process.exit(code);
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: rootDir, stdio: "inherit" });
}

function runQuiet(cmd, args) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
}

function tryRunQuiet(cmd, args) {
  try {
    return runQuiet(cmd, args);
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  let branch = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") {
      branch = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    } else {
      usageAndExit(1);
    }
  }
  return { branch };
}

const { branch } = parseArgs(process.argv.slice(2));
const version = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
).version?.trim();
if (!version) throw new Error('Root package.json must contain a valid "version"');

const currentBranch = runQuiet("git", ["branch", "--show-current"]);
const branchRef = branch || currentBranch;
if (branchRef !== "main") {
  throw new Error(
    `Release tags can only be pushed from main, not ${branchRef || "detached HEAD"}.`,
  );
}
if (runQuiet("git", ["status", "--porcelain"])) {
  throw new Error("Release worktree must be clean before pushing main or a tag.");
}

const tag = `v${version}`;
const headCommit = runQuiet("git", ["rev-parse", "HEAD"]);
const localTagCommit = tryRunQuiet("git", ["rev-list", "-n", "1", tag]);
if (localTagCommit && localTagCommit !== headCommit) {
  throw new Error(`Local tag ${tag} points to ${localTagCommit}, but HEAD is ${headCommit}.`);
}

const remoteTagCommit =
  tryRunQuiet("git", ["ls-remote", "--exit-code", "origin", `refs/tags/${tag}^{}`]).split(
    /\s+/,
  )[0] ||
  tryRunQuiet("git", ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`]).split(
    /\s+/,
  )[0];
if (remoteTagCommit && remoteTagCommit !== headCommit) {
  throw new Error(`Remote tag ${tag} points to ${remoteTagCommit}, but HEAD is ${headCommit}.`);
}

run("git", ["push", "origin", "HEAD:main"]);
const remoteMainCommit = runQuiet("git", [
  "ls-remote",
  "--exit-code",
  "--refs",
  "origin",
  "refs/heads/main",
])
  .split(/\s+/)[0]
  .trim();
if (remoteMainCommit !== headCommit) {
  throw new Error(`origin/main is ${remoteMainCommit}, expected ${headCommit}.`);
}

const repository = process.env.GITHUB_REPOSITORY || "ByteTrue/byspace";

const successfulCiRun = tryRunQuiet("gh", [
  "run",
  "list",
  "--repo",
  repository,
  "--workflow",
  "CI",
  "--commit",
  headCommit,
  "--event",
  "push",
  "--status",
  "success",
  "--limit",
  "1",
  "--json",
  "databaseId",
  "--jq",
  ".[0].databaseId // empty",
]);
if (!successfulCiRun) {
  throw new Error(
    `Pushed ${headCommit} to main, but exact-SHA CI is not green yet. Wait for CI, then rerun npm run release:push.`,
  );
}

if (!localTagCommit) run("git", ["tag", "-a", tag, "-m", tag]);
if (remoteTagCommit) {
  console.log(`Tag ${tag} already exists on origin`);
} else {
  run("git", ["push", "origin", tag]);
}
console.log(`Release tag published after exact-SHA CI: ${tag} (${headCommit})`);
