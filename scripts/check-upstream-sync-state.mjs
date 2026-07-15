import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = resolve(root, ".byspace/upstream-sync.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));

function fail(message) {
  throw new Error(`upstream sync state: ${message}`);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function gitSucceeds(args) {
  return spawnSync("git", args, { cwd: root, stdio: "ignore" }).status === 0;
}

function assertCommit(commit, label) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    fail(`${label} must be a full 40-character commit SHA`);
  }
  git(["cat-file", "-e", `${commit}^{commit}`]);
}

if (state.schemaVersion !== 1) fail("unsupported schemaVersion");
if (!Array.isArray(state.batches) || state.batches.length === 0) fail("batches must not be empty");

let previousEnd = null;
for (const [index, batch] of state.batches.entries()) {
  const label = `batches[${index}]`;
  assertCommit(batch.startExclusive, `${label}.startExclusive`);
  assertCommit(batch.endInclusive, `${label}.endInclusive`);
  if (previousEnd && batch.startExclusive !== previousEnd) {
    fail(`${label}.startExclusive must equal the previous batch end`);
  }
  if (batch.startExclusive === batch.endInclusive) {
    fail(`${label} must advance beyond startExclusive`);
  }
  if (!gitSucceeds(["merge-base", "--is-ancestor", batch.startExclusive, batch.endInclusive])) {
    fail(`${label}.startExclusive must be an ancestor of endInclusive`);
  }

  const expected = git(["rev-list", "--reverse", `${batch.startExclusive}..${batch.endInclusive}`])
    .split("\n")
    .filter(Boolean);
  if (expected.length === 0) fail(`${label} must contain at least one upstream commit`);
  const applied = Array.isArray(batch.decisions?.applied) ? batch.decisions.applied : [];
  const categorized = [
    ...(batch.decisions?.inherited ?? []),
    ...applied.map((entry) => entry.upstreamCommit),
    ...(batch.decisions?.deferred ?? []),
    ...(batch.decisions?.skipped ?? []),
  ];

  for (const [decisionIndex, commit] of categorized.entries()) {
    assertCommit(commit, `${label}.decisions[${decisionIndex}]`);
  }
  const unique = new Set(categorized);
  if (unique.size !== categorized.length)
    fail(`${label} categorizes an upstream commit more than once`);
  if (expected.length !== categorized.length) {
    fail(`${label} covers ${categorized.length} commits, expected ${expected.length}`);
  }
  for (const commit of expected) {
    if (!unique.has(commit)) fail(`${label} omits upstream commit ${commit}`);
  }

  for (const [appliedIndex, entry] of applied.entries()) {
    if (entry.mode !== "full" && entry.mode !== "partial") {
      fail(`${label}.decisions.applied[${appliedIndex}].mode must be full or partial`);
    }
    assertCommit(entry.localCommit, `${label}.decisions.applied[${appliedIndex}].localCommit`);
    if (!gitSucceeds(["merge-base", "--is-ancestor", entry.localCommit, "HEAD"])) {
      fail(`${label}.decisions.applied[${appliedIndex}].localCommit is not reachable from HEAD`);
    }
  }
  for (const [hardeningIndex, commit] of (batch.hardeningCommits ?? []).entries()) {
    assertCommit(commit, `${label}.hardeningCommits[${hardeningIndex}]`);
    if (!gitSucceeds(["merge-base", "--is-ancestor", commit, "HEAD"])) {
      fail(`${label}.hardeningCommits[${hardeningIndex}] is not reachable from HEAD`);
    }
  }

  previousEnd = batch.endInclusive;
}

if (state.cursor?.lastReviewedCommit !== previousEnd) {
  fail("cursor.lastReviewedCommit must equal the final batch endInclusive");
}

process.stdout.write(
  `Upstream sync state is complete through ${state.cursor.lastReviewedCommit} (${state.batches.length} batch${state.batches.length === 1 ? "" : "es"}).\n`,
);
