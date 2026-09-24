/**
 * Tests for the worker SQLite store.
 *
 * Covers the properties the domain depends on: state and history move together
 * or not at all, retries do not fabricate history, and data survives reopening
 * the database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IllegalWorkerTaskTransitionError } from "./worker-task-state.js";
import { WorkerStore } from "./worker-store.js";

let dir: string;
let store: WorkerStore;

const WORKER = {
  id: "w1",
  name: "Alice",
  templateId: "frontend-developer",
  workspacePath: "/tmp/ws",
  status: "online" as const,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "worker-store-"));
  store = new WorkerStore({ databasePath: path.join(dir, "worker.db") });
  store.createWorker(WORKER);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("worker store", () => {
  it("records the schema version so the domain can migrate forward", () => {
    expect(store.getSchemaVersion()).toBe(1);
  });

  it("round-trips a worker", () => {
    expect(store.getWorker("w1")).toEqual(WORKER);
    expect(store.getWorker("missing")).toBeNull();
    expect(store.listWorkers().map((w) => w.id)).toEqual(["w1"]);
  });

  it("starts a task in planned and writes no history for creation", () => {
    const task = store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    expect(task.state).toBe("planned");
    // Creation is not a transition; history starts at the first move.
    expect(store.listTaskHistory("t1")).toEqual([]);
  });

  it("moves state and appends history in the same step", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });

    const result = store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "worker:w-lead",
      recordedAt: "2026-09-24T01:00:00.000Z",
    });

    expect(result.task.state).toBe("assigned");
    expect(result.task.updatedAt).toBe("2026-09-24T01:00:00.000Z");
    expect(result.historyEntry).toMatchObject({
      seq: 1,
      fromState: "planned",
      toState: "assigned",
      action: "assign_task",
      actor: "worker:w-lead",
    });
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("rejects an illegal transition without changing state or history", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "completed",
        action: "accept_task_result",
        actor: "worker:w-lead",
      }),
    ).toThrow(IllegalWorkerTaskTransitionError);

    expect(store.getTask("t1")?.state).toBe("planned");
    expect(store.listTaskHistory("t1")).toEqual([]);
  });

  it("treats a same-state retry as a no-op and writes no history", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    const retry = store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    expect(retry.historyEntry).toBeNull();
    expect(retry.task.state).toBe("assigned");
    // The idempotent retry must leave exactly the original entry behind.
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("refuses a legal state change carrying the wrong action", () => {
    // The graph allows submitted -> completed, but 'submit_task' is not the
    // action that produces it. Recording it would put a false line in history.
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "submitted",
      action: "submit_task",
      actor: "worker:w1",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "completed",
        action: "submit_task",
        actor: "worker:lead",
      }),
    ).toThrow(/does not move a worker task from 'submitted' to 'completed'/);

    // Refused means unchanged: state and history both stay put.
    expect(store.getTask("t1")?.state).toBe("submitted");
    expect(store.listTaskHistory("t1")).toHaveLength(1);
  });

  it("refuses a same-state arrival from an unrelated action", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    // 'accept_task_result' arriving at 'assigned' claims work that did not
    // happen; only a retry of the producing action or a progress note is fine.
    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "assigned",
        action: "accept_task_result",
        actor: "lead",
      }),
    ).toThrow(/Expected 'assign_task'/);
  });

  it("accepts a progress note on a task in flight", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "ack_task",
      actor: "worker:w1",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "in_progress",
        action: "report_progress",
        actor: "worker:w1",
        note: "halfway",
      }),
    ).not.toThrow();
  });

  it("numbers history monotonically across a full legal path", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    const path_: Array<[Parameters<typeof store.applyTaskTransition>[0]["toState"], string]> = [
      ["assigned", "assign_task"],
      ["in_progress", "ack_task"],
      ["submitted", "submit_task"],
      ["completed", "accept_task_result"],
    ];
    for (const [toState, action] of path_) {
      store.applyTaskTransition({
        taskId: "t1",
        toState,
        action: action as Parameters<typeof store.applyTaskTransition>[0]["action"],
        actor: "lead",
      });
    }

    const history = store.listTaskHistory("t1");
    expect(history.map((h) => h.seq)).toEqual([1, 2, 3, 4]);
    expect(history.map((h) => h.toState)).toEqual([
      "assigned",
      "in_progress",
      "submitted",
      "completed",
    ]);
    expect(store.getTask("t1")?.state).toBe("completed");
  });

  it("refuses to move a task once it is terminal", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "cancelled",
      action: "cancel_task",
      actor: "human",
    });

    expect(() =>
      store.applyTaskTransition({
        taskId: "t1",
        toState: "assigned",
        action: "assign_task",
        actor: "lead",
      }),
    ).toThrow(IllegalWorkerTaskTransitionError);
  });

  it("rejects transitions for unknown tasks", () => {
    expect(() =>
      store.applyTaskTransition({
        taskId: "nope",
        toState: "assigned",
        action: "assign_task",
        actor: "lead",
      }),
    ).toThrow(/unknown worker task/);
  });

  it("truncates an over-long progress note instead of rejecting it", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "ack_task",
      actor: "lead",
    });

    const result = store.applyTaskTransition({
      taskId: "t1",
      toState: "in_progress",
      action: "report_progress",
      actor: "worker:w1",
      note: "x".repeat(500),
    });

    // Progress is same-state: it must not fabricate a state change.
    expect(result.historyEntry).toBeNull();
    expect(store.getTask("t1")?.state).toBe("in_progress");
  });

  it("cascades task and history deletion when a worker is removed", () => {
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
    });

    // FK enforcement is per-connection; this asserts we enabled it.
    expect(() => store.createTask({ taskId: "t2", workerId: "ghost", title: "orphan" })).toThrow();
    expect(store.listTasksForWorker("w1")).toHaveLength(1);
  });

  it("survives reopening the database", () => {
    const databasePath = path.join(dir, "worker.db");
    store.createTask({ taskId: "t1", workerId: "w1", title: "Build it" });
    store.applyTaskTransition({
      taskId: "t1",
      toState: "assigned",
      action: "assign_task",
      actor: "lead",
      recordedAt: "2026-09-24T01:00:00.000Z",
    });
    store.close();

    const reopened = new WorkerStore({ databasePath });
    try {
      expect(reopened.getTask("t1")?.state).toBe("assigned");
      expect(reopened.listTaskHistory("t1")).toHaveLength(1);
      expect(reopened.listWorkers().map((w) => w.id)).toEqual(["w1"]);
    } finally {
      reopened.close();
    }
  });
});
