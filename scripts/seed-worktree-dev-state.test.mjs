import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve(import.meta.dirname, "seed-worktree-dev-state.mjs");
const byspaceConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../byspace.json"), "utf8"),
);

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function runSetup(sourceRoot, targetRoot, extraEnv = {}) {
  return execFileSync(process.execPath, [script], {
    cwd: targetRoot,
    env: {
      ...process.env,
      BYSPACE_SOURCE_CHECKOUT_PATH: sourceRoot,
      BYSPACE_WORKTREE_PATH: targetRoot,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("keeps worktree setup commands portable across PowerShell and POSIX shells", () => {
  assert.deepEqual(byspaceConfig.worktree.setup, [
    "npm ci",
    "node ./scripts/seed-worktree-dev-state.mjs",
    "npm run build:server",
  ]);
});

test("seeds durable BySpace metadata and server env without shell syntax", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-worktree-seed-"));
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });

  write(join(source, ".dev/byspace-home/agents/one.json"), '{"id":"one"}');
  write(join(source, ".dev/byspace-home/agents/ignored.log"), "runtime");
  write(join(source, ".dev/byspace-home/projects/two.json"), '{"id":"two"}');
  write(join(source, ".dev/byspace-home/config.json"), '{"version":1}');
  write(join(source, ".dev/byspace-home/byspace.pid"), "123");
  write(join(source, "packages/server/.env"), "TOKEN=local\n");
  const external = join(root, "external.json");
  write(external, '{"secret":true}');
  symlinkSync(external, join(source, ".dev/byspace-home/agents/link.json"));

  runSetup(source, target);

  assert.equal(
    readFileSync(join(target, ".dev/byspace-home/agents/one.json"), "utf8"),
    '{"id":"one"}',
  );
  assert.equal(
    readFileSync(join(target, ".dev/byspace-home/projects/two.json"), "utf8"),
    '{"id":"two"}',
  );
  assert.equal(
    readFileSync(join(target, ".dev/byspace-home/config.json"), "utf8"),
    '{"version":1}',
  );
  assert.equal(readFileSync(join(target, "packages/server/.env"), "utf8"), "TOKEN=local\n");
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/ignored.log")), false);
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/link.json")), false);
  assert.equal(existsSync(join(target, ".dev/byspace-home/byspace.pid")), false);
});

test("does not copy a symlinked config file", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-worktree-config-link-"));
  const source = join(root, "source");
  const target = join(root, "target");
  const external = join(root, "external-config.json");
  write(external, '{"secret":true}');
  mkdirSync(join(source, ".dev/byspace-home"), { recursive: true });
  mkdirSync(target, { recursive: true });
  symlinkSync(external, join(source, ".dev/byspace-home/config.json"));

  runSetup(source, target);

  assert.equal(existsSync(join(target, ".dev/byspace-home/config.json")), false);
});

test("never resets source metadata through a symlinked target checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-worktree-alias-"));
  const source = join(root, "source");
  const targetAlias = join(root, "target-alias");
  const sourceRecord = join(source, ".dev/byspace-home/agents/source.json");
  write(sourceRecord, '{"source":true}');
  symlinkSync(source, targetAlias, process.platform === "win32" ? "junction" : "dir");

  runSetup(source, targetAlias, { BYSPACE_DEV_RESET_HOME: "1" });

  assert.equal(readFileSync(sourceRecord, "utf8"), '{"source":true}');
});

test("preserves an initialized target unless reset is requested", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-worktree-reset-"));
  const source = join(root, "source");
  const target = join(root, "target");
  write(join(source, ".dev/byspace-home/agents/source.json"), '{"source":true}');
  write(join(target, ".dev/byspace-home/agents/existing.json"), '{"existing":true}');

  const skipped = runSetup(source, target);
  assert.match(skipped, /already has data/);
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/source.json")), false);
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/existing.json")), true);

  runSetup(source, target, { BYSPACE_DEV_RESET_HOME: "1" });
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/source.json")), true);
  assert.equal(existsSync(join(target, ".dev/byspace-home/agents/existing.json")), false);
});

test("treats a missing optional source home and server env as a successful no-op", () => {
  const root = mkdtempSync(join(tmpdir(), "byspace-worktree-empty-"));
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });

  const output = runSetup(source, target);
  assert.match(output, /Seed:\s+skipped/);
  assert.match(output, /Env:\s+skipped/);
});
