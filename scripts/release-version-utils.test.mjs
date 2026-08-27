import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildNpmVersionArgs,
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("versioning updates files without creating a commit or tag", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-version-no-tag-"));
  const runGit = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

  try {
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ name: "version-test", version: "1.0.0", private: true }, null, 2)}\n`,
    );
    writeFileSync(
      join(root, "package-lock.json"),
      `${JSON.stringify(
        {
          name: "version-test",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: { "": { name: "version-test", version: "1.0.0" } },
        },
        null,
        2,
      )}\n`,
    );
    runGit("init", "--quiet");
    runGit("config", "user.name", "BySpace test");
    runGit("config", "user.email", "test@byspace.invalid");
    runGit("add", "package.json", "package-lock.json");
    runGit("commit", "--quiet", "-m", "fixture");
    const initialHead = runGit("rev-parse", "HEAD");

    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", buildNpmVersionArgs("1.0.1"), {
      cwd: root,
      stdio: "pipe",
    });

    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.0.1");
    assert.equal(runGit("rev-parse", "HEAD"), initialHead);
    assert.equal(runGit("tag", "--list"), "");
    assert.match(runGit("status", "--short"), /package(?:-lock)?\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("rejects non-beta prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Expected beta prerelease versions/);
});
