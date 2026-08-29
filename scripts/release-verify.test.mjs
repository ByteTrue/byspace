import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseVerifyPublishArgs,
  isPublishedVersion,
  verifyRelease,
} from "./release-verify.mjs";

test("stable release verify uses the default npm dist-tag", () => {
  assert.deepEqual(buildReleaseVerifyPublishArgs("0.2.0"), ["--dry-run", "--skip-pack"]);
});

test("beta release verify uses the beta dist-tag", () => {
  assert.deepEqual(buildReleaseVerifyPublishArgs("0.2.0-beta.4"), [
    "--dry-run",
    "--skip-pack",
    "--tag",
    "beta",
  ]);
});

test("published-version checks treat 200 as published and 404 as unpublished", async () => {
  assert.equal(await isPublishedVersion("0.2.0", { getStatus: async () => 200 }), true);
  assert.equal(await isPublishedVersion("0.2.0", { getStatus: async () => 404 }), false);
});

test("published-version checks fail closed on unexpected registry responses", async () => {
  await assert.rejects(
    isPublishedVersion("0.2.0", { getStatus: async () => 503 }),
    /Failed to verify npm publication for @bytetrue\/byspace@0\.2\.0: HTTP 503/,
  );
});

test("release verify skips dry-run publish when the version already exists", async () => {
  let publishArgs = null;
  const logs = [];

  await verifyRelease("0.2.0", {
    checkPublished: async () => true,
    log: (message) => logs.push(message),
    runPublish: (args) => {
      publishArgs = args;
    },
  });

  assert.equal(publishArgs, null);
  assert.deepEqual(logs, [
    "Skipping dry-run publish verify for already-published @bytetrue/byspace@0.2.0.",
  ]);
});

test("release verify still dry-runs unpublished beta releases", async () => {
  let publishArgs = null;

  await verifyRelease("0.2.0-beta.4", {
    checkPublished: async () => false,
    log: () => {},
    runPublish: (args) => {
      publishArgs = args;
    },
  });

  assert.deepEqual(publishArgs, ["--dry-run", "--skip-pack", "--tag", "beta"]);
});
