import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCiState } from "./release-version-utils.mjs";

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

// Wait for CI on the pushed commit instead of failing immediately.
//
// A release pushes the version commit and then has to prove CI is green on exactly that commit
// before tagging. Failing here forced a two-step release — push, wait ten to twenty minutes, rerun
// — which is why every release cost an extra turn and an extra look at the Actions tab. Waiting in
// place makes `npm run release:beta:next` a single command.
//
// Set RELEASE_CI_WAIT_MS=0 to keep the old fail-fast behaviour for a script that tags externally.
const repository = process.env.GITHUB_REPOSITORY || "ByteTrue/byspace";
const waitMs = Number(process.env.RELEASE_CI_WAIT_MS ?? 45 * 60_000);
const pollMs = 20_000;

function ciRunState(commit) {
  const out = tryRunQuiet("gh", [
    "run",
    "list",
    "--repo",
    repository,
    "--workflow",
    "CI",
    "--commit",
    commit,
    "--event",
    "push",
    "--limit",
    "1",
    "--json",
    "status,conclusion",
    "--jq",
    '.[0] | "\\(.status) \\(.conclusion)"',
  ]);
  const [status = "", conclusion = ""] = out.split(/\s+/).filter(Boolean);
  return { status, conclusion };
}

// Resolve the most recent commit that touched non-release-metadata files (i.e. actual code/tests).
// Pure changelog + version-bump commits are ignored by CI push triggers so releasing already-tested
// main code starts packaging immediately without re-running the test suite a second time.
const codeCommit =
  tryRunQuiet("git", [
    "log",
    "-n",
    "1",
    "--format=%H",
    "HEAD",
    "--",
    ".",
    ":!CHANGELOG.md",
    ":!package.json",
    ":!packages/*/package.json",
    ":!workers/*/package.json",
    ":!internal/cli/gui_android.go",
  ]) || headCommit;

let ciState = ciRunState(codeCommit);
let ciVerdict = classifyCiState(ciState);
if (ciVerdict !== "green") {
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    throw new Error(
      `Pushed ${headCommit} to main, but CI on code commit ${codeCommit} is not green yet. Wait for CI, then rerun npm run release:push.`,
    );
  }
  const shortSha = codeCommit.slice(0, 9);
  process.stdout.write(
    `Waiting for CI on code commit ${shortSha} (up to ${Math.round(waitMs / 60_000)}m)\n`,
  );
  const deadline = Date.now() + waitMs;
  let lastReported = "";
  while (ciVerdict === "pending" && Date.now() < deadline) {
    if (ciState.status && ciState.status !== lastReported) {
      lastReported = ciState.status;
      process.stdout.write(`  CI ${ciState.status}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    ciState = ciRunState(codeCommit);
    ciVerdict = classifyCiState(ciState);
  }
  if (ciVerdict === "failed") {
    throw new Error(
      `CI on ${codeCommit} concluded ${ciState.conclusion || "without a result"}; refusing to tag. Fix main and cut a new version.`,
    );
  }
  if (ciVerdict !== "green") {
    throw new Error(
      `CI on ${codeCommit} did not go green within ${Math.round(waitMs / 60_000)}m (last: ${ciState.status || "not started"} ${ciState.conclusion}). Rerun npm run release:push once it does; it will not push again or cut a second version.`,
    );
  }
  process.stdout.write(`  CI green on ${shortSha}\n`);
}

if (!localTagCommit) run("git", ["tag", "-a", tag, "-m", tag]);
if (remoteTagCommit) {
  console.log(`Tag ${tag} already exists on origin`);
} else {
  run("git", ["push", "origin", tag]);
}
console.log(`Release tag published after exact-SHA CI: ${tag} (${headCommit})`);
