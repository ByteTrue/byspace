/**
 * The wakeup behavior layer's load-bearing semantics, each pinned by a test
 * that fails if the semantic silently changes:
 *
 *   - an event capture writes one receipt per matching subscription;
 *   - the self-trigger guard: a run never wakes the subscription it itself
 *     registered (source_task_id), nor a task whose context names it;
 *   - receipts are idempotent by (wakeup, revision, event_key);
 *   - a closed issue stops waking;
 *   - dispatch enqueues a run carrying the wakeup identity, settles the
 *     receipts, and advances a continuous time-kind or retires a once/at.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;

const FIXED_NOW = new Date("2026-09-28T12:00:00.000Z");

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

const seedIssue = () =>
  store.createIssue({ title: "Work", creatorType: "owner", creatorId: "owner" });

describe("wakeup capture", () => {
  it("one receipt per matching subscription", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "check on completion",
      kind: "event",
      mode: "continuous",
      eventTypes: ["task.completed"],
    });
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "unrelated event",
      kind: "event",
      mode: "continuous",
      eventTypes: ["comment.created"],
    });

    const worker = store.createAgent({ name: "Worker" });
    const task = store.createTask({ issueId: issue.id, agentId: worker.id });
    store.updateTaskStatus({ id: task.id, status: "completed" });

    const ready = store.listReadyWakeups(FIXED_NOW);
    expect(ready).toHaveLength(1);
    expect(ready[0].wakeup.instruction).toBe("check on completion");
    expect(ready[0].evidence[0]).toMatchObject({ status: "completed" });
  });

  it("a run never wakes the subscription it registered itself", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    const ownTask = store.createTask({ issueId: issue.id, agentId: agent.id });
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: agent.id,
      instruction: "follow up when my run finishes",
      kind: "event",
      mode: "continuous",
      eventTypes: ["task.completed"],
      sourceTaskId: ownTask.id,
    });

    store.updateTaskStatus({ id: ownTask.id, status: "completed" });

    expect(store.listReadyWakeups(FIXED_NOW)).toHaveLength(0);
  });

  it("a task whose context names the wakeup never re-triggers it", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    const wakeup = store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "recurring check",
      kind: "event",
      mode: "continuous",
      eventTypes: ["task.completed"],
    });
    const spawned = store.createTask({
      issueId: issue.id,
      agentId: agent.id,
      context: { wakeup_id: wakeup.id, wakeup_revision: wakeup.revision },
    });

    store.updateTaskStatus({ id: spawned.id, status: "completed" });

    expect(store.listReadyWakeups(FIXED_NOW)).toHaveLength(0);
  });

  it("receipts are idempotent by (wakeup, revision, event_key)", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "watch status",
      kind: "event",
      mode: "continuous",
      eventTypes: ["issue.status_changed"],
    });

    const first = store.captureWakeups({
      issueId: issue.id,
      type: "issue.status_changed",
      key: "same-key",
      agentId: null,
      taskId: null,
      payload: { to: "in_progress" },
    });
    const second = store.captureWakeups({
      issueId: issue.id,
      type: "issue.status_changed",
      key: "same-key",
      agentId: null,
      taskId: null,
      payload: { to: "in_progress" },
    });

    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

describe("wakeup lifecycle", () => {
  it("a closed issue stops waking", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "watch status",
      kind: "event",
      mode: "continuous",
      eventTypes: ["issue.status_changed"],
    });

    const fresh = store.getIssue(issue.id);
    store.updateIssueStatus({ id: issue.id, status: "done", expectedRevision: fresh.revision });
    const doneIssue = store.getIssue(issue.id);

    // Further captures on a closed issue produce nothing.
    const captured = store.captureWakeups({
      issueId: issue.id,
      type: "issue.status_changed",
      key: `${issue.id}:${doneIssue.revision}:late`,
      agentId: null,
      taskId: null,
      payload: { to: "in_review" },
    });
    expect(captured).toBe(0);
    expect(store.listWakeupsForIssue(issue.id)[0].enabled).toBe(false);
  });

  it("dispatch enqueues a run carrying the wakeup identity and settles receipts", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    const wakeup = store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "recurring check",
      kind: "event",
      mode: "continuous",
      eventTypes: ["issue.status_changed"],
    });
    const fresh = store.getIssue(issue.id);
    store.updateIssueStatus({
      id: issue.id,
      status: "in_progress",
      expectedRevision: fresh.revision,
    });

    const [ready] = store.listReadyWakeups(FIXED_NOW);
    const taskId = store.dispatchWakeup(ready.wakeup, ready.evidence, FIXED_NOW);

    const task = store.getTask(taskId);
    expect(task.agentId).toBe(agent.id);
    expect(JSON.parse(task.context ?? "{}")).toMatchObject({
      wakeup_id: wakeup.id,
      wakeup_revision: wakeup.revision,
    });
    // Receipts settled: nothing ready again for the same evidence.
    expect(store.listReadyWakeups(FIXED_NOW)).toHaveLength(0);
    // Continuous event subscriptions stay enabled.
    expect(store.getWakeup(wakeup.id).enabled).toBe(true);
  });

  it("a once-mode wakeup retires after its dispatch", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    const wakeup = store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "one-shot watch",
      kind: "event",
      mode: "once",
      eventTypes: ["issue.status_changed"],
    });
    const fresh = store.getIssue(issue.id);
    store.updateIssueStatus({
      id: issue.id,
      status: "in_progress",
      expectedRevision: fresh.revision,
    });

    const [ready] = store.listReadyWakeups(FIXED_NOW);
    store.dispatchWakeup(ready.wakeup, ready.evidence, FIXED_NOW);

    expect(store.getWakeup(wakeup.id).enabled).toBe(false);
  });

  it("an every-kind advances its next fire on dispatch", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    const wakeup = store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "hourly check",
      kind: "every",
      mode: "continuous",
      intervalSeconds: 3600,
    });
    expect(store.getWakeup(wakeup.id).nextFireAt).not.toBeNull();

    const [ready] = store.listReadyWakeups(new Date("2026-09-28T13:00:00.000Z"));
    store.dispatchWakeup(ready.wakeup, ready.evidence, new Date("2026-09-28T13:00:00.000Z"));

    const next = store.getWakeup(wakeup.id).nextFireAt;
    expect(next).toBe("2026-09-28T14:00:00.000Z");
    expect(store.getWakeup(wakeup.id).enabled).toBe(true);
  });

  it("a time-kind before its fire is not ready", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "later",
      kind: "at",
      mode: "once",
      at: "2026-09-28T18:00:00.000Z",
    });
    expect(store.listReadyWakeups(FIXED_NOW)).toHaveLength(0);
    expect(store.listReadyWakeups(new Date("2026-09-28T18:00:01.000Z"))).toHaveLength(1);
  });

  it("expired processed receipts age out", () => {
    const agent = store.createAgent({ name: "Secretary" });
    const issue = seedIssue();
    store.createWakeup({
      issueId: issue.id,
      agentId: agent.id,
      createdBy: "owner",
      instruction: "watch",
      kind: "event",
      mode: "once",
      eventTypes: ["issue.status_changed"],
    });
    const fresh = store.getIssue(issue.id);
    store.updateIssueStatus({
      id: issue.id,
      status: "in_progress",
      expectedRevision: fresh.revision,
    });
    const [ready] = store.listReadyWakeups(FIXED_NOW);
    store.dispatchWakeup(ready.wakeup, ready.evidence, FIXED_NOW);

    const purged = store.purgeExpiredReceipts(new Date("2026-10-06T00:00:00.000Z"));
    expect(purged).toBeGreaterThan(0);
  });
});
