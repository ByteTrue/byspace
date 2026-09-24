/**
 * Tests for the group report projection.
 *
 * The report is what a person reads instead of watching the group, so the
 * definitions of "delivered", "waiting on you" and "in progress" are pinned
 * here. They are the same definitions the screen uses, because the screen only
 * renders what this returns.
 */
import { describe, expect, it } from "vitest";

import type {
  AggregatedWorker,
  AggregatedWorkerGroup,
  AggregatedWorkerTask,
} from "@/workers/aggregated-workers";
import {
  buildGroupReport,
  deriveGroupProgress,
  describeGroupBudget,
  orderGroupWork,
  type GroupWorkItem,
} from "@/workers/group-report";

function worker(id: string, name: string, serverId = "s1"): AggregatedWorker {
  return {
    id,
    name,
    templateId: "qa-engineer",
    templateTitle: "QA Engineer",
    templateDescription: "A quality assurance role.",
    status: "online",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    serverId,
    serverName: "host",
  };
}

function task(
  id: string,
  workerId: string,
  state: AggregatedWorkerTask["state"],
  serverId = "s1",
): AggregatedWorkerTask {
  return {
    taskId: id,
    workerId,
    title: `Task ${id}`,
    state,
    agentId: null,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    serverId,
    serverName: "host",
  };
}

function item(state: AggregatedWorkerTask["state"], id = "t1"): GroupWorkItem {
  return {
    taskId: id,
    workerId: "w1",
    workerName: "Alice",
    title: `Task ${id}`,
    state,
    agentId: null,
  };
}

function group(overrides: Partial<AggregatedWorkerGroup> = {}): AggregatedWorkerGroup {
  return {
    id: "grp_1",
    name: "Pricing page",
    projectId: "prj_1",
    workspaceId: null,
    status: "active",
    members: [{ workerId: "w1", role: "coordinator", joinedAt: "2026-09-24T00:00:00.000Z" }],
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    serverId: "s1",
    serverName: "host",
    goal: {
      goalId: "goal_1",
      groupId: "grp_1",
      content: "Deliver the pricing page",
      turnLimit: 12,
      turnUsed: 2,
      status: "active",
      generation: 1,
      revision: 1,
      pauseReason: null,
      resultMessageId: null,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("group progress", () => {
  it("says there is no objective when the group has no goal", () => {
    // A roster can exist before the objective, and an empty report would look
    // like nothing is happening.
    const progress = deriveGroupProgress({
      hasGoal: false,
      goalStatus: null,
      pauseReason: null,
      tasks: [item("in_progress")],
    });
    expect(progress.kind).toBe("no-goal");
    expect(progress.detail).toContain("1 task");
  });

  it("reports nothing handed out when the goal exists but no work does", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [],
    });
    expect(progress).toMatchObject({ kind: "not-started", headline: "Nothing handed out yet" });
  });

  it("reports work in flight", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("in_progress"), item("assigned", "t2")],
    });
    expect(progress).toMatchObject({ kind: "working", headline: "In progress" });
  });

  it("puts work waiting on a person ahead of work in flight", () => {
    // A block nobody hears about is the failure this view exists to prevent.
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("in_progress"), item("blocked", "t2")],
    });
    expect(progress).toMatchObject({ kind: "waiting-on-you", headline: "Waiting on you" });
  });

  it("treats a submitted result as waiting on a person", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("submitted")],
    });
    expect(progress.kind).toBe("waiting-on-you");
  });

  it("reports a completed goal as delivered", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "completed",
      pauseReason: null,
      tasks: [item("completed")],
    });
    expect(progress).toMatchObject({ kind: "delivered", headline: "Delivered" });
  });

  it("does not call a completed goal clean when tasks were left unresolved", () => {
    // Completion is a claim about the objective, not about every task. Reporting
    // it as a clean delivery would hide the tasks nobody resolved.
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "completed",
      pauseReason: null,
      tasks: [item("completed"), item("blocked", "t2")],
    });
    expect(progress).toMatchObject({
      kind: "delivered-with-issues",
      headline: "Delivered, with open issues",
    });
    expect(progress.detail).toContain("1 task");
  });

  it("reports a paused goal as stopped, with its reason", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "paused",
      pauseReason: "awaiting_user",
      tasks: [item("in_progress")],
    });
    expect(progress).toMatchObject({ kind: "stopped", headline: "Stopped" });
    expect(progress.detail).toContain("awaiting_user");
  });

  it("does not report an active goal with only ended tasks as in flight", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("completed")],
    });
    expect(progress.kind).toBe("working");
    expect(progress.detail).toContain("may be between steps");
  });
});

