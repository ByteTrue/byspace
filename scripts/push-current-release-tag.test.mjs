import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceScript = fileURLToPath(new URL("./push-current-release-tag.mjs", import.meta.url));
const sourceUtils = fileURLToPath(new URL("./release-version-utils.mjs", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture(ciRunId) {
  const root = mkdtempSync(path.join(tmpdir(), "byspace-release-push-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  const scripts = path.join(repo, "scripts");
  mkdirSync(bin);
  mkdirSync(repo);
  mkdirSync(scripts);
  copyFileSync(sourceScript, path.join(scripts, "push-current-release-tag.mjs"));
  copyFileSync(sourceUtils, path.join(scripts, "release-version-utils.mjs"));
  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Release Test");
  git(repo, "config", "user.email", "release-test@example.com");
  writeFileSync(path.join(repo, "package.json"), '{"version":"1.2.3-beta.1"}\n');
  git(repo, "add", ".");
  git(repo, "commit", "-m", "release");
  git(repo, "remote", "add", "origin", remote);

  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${ciRunId}'\n`);
  chmodSync(gh, 0o755);
  return { bin, remote, repo, script: path.join(scripts, "push-current-release-tag.mjs") };
}

function run({ bin, repo, script }) {
  return spawnSync(process.execPath, [script], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

test("pushes main but does not create the tag before exact-SHA CI succeeds", () => {
  const state = fixture("");
  const result = run(state);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact-SHA CI is not green/u);
  assert.equal(git(state.repo, "rev-parse", "origin/main"), git(state.repo, "rev-parse", "HEAD"));
  assert.equal(git(state.repo, "tag", "--list"), "");
  assert.equal(git(state.repo, "ls-remote", "--tags", "origin"), "");
});

test("creates and pushes the tag only after exact-SHA CI succeeds", () => {
  const state = fixture("12345");
  const result = run(state);
  assert.equal(result.status, 0, result.stderr);
  const head = git(state.repo, "rev-parse", "HEAD");
  assert.equal(git(state.repo, "rev-list", "-n", "1", "v1.2.3-beta.1"), head);
  assert.match(
    git(state.repo, "ls-remote", "--tags", "origin", "refs/tags/v1.2.3-beta.1^{}"),
    new RegExp(`^${head}`),
  );
});
