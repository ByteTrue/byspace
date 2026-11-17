import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "scripts/project-npm.mjs");

test("project npm isolates nested commands and version lifecycle without changing the lock", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "project npm "));
  const originalPath = process.env.PATH;
  const manifest = {
    name: "project-npm-fixture",
    version: "1.0.0",
    private: true,
    packageManager: JSON.parse(readFileSync(path.join(root, "package.json"))).packageManager,
    scripts: {
      nested: "npm --version",
      args: "node args.cjs",
      version: "npm --version > lifecycle.txt",
    },
  };
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  writeFileSync(path.join(dir, "args.cjs"), "console.log(JSON.stringify(process.argv.slice(2)))");
  function run(args, expected = 0) {
    const result = spawnSync(process.execPath, [runner, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(result.status, expected, result.stdout + result.stderr);
    return result.stdout;
  }
  try {
    assert.equal(run(["--version"]).trim(), "10.9.9");
    assert.match(run(["run", "nested"]), /10\.9\.9/);
    assert.match(run(["run", "args", "--", "two words", "a&b"]), /\["two words","a&b"\]/);
    const githubPath = path.join(dir, "github-path.txt");
    const setup = spawnSync(process.execPath, [runner, "--setup-ci"], {
      cwd: dir,
      env: { ...process.env, GITHUB_PATH: githubPath },
      encoding: "utf8",
    });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    assert.equal(readFileSync(githubPath, "utf8").trim(), path.join(root, ".dev", "corepack"));
    run(["version", "1.0.1", "--no-git-tag-version"]);
    assert.equal(readFileSync(path.join(dir, "lifecycle.txt"), "utf8").trim(), "10.9.9");
    run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
    const lock = readFileSync(path.join(dir, "package-lock.json"), "utf8");
    run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.equal(readFileSync(path.join(dir, "package-lock.json"), "utf8"), lock);
    run(["run", "missing-script"], 1);
    assert.equal(process.env.PATH, originalPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
