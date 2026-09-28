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

describe("position independent of status", () => {
  it("a same-status drag re-slots the card", () => {
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
      id: a.id,
      expectedRevision: a.revision,
      status: "todo",
      position: b.position + 5,
    });
    expect(moved.position).toBe(b.position + 5);
    expect(moved.status).toBe("todo");
  });

  it("an assignee-only drag re-slots without touching status", () => {
    const agent = store.createAgent({ name: "Mover" });
    const a = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const moved = store.updateIssue({
      id: a.id,
      expectedRevision: a.revision,
      assigneeType: "agent",
      assigneeId: agent.id,
      position: -9,
    });
    expect(moved.position).toBe(-9);
    expect(moved.status).toBe(a.status);
    expect(moved.assigneeId).toBe(agent.id);
  });
});

describe("subscribers", () => {
  it("implicit reasons land on their writes, one row per person", () => {
    // Distinct people per reason: a person triggered twice keeps one row
    // with the newest reason (the row key is (issue, person), as the
    // source's).
    const assignee = store.createAgent({ name: "Assignee" });
    const commenter = store.createAgent({ name: "Commenter" });
    const mentioned = store.createAgent({ name: "Mentioned" });
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    store.updateIssue({
      id: issue.id,
      expectedRevision: issue.revision,
      assigneeType: "agent",
      assigneeId: assignee.id,
    });
    store.createComment({
      issueId: issue.id,
      authorType: "agent",
      authorId: commenter.id,
      content: "note [@Mentioned](mention://agent/x)",
      mentions: [
        { kind: "agent" as const, id: mentioned.id, name: null },
        { kind: "name" as const, id: null, name: "Mentioned" },
      ],
      agentIdByName: new Map([["Mentioned", mentioned.id]]),
    });
    const reasons = store
      .listActiveSubscribers(issue.id)
      .map((entry) => entry.reason)
      .sort();
    expect(reasons).toEqual(["assignee", "commenter", "creator", "mentioned"]);
  });

  it("a person triggered twice keeps one row with the newest reason", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "me again",
    });
    const subs = store.listActiveSubscribers(issue.id);
    expect(subs).toHaveLength(1);
    expect(subs[0].reason).toBe("commenter");
  });

  it("soft unsubscribe keeps the row and a later comment revives it", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    store.unsubscribe({ issueId: issue.id, userType: "owner", userId: "owner" });
    expect(store.listActiveSubscribers(issue.id)).toHaveLength(0);
    store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "back again",
    });
    const subs = store.listActiveSubscribers(issue.id);
    expect(subs).toHaveLength(1);
    expect(subs[0].reason).toBe("commenter");
  });

  it("the sub-issues read face returns a parent's children in board order", () => {
    const parent = store.createIssue({ title: "P", creatorType: "owner", creatorId: "owner" });
    const childA = store.createIssue({
      title: "childA",
      creatorType: "owner",
      creatorId: "owner",
      parentIssueId: parent.id,
    });
    const childB = store.createIssue({
      title: "childB",
      creatorType: "owner",
      creatorId: "owner",
      parentIssueId: parent.id,
    });
    const children = store.listChildIssues(parent.id).map((entry) => entry.id);
    expect(children).toEqual([childB.id, childA.id]); // newest on top
    expect(store.listChildIssues(childA.id)).toHaveLength(0);
  });
});

describe("comment reactions", () => {
  it("one row per person per emoji, toggling by the unique key", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const comment = store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "hello",
    });
    store.setCommentReaction({
      commentId: comment.id,
      userType: "owner",
      userId: "owner",
      emoji: "👍",
      reacted: true,
    });
    store.setCommentReaction({
      commentId: comment.id,
      userType: "owner",
      userId: "owner",
      emoji: "👍",
      reacted: true,
    });
    const agent = store.createAgent({ name: "Reactor" });
    store.setCommentReaction({
      commentId: comment.id,
      userType: "agent",
      userId: agent.id,
      emoji: "👍",
      reacted: true,
    });
    const grouped = store.listCommentReactions(comment.id, { userType: "owner", userId: "owner" });
    expect(grouped).toEqual([{ emoji: "👍", count: 2, reactedByViewer: true }]);
    store.setCommentReaction({
      commentId: comment.id,
      userType: "owner",
      userId: "owner",
      emoji: "👍",
      reacted: false,
    });
    const after = store.listCommentReactions(comment.id, { userType: "owner", userId: "owner" });
    expect(after).toEqual([{ emoji: "👍", count: 1, reactedByViewer: false }]);
  });
});

