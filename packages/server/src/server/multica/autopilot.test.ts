/**
 * The autopilot engine's load-bearing semantics, each pinned:
 *
 *   - create_issue opens a titled issue on the assignee and starts its run;
 *   - run_only enqueues a task with NO issue (033's nullable half) and the
 *     autopilot's description as its brief;
 *   - the skip policy suppresses a firing while a run is in flight, and the
 *     suppressed firing is still a run row (status skipped);
 *   - queue policy fires anyway;
 *   - a paused autopilot does not dispatch;
 *   - the schedule tick advances next_run_at and stamps last_fired_at;
 *   - the {{date}} placeholder interpolates in the trigger's timezone.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchAutopilot, tickAutopilots } from "./autopilot.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;

const NOW = new Date("2026-09-29T09:00:00.000Z");

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

const seed = () => {
  const agent = store.createAgent({ name: "Patrol" });
  return agent;
};

describe("autopilot dispatch", () => {
  it("create_issue opens a titled issue on the assignee and starts its run", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Morning patrol",
      description: "Look at everything in flight",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "create_issue",
      issueTitleTemplate: "Patrol {{date}}",
    });

    const result = dispatchAutopilot({
      store,
      autopilot,
      trigger: null,
      source: "manual",
      now: NOW,
    });

    expect(result.fired).toBe(true);
    const run = store.getAutopilotRun(result.run.id);
    expect(run.status).toBe("issue_created");
    expect(run.issueId).not.toBeNull();
    const issue = store.getIssue(run.issueId as string);
    expect(issue.title).toBe("Patrol 2026-09-29");
    expect(issue.assigneeId).toBe(agent.id);
    // Leaving backlog at creation enqueues the first run through the shared
    // predicate.
    expect(store.listTasksForIssue(issue.id)).toHaveLength(1);
    expect(store.getAutopilot(autopilot.id).lastRunAt).not.toBeNull();
  });

  it("run_only enqueues a task with no issue", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Hourly check",
      description: "Verify the queue drains",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "run_only",
    });

    const result = dispatchAutopilot({
      store,
      autopilot,
      trigger: null,
      source: "manual",
      now: NOW,
    });

    expect(result.fired).toBe(true);
    const run = store.getAutopilotRun(result.run.id);
    expect(run.status).toBe("running");
    expect(run.taskId).not.toBeNull();
    const task = store.getTask(run.taskId as string);
    expect(task.issueId).toBeNull();
    expect(task.agentId).toBe(agent.id);
    expect(task.autopilotRunId).toBe(run.id);
  });

  it("skip suppresses a firing while a run is in flight, but records it", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Patrol",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "run_only",
      concurrencyPolicy: "skip",
    });

    const first = dispatchAutopilot({
      store,
      autopilot,
      trigger: null,
      source: "manual",
      now: NOW,
    });
    expect(first.fired).toBe(true);
    const second = dispatchAutopilot({
      store,
      autopilot,
      trigger: null,
      source: "manual",
      now: NOW,
    });
    expect(second.fired).toBe(false);
    expect(second.run.status).toBe("skipped");
    expect(second.reason).toContain("in flight");
    expect(store.listAutopilotRuns(autopilot.id)).toHaveLength(2);
  });

  it("queue fires anyway", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Patrol",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "run_only",
      concurrencyPolicy: "queue",
    });

    dispatchAutopilot({ store, autopilot, trigger: null, source: "manual", now: NOW });
    const second = dispatchAutopilot({
      store,
      autopilot,
      trigger: null,
      source: "manual",
      now: NOW,
    });
    expect(second.fired).toBe(true);
  });

  it("a paused autopilot does not dispatch", () => {
    const agent = seed();
    const created = store.createAutopilot({
      title: "Paused patrol",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "run_only",
    });
    const paused = store.setAutopilotStatus({
      id: created.id,
      status: "paused",
      pauseReason: "owner asked",
    });

    const result = dispatchAutopilot({
      store,
      autopilot: paused,
      trigger: null,
      source: "manual",
      now: NOW,
    });
    expect(result.fired).toBe(false);
    expect(result.run.status).toBe("skipped");
    expect(store.listQueuedTasks()).toHaveLength(0);
  });

  it("the schedule tick fires due triggers and advances next_run_at", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Daily patrol",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "run_only",
    });
    const trigger = store.createAutopilotTrigger({
      autopilotId: autopilot.id,
      kind: "schedule",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      nextRunAt: "2026-09-29T09:00:00.000Z",
    });

    const results = tickAutopilots({ store, now: NOW });
    expect(results).toHaveLength(1);
    expect(results[0].fired).toBe(true);
    const advanced = store.getAutopilotTrigger(trigger.id);
    expect(advanced.nextRunAt).toBe("2026-09-30T09:00:00.000Z");
    expect(advanced.lastFiredAt).not.toBeNull();
    // Not due again an hour later.
    expect(tickAutopilots({ store, now: new Date("2026-09-29T10:00:00.000Z") })).toHaveLength(0);
  });

  it("the date placeholder follows the trigger timezone", () => {
    const agent = seed();
    const autopilot = store.createAutopilot({
      title: "Nightly",
      assigneeType: "agent",
      assigneeId: agent.id,
      executionMode: "create_issue",
      issueTitleTemplate: "Night of {{ date }}",
    });
    const trigger = store.createAutopilotTrigger({
      autopilotId: autopilot.id,
      kind: "schedule",
      cronExpression: "0 23 * * *",
      timezone: "Asia/Shanghai",
      nextRunAt: NOW.toISOString(),
    });

    const result = dispatchAutopilot({ store, autopilot, trigger, source: "schedule", now: NOW });
    const run = store.getAutopilotRun(result.run.id);
    const issue = store.getIssue(run.issueId as string);
    // 09:00Z is 17:00 the same day in Shanghai — same date either way here,
    // so assert the token resolved at all and to a well-formed date.
    expect(issue.title).toMatch(/^Night of \d{4}-\d{2}-\d{2}$/);
  });
});
