import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { withWorkspaceLifecycleLock } from "./workspace-lifecycle-lock.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) rmSync(target, { recursive: true, force: true });
});

test("serializes lifecycle operations for the same filesystem path", async () => {
  const target = realpathSync(mkdtempSync(path.join(tmpdir(), "workspace-lifecycle-lock-")));
  cleanupPaths.push(target);
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstEntered!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let secondRan = false;

  const first = withWorkspaceLifecycleLock(target, async () => {
    firstEntered();
    await firstBlocked;
  });
  await firstStarted;
  const second = withWorkspaceLifecycleLock(target, async () => {
    secondRan = true;
  });

  await Promise.resolve();
  expect(secondRan).toBe(false);
  releaseFirst();
  await Promise.all([first, second]);
  expect(secondRan).toBe(true);
});