describe("report grammar", () => {
  // Found by reading the rendered screen: the verb has to agree with the count,
  // and "1 task need a decision" is what leaving the caller to add it produced.
  it("agrees with a single task", () => {
    const waiting = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("blocked")],
    });
    expect(waiting.detail).toBe("1 task needs a decision before the group can continue.");

    const noGoal = deriveGroupProgress({
      hasGoal: false,
      goalStatus: null,
      pauseReason: null,
      tasks: [item("in_progress")],
    });
    expect(noGoal.detail).toBe("1 task is assigned with no goal to judge it against.");
  });

  it("agrees with several tasks", () => {
    const waiting = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "active",
      pauseReason: null,
      tasks: [item("blocked"), item("submitted", "t2")],
    });
    expect(waiting.detail).toBe("2 tasks need a decision before the group can continue.");
  });

  it("agrees when a delivered goal left one issue open", () => {
    const progress = deriveGroupProgress({
      hasGoal: true,
      goalStatus: "completed",
      pauseReason: null,
      tasks: [item("completed"), item("blocked", "t2")],
    });
    expect(progress.detail).toContain("1 task ended blocked");
    expect(progress.detail).toContain("it was not resolved");
  });
});

describe("group budget", () => {
  it("reports how much is left", () => {
    expect(describeGroupBudget({ hasGoal: true, turnUsed: 2, turnLimit: 12 })).toBe(
      "2 of 12 public messages used, 10 left",
    );
  });

  it("says so when the budget is spent", () => {
    expect(describeGroupBudget({ hasGoal: true, turnUsed: 12, turnLimit: 12 })).toContain(
      "Budget spent",
    );
  });

  it("says nothing when there is no goal", () => {
    // "0 of 0" would read as an exhausted budget rather than an absent one.
    expect(describeGroupBudget({ hasGoal: false, turnUsed: 0, turnLimit: null })).toBeNull();
  });

  it("says nothing when the goal carries no limit", () => {
    expect(describeGroupBudget({ hasGoal: true, turnUsed: 0, turnLimit: null })).toBeNull();
  });
});

describe("group work ordering", () => {
  it("puts what needs a person first and ended work last", () => {
    const ordered = orderGroupWork([
      item("completed", "done"),
      item("in_progress", "running"),
      item("blocked", "stuck"),
      item("submitted", "review"),
    ]);
    expect(ordered.map((entry) => entry.taskId)).toEqual(["stuck", "review", "running", "done"]);
  });
});

describe("building a group report", () => {
  it("reports the objective and the coordinator by name", () => {
    const report = buildGroupReport({
      group: group(),
      workers: [worker("w1", "Alice")],
      tasks: [],
    });
    expect(report.objective).toBe("Deliver the pricing page");
    expect(report.coordinatorName).toBe("Alice");
  });

  it("leaves the coordinator unnamed when that worker is gone", () => {
    // A departed coordinator is a fact about the group, not a rendering bug.
    const report = buildGroupReport({ group: group(), workers: [], tasks: [] });
    expect(report.coordinatorName).toBeNull();
    expect(report.members[0]?.name).toBeNull();
  });

  it("includes only the group's own members' tasks", () => {
    // Filtering by member rather than by project avoids attributing unrelated
    // work on the same project to this group.
    const report = buildGroupReport({
      group: group(),
      workers: [worker("w1", "Alice"), worker("w2", "Bob")],
      tasks: [task("mine", "w1", "in_progress"), task("theirs", "w2", "in_progress")],
    });
    expect(report.work.map((entry) => entry.taskId)).toEqual(["mine"]);
  });

  it("excludes tasks from another host", () => {
    const report = buildGroupReport({
      group: group(),
      workers: [worker("w1", "Alice")],
      tasks: [task("local", "w1", "in_progress", "s1"), task("remote", "w1", "in_progress", "s2")],
    });
    expect(report.work.map((entry) => entry.taskId)).toEqual(["local"]);
  });

  it("carries the budget through, and omits it when there is no goal", () => {
    const withGoal = buildGroupReport({ group: group(), workers: [], tasks: [] });
    expect(withGoal.budgetLine).toContain("2 of 12");

    const withoutGoal = buildGroupReport({
      group: group({ goal: null }),
      workers: [],
      tasks: [],
    });
    expect(withoutGoal.budgetLine).toBeNull();
    expect(withoutGoal.progress.kind).toBe("no-goal");
  });
});
