import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCiState,
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  normalizeJobName,
  parseReleaseVersion,
  verifyReleaseJobs,
  releaseGateAction,
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

test("normalizeJobName collapses matrix variants", () => {
  assert.equal(normalizeJobName("playwright (shard 3/16)"), "playwright");
  assert.equal(normalizeJobName("go-tests (windows-latest)"), "go-tests");
  assert.equal(normalizeJobName("relay-tests"), "relay-tests");
});

test("verifyReleaseJobs rejects a run that skipped the suites", () => {
  // What a version-only commit reports: format, lint, typecheck, and nothing else.
  const skipped = new Map([
    ["format", ["success"]],
    ["lint", ["success"]],
    ["typecheck", ["success"]],
    ["go-tests", ["skipped"]],
    ["app-tests", ["skipped"]],
    ["playwright", ["skipped"]],
  ]);
  const { missing, failed } = verifyReleaseJobs(skipped);
  assert.deepEqual(missing, ["sdk-tests", "relay-tests", "build-e2e"]);
  assert.deepEqual(failed, ["go-tests", "app-tests", "playwright"]);
});

test("verifyReleaseJobs accepts a full green run", () => {
  const green = new Map([
    ["format", ["success"]],
    ["lint", ["success"]],
    ["typecheck", ["success"]],
    ["go-tests", ["success", "success"]],
    ["sdk-tests", ["success"]],
    ["relay-tests", ["success"]],
    ["build-e2e", ["success"]],
    ["app-tests", ["success"]],
    ["playwright", Array.from({ length: 16 }, () => "success")],
  ]);
  assert.deepEqual(verifyReleaseJobs(green), { missing: [], failed: [] });
});

test("releaseGateAction waits for a run that has not appeared yet", () => {
  assert.equal(releaseGateAction(null, null).action, "wait");
  assert.equal(releaseGateAction({ status: "in_progress" }, null).action, "wait");
});

test("releaseGateAction fails a concluded push run that did not pass", () => {
  assert.equal(
    releaseGateAction({ status: "completed", conclusion: "failure" }, null).action,
    "fail",
  );
  assert.equal(
    releaseGateAction({ status: "completed", conclusion: "cancelled" }, null).action,
    "fail",
  );
});

test("releaseGateAction tags on a full green push run", () => {
  const green = new Map([
    ["format", ["success"]],
    ["lint", ["success"]],
    ["typecheck", ["success"]],
    ["go-tests", ["success", "success"]],
    ["sdk-tests", ["success"]],
    ["relay-tests", ["success"]],
    ["build-e2e", ["success"]],
    ["app-tests", ["success"]],
    ["playwright", Array.from({ length: 16 }, () => "success")],
  ]);
  assert.deepEqual(releaseGateAction({ status: "completed", conclusion: "success" }, green), {
    action: "tag",
    detail: "",
  });
});

test("releaseGateAction dispatches when the push run skipped required suites", () => {
  // A version-only push reports success with go, app, browser and relay skipped; it is not
  // evidence that the tagged code passed any of them.
  const skipped = new Map([
    ["format", ["success"]],
    ["lint", ["success"]],
    ["typecheck", ["success"]],
    ["go-tests", ["skipped"]],
    ["app-tests", ["skipped"]],
    ["playwright", ["skipped"]],
  ]);
  const { action, detail } = releaseGateAction(
    { status: "completed", conclusion: "success" },
    skipped,
  );
  assert.equal(action, "dispatch");
  assert.match(detail, /go-tests/);
  assert.match(detail, /playwright/);
});

test("releaseGateAction dispatches when the job list is unavailable", () => {
  assert.equal(
    releaseGateAction({ status: "completed", conclusion: "success" }, null).action,
    "dispatch",
  );
});
