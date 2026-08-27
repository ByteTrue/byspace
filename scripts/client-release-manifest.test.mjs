import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createClientReleaseManifest,
  verifyClientReleaseManifest,
} from "./client-release-manifest.mjs";

const VERSION = "1.2.3";
const TAG = `v${VERSION}`;
const COMMIT = "a".repeat(40);
const CERTIFICATE = "b".repeat(64);

function fixtureDirectory(channel = "stable") {
  const directory = mkdtempSync(path.join(tmpdir(), "byspace-client-release-"));
  const updaterChannel = channel === "stable" ? "latest" : "beta";
  const names = [
    `BySpace-${VERSION}-arm64.dmg`,
    `BySpace-${VERSION}-arm64.zip`,
    `BySpace-${VERSION}-x64.dmg`,
    `BySpace-${VERSION}-x64.zip`,
    "BySpace-x64.AppImage",
    `BySpace-${VERSION}-x64.deb`,
    `BySpace-${VERSION}-x64.rpm`,
    `BySpace-${VERSION}-x64.tar.gz`,
    `BySpace-Setup-${VERSION}-x64.exe`,
    `BySpace-Setup-${VERSION}-x64.zip`,
    `BySpace-Setup-${VERSION}-arm64.exe`,
    `BySpace-Setup-${VERSION}-arm64.zip`,
    `BySpace-${VERSION}-android.apk`,
    `${updaterChannel}-mac.yml`,
    `${updaterChannel}-linux.yml`,
    `${updaterChannel}.yml`,
  ];
  const updaterReferences = new Map([
    [`${updaterChannel}-mac.yml`, [`BySpace-${VERSION}-arm64.zip`, `BySpace-${VERSION}-x64.zip`]],
    [`${updaterChannel}-linux.yml`, ["BySpace-x64.AppImage"]],
    [`${updaterChannel}.yml`, [`BySpace-Setup-${VERSION}-x64.exe`]],
  ]);
  for (const name of names) {
    const references = updaterReferences.get(name);
    const content = references
      ? `version: ${VERSION}\nfiles:\n${references.map((reference) => `  - url: ${reference}`).join("\n")}\npath: ${references[0]}\n`
      : `fixture:${name}\n`;
    writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function create(directory, channel = "stable") {
  return createClientReleaseManifest({
    directory,
    tag: TAG,
    commit: COMMIT,
    version: VERSION,
    channel,
    androidCertSha256: CERTIFICATE,
    macosSigning: "ad-hoc",
    windowsSigning: "unsigned",
  });
}

test("creates and verifies a complete cross-platform client release manifest", () => {
  const directory = fixtureDirectory();
  try {
    const manifest = create(directory);
    assert.equal(manifest.assets.length, 16);
    assert.deepEqual(manifest.ios, {
      published: false,
      reason: "source-retained-but-excluded-from-cd",
    });
    assert.equal(manifest.signing.android.certificateSha256, CERTIFICATE);
    assert.equal(
      manifest.assets.find((asset) => asset.name === `BySpace-${VERSION}-arm64.zip`)?.platform,
      "macos",
    );
    assert.equal(
      manifest.assets.find((asset) => asset.name === `BySpace-Setup-${VERSION}-arm64.zip`)
        ?.platform,
      "windows",
    );
    assert.equal(verifyClientReleaseManifest({ directory, tag: TAG, commit: COMMIT }).tag, TAG);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("uses Electron updater channel filenames for Beta", () => {
  const directory = fixtureDirectory("beta");
  try {
    const manifest = create(directory, "beta");
    assert.equal(manifest.channel, "beta");
    assert.equal(
      manifest.assets.some((asset) => asset.name === "beta-mac.yml"),
      true,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("rejects a modified release asset", () => {
  const directory = fixtureDirectory();
  try {
    create(directory);
    writeFileSync(path.join(directory, `BySpace-${VERSION}-android.apk`), "tampered\n");
    assert.throws(
      () => verifyClientReleaseManifest({ directory, tag: TAG, commit: COMMIT }),
      /integrity verification/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
test("rejects updater metadata that points outside the release", () => {
  const directory = fixtureDirectory();
  try {
    create(directory);
    writeFileSync(path.join(directory, "latest.yml"), "path: missing-installer.exe\n");
    assert.throws(
      () => verifyClientReleaseManifest({ directory, tag: TAG, commit: COMMIT }),
      /references missing asset/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("forbids iOS artifacts", () => {
  const directory = fixtureDirectory();
  try {
    writeFileSync(path.join(directory, `BySpace-${VERSION}-ios.ipa`), "forbidden\n");
    assert.throws(() => create(directory), /iOS assets are forbidden/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
