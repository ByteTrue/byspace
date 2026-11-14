import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeJobName,
  releaseGateAction,
  verifyReleaseJobs,
} from "./release-version-utils.mjs";
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

// Wait for CI on the pushed commit before tagging.
//
// The push starts a CI run, and a release has to prove that run green on exactly this commit. In
// the common case the push run executes the full set; dispatching another full run here would then
// be queued behind it by the workflow's concurrency group, so the release would pay for two full
// runs back to back. Wait for the push run first and reuse it when every required job executed.
// Only a path-filtered run (jobs skipped) forces a dispatch.
//
// Set RELEASE_CI_WAIT_MS=0 to keep the old fail-fast behaviour for a script that tags externally.
const repository = process.env.GITHUB_REPOSITORY || "ByteTrue/byspace";
const waitMs = Number(process.env.RELEASE_CI_WAIT_MS ?? 45 * 60_000);
const pollMs = 20_000;
const noWait = !Number.isFinite(waitMs) || waitMs <= 0;

// A run routed by path filters is not evidence about the commit it reports on. A docs-only or
// version-only change goes green with go/app/browser/relay skipped, and that "success" was enough
// to tag v0.25.0 — which then shipped a pairing flow no suite had ever run.
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

function ciRunState(commit, event) {
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
    event,
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

async function waitForCi(commit, event, label) {
  const deadline = Date.now() + waitMs;
  console.log(`Waiting for ${label} on ${commit.slice(0, 9)}`);
  let lastReported = "";
  let runState = { id: "", status: "", conclusion: "" };
  while (Date.now() < deadline) {
    runState = ciRunState(commit, event);
    if (runState.id && runState.status && runState.status !== lastReported) {
      lastReported = runState.status;
      console.log(`  CI ${runState.status}`);
    }
    if (runState.conclusion) return runState;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (!runState.id) {
    throw new Error(
      `${label} never appeared for ${commit} within ${Math.round(waitMs / 60_000)}m.`,
    );
  }
  throw new Error(`${label} on ${commit} did not finish within ${Math.round(waitMs / 60_000)}m.`);
}

const shortSha = headCommit.slice(0, 9);

if (noWait) {
  console.log(`Dispatching full CI on ${shortSha} (RELEASE_CI_WAIT_MS=0)`);
  run("gh", ["workflow", "run", "CI", "--repo", repository, "--ref", branch]);
  throw new Error(
    `Dispatched full CI on ${headCommit}; rerun npm run release:push once that run is green.`,
  );
}

const pushRun = await waitForCi(headCommit, "push", "the push CI");
if (pushRun.conclusion !== "success") {
  throw new Error(
    `Push CI on ${headCommit} concluded ${pushRun.conclusion}; refusing to tag. Fix main and cut a new version.`,
  );
}

const gate = releaseGateAction(pushRun, jobConclusions(pushRun.id));
if (gate.action === "fail") {
  throw new Error(`Push CI on ${headCommit} failed; refusing to tag.`);
}
if (gate.action === "dispatch") {
  console.log(`  push CI did not run the full set (${gate.detail}); dispatching full CI`);
  run("gh", ["workflow", "run", "CI", "--repo", repository, "--ref", branch]);
  const dispatched = await waitForCi(headCommit, "workflow_dispatch", "the dispatched full CI");
  if (dispatched.conclusion !== "success") {
    throw new Error(
      `Full CI on ${headCommit} concluded ${dispatched.conclusion}; refusing to tag. Fix main and cut a new version.`,
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
} else {
  console.log(`  full push CI green on ${shortSha}; reusing it for the tag`);
}
console.log(`  full CI green on ${shortSha}`);

if (!localTagCommit) run("git", ["tag", "-a", tag, "-m", tag]);
if (remoteTagCommit) {
  console.log(`Tag ${tag} already exists on origin`);
} else {
  run("git", ["push", "origin", tag]);
}
console.log(`Release tag published after exact-SHA CI: ${tag} (${headCommit})`);
