import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const spawnCounters = vi.hoisted(() => ({
  trackedTextDiffCalls: 0,
  showCalls: 0,
  catFileBatchCalls: 0,
  failBatchedTrackedDiff: false,
  failCatFileBatch: false,
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const [command, commandArgs] = args;
      if (command === "git" && Array.isArray(commandArgs)) {
        const normalizedArgs = commandArgs.map((arg) => String(arg));
        // `runGitCommand` always prepends `-c core.quotepath=false`; skip it to
        // find the actual git subcommand.
        const subcommandIndex =
          normalizedArgs[0] === "-c" && normalizedArgs[1] === "core.quotepath=false" ? 2 : 0;
        const subcommand = normalizedArgs[subcommandIndex];
        const isTrackedTextDiff =
          subcommand === "diff" &&
          normalizedArgs.includes("HEAD") &&
          !normalizedArgs.includes("--numstat") &&
          !normalizedArgs.includes("--no-index") &&
          !normalizedArgs.includes("--shortstat") &&
          !normalizedArgs.includes("--name-status");
        if (isTrackedTextDiff) {
          spawnCounters.trackedTextDiffCalls += 1;
          const separatorIndex = normalizedArgs.lastIndexOf("--");
          if (
            spawnCounters.failBatchedTrackedDiff &&
            normalizedArgs.length - separatorIndex - 1 > 1
          ) {
            throw new Error("simulated command-line limit");
          }
        }
        if (subcommand === "show") {
          spawnCounters.showCalls += 1;
        }
        if (subcommand === "cat-file" && normalizedArgs.includes("--batch")) {
          spawnCounters.catFileBatchCalls += 1;
          if (spawnCounters.failCatFileBatch) {
            throw new Error("simulated cat-file batch failure");
          }
        }
      }
      return actual.spawn(...args);
    },
  };
});

import { getCheckoutDiff } from "./checkout-git.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
  });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }

  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    const setup = initRepoWithTrackedChanges(20);
    tempDir = setup.tempDir;
    repoDir = setup.repoDir;
    spawnCounters.trackedTextDiffCalls = 0;
    spawnCounters.showCalls = 0;
    spawnCounters.catFileBatchCalls = 0;
    spawnCounters.failBatchedTrackedDiff = false;
    spawnCounters.failCatFileBatch = false;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("batches tracked file diffs into bounded git commands", async () => {
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: false,
    });

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-19.txt");
    expect(spawnCounters.trackedTextDiffCalls).toBe(1);
  });

  it("falls back to per-file diffs when a batch cannot spawn", async () => {
    spawnCounters.failBatchedTrackedDiff = true;

    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: false,
    });

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-19.txt");
    expect(spawnCounters.trackedTextDiffCalls).toBe(21);
  });

  it("does not read every historical file to highlight a live structured diff", async () => {
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: true,
    });

    expect(result.structured).toHaveLength(20);
    expect(spawnCounters.trackedTextDiffCalls).toBe(1);
    expect(spawnCounters.showCalls).toBe(0);
    expect(spawnCounters.catFileBatchCalls).toBe(1);
  });

  it("falls back to individual historical reads when cat-file batching fails", async () => {
    spawnCounters.failCatFileBatch = true;

    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: true,
    });

    expect(result.structured).toHaveLength(20);
    expect(spawnCounters.catFileBatchCalls).toBe(1);
    expect(spawnCounters.showCalls).toBe(20);
  });
});
