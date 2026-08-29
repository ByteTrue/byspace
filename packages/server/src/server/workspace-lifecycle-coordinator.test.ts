import { expect, test } from "vitest";

import { WorkspaceLifecycleCoordinator } from "./workspace-lifecycle-coordinator.js";

async function queueEscapedOperation(
  coordinator: WorkspaceLifecycleCoordinator,
  gate: Promise<void>,
  events: string[],
): Promise<void> {
  await gate;
  await coordinator.runExclusive(async () => {
    events.push("escaped");
  });
}

test("serializes create, cascade remove, and path archive barriers", async () => {
  const coordinator = new WorkspaceLifecycleCoordinator();
  const events: string[] = [];
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const create = coordinator.runExclusive(async () => {
    events.push("create:start");
    await createGate;
    events.push("create:registered");
  });
  const remove = coordinator.runExclusive(async () => {
    events.push("remove:cascade");
  });
  const archive = coordinator.runExclusive(async () => {
    events.push("archive:check-delete");
  });
  await Promise.resolve();
  expect(events).toEqual(["create:start"]);
  releaseCreate();
  await Promise.all([create, remove, archive]);
  expect(events).toEqual([
    "create:start",
    "create:registered",
    "remove:cascade",
    "archive:check-delete",
  ]);
});

test("allows a lifecycle operation to reenter without deadlocking", async () => {
  const coordinator = new WorkspaceLifecycleCoordinator();
  const events: string[] = [];

  await coordinator.runExclusive(async () => {
    events.push("outer:start");
    await coordinator.runExclusive(async () => {
      events.push("inner");
    });
    events.push("outer:end");
  });

  expect(events).toEqual(["outer:start", "inner", "outer:end"]);
});

test("does not let escaped async work retain reentrant access after its operation settles", async () => {
  const coordinator = new WorkspaceLifecycleCoordinator();
  const events: string[] = [];
  let releaseEscaped!: () => void;
  const escapedGate = new Promise<void>((resolve) => {
    releaseEscaped = resolve;
  });
  let escaped!: Promise<void>;

  await coordinator.runExclusive(async () => {
    escaped = queueEscapedOperation(coordinator, escapedGate, events);
  });

  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  let currentStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    currentStarted = resolve;
  });
  const current = coordinator.runExclusive(async () => {
    events.push("current:start");
    currentStarted();
    await currentGate;
    events.push("current:end");
  });
  await started;

  releaseEscaped();
  await Promise.resolve();
  expect(events).toEqual(["current:start"]);

  releaseCurrent();
  await Promise.all([current, escaped]);
  expect(events).toEqual(["current:start", "current:end", "escaped"]);
});
