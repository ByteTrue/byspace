import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  withWorkspaceLifecycleLock,
  withWorkspaceLifecycleLocks,
} from "./workspace-lifecycle-lock.js";

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

test("serializes different paths that mutate the same project", async () => {
  const firstPath = realpathSync(mkdtempSync(path.join(tmpdir(), "workspace-project-lock-a-")));
  const secondPath = realpathSync(mkdtempSync(path.join(tmpdir(), "workspace-project-lock-b-")));
  cleanupPaths.push(firstPath, secondPath);
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstEntered!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let secondRan = false;

  const first = withWorkspaceLifecycleLocks(
    { paths: [firstPath], projectIds: ["project-1"] },
    async () => {
      firstEntered();
      await firstBlocked;
    },
  );
  await firstStarted;
  const second = withWorkspaceLifecycleLocks(
    { paths: [secondPath], projectIds: ["project-1"] },
    async () => {
      secondRan = true;
    },
  );
  await Promise.resolve();
  expect(secondRan).toBe(false);
  releaseFirst();
  await Promise.all([first, second]);
});

test("reenters locks already held by the same async transaction", async () => {
  const target = realpathSync(mkdtempSync(path.join(tmpdir(), "workspace-reentrant-lock-")));
  cleanupPaths.push(target);
  let nestedRan = false;

  await withWorkspaceLifecycleLocks(
    { paths: [target], projectIds: ["project-reentrant"] },
    async () => {
      await withWorkspaceLifecycleLocks(
        { paths: [target], projectIds: ["project-reentrant"] },
        async () => {
          nestedRan = true;
        },
      );
    },
  );
  expect(nestedRan).toBe(true);
});
