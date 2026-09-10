import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { validateDesktopManifests } from "./validate-desktop-manifests.mjs";

const RELEASE_DATE = "2026-09-10T00:00:00.000Z";
const ROLLOUT = { releaseDate: RELEASE_DATE, rolloutHours: 36 };

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "byspace-validate-manifests-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

function writeMac(overrides = "") {
  const manifestPath = path.join(dir, "latest-mac.yml");
  writeFileSync(
    manifestPath,
    [
      "version: 0.12.0",
      `releaseDate: '${RELEASE_DATE}'`,
      "rolloutHours: 36",
      "minimumSystemVersion: 22.0.0",
      "files:",
      "  - url: BySpace-0.12.0-arm64.dmg",
      "    sha512: arm-hash",
      "  - url: BySpace-0.12.0-x64.dmg",
      "    sha512: x64-hash",
      overrides,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  );
  return manifestPath;
}

test("accepts a mac manifest carrying both architectures", () => {
  validateDesktopManifests(ROLLOUT, [writeMac()]);
});

test("rejects a mac manifest missing one architecture", () => {
  const manifestPath = path.join(dir, "latest-mac.yml");
  writeFileSync(
    manifestPath,
    [
      "version: 0.12.0",
      `releaseDate: '${RELEASE_DATE}'`,
      "rolloutHours: 36",
      "minimumSystemVersion: 22.0.0",
      "files:",
      "  - url: BySpace-0.12.0-arm64.dmg",
      "    sha512: arm-hash",
    ].join("\n"),
  );
  assert.throws(() => validateDesktopManifests(ROLLOUT, [manifestPath]), /missing the x64 DMG/);
});

test("rejects a DMG entry without a checksum", () => {
  const manifestPath = path.join(dir, "latest-mac.yml");
  writeFileSync(
    manifestPath,
    [
      "version: 0.12.0",
      `releaseDate: '${RELEASE_DATE}'`,
      "rolloutHours: 36",
      "minimumSystemVersion: 22.0.0",
      "files:",
      "  - url: BySpace-0.12.0-arm64.dmg",
      "    sha512: arm-hash",
      "  - url: BySpace-0.12.0-x64.dmg",
    ].join("\n"),
  );
  assert.throws(
    () => validateDesktopManifests(ROLLOUT, [manifestPath]),
    /x64 DMG entry has no sha512/,
  );
});

test("rejects a mac manifest that drops the macOS floor", () => {
  const manifestPath = path.join(dir, "latest-mac.yml");
  writeFileSync(
    manifestPath,
    [
      "version: 0.12.0",
      `releaseDate: '${RELEASE_DATE}'`,
      "rolloutHours: 36",
      "files:",
      "  - url: BySpace-0.12.0-arm64.dmg",
      "    sha512: arm-hash",
      "  - url: BySpace-0.12.0-x64.dmg",
      "    sha512: x64-hash",
    ].join("\n"),
  );
  assert.throws(() => validateDesktopManifests(ROLLOUT, [manifestPath]), /minimumSystemVersion/);
});

test("rejects a mis-stamped rollout on any platform manifest", () => {
  const manifestPath = path.join(dir, "latest-linux.yml");
  writeFileSync(
    manifestPath,
    ["version: 0.12.0", `releaseDate: '${RELEASE_DATE}'`, "rolloutHours: 12"].join("\n"),
  );
  assert.throws(() => validateDesktopManifests(ROLLOUT, [manifestPath]), /rolloutHours=12/);
});

test("leaves non-mac manifests free of the macOS checks", () => {
  const manifestPath = path.join(dir, "latest-linux.yml");
  writeFileSync(
    manifestPath,
    ["version: 0.12.0", `releaseDate: '${RELEASE_DATE}'`, "rolloutHours: 36"].join("\n"),
  );
  validateDesktopManifests(ROLLOUT, [manifestPath]);
});

test("requires at least one manifest", () => {
  assert.throws(() => validateDesktopManifests(ROLLOUT, []), /at least one manifest/);
});
