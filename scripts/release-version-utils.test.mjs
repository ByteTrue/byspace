import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCiState,
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

test("classifies a CI run that has not been created yet as pending", () => {
  // Right after a push, Actions has no run for the commit. Calling that "not green" is what made
  // a release take two steps and an extra turn at the Actions tab.
  assert.equal(classifyCiState(null), "pending");
  assert.equal(classifyCiState({}), "pending");
  assert.equal(classifyCiState({ status: "", conclusion: "" }), "pending");
});

test("classifies an in-flight CI run as pending", () => {
  assert.equal(classifyCiState({ status: "queued" }), "pending");
  assert.equal(classifyCiState({ status: "in_progress" }), "pending");
});

test("classifies a successful CI run as green", () => {
  assert.equal(classifyCiState({ status: "completed", conclusion: "success" }), "green");
});

test("classifies a concluded non-success as failed", () => {
  assert.equal(classifyCiState({ status: "completed", conclusion: "failure" }), "failed");
  assert.equal(classifyCiState({ status: "completed", conclusion: "cancelled" }), "failed");
  assert.equal(classifyCiState({ status: "completed", conclusion: "" }), "failed");
});