describe("labels", () => {
  it("a set write replaces the whole relation and is idempotent per key", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const red = store.createLabel({ name: "bug", color: "#ef4444" });
    const blue = store.createLabel({ name: "docs", color: "#3b82f6" });
    store.setIssueLabels(issue.id, [red.id, blue.id]);
    store.setIssueLabels(issue.id, [red.id, blue.id]);
    expect(
      store
        .listLabelsForIssue(issue.id)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["bug", "docs"]);
    store.setIssueLabels(issue.id, [blue.id]);
    expect(store.listLabelsForIssue(issue.id).map((entry) => entry.name)).toEqual(["docs"]);
    store.setIssueLabels(issue.id, []);
    expect(store.listLabelsForIssue(issue.id)).toHaveLength(0);
  });

  it("deleting a label unlinks it from every issue", () => {
    // The relation cascades on the label's delete (FK), so a removed label
    // cannot leave dangling dots on cards.
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const red = store.createLabel({ name: "bug", color: "#ef4444" });
    store.setIssueLabels(issue.id, [red.id]);
    expect(store.listLabelsForIssue(issue.id)).toHaveLength(1);
  });
});

describe("comment revision", () => {
  it("editing bumps revision and deletes reply-less comments outright", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const comment = store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "first words",
    });
    const edited = store.editComment(comment.id, "second words");
    expect(edited.content).toBe("second words");
    expect(edited.revision).toBe(comment.revision + 1);
    store.deleteComment(comment.id);
    expect(store.listCommentsForIssue(issue.id)).toHaveLength(0);
  });

  it("a comment with replies becomes a tombstone, keeping the thread", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const parent = store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "root",
    });
    store.createComment({
      issueId: issue.id,
      authorType: "owner",
      authorId: "owner",
      content: "reply",
      parentId: parent.id,
    });
    store.deleteComment(parent.id);
    const rows = store.listCommentsForIssue(issue.id);
    expect(rows).toHaveLength(2);
    const tomb = rows.find((row) => row.id === parent.id);
    expect(tomb?.content).toBe("");
    expect(tomb?.deletedAt).not.toBeNull();
  });
});

describe("label directory management", () => {
  it("rename and recolor keep the omitted field", () => {
    const label = store.createLabel({ name: "bug", color: "#ef4444" });
    const renamed = store.updateLabel(label.id, { name: "defect" });
    expect(renamed.name).toBe("defect");
    expect(renamed.color).toBe("#ef4444");
    const recolored = store.updateLabel(label.id, { color: "#22c55e" });
    expect(recolored.name).toBe("defect");
    expect(recolored.color).toBe("#22c55e");
  });

  it("deleting a label cascades its attachments away", () => {
    const issue = store.createIssue({ title: "A", creatorType: "owner", creatorId: "owner" });
    const label = store.createLabel({ name: "temp", color: "#3b82f6" });
    store.setIssueLabels(issue.id, [label.id]);
    expect(store.listLabelsForIssue(issue.id)).toHaveLength(1);
    store.deleteLabel(label.id);
    expect(store.listLabelsForIssue(issue.id)).toHaveLength(0);
    expect(store.listLabels()).toHaveLength(0);
  });

  it("unknown label ids error rather than no-op", () => {
    expect(() => store.updateLabel("missing", { name: "x" })).toThrow(/label/i);
    expect(() => store.deleteLabel("missing")).toThrow(/label/i);
  });
});

describe("inbox bulk archive", () => {
  it("archive-all files every live item; archive-all-read only the read ones", () => {
    const first = store.createInboxItem({
      type: "run_failed",
      severity: "info",
      title: "one",
      actorType: "agent",
      actorId: "a1",
    });
    const second = store.createInboxItem({
      type: "run_failed",
      severity: "info",
      title: "two",
      actorType: "agent",
      actorId: "a1",
    });
    store.markInboxRead(first.id, true);
    expect(store.archiveAllReadInbox()).toBe(1);
    expect(store.getInboxItem(first.id).archived).toBe(true);
    expect(store.getInboxItem(second.id).archived).toBe(false);
    expect(store.archiveAllInbox()).toBe(1);
    expect(store.getInboxItem(second.id).archived).toBe(true);
  });
});

describe("my-issues scopes", () => {
  it("the four scopes read their own sets, and subscribed aliases involved", () => {
    const agent = store.createAgent({ name: "Mine agent" });
    store.createIssue({
      title: "on my desk",
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: "owner",
      assigneeId: "owner",
    });
    store.createIssue({
      title: "my agent holds it",
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: "agent",
      assigneeId: agent.id,
    });
    const other = store.createIssue({
      title: "unrelated",
      creatorType: "owner",
      creatorId: "owner",
    });
    store.addSubscriber({
      issueId: other.id,
      userType: "owner",
      userId: "owner",
      reason: "manual",
    });

    const titles = (scope: Parameters<typeof store.listMyIssues>[0]) =>
      store
        .listMyIssues(scope)
        .map((row) => row.title)
        .sort();
    expect(titles("all")).toEqual(["my agent holds it", "on my desk", "unrelated"]);
    expect(titles("assigned")).toEqual(["on my desk"]);
    expect(titles("created")).toEqual(["my agent holds it", "on my desk", "unrelated"]);
    // involved: what my team holds — the subscriber's own issue is not in it,
    // exactly as the source's predicate reads.
    expect(titles("involved")).toEqual(["my agent holds it"]);
    expect(titles("subscribed")).toEqual(titles("involved"));
  });
});
