import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "release-artifact-manifest.mjs");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const commit = "a".repeat(40);

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function archive(cwd, source, destination) {
  const result = spawnSync("tar", ["-czf", destination, "-C", cwd, source], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function withTempDir(callback) {
  const directory = mkdtempSync(join(tmpdir(), "byspace-release-artifact-"));
  try {
    callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("creates and verifies a Web artifact manifest", () => {
  withTempDir((directory) => {
    mkdirSync(join(directory, "dist"));
    writeFileSync(join(directory, "dist", "index.html"), "<!doctype html>\n");
    const artifact = join(directory, `byspace-web-${version}.tgz`);
    const manifest = join(directory, "web-artifact.json");
    archive(directory, "dist", artifact);

    const create = run([
      "create",
      "--kind",
      "web",
      "--artifact",
      artifact,
      "--manifest",
      manifest,
      "--commit",
      commit,
    ]);
    assert.equal(create.status, 0, create.stderr);

    const verify = run(["verify", "--kind", "web", "--manifest", manifest, "--commit", commit]);
    assert.equal(verify.status, 0, verify.stderr);

    const data = JSON.parse(readFileSync(manifest, "utf8"));
    assert.deepEqual(
      {
        schemaVersion: data.schemaVersion,
        kind: data.kind,
        commit: data.commit,
        version: data.version,
        artifact: data.artifact,
        sha256Length: data.sha256.length,
      },
      {
        schemaVersion: 1,
        kind: "web",
        commit,
        version,
        artifact: `byspace-web-${version}.tgz`,
        sha256Length: 64,
      },
    );
  });
});

test("fails closed when artifact bytes, presence, or expected commit differ", () => {
  withTempDir((directory) => {
    mkdirSync(join(directory, "dist"));
    writeFileSync(join(directory, "dist", "index.html"), "<!doctype html>\n");
    const artifact = join(directory, `byspace-web-${version}.tgz`);
    const manifest = join(directory, "web-artifact.json");
    archive(directory, "dist", artifact);
    assert.equal(
      run([
        "create",
        "--kind",
        "web",
        "--artifact",
        artifact,
        "--manifest",
        manifest,
        "--commit",
        commit,
      ]).status,
      0,
    );

    const wrongCommit = run([
      "verify",
      "--kind",
      "web",
      "--manifest",
      manifest,
      "--commit",
      "b".repeat(40),
    ]);
    assert.notEqual(wrongCommit.status, 0);
    assert.match(wrongCommit.stderr, /commit/i);

    appendFileSync(artifact, "tampered");
    const tampered = run(["verify", "--kind", "web", "--manifest", manifest, "--commit", commit]);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /SHA-256/i);

    rmSync(artifact);
    const missing = run(["verify", "--kind", "web", "--manifest", manifest, "--commit", commit]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ENOENT|no such file/i);
  });
});

test("creates and verifies an npm artifact manifest from the packed package metadata", () => {
  withTempDir((directory) => {
    mkdirSync(join(directory, "package"));
    writeFileSync(
      join(directory, "package", "package.json"),
      `${JSON.stringify({ name: "@bytetrue/byspace", version })}\n`,
    );
    writeFileSync(join(directory, "package", "README.md"), "BySpace\n");
    const artifact = join(directory, `bytetrue-byspace-${version}.tgz`);
    const manifest = join(directory, "npm-artifact.json");
    archive(directory, "package", artifact);

    const create = run([
      "create",
      "--kind",
      "npm",
      "--artifact",
      artifact,
      "--manifest",
      manifest,
      "--commit",
      commit,
    ]);
    assert.equal(create.status, 0, create.stderr);
    const verify = run(["verify", "--kind", "npm", "--manifest", manifest, "--commit", commit]);
    assert.equal(verify.status, 0, verify.stderr);
  });
});

test("rejects an npm artifact whose package version differs from the source", () => {
  withTempDir((directory) => {
    mkdirSync(join(directory, "package"));
    writeFileSync(
      join(directory, "package", "package.json"),
      `${JSON.stringify({ name: "@bytetrue/byspace", version: "9.9.9" })}\n`,
    );
    const artifact = join(directory, `bytetrue-byspace-${version}.tgz`);
    archive(directory, "package", artifact);

    const result = run([
      "create",
      "--kind",
      "npm",
      "--artifact",
      artifact,
      "--manifest",
      join(directory, "npm-artifact.json"),
      "--commit",
      commit,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /version/i);
  });
});
