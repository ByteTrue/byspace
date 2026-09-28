/**
 * Tests for the store: the query layer over the migrated schema.
 *
 * The contracts worth pinning map to the source's sqlc queries: issue numbers
 * are allocated atomically and without gaps or duplicates, the optional-filter
 * list shape, and the revision-checked status update that refuses a stale
 * write instead of overwriting a concurrent winner.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  store = new MulticaStore(db, { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("issue store", () => {
  it("creates an issue with an allocated number and reads it back", () => {
    const issue = store.createIssue({
      title: "Ship the board",
      creatorType: "owner",
      creatorId: "owner",
    });
    expect(issue.number).toBe(1);
    expect(issue.status).toBe("backlog");
    expect(issue.revision).toBe(1);
    expect(store.getIssue(issue.id).title).toBe("Ship the board");
  });

  it("allocates sequential numbers without duplicates", () => {
    const a = store.createIssue({ title: "a", creatorType: "owner", creatorId: "owner" });
    const b = store.createIssue({ title: "b", creatorType: "owner", creatorId: "owner" });
    const c = store.createIssue({ title: "c", creatorType: "owner", creatorId: "owner" });
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
  });

  it("accepts the source's assignee and project linkage on create", () => {
    // The linkage is a foreign key: the project must exist first, exactly as
    // the source's handler validates before insert.
    db.prepare("INSERT INTO project (id, title) VALUES ('project-1', 'P')").run();
    const issue = store.createIssue({
      title: "with assignee",
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: "agent",
      assigneeId: "agent-1",
      projectId: "project-1",
      status: "todo",
      priority: "high",
    });
    expect(issue.assigneeType).toBe("agent");
    expect(issue.status).toBe("todo");
    expect(issue.priority).toBe("high");
  });

  it("filters lists by status and assignee, newest first", () => {
    store.createIssue({ title: "one", creatorType: "owner", creatorId: "owner" });
    store.createIssue({
      title: "two",
      creatorType: "owner",
      creatorId: "owner",
      status: "todo",
    });
    const todo = store.listIssues({ status: "todo" });
    expect(todo).toHaveLength(1);
    expect(todo[0].title).toBe("two");
    const all = store.listIssues({});
    expect(all).toHaveLength(2);
    // Newest first; the same-millisecond tie breaks on the number, which is
    // the source's position-then-created ordering made deterministic.
    expect(all[0].title).toBe("two");
  });

  it("updates status with revision optimism and refuses a stale write", () => {
    const issue = store.createIssue({ title: "t", creatorType: "owner", creatorId: "owner" });
    const first = store.updateIssueStatus({
      id: issue.id,
      status: "in_progress",
      expectedRevision: issue.revision,
    });
    expect(first.status).toBe("in_progress");
    expect(first.revision).toBe(2);

    // A stale writer holding revision 1 must be refused, not silently lose.
    expect(() =>
      store.updateIssueStatus({ id: issue.id, status: "done", expectedRevision: 1 }),
    ).toThrow(/changed since revision 1/);
    // The winner's write is intact.
    expect(store.getIssue(issue.id).status).toBe("in_progress");
  });

  it("throws for an unknown issue id", () => {
    expect(() => store.getIssue("missing")).toThrow(/issue not found/);
  });
});

describe("status catalog", () => {
  it("lists the seven built-ins in position order", () => {
    const statuses = store.listIssueStatuses();
    expect(statuses.map((status) => status.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "blocked",
      "cancelled",
    ]);
    expect(statuses.every((status) => status.isSystem)).toBe(true);
  });
});

describe("position semantics", () => {
  it("a new issue lands on top of its column", () => {
    const first = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const second = store.createIssue({ title: "B", creatorType: "owner", creatorId: "owner" });
    expect(second.position).toBeLessThan(first.position);
    expect(store.listIssues({})[0].title).toBe("B");
  });

  it("a status change without a position re-ranks to the top of the target column", () => {
    const a = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const b = store.createIssue({ title: "B", creatorType: "owner", creatorId: "owner" });
    // A sits below B in backlog; move A to todo, then B to todo: B must land
    // above A, not inherit A's backlog rank.
    store.updateIssueStatus({ id: a.id, status: "todo", expectedRevision: a.revision });
    store.updateIssueStatus({ id: b.id, status: "todo", expectedRevision: b.revision });
    const todo = store.listIssues({}).filter((issue) => issue.status === "todo");
    expect(todo.map((issue) => issue.title)).toEqual(["B", "A"]);
  });

  it("an explicit position is the drop slot", () => {
    const a = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const b = store.createIssue({ title: "B", creatorType: "owner", creatorId: "owner" });
    // Drop A between nothing and B's rank: an explicit position wins even
    // though the status also changes.
    store.updateIssueStatus({
      id: a.id,
      status: "in_progress",
      expectedRevision: a.revision,
      position: b.position + 100,
    });
    expect(store.getIssue(a.id).position).toBe(b.position + 100);
  });

  it("same-column moves with an explicit position never tie", () => {
    const a = store.createIssue({
      title: "A",
      creatorType: "owner",
      creatorId: "owner",
      status: "todo",
    });
    const b = store.createIssue({
      title: "B",
      creatorType: "owner",
      creatorId: "owner",
      status: "todo",
    });
    const moved = store.updateIssue({
      id: b.id,
      expectedRevision: b.revision,
      position: a.position - 0.5,
    });
    expect(moved.position).toBeLessThan(a.position);
    const order = store
      .listIssues({})
      .filter((issue) => issue.status === "todo")
      .map((issue) => issue.title);
    expect(order).toEqual(["B", "A"]);
  });
});

describe("activity log", () => {
  it("records creation and each changed field, and nothing else", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    store.updateIssue({
      id: issue.id,
      expectedRevision: issue.revision,
      status: "todo",
      title: "A", // unchanged: must not appear
    });
    const actions = store.listActivitiesForIssue(issue.id).map((entry) => entry.action);
    expect(actions).toEqual(["created", "status_changed"]);
    const statusEntry = store.listActivitiesForIssue(issue.id)[1];
    expect(JSON.parse(statusEntry.details)).toEqual({ from: "backlog", to: "todo" });
  });

  it("records task outcomes only for tasks that have an issue", () => {
    const agent = store.createAgent({ name: "Log" });
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    store.recordActivity({
      issueId: issue.id,
      actorType: "agent",
      actorId: agent.id,
      action: "task_completed",
    });
    store.recordActivity({ issueId: null, actorType: "agent", actorId: agent.id, action: "x" });
    const actions = store.listActivitiesForIssue(issue.id).map((entry) => entry.action);
    expect(actions).toContain("task_completed");
    expect(actions).not.toContain("x");
  });
});
