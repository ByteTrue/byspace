#!/usr/bin/env npx zx

import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyInvocation, isExistingDirectory, isPathLikeArg } from "../src/classify.ts";
import { buildWorkspaceWebRoute, resolveWebUiOrigin } from "../src/commands/open.ts";

console.log("📋 Phase 32: Open Project CLI Tests\n");

console.log("  Testing path-like detection exports...");
assert.equal(isPathLikeArg("."), true);
assert.equal(isPathLikeArg("./app"), true);
assert.equal(isPathLikeArg("/tmp/app"), true);
assert.equal(isPathLikeArg("~/app"), true);
assert.equal(isPathLikeArg("run"), false);
assert.equal(isPathLikeArg("foo"), false);
console.log("  ✅ path-like detection matches the expected prefixes");

console.log("  Testing existing directory detection and command precedence...");
const existingProject = join(await mkdtemp(join(tmpdir(), "byspace-open-project-")), "project");
await mkdir(existingProject);
const originalCwd = process.cwd();
process.chdir(join(existingProject, ".."));

assert.equal(isExistingDirectory({ pathArg: "project", cwd: process.cwd() }), true);
assert.equal(
  classifyInvocation({
    argv: ["project"],
    knownCommands: new Set(["run", "status"]),
    cwd: process.cwd(),
  }).kind,
  "open-project",
);
assert.equal(
  classifyInvocation({
    argv: ["run"],
    knownCommands: new Set(["run", "status"]),
    cwd: process.cwd(),
  }).kind,
  "cli",
);

process.chdir(originalCwd);
console.log("  ✅ existing directories open as projects, but known commands still win");

console.log("  Testing the daemon web UI origin...");
assert.equal(resolveWebUiOrigin("127.0.0.1:6777"), "http://127.0.0.1:6777");
assert.equal(resolveWebUiOrigin("tcp://localhost:6778"), "http://localhost:6778");
assert.equal(resolveWebUiOrigin("0.0.0.0:6777"), "http://127.0.0.1:6777");
assert.equal(resolveWebUiOrigin("[::1]:6777"), "http://[::1]:6777");
assert.equal(resolveWebUiOrigin(" unix:///tmp/byspace.sock "), null);
assert.equal(resolveWebUiOrigin("pipe://\\\\.\\pipe\\byspace"), null);
assert.equal(resolveWebUiOrigin("ssh://build-host"), null);
assert.equal(resolveWebUiOrigin("localhost"), null);
assert.equal(resolveWebUiOrigin(""), null);
console.log("  ✅ only TCP daemon hosts produce a browser-reachable origin");

console.log("  Testing the workspace web route...");
assert.equal(
  buildWorkspaceWebRoute("srv_1", "wks_60e42485f5bb08e2"),
  "/h/srv_1/workspace/wks_60e42485f5bb08e2",
);
assert.equal(buildWorkspaceWebRoute("srv 1", "wks/a"), "/h/srv%201/workspace/wks%2Fa");
console.log("  ✅ workspace routes match the app's host route shape");

console.log("\n✅ Phase 32: Open Project CLI Tests PASSED");
