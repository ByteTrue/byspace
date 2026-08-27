import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifier = path.join(root, "scripts", "verify-desktop-package.mjs");
const requiredAsarEntries = [
  "dist/main.js",
  "dist/preload.js",
  "dist/daemon/node-entrypoint-runner.js",
  "node_modules/@bytetrue/byspace/bin/byspace",
  "node_modules/@bytetrue/byspace-server/dist/scripts/supervisor-entrypoint.js",
  "node_modules/@bytetrue/byspace-server/dist/server/server/daemon-worker.js",
  "node_modules/esbuild/lib/main.js",
];

async function createFixture({ windowsAsarPaths = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "byspace-desktop-package-"));
  const source = path.join(directory, "source");
  const resources = path.join(directory, "resources");
  mkdirSync(source, { recursive: true });
  writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({ name: "@bytetrue/byspace-desktop", version: "1.0.0" }),
  );
  for (const entry of requiredAsarEntries) {
    const target = path.join(source, windowsAsarPaths ? entry.replaceAll("/", "\\") : entry);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "export {};\n");
  }
  mkdirSync(resources, { recursive: true });
  await createPackage(source, path.join(resources, "app.asar"));
  writeFileSync(path.join(resources, "app-update.yml"), "provider: github\nrepo: byspace\n");
  mkdirSync(path.join(resources, "bin"), { recursive: true });
  writeFileSync(path.join(resources, "bin", "byspace"), "#!/bin/sh\n");
  for (const dependency of ["node-pty", "@esbuild"]) {
    mkdirSync(path.join(resources, "app.asar.unpacked", "node_modules", dependency), {
      recursive: true,
    });
  }
  return { directory, resources };
}

test("accepts the real packaged Desktop ASAR layout", async () => {
  const fixture = await createFixture();
  try {
    const output = execFileSync(process.execPath, [verifier, fixture.resources, "byspace"], {
      encoding: "utf8",
    });
    assert.match(output, /Verified packaged Desktop resources/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("accepts Windows-style ASAR path separators", async () => {
  const fixture = await createFixture({ windowsAsarPaths: true });
  try {
    const output = execFileSync(process.execPath, [verifier, fixture.resources, "byspace"], {
      encoding: "utf8",
    });
    assert.match(output, /Verified packaged Desktop resources/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a missing packaged runtime entry", async () => {
  const fixture = await createFixture();
  try {
    rmSync(path.join(fixture.resources, "app.asar.unpacked", "node_modules", "node-pty"), {
      recursive: true,
      force: true,
    });
    assert.throws(
      () =>
        execFileSync(process.execPath, [verifier, fixture.resources, "byspace"], { stdio: "pipe" }),
      /Missing packaged Desktop resource/,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a missing packaged esbuild platform binary directory", async () => {
  const fixture = await createFixture();
  try {
    rmSync(path.join(fixture.resources, "app.asar.unpacked", "node_modules", "@esbuild"), {
      recursive: true,
      force: true,
    });
    assert.throws(
      () =>
        execFileSync(process.execPath, [verifier, fixture.resources, "byspace"], { stdio: "pipe" }),
      /Missing packaged Desktop resource/,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
