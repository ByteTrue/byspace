import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeJobName, verifyReleaseJobs } from "./release-version-utils.mjs";
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

// Wait for a full CI run on the pushed commit instead of failing immediately.
//
// A release pushes the version commit and then has to prove CI is green on exactly that commit
// before tagging. Failing here forced a two-step release — push, wait ten to twenty minutes, rerun
// — which is why every release cost an extra turn and an extra look at the Actions tab.
//
// Set RELEASE_CI_WAIT_MS=0 to keep the old fail-fast behaviour for a script that tags externally.
const repository = process.env.GITHUB_REPOSITORY || "ByteTrue/byspace";
const waitMs = Number(process.env.RELEASE_CI_WAIT_MS ?? 45 * 60_000);
const pollMs = 20_000;

// A run routed by path filters is not evidence about the commit it reports on. A docs-only or
// version-only change goes green with go/app/browser/relay skipped, and that "success" was enough
// to tag v0.25.0 — which then shipped a pairing flow no suite had ever run. Dispatching CI ignores
// the filters (workflow_dispatch always runs the full set), so the tag is gated on a run where the
// jobs that catch regressions actually executed.
function jobConclusions(runId) {
  const out = runQuiet("gh", [
    "api",
    `repos/${repository}/actions/runs/${runId}/jobs`,
    "--paginate",
    "--jq",
    '.jobs[] | {n: .name, c: (.conclusion // "")}',
  ]);
  const byJob = new Map();
  for (const line of out.split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    const { n: name, c: conclusion } = JSON.parse(line);
    const key = normalizeJobName(name);
    byJob.set(key, [...(byJob.get(key) ?? []), conclusion || "unfinished"]);
  }
  return byJob;
}

function dispatchedRunState(commit) {
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
    "workflow_dispatch",
    "--limit",
    "1",
    "--json",
    "databaseId,status,conclusion",
  ]);
  const [first] = out ? JSON.parse(out) : [];
  return {
    id: String(first?.databaseId ?? ""),
    status: String(first?.status ?? ""),
    conclusion: String(first?.conclusion ?? ""),
  };
}

const shortSha = headCommit.slice(0, 9);
const deadline = Date.now() + waitMs;
console.log(`Dispatching full CI on ${shortSha} (up to ${Math.round(waitMs / 60_000)}m)`);
run("gh", ["workflow", "run", "CI", "--repo", repository, "--ref", branch]);
if (!Number.isFinite(waitMs) || waitMs <= 0) {
  throw new Error(
    `Dispatched full CI on ${headCommit}; rerun npm run release:push once that run is green.`,
  );
}

let dispatched = { id: "", status: "", conclusion: "" };
let lastReported = "";
while (Date.now() < deadline) {
  dispatched = dispatchedRunState(headCommit);
  if (dispatched.id && dispatched.status && dispatched.status !== lastReported) {
    lastReported = dispatched.status;
    console.log(`  CI ${dispatched.status}`);
  }
  if (dispatched.conclusion) break;
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

if (dispatched.conclusion !== "success") {
  throw new Error(
    `Full CI on ${headCommit} concluded ${dispatched.conclusion || "without a result"}; refusing to tag. Fix main and cut a new version.`,
  );
}

const { missing, failed } = verifyReleaseJobs(jobConclusions(dispatched.id));
if (missing.length > 0 || failed.length > 0) {
  const detail = [
    missing.length > 0 ? `did not run: ${missing.join(", ")}` : "",
    failed.length > 0 ? `did not pass: ${failed.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  throw new Error(
    `Full CI on ${headCommit} went green without proving anything (${detail}); refusing to tag.`,
  );
}
console.log(`  full CI green on ${shortSha}`);

if (!localTagCommit) run("git", ["tag", "-a", tag, "-m", tag]);
if (remoteTagCommit) {
  console.log(`Tag ${tag} already exists on origin`);
} else {
  run("git", ["push", "origin", tag]);
}
console.log(`Release tag published after exact-SHA CI: ${tag} (${headCommit})`);
