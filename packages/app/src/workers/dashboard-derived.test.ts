/**
 * Tests for the dashboard projections.
 *
 * These decide what the four stat cards and the "needs attention" queue mean, so
 * they are worth pinning: a bucket that quietly absorbs the wrong states would
 * misreport an operator's workload rather than fail visibly.
 */
import { describe, expect, it } from "vitest";

import type { AggregatedWorkerTask, WorkerTaskState } from "./aggregated-workers";
import {
  countWorkerTasks,
  describeRosterActivity,
  selectAttentionTasks,
} from "./dashboard-derived";

function task(state: WorkerTaskState, overrides: Partial<AggregatedWorkerTask> = {}) {
  return {
    taskId: `wtk_${state}`,
    workerId: "wkr_1",
    title: `a ${state} task`,
    state,
    agentId: null,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    serverId: "srv_a",
    serverName: "Alpha",
    ...overrides,
  } satisfies AggregatedWorkerTask;
}

describe("countWorkerTasks", () => {
  it("counts nothing as zero rather than undefined", () => {
    expect(countWorkerTasks([])).toEqual({ total: 0, active: 0, actionRequired: 0, ended: 0 });
  });

  it("counts in-flight work as active", () => {
    const counts = countWorkerTasks([
      task("planned"),
      task("prepared"),
      task("assigned"),
      task("in_progress"),
    ]);
    expect(counts.active).toBe(4);
    expect(counts.actionRequired).toBe(0);
    expect(counts.ended).toBe(0);
    expect(counts.total).toBe(4);
  });

  it("treats submitted work as waiting on a person, not as in flight", () => {
    // A submitted task is not being worked on; it is queued behind the user.
    const counts = countWorkerTasks([task("submitted")]);
    expect(counts.actionRequired).toBe(1);
    expect(counts.active).toBe(0);
  });

  it("treats blocked work as needing a person too", () => {
    const counts = countWorkerTasks([task("blocked")]);
    expect(counts.actionRequired).toBe(1);
  });

  it("treats planned work as active rather than as needing attention", () => {
    // Nobody has been asked to do anything yet, so it is not the user's queue.
    const counts = countWorkerTasks([task("planned")]);
    expect(counts.actionRequired).toBe(0);
    expect(counts.active).toBe(1);
  });

  it("counts every terminal state as ended", () => {
    const counts = countWorkerTasks([
      task("completed"),
      task("revision", { taskId: "t2" }),
      task("blocked", { taskId: "t3" }),
      task("cancelled", { taskId: "t4" }),
    ]);
    expect(counts.ended).toBe(4);
  });

  it("classifies every state exactly once across the three buckets", () => {
    // Exhaustive so a new state cannot be added without deciding where it goes.
    const states: WorkerTaskState[] = [
      "planned",
      "prepared",
      "assigned",
      "in_progress",
      "submitted",
      "completed",
      "revision",
      "blocked",
      "cancelled",
    ];
    expect(states).toHaveLength(9);
    for (const state of states) {
      const single = countWorkerTasks([task(state)]);
      const buckets = single.active + single.actionRequired + single.ended;
      // `blocked` is deliberately in two buckets: it needs a person and it is
      // over. Everything else belongs to exactly one.
      expect(single.total, state).toBe(1);
      if (state === "blocked") {
        expect(buckets, state).toBe(2);
      } else {
        expect(buckets, state).toBe(1);
      }
    }
  });
});

describe("selectAttentionTasks", () => {
  it("splits results to review from problems to unblock", () => {
    const result = selectAttentionTasks([task("submitted"), task("blocked")]);
    expect(result.review.map((t) => t.state)).toEqual(["submitted"]);
    expect(result.unblock.map((t) => t.state)).toEqual(["blocked"]);
  });

  it("ignores tasks nobody is waiting on", () => {
    const result = selectAttentionTasks([task("planned"), task("in_progress"), task("completed")]);
    expect(result.review).toEqual([]);
    expect(result.unblock).toEqual([]);
  });

  it("orders each queue by most recent activity", () => {
    const older = task("submitted", { taskId: "old", updatedAt: "2026-09-24T00:00:00.000Z" });
    const newer = task("submitted", { taskId: "new", updatedAt: "2026-09-24T05:00:00.000Z" });
    const result = selectAttentionTasks([older, newer]);
    expect(result.review.map((t) => t.taskId)).toEqual(["new", "old"]);
  });
});

describe("describeRosterActivity", () => {
  it("says nothing has been handed out when the board is empty", () => {
    expect(describeRosterActivity({ total: 0, active: 0, actionRequired: 0, ended: 0 })).toBe(
      "No work has been handed out yet",
    );
  });

  it("says it is waiting on the user when only they can move things", () => {
    expect(describeRosterActivity({ total: 1, active: 0, actionRequired: 1, ended: 0 })).toBe(
      "Waiting on you",
    );
  });

  it("does not claim work is in flight when nothing is active", () => {
    expect(describeRosterActivity({ total: 1, active: 0, actionRequired: 0, ended: 1 })).toBe(
      "The workers are idle",
    );
  });

  it("reports the number of tasks in flight, singular and plural", () => {
    expect(describeRosterActivity({ total: 1, active: 1, actionRequired: 0, ended: 0 })).toBe(
      "1 task in flight",
    );
    expect(describeRosterActivity({ total: 3, active: 3, actionRequired: 0, ended: 0 })).toBe(
      "3 tasks in flight",
    );
  });
});
