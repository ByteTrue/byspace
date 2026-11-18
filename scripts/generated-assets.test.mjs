import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OUTPUTS } from "./generate-icons.mjs";

// The brand mark lives in one vector path, and 23 committed files are rendered from it. A committed
// generated file is only safe while something re-renders and compares it: editing the path, or
// bumping sharp, otherwise leaves the app shipping icons that no longer match the source.
// bywork/memory/generated-artifacts.md owns that rule.
//
// Rendering happens in a temp root so the guard never writes over the assets it is checking.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tracked(relative) {
  const listed = execFileSync("git", ["ls-files", "--", relative], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  return listed.length > 0;
}

test("every generated icon output is committed", () => {
  const untracked = OUTPUTS.filter((output) => !tracked(output));
  assert.deepEqual(untracked, [], `generated but not committed: ${untracked.join(", ")}`);
});

test("committed component sheet matches a fresh build", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "byspace-sheet-"));
  const built = join(outRoot, "component-sheet.html");
  try {
    execFileSync("python3", ["design/build-sheet.py", built], { cwd: repoRoot, stdio: "pipe" });
    assert.ok(
      readFileSync(built).equals(readFileSync(join(repoRoot, "design/component-sheet.html"))),
      "design/component-sheet.html is stale, run `python3 design/build-sheet.py`",
    );
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});

test("committed icons match a fresh render of the brand mark", () => {
  const outRoot = mkdtempSync(join(tmpdir(), "byspace-icons-"));
  try {
    execFileSync(process.execPath, ["scripts/generate-icons.mjs", outRoot], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    const drifted = OUTPUTS.filter(
      (output) => !readFileSync(join(outRoot, output)).equals(readFileSync(join(repoRoot, output))),
    );
    assert.deepEqual(
      drifted,
      [],
      `stale generated assets, run \`npm run icons:generate\`: ${drifted.join(", ")}`,
    );
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
});
